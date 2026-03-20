"""
ml/core/main.py

FastAPI inference service. Entry point for the entire ML layer.

Endpoints:
  POST /ml/score       — score a transaction, return AnomaScoreResult
  POST /ml/explain     — Rupali's explainability router plugs in here
  GET  /ml/health      — service health + models loaded status
  GET  /ml/model-info  — model versions, training dates, metrics
  POST /simulator/trigger — trigger a fraud scenario (for demo)

Startup:
  - Loads all .pkl models from core/models/
  - Verifies Neo4j connection
  - Starts Kafka consumer in background thread

Run:
  uvicorn core.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
import pickle
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from core.graph.neo4j_client import health_check as neo4j_health
from core.scoring.anoma_score import compute_anoma_score, update_weights, get_weights

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MODELS_DIR = Path(__file__).parent / "models"
_startup_time = datetime.now(tz=timezone.utc)
_models_status: dict = {}


# ── Model loading at startup ──────────────────────────────────────────────────

def _load_all_models() -> dict:
    """
    Load all .pkl model files from core/models/.
    Returns a status dict for the /ml/health and /ml/model-info endpoints.
    """
    status = {}
    model_files = {
        "isolation_forest_layering": "isolation_forest_layering.pkl",
        "xgboost_structuring":       "xgboost_structuring.pkl",
        "logistic_dormancy":         "logistic_dormancy.pkl",
    }
    for name, filename in model_files.items():
        path = MODELS_DIR / filename
        if path.exists():
            try:
                with open(path, "rb") as f:
                    pickle.load(f)   # validate it loads cleanly
                mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
                status[name] = {
                    "loaded":       True,
                    "path":         str(path),
                    "trained_at":   mtime.isoformat(),
                    "size_kb":      round(path.stat().st_size / 1024, 1),
                }
                log.info("Model loaded: %s", name)
            except Exception as e:
                status[name] = {"loaded": False, "error": str(e)}
                log.error("Failed to load model %s: %s", name, e)
        else:
            status[name] = {"loaded": False, "error": "file not found — run train_classifiers.py"}
            log.warning("Model not found: %s", path)

    loaded_count = sum(1 for v in status.values() if v.get("loaded"))
    log.info("Models loaded: %d / %d", loaded_count, len(model_files))
    return status


# ── Kafka consumer background thread ─────────────────────────────────────────

def _start_kafka_consumer():
    """Start the Kafka consumer in a background thread."""
    try:
        from core.kafka.consumer import start_consumer
        t = threading.Thread(target=start_consumer, daemon=True, name="kafka-consumer")
        t.start()
        log.info("Kafka consumer started in background thread")
    except Exception as e:
        log.warning("Kafka consumer failed to start: %s — scoring via HTTP only", e)


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _models_status
    log.info("AnomaNet ML service starting...")

    # Load models
    _models_status = _load_all_models()

    # Check Neo4j
    if neo4j_health():
        log.info("Neo4j connection verified")
    else:
        log.warning("Neo4j not reachable — graph-based scoring degraded")

    # Start Kafka consumer
    _start_kafka_consumer()

    log.info("AnomaNet ML service ready on port 8000")
    yield

    log.info("AnomaNet ML service shutting down...")
    from core.graph.neo4j_client import close_driver
    close_driver()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AnomaNet ML Service",
    description="Fraud detection scoring engine — AnomaNet",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Plug in Rupali's explainability router (one line) ────────────────────────
try:
    from ml.modules.explainability.router import explain_router
    app.include_router(explain_router)
    log.info("Explainability router registered")
except ImportError:
    log.warning("Explainability router not available yet — POST /ml/explain uses fallback")


# ── Request / Response models ─────────────────────────────────────────────────

class ScoreRequest(BaseModel):
    transaction_id:          str
    account_id:              str
    amount:                  float
    channel:                 str
    initiated_at:            str          # ISO8601
    metadata:                dict         = Field(default_factory=dict)
    recent_transactions:     list[dict]   = Field(default_factory=list)
    kyc_risk_tier:           str          = "LOW"
    declared_monthly_income: float        = 0.0
    post_activation_outbound_hours: float = 999.0
    residency_seconds:       float        = 9999.0


class ScoreResponse(BaseModel):
    transaction_id:    str
    account_id:        str
    anoma_score:       float
    threshold_used:    float
    alert_triggered:   bool
    score_breakdown:   dict
    detected_patterns: list[str]
    scored_at:         str


class HealthResponse(BaseModel):
    status:          str
    models_loaded:   list[str]
    models_missing:  list[str]
    neo4j_healthy:   bool
    uptime_seconds:  float
    version:         str = "1.0.0"


class WeightsUpdateRequest(BaseModel):
    layering:         float
    circular:         float
    structuring:      float
    dormancy:         float
    profile_mismatch: float


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/ml/score", response_model=ScoreResponse)
async def score_transaction(req: ScoreRequest):
    """
    Score a single transaction for fraud.
    Called by Ratnesh's transaction-service after enrichment.
    Also called directly during testing.
    """
    try:
        ts = datetime.fromisoformat(req.initiated_at)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid initiated_at: {req.initiated_at}")

    try:
        result = compute_anoma_score(
            transaction_id                 = req.transaction_id,
            account_id                     = req.account_id,
            current_amount                 = req.amount,
            current_channel                = req.channel,
            current_tx_timestamp           = ts,
            current_tx_metadata            = req.metadata,
            recent_transactions            = req.recent_transactions,
            kyc_risk_tier                  = req.kyc_risk_tier,
            declared_monthly_income        = req.declared_monthly_income,
            post_activation_outbound_hours = req.post_activation_outbound_hours,
            residency_seconds              = req.residency_seconds,
        )
    except Exception as e:
        log.error("Scoring failed for tx %s: %s", req.transaction_id, e)
        raise HTTPException(status_code=500, detail=f"Scoring error: {str(e)}")

    return ScoreResponse(
        transaction_id    = result.transaction_id,
        account_id        = result.account_id,
        anoma_score       = result.anoma_score,
        threshold_used    = result.threshold_used,
        alert_triggered   = result.alert_triggered,
        score_breakdown   = result.score_breakdown,
        detected_patterns = result.detected_patterns,
        scored_at         = result.scored_at,
    )


@app.get("/ml/health", response_model=HealthResponse)
async def health():
    """
    Service health check. Called by Ratnesh's Spring Boot services
    and by docker-compose healthcheck.
    """
    loaded  = [k for k, v in _models_status.items() if v.get("loaded")]
    missing = [k for k, v in _models_status.items() if not v.get("loaded")]
    uptime  = (datetime.now(tz=timezone.utc) - _startup_time).total_seconds()

    return HealthResponse(
        status        = "ok" if len(missing) == 0 else "degraded",
        models_loaded = loaded,
        models_missing = missing,
        neo4j_healthy = neo4j_health(),
        uptime_seconds = round(uptime, 1),
    )


@app.get("/ml/model-info")
async def model_info():
    """
    Returns detailed info about loaded models.
    Displayed on the admin panel (Rupali's frontend).
    """
    return {
        "models": _models_status,
        "weights": get_weights(),
        "thresholds": {
            "standard": float(os.getenv("ANOMASCORE_THRESHOLD", "0.65")),
            "pep":      float(os.getenv("PEP_THRESHOLD", "0.45")),
        },
        "service_started": _startup_time.isoformat(),
    }


@app.put("/ml/weights")
async def update_scoring_weights(req: WeightsUpdateRequest):
    """
    Update AnomaScore weights at runtime.
    Called by Ratnesh's backend after admin panel PUT /api/admin/config.
    """
    new_weights = {
        "layering":         req.layering,
        "circular":         req.circular,
        "structuring":      req.structuring,
        "dormancy":         req.dormancy,
        "profile_mismatch": req.profile_mismatch,
    }
    try:
        update_weights(new_weights)
        return {"status": "updated", "weights": get_weights()}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/simulator/trigger")
async def trigger_scenario(type: str, background_tasks: BackgroundTasks):
    """
    Trigger a fraud scenario from the simulator.
    Called by Ratnesh's simulator-bridge service.
    Runs scenario generation in background — returns immediately.
    """
    valid_types = {"LAYERING", "CIRCULAR", "STRUCTURING", "DORMANT", "PROFILE_MISMATCH"}
    if type.upper() not in valid_types:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid scenario type. Valid: {valid_types}"
        )

    scenario_id = f"{type.upper()}_{int(time.time())}"
    background_tasks.add_task(_run_scenario, type.upper(), scenario_id)

    return {"triggered": True, "scenario_id": scenario_id, "type": type.upper()}


def _run_scenario(scenario_type: str, scenario_id: str):
    """Run a single on-demand fraud scenario and push transactions to Kafka."""
    try:
        from datetime import timezone
        from data_simulator.models import SIM_END

        log.info("Running scenario: %s (%s)", scenario_type, scenario_id)

        txns = []

        if scenario_type == "CIRCULAR":
            from data_simulator.scenarios.circular import generate_circular_cluster
            txns, _, _ = generate_circular_cluster(
                n_clusters=1, shared_pool=[], sim_end=SIM_END)

        elif scenario_type == "LAYERING":
            from data_simulator.scenarios.layering import generate_layering_cluster
            txns, _, _ = generate_layering_cluster(
                n_clusters=1, shared_pool=[], sim_end=SIM_END)

        elif scenario_type == "STRUCTURING":
            from data_simulator.scenarios.structuring import generate_structuring_cluster
            txns, _, _ = generate_structuring_cluster(
                n_clusters=1, shared_pool=[], sim_end=SIM_END)

        elif scenario_type == "DORMANT":
            from data_simulator.scenarios.dormant_activation import generate_dormant_cluster
            txns, _, _ = generate_dormant_cluster(n_clusters=1, sim_end=SIM_END)

        elif scenario_type == "PROFILE_MISMATCH":
            from data_simulator.scenarios.profile_mismatch_gen import generate_profile_mismatch_cluster
            txns, _, _ = generate_profile_mismatch_cluster(n_clusters=1, sim_end=SIM_END)

        # Push to Kafka
        _publish_scenario_transactions(txns, scenario_id)
        log.info("Scenario %s complete — %d transactions published", scenario_id, len(txns))

    except Exception as e:
        log.error("Scenario %s failed: %s", scenario_id, e)


def _publish_scenario_transactions(txns, scenario_id: str):
    """Publish scenario transactions to Kafka raw.transactions topic."""
    try:
        import json
        from kafka import KafkaProducer

        producer = KafkaProducer(
            bootstrap_servers=os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        )
        for tx in txns:
            msg = {
                "event_type":    "TRANSACTION_CREATED",
                "event_id":      tx.id,
                "schema_version": "1.0",
                "timestamp":     tx.initiated_at.isoformat(),
                "scenario_id":   scenario_id,
                "transaction": {
                    "id":               tx.id,
                    "reference_number": tx.reference_number,
                    "source_account_id": tx.source_account_id,
                    "dest_account_id":  tx.dest_account_id,
                    "amount":           tx.amount,
                    "currency":         "INR",
                    "channel":          tx.channel,
                    "initiated_at":     tx.initiated_at.isoformat(),
                    "branch_id":        tx.branch_id,
                },
            }
            producer.send("raw.transactions", value=msg)
        producer.flush()
        producer.close()
    except Exception as e:
        log.error("Failed to publish scenario transactions: %s", e)


# ── Fallback explain endpoint (when Rupali's router not loaded) ───────────────

@app.post("/ml/explain")
async def explain_fallback(body: dict):
    """
    Fallback explainability endpoint.
    Replaced automatically when Rupali's explain_router loads.
    """
    from ml.interfaces import get_explanation
    alert_id       = body.get("alert_id", "unknown")
    score_breakdown = body.get("score_breakdown", {})
    explanation    = get_explanation(alert_id, score_breakdown)
    return {
        "explanation":     explanation,
        "evidence_points": [
            f"{k}: {v:.2f}" for k, v in score_breakdown.items() if v > 0.4
        ],
    }