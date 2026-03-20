"""
ml/core/kafka/consumer.py

Kafka consumer for the ML scoring pipeline.

Consumes:  ml.scoring.queue     (EnrichmentEvents from Ratnesh's transaction-service)
Publishes: alerts.generated     (AlertEvents when AnomaScore >= threshold)
Publishes: ml.scoring.dlq       (dead-letter queue for failed messages)

Flow per message:
  1. Deserialise EnrichmentEvent
  2. Write transaction edge to Neo4j (live graph update)
  3. Get rolling features from Rupali's Redis store
  4. Compute residency time (time between inbound and outbound on same account)
  5. Run compute_anoma_score() — all 5 detectors
  6. Update account's anoma_score in Neo4j
  7. If alert_triggered → publish AlertEvent to alerts.generated
  8. On any error → publish to dead-letter queue, continue

Resilience:
  - Each message is processed independently — one failure never blocks the queue
  - Dead-letter queue captures failed messages for manual review
  - Consumer retries on connection loss with exponential backoff
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)

KAFKA_SERVERS      = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
SCORING_TOPIC      = "ml.scoring.queue"
ALERTS_TOPIC       = "alerts.generated"
DLQ_TOPIC          = "ml.scoring.dlq"
CONSUMER_GROUP     = "anomanet-ml-scorer"
MAX_POLL_RECORDS   = 10
SESSION_TIMEOUT_MS = 30_000


# ── Residency time computation ────────────────────────────────────────────────

def _compute_residency(account_id: str, current_tx_time: datetime) -> float:
    """
    Compute residency time: seconds between the most recent inbound
    transaction and the current outbound transaction on this account.
    Short residency = money arrives and immediately leaves = layering signal.

    Returns 9999.0 if no recent inbound found (safe default — no signal).
    """
    try:
        from core.graph.neo4j_client import get_driver
        cypher = """
        MATCH (src)-[r:TRANSFERRED_TO]->(a:Account {id: $account_id})
        WHERE r.timestamp < $current_time
        RETURN r.timestamp AS inbound_time
        ORDER BY r.timestamp DESC
        LIMIT 1
        """
        with get_driver().session() as session:
            result = session.run(
                cypher,
                account_id   = account_id,
                current_time = current_tx_time.isoformat(),
            )
            record = result.single()
            if record and record["inbound_time"]:
                inbound_ts = datetime.fromisoformat(str(record["inbound_time"]))
                if inbound_ts.tzinfo is None:
                    inbound_ts = inbound_ts.replace(tzinfo=timezone.utc)
                residency = (current_tx_time - inbound_ts).total_seconds()
                return max(0.0, residency)
    except Exception as e:
        log.debug("Residency computation failed for %s: %s", account_id, e)
    return 9999.0


def _compute_outbound_hours(account_id: str, inbound_time: datetime) -> float:
    """
    For dormancy scoring: how many hours between inbound and first outbound?
    """
    try:
        from core.graph.neo4j_client import get_driver
        cypher = """
        MATCH (a:Account {id: $account_id})-[r:TRANSFERRED_TO]->()
        WHERE r.timestamp > $inbound_time
        RETURN r.timestamp AS outbound_time
        ORDER BY r.timestamp ASC
        LIMIT 1
        """
        with get_driver().session() as session:
            result = session.run(
                cypher,
                account_id   = account_id,
                inbound_time = inbound_time.isoformat(),
            )
            record = result.single()
            if record and record["outbound_time"]:
                outbound_ts = datetime.fromisoformat(str(record["outbound_time"]))
                if outbound_ts.tzinfo is None:
                    outbound_ts = outbound_ts.replace(tzinfo=timezone.utc)
                return (outbound_ts - inbound_time).total_seconds() / 3600
    except Exception as e:
        log.debug("Outbound hours computation failed: %s", e)
    return 999.0


# ── Recent transactions for structuring scorer ────────────────────────────────

def _get_recent_transactions(account_id: str, days: int = 7) -> list[dict]:
    """
    Fetch recent transactions for the structuring scorer.
    Returns list of dicts with amount, channel, branch_id, initiated_at.
    """
    try:
        from core.graph.neo4j_client import get_driver
        from datetime import timedelta
        since = (datetime.now(tz=timezone.utc) - timedelta(days=days)).isoformat()
        cypher = """
        MATCH (a:Account {id: $account_id})-[r:TRANSFERRED_TO]->()
        WHERE r.timestamp >= $since
        RETURN r.amount AS amount, r.channel AS channel,
               r.branch_id AS branch_id, r.timestamp AS initiated_at
        ORDER BY r.timestamp DESC
        LIMIT 50
        """
        with get_driver().session() as session:
            result = session.run(cypher, account_id=account_id, since=since)
            return [dict(row) for row in result.data()]
    except Exception as e:
        log.debug("get_recent_transactions failed for %s: %s", account_id, e)
    return []


# ── Message processing ────────────────────────────────────────────────────────

def _process_message(msg_value: dict, producer) -> bool:
    """
    Process a single EnrichmentEvent from ml.scoring.queue.
    Returns True if processed successfully, False if should go to DLQ.
    """
    try:
        tx = msg_value.get("transaction", {})
        if not tx:
            log.warning("Message missing transaction field: %s", msg_value)
            return False

        tx_id      = tx.get("id", "")
        account_id = tx.get("source_account_id", "")
        amount     = float(tx.get("amount", 0))
        channel    = tx.get("channel", "UNKNOWN")
        branch_id  = tx.get("branch_id", "")
        initiated_at_str = tx.get("initiated_at", "")
        metadata   = tx.get("metadata", {})

        # Account KYC from enrichment event (Ratnesh enriches before publishing)
        account    = msg_value.get("account", {})
        kyc_tier   = account.get("kyc_risk_tier", "LOW")
        declared_income = float(account.get("declared_monthly_income", 0) or 0)
        dest_account_id = tx.get("dest_account_id", "")

        if not all([tx_id, account_id, amount, initiated_at_str]):
            log.warning("Incomplete transaction data: %s", tx_id)
            return False

        try:
            tx_time = datetime.fromisoformat(initiated_at_str)
            if tx_time.tzinfo is None:
                tx_time = tx_time.replace(tzinfo=timezone.utc)
        except ValueError:
            log.error("Invalid timestamp: %s", initiated_at_str)
            return False

        # ── Step 1: Write edge to Neo4j ───────────────────────────────────────
        from core.graph.neo4j_client import write_transaction_edge, update_anoma_score
        write_transaction_edge(
            tx_id            = tx_id,
            source_account_id = account_id,
            dest_account_id  = dest_account_id,
            amount           = amount,
            channel          = channel,
            timestamp        = tx_time.isoformat(),
            branch_id        = branch_id,
        )

        # ── Step 2: Compute contextual features ───────────────────────────────
        residency_seconds = _compute_residency(account_id, tx_time)
        outbound_hours    = _compute_outbound_hours(account_id, tx_time)
        recent_txns       = _get_recent_transactions(account_id, days=7)

        # ── Step 3: Score ─────────────────────────────────────────────────────
        from core.scoring.anoma_score import compute_anoma_score
        result = compute_anoma_score(
            transaction_id                 = tx_id,
            account_id                     = account_id,
            current_amount                 = amount,
            current_channel                = channel,
            current_tx_timestamp           = tx_time,
            current_tx_metadata            = metadata,
            recent_transactions            = recent_txns,
            kyc_risk_tier                  = kyc_tier,
            declared_monthly_income        = declared_income,
            post_activation_outbound_hours = outbound_hours,
            residency_seconds              = residency_seconds,
        )

        # ── Step 4: Update Neo4j anoma_score ──────────────────────────────────
        update_anoma_score(account_id, result.anoma_score)

        # ── Step 5: Publish alert if triggered ────────────────────────────────
        if result.alert_triggered:
            alert_event = {
                "event_type":       "ALERT_GENERATED",
                "alert_id":         f"ALT_{tx_id[:8]}_{int(time.time())}",
                "transaction_id":   tx_id,
                "account_id":       account_id,
                "anoma_score":      result.anoma_score,
                "score_breakdown":  result.score_breakdown,
                "detected_patterns": result.detected_patterns,
                "threshold_used":   result.threshold_used,
                "timestamp":        datetime.now(tz=timezone.utc).isoformat(),
            }
            producer.send(
                ALERTS_TOPIC,
                value=json.dumps(alert_event).encode("utf-8"),
            )
            log.info(
                "ALERT published | tx=%s | account=%s | score=%.3f | patterns=%s",
                tx_id, account_id, result.anoma_score, result.detected_patterns,
            )

        return True

    except Exception as e:
        log.error("Message processing failed: %s | error: %s", msg_value.get("transaction", {}).get("id", "?"), e)
        return False


# ── Dead-letter queue ─────────────────────────────────────────────────────────

def _send_to_dlq(producer, raw_value: bytes, error: str):
    """Send failed message to dead-letter queue for manual review."""
    try:
        dlq_msg = {
            "failed_at":    datetime.now(tz=timezone.utc).isoformat(),
            "error":        error,
            "raw_message":  raw_value.decode("utf-8", errors="replace"),
        }
        producer.send(DLQ_TOPIC, value=json.dumps(dlq_msg).encode("utf-8"))
    except Exception as e:
        log.error("Failed to send to DLQ: %s", e)


# ── Main consumer loop ────────────────────────────────────────────────────────

def start_consumer():
    """
    Main consumer loop. Runs in a background thread.
    Called by core/main.py at startup.

    Retry logic:
      - Connection failure → exponential backoff up to 60 seconds
      - Message processing failure → send to DLQ, continue
      - KeyboardInterrupt → clean shutdown
    """
    from kafka import KafkaConsumer, KafkaProducer
    from kafka.errors import NoBrokersAvailable

    retry_delay = 5
    max_delay   = 60

    while True:
        consumer = None
        producer = None
        try:
            log.info("Connecting to Kafka at %s...", KAFKA_SERVERS)

            consumer = KafkaConsumer(
                SCORING_TOPIC,
                bootstrap_servers     = KAFKA_SERVERS,
                group_id              = CONSUMER_GROUP,
                auto_offset_reset     = "latest",
                enable_auto_commit    = True,
                auto_commit_interval_ms = 5000,
                max_poll_records      = MAX_POLL_RECORDS,
                session_timeout_ms    = SESSION_TIMEOUT_MS,
                value_deserializer    = lambda v: json.loads(v.decode("utf-8")),
            )

            producer = KafkaProducer(
                bootstrap_servers = KAFKA_SERVERS,
                acks              = "all",
                retries           = 3,
            )

            log.info("Kafka consumer ready — listening on %s", SCORING_TOPIC)
            retry_delay = 5   # reset backoff on successful connection

            for message in consumer:
                try:
                    success = _process_message(message.value, producer)
                    if not success:
                        _send_to_dlq(
                            producer,
                            message.value if isinstance(message.value, bytes)
                            else json.dumps(message.value).encode(),
                            "Processing returned False",
                        )
                except Exception as e:
                    log.error("Unhandled error in message loop: %s", e)
                    _send_to_dlq(
                        producer,
                        json.dumps(message.value).encode() if message.value else b"{}",
                        str(e),
                    )

        except NoBrokersAvailable:
            log.warning("Kafka not available — retrying in %ds", retry_delay)
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, max_delay)

        except KeyboardInterrupt:
            log.info("Kafka consumer shutting down")
            break

        except Exception as e:
            log.error("Consumer error: %s — retrying in %ds", e, retry_delay)
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, max_delay)

        finally:
            if consumer:
                try:
                    consumer.close()
                except Exception:
                    pass
            if producer:
                try:
                    producer.flush()
                    producer.close()
                except Exception:
                    pass