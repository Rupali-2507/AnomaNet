"""
ml/core/batch_score.py

Enriched batch scorer — fires all 5 detectors properly.

Key difference from naive version:
  - Pulls full 7-day transaction history from Neo4j for structuring + layering
  - Computes residency_seconds from Neo4j for layering
  - Computes post_activation_outbound_hours from Neo4j for dormancy
  - Builds rolling_features dict from Neo4j history (bypasses Redis)
  - Pulls declared_monthly_income from Neo4j Customer node
  - BACKFILLS Redis with 30d history so profile_mismatch gets real features

Run from ml/ directory:
    python -m core.batch_score

FIXES APPLIED:
  1. Cypher uses chained WITH to avoid cartesian product
     (was causing UserWarning + income always 0)
  2. avg_tx_amount_30d now filters to last 30 days only
  3. channel_entropy computed from real channel distribution (was hardcoded 0.5)
  4. Redis backfill: pushes 30d outbound history into Redis per account so
     profile_mismatch/inference.py gets real rolling features instead of zeros
     (was causing every account to score identically at 0.183)
"""

import logging
from collections import Counter
from datetime import datetime, timezone, timedelta
from math import log2

from core.graph.neo4j_client import get_driver, update_anoma_score
from core.scoring.anoma_score import compute_anoma_score

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def get_all_account_ids() -> list[str]:
    with get_driver().session() as s:
        return [r["id"] for r in s.run("MATCH (a:Account) RETURN a.id AS id").data()]


def get_account_context(account_id: str) -> dict | None:
    """
    Pulls everything the 5 scorers need directly from Neo4j.
    Returns None if account has no transactions at all.

    FIX: Chained OPTIONAL MATCH with intermediate WITH clauses to prevent
    the cartesian product that was causing:
      - UserWarning: Expected a result with a single record, but found multiple
      - declared_monthly_income always returning 0 (wrong row picked by .single())
    """
    cypher = """
    MATCH (a:Account {id: $id})
    OPTIONAL MATCH (c:Customer)-[:OWNS]->(a)

    WITH a, c

    OPTIONAL MATCH (a)-[out:TRANSFERRED_TO]->(dst:Account)
    WITH a, c,
         collect(DISTINCT {
             amount:    out.amount,
             channel:   out.channel,
             branch_id: out.branch_id,
             timestamp: out.timestamp,
             dst_id:    dst.id
         }) AS outbound

    OPTIONAL MATCH (src2:Account)-[in_:TRANSFERRED_TO]->(a)
    WITH a, c, outbound,
         collect(DISTINCT {
             amount:    in_.amount,
             timestamp: in_.timestamp,
             src_id:    src2.id
         }) AS inbound

    RETURN
        a.is_dormant                             AS is_dormant,
        a.kyc_risk_tier                          AS kyc_risk_tier,
        a.branch_id                              AS branch_id,
        coalesce(c.declared_monthly_income, 0.0) AS declared_monthly_income,
        outbound,
        inbound
    """
    with get_driver().session() as s:
        record = s.run(cypher, id=account_id).single()
        if record is None:
            return None
        return dict(record)


def build_context(account_id: str, ctx: dict) -> dict:
    """
    Transforms raw Neo4j data into exactly what compute_anoma_score() needs.
    Also backfills Redis with 30d transaction history so profile_mismatch
    inference gets real rolling features instead of zeros.

    FIXES:
      - avg_tx_amount_30d now correctly filters to last 30 days
      - channel_entropy computed from real channel distribution
      - Redis backfill added for profile_mismatch real-time inference
    """
    now        = datetime.now(tz=timezone.utc)
    window_24h = now - timedelta(hours=24)
    window_1h  = now - timedelta(hours=1)
    window_7d  = now - timedelta(days=7)
    window_30d = now - timedelta(days=30)

    outbound = [t for t in (ctx["outbound"] or []) if t.get("amount") is not None]
    inbound  = [t for t in (ctx["inbound"]  or []) if t.get("amount") is not None]

    def parse_ts(ts_str):
        if not ts_str:
            return None
        try:
            dt = datetime.fromisoformat(str(ts_str))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None

    # ── recent_transactions for structuring (last 7 days outbound) ──────────
    recent_txns = []
    for t in outbound:
        ts = parse_ts(t.get("timestamp"))
        if ts and ts >= window_7d:
            recent_txns.append({
                "amount":       float(t.get("amount") or 0),
                "channel":      t.get("channel") or "UNKNOWN",
                "branch_id":    t.get("branch_id") or "",
                "initiated_at": ts.isoformat(),
            })

    # ── Time-windowed outbound buckets ───────────────────────────────────────
    out_1h  = [t for t in outbound
               if parse_ts(t.get("timestamp")) and parse_ts(t.get("timestamp")) >= window_1h]
    out_24h = [t for t in outbound
               if parse_ts(t.get("timestamp")) and parse_ts(t.get("timestamp")) >= window_24h]

    # FIX: was using all-time outbound; now correctly limited to 30 days
    out_30d = [t for t in outbound
               if parse_ts(t.get("timestamp")) and parse_ts(t.get("timestamp")) >= window_30d]

    # ── FIX: Backfill Redis with 30d history so profile_mismatch gets real data
    # profile_mismatch/inference.py calls get_rolling_features(account_id) from
    # Redis. In batch mode Redis is empty (Kafka consumer never ran), so every
    # account gets zero features → identical reconstruction error → score 0.183.
    # Pushing the Neo4j history into Redis here fixes this.
    try:
        from shared.feature_store.redis_store import set_transaction
        src_branch = ctx.get("branch_id") or "UNKNOWN"
        for t in out_30d:
            ts = parse_ts(t.get("timestamp"))
            if ts:
                set_transaction(
                    account_id   = account_id,
                    amount       = float(t.get("amount") or 0),
                    ts           = ts.timestamp(),
                    channel      = t.get("channel")   or "UNKNOWN",
                    dest_account = t.get("dst_id")    or "UNKNOWN",
                    dest_branch  = t.get("branch_id") or "UNKNOWN",
                    src_branch   = src_branch,
                )
    except Exception as e:
        log.warning("Redis backfill failed for %s: %s", account_id, e)

    # ── rolling_features aggregates ──────────────────────────────────────────
    branches_24h       = {t.get("branch_id") for t in out_24h if t.get("branch_id")}
    counterparties_24h = {t.get("dst_id")    for t in out_24h if t.get("dst_id")}
    total_amount_24h   = sum(float(t.get("amount") or 0) for t in out_24h)
    total_amount_1h    = sum(float(t.get("amount") or 0) for t in out_1h)

    all_amounts_30d = [float(t.get("amount") or 0) for t in out_30d]
    avg_amount_30d  = sum(all_amounts_30d) / len(all_amounts_30d) if all_amounts_30d else 0.0

    cross_branch = len(branches_24h) / max(len(out_24h), 1)

    # FIX: was hardcoded to 0.5; now computed from real channel distribution
    _channels = [t.get("channel") for t in out_24h if t.get("channel")]
    if _channels:
        _counts  = Counter(_channels)
        _total   = len(_channels)
        channel_entropy = -sum(
            (c / _total) * log2(c / _total) for c in _counts.values()
        )
    else:
        channel_entropy = 0.0

    rolling_features = {
        "tx_count_1h":               len(out_1h),
        "tx_count_24h":              len(out_24h),
        "total_amount_1h":           total_amount_1h,
        "total_amount_24h":          total_amount_24h,
        "unique_counterparties_24h": len(counterparties_24h),
        "out_degree_1h":             len({t.get("dst_id") for t in out_1h if t.get("dst_id")}),
        "cross_branch_ratio":        cross_branch,
        "avg_tx_amount_30d":         avg_amount_30d,
        "channel_entropy":           channel_entropy,
    }

    # ── residency_seconds for layering ───────────────────────────────────────
    residency_seconds = 9999.0
    if inbound and outbound:
        latest_in  = max(
            (parse_ts(t.get("timestamp")) for t in inbound  if parse_ts(t.get("timestamp"))),
            default=None,
        )
        latest_out = max(
            (parse_ts(t.get("timestamp")) for t in outbound if parse_ts(t.get("timestamp"))),
            default=None,
        )
        if latest_in and latest_out and latest_out > latest_in:
            residency_seconds = (latest_out - latest_in).total_seconds()

    # ── post_activation_outbound_hours for dormancy ──────────────────────────
    post_activation_outbound_hours = 999.0
    if ctx.get("is_dormant") and inbound and outbound:
        earliest_in  = min(
            (parse_ts(t.get("timestamp")) for t in inbound  if parse_ts(t.get("timestamp"))),
            default=None,
        )
        earliest_out = min(
            (parse_ts(t.get("timestamp")) for t in outbound if parse_ts(t.get("timestamp"))),
            default=None,
        )
        if earliest_in and earliest_out and earliest_out > earliest_in:
            post_activation_outbound_hours = (
                earliest_out - earliest_in
            ).total_seconds() / 3600

    # ── current_amount and timestamp: use most recent outbound ───────────────
    latest_tx_ts    = now
    current_amount  = 0.0
    current_channel = "UNKNOWN"
    if outbound:
        with_ts = [(parse_ts(t.get("timestamp")), t) for t in outbound]
        valid   = [(ts, t) for ts, t in with_ts if ts]
        if valid:
            latest_ts, latest_t = max(valid, key=lambda x: x[0])
            latest_tx_ts    = latest_ts
            current_amount  = float(latest_t.get("amount") or 0)
            current_channel = latest_t.get("channel") or "UNKNOWN"

    return {
        "current_amount":                 current_amount,
        "current_channel":                current_channel,
        "current_tx_timestamp":           latest_tx_ts,
        "recent_transactions":            recent_txns,
        "rolling_features":               rolling_features,
        "residency_seconds":              residency_seconds,
        "post_activation_outbound_hours": post_activation_outbound_hours,
        "kyc_risk_tier":                  ctx.get("kyc_risk_tier") or "LOW",
        "declared_monthly_income":        float(ctx.get("declared_monthly_income") or 0),
    }


def batch_score():
    log.info("Starting enriched batch scorer (all 5 detectors)...")
    account_ids = get_all_account_ids()
    total = len(account_ids)
    log.info("Found %d accounts", total)

    scored = skipped = errors = 0
    start_time = datetime.now(tz=timezone.utc)

    for i, account_id in enumerate(account_ids, 1):
        try:
            ctx = get_account_context(account_id)
            if ctx is None:
                update_anoma_score(account_id, 0.0)
                skipped += 1
            else:
                has_transactions = any(
                    t.get("amount") is not None
                    for t in (ctx.get("outbound") or []) + (ctx.get("inbound") or [])
                )
                if not has_transactions:
                    update_anoma_score(account_id, 0.0)
                    skipped += 1
                else:
                    c = build_context(account_id, ctx)
                    result = compute_anoma_score(
                        transaction_id                 = f"BATCH_{account_id}",
                        account_id                     = account_id,
                        current_amount                 = c["current_amount"],
                        current_channel                = c["current_channel"],
                        current_tx_timestamp           = c["current_tx_timestamp"],
                        recent_transactions            = c["recent_transactions"],
                        kyc_risk_tier                  = c["kyc_risk_tier"],
                        declared_monthly_income        = c["declared_monthly_income"],
                        post_activation_outbound_hours = c["post_activation_outbound_hours"],
                        residency_seconds              = c["residency_seconds"],
                    )
                    update_anoma_score(account_id, result.anoma_score)
                    scored += 1

        except Exception as e:
            log.error("Failed account %s: %s", account_id, e)
            errors += 1

        # ── Progress bar ─────────────────────────────────────────────────────
        elapsed     = (datetime.now(tz=timezone.utc) - start_time).total_seconds()
        rate        = i / elapsed if elapsed > 0 else 0
        eta_seconds = (total - i) / rate if rate > 0 else 0
        eta_str     = str(timedelta(seconds=int(eta_seconds)))
        elapsed_str = str(timedelta(seconds=int(elapsed)))

        pct      = i / total
        bar_done = int(30 * pct)
        bar      = "█" * bar_done + "░" * (30 - bar_done)

        print(
            f"\r[{bar}] {i}/{total} ({pct*100:.1f}%) | "
            f"✓{scored} ✗{errors} ~{skipped} | "
            f"{rate:.1f} acc/s | elapsed {elapsed_str} | ETA {eta_str}   ",
            end="", flush=True,
        )

    elapsed_total = (datetime.now(tz=timezone.utc) - start_time).total_seconds()
    print()
    log.info(
        "Done in %s — scored=%d | skipped=%d | errors=%d",
        str(timedelta(seconds=int(elapsed_total))), scored, skipped, errors,
    )


if __name__ == "__main__":
    batch_score()