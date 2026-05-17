"""
ml/shared/feature_store/redis_store.py

Rolling-window feature cache backed by Redis sorted sets.

Public API:
    get_rolling_features(account_id: str) -> dict
    set_transaction(account_id: str, amount: float, ts: float) -> None

How it works:
  Each transaction is stored in a Redis sorted set keyed by account_id,
  with the Unix timestamp as the score. This allows O(log N) range queries
  like "all transactions in the last 1 hour".

  Features computed on read (no separate aggregation job needed):
    tx_count_1h               — number of transactions in the last hour
    tx_count_24h              — number of transactions in the last 24 hours
    total_amount_24h          — sum of amounts in the last 24 hours
    unique_counterparties_24h — distinct destination accounts in 24 hours
    avg_tx_amount_30d         — rolling 30-day average transaction amount
    channel_entropy           — Shannon entropy of payment channels used
    cross_branch_ratio        — fraction of transactions to different branches

  Keys used in Redis:
    txns:{account_id}               — sorted set of (amount|channel|dest|branch, ts)
    feat_cache:{account_id}         — cached feature dict (TTL 60s)

Owner: Rupali
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
from collections import Counter
from typing import Optional

import redis

log = logging.getLogger(__name__)

# ── Redis connection config ───────────────────────────────────────────────────
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB   = int(os.getenv("REDIS_DB",   "0"))
REDIS_PASS = os.getenv("REDIS_PASSWORD", None)

# TTLs
FEATURE_CACHE_TTL  = 60          # seconds — recompute features every minute
TX_RETENTION_SECS  = 86400 * 31  # keep 31 days of tx data per account

# Time windows (seconds)
WINDOW_1H  = 3600
WINDOW_24H = 86400
WINDOW_30D = 86400 * 30

# Redis key prefixes
PREFIX_TXNS  = "txns"
PREFIX_CACHE = "feat_cache"

# ── Singleton Redis client ────────────────────────────────────────────────────
_client: Optional[redis.Redis] = None


def _get_client() -> redis.Redis:
    global _client
    if _client is not None:
        try:
            _client.ping()
            return _client
        except Exception:
            _client = None

    ssl = os.getenv("REDIS_SSL", "false").lower() == "true"

    _client = redis.Redis(
        host             = REDIS_HOST,
        port             = REDIS_PORT,
        db               = REDIS_DB,
        password         = REDIS_PASS,
        ssl              = ssl,
        decode_responses = True,
        socket_connect_timeout = 2,
        socket_timeout         = 2,
    )
    log.info("Redis client connected to %s:%d db=%d ssl=%s", REDIS_HOST, REDIS_PORT, REDIS_DB, ssl)
    return _client


# ── Transaction ingestion ─────────────────────────────────────────────────────

def set_transaction(
    account_id:   str,
    amount:       float,
    ts:           Optional[float] = None,
    channel:      str = "UNKNOWN",
    dest_account: str = "UNKNOWN",
    dest_branch:  str = "UNKNOWN",
    src_branch:   str = "UNKNOWN",
) -> None:
    """
    Record a transaction in the Redis sorted set for account_id.

    Called by the Kafka consumer (ml/core/kafka/consumer.py) every time
    a new transaction arrives, so features are always up to date.

    Args:
        account_id:   the source or destination account
        amount:       transaction amount (INR)
        ts:           Unix timestamp (defaults to now)
        channel:      NEFT / RTGS / UPI / SWIFT / CASH / etc.
        dest_account: destination account ID (for counterparty counting)
        dest_branch:  destination branch ID
        src_branch:   source / home branch of the account
    """
    ts = ts or time.time()
    key = f"{PREFIX_TXNS}:{account_id}"

    # Encode all fields into a single member string so sorted set is self-contained
    member = json.dumps({
        "amount":       amount,
        "channel":      channel,
        "dest_account": dest_account,
        "dest_branch":  dest_branch,
        "src_branch":   src_branch,
    }, separators=(",", ":"))

    try:
        client = _get_client()
        pipe   = client.pipeline()

        # Add transaction with timestamp as score
        pipe.zadd(key, {member: ts})

        # Expire old transactions (keep 31 days)
        cutoff = ts - TX_RETENTION_SECS
        pipe.zremrangebyscore(key, "-inf", cutoff)

        # Set TTL on the key itself (auto-clean inactive accounts)
        pipe.expire(key, TX_RETENTION_SECS)

        # Invalidate feature cache so next read recomputes
        pipe.delete(f"{PREFIX_CACHE}:{account_id}")

        pipe.execute()

    except Exception as e:
        log.error("set_transaction failed for account %s: %s", account_id, e)


# ── Feature computation ───────────────────────────────────────────────────────

def _parse_member(member: str) -> dict:
    """Parse a stored sorted-set member back into a dict."""
    try:
        return json.loads(member)
    except Exception:
        return {"amount": 0.0, "channel": "UNKNOWN",
                "dest_account": "UNKNOWN", "dest_branch": "UNKNOWN",
                "src_branch": "UNKNOWN"}


def _shannon_entropy(counts: Counter) -> float:
    """Normalised Shannon entropy of a frequency distribution."""
    total = sum(counts.values())
    if total == 0:
        return 0.0
    probs = [c / total for c in counts.values()]
    raw_entropy = -sum(p * math.log2(p) for p in probs if p > 0)
    # Normalise by max possible entropy (log2 of number of distinct values)
    max_entropy = math.log2(len(counts)) if len(counts) > 1 else 1.0
    return raw_entropy / max_entropy


def _compute_features(account_id: str) -> dict:
    """
    Compute all rolling features for an account by querying its sorted set.
    This is the core computation — results are cached for FEATURE_CACHE_TTL seconds.
    """
    client = _get_client()
    key    = f"{PREFIX_TXNS}:{account_id}"
    now    = time.time()

    # Fetch all transactions in the last 30 days (widest window needed)
    cutoff_30d = now - WINDOW_30D
    cutoff_24h = now - WINDOW_24H
    cutoff_1h  = now - WINDOW_1H

    # zrangebyscore returns list of (member, score) tuples with withscores=True
    try:
        raw_30d = client.zrangebyscore(key, cutoff_30d, "+inf", withscores=True)
    except Exception as e:
        log.warning("Redis query failed for account %s: %s", account_id, e)
        return _zero_features()

    if not raw_30d:
        return _zero_features()

    # Parse all records
    records_30d = [(r_parse := _parse_member(m), float(ts)) for m, ts in raw_30d]
    records_24h = [(r, ts) for r, ts in records_30d if ts >= cutoff_24h]
    records_1h  = [(r, ts) for r, ts in records_24h if ts >= cutoff_1h]

    # ── tx_count_1h / tx_count_24h ────────────────────────────────────────────
    tx_count_1h  = len(records_1h)
    tx_count_24h = len(records_24h)

    # ── total_amount_24h ──────────────────────────────────────────────────────
    total_amount_24h = sum(r["amount"] for r, _ in records_24h)

    # ── avg_tx_amount_30d ─────────────────────────────────────────────────────
    amounts_30d      = [r["amount"] for r, _ in records_30d]
    avg_tx_amount_30d = (sum(amounts_30d) / len(amounts_30d)) if amounts_30d else 0.0

    # ── unique_counterparties_24h ─────────────────────────────────────────────
    dest_accounts_24h = {r["dest_account"] for r, _ in records_24h}
    dest_accounts_24h.discard("UNKNOWN")
    unique_counterparties_24h = len(dest_accounts_24h)

    # ── channel_entropy ───────────────────────────────────────────────────────
    channels_24h  = Counter(r["channel"] for r, _ in records_24h)
    channel_entropy = _shannon_entropy(channels_24h)

    # ── cross_branch_ratio ────────────────────────────────────────────────────
    cross_branch_count = sum(
        1 for r, _ in records_24h
        if r["dest_branch"] not in ("UNKNOWN", "") and
           r["src_branch"]  not in ("UNKNOWN", "") and
           r["dest_branch"] != r["src_branch"]
    )
    cross_branch_ratio = (
        cross_branch_count / tx_count_24h if tx_count_24h > 0 else 0.0
    )

    return {
        "tx_count_1h":               tx_count_1h,
        "tx_count_24h":              tx_count_24h,
        "total_amount_24h":          round(total_amount_24h, 2),
        "unique_counterparties_24h": unique_counterparties_24h,
        "avg_tx_amount_30d":         round(avg_tx_amount_30d, 2),
        "channel_entropy":           round(channel_entropy, 4),
        "cross_branch_ratio":        round(cross_branch_ratio, 4),
    }


def _zero_features() -> dict:
    """Return a safe all-zeros feature dict (used as fallback)."""
    return {
        "tx_count_1h":               0,
        "tx_count_24h":              0,
        "total_amount_24h":          0.0,
        "unique_counterparties_24h": 0,
        "avg_tx_amount_30d":         0.0,
        "channel_entropy":           0.0,
        "cross_branch_ratio":        0.0,
    }


# ── Public function: get_rolling_features ─────────────────────────────────────

def get_rolling_features(account_id: str) -> dict:
    """
    Return rolling-window velocity features for the account from Redis.

    Imported by interfaces.py as _real_features.
    Called by Muskan's layering scorer and profile mismatch inference.

    Features:
        tx_count_1h               int    transactions in last 1 hour
        tx_count_24h              int    transactions in last 24 hours
        total_amount_24h          float  total INR transacted in 24h
        unique_counterparties_24h int    distinct destination accounts in 24h
        avg_tx_amount_30d         float  30-day rolling average transaction amount
        channel_entropy           float  Shannon entropy of payment channels [0,1]
        cross_branch_ratio        float  fraction of cross-branch transactions [0,1]

    Returns:
        dict with all 7 keys guaranteed to be present.
        Returns zero-dict if Redis is unavailable.
    """
    cache_key = f"{PREFIX_CACHE}:{account_id}"

    # ── Try feature cache first ───────────────────────────────────────────────
    try:
        client  = _get_client()
        cached  = client.get(cache_key)
        if cached:
            features = json.loads(cached)
            log.debug("feature_store cache hit | account=%s", account_id)
            return features
    except Exception as e:
        log.warning("Feature cache read failed for %s: %s", account_id, e)

    # ── Compute from raw sorted set ───────────────────────────────────────────
    try:
        features = _compute_features(account_id)
    except Exception as e:
        log.error("Feature computation failed for %s: %s", account_id, e)
        return _zero_features()

    # ── Write back to cache ───────────────────────────────────────────────────
    try:
        client = _get_client()
        client.setex(cache_key, FEATURE_CACHE_TTL, json.dumps(features))
    except Exception as e:
        log.debug("Feature cache write failed for %s: %s", account_id, e)

    log.debug(
        "feature_store computed | account=%s | tx_1h=%d | tx_24h=%d | total_24h=%.0f",
        account_id,
        features["tx_count_1h"],
        features["tx_count_24h"],
        features["total_amount_24h"],
    )

    return features