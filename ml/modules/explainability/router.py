"""
ml/modules/explainability/router.py

FastAPI router for the explainability module.

Routes:
    POST /ml/explain        — generate explanation for a new alert
    GET  /ml/explain/{id}   — retrieve a cached explanation

Muskan adds ONE line to core/main.py to mount this router:
    app.include_router(explain_router)

Owner: Rupali
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from modules.explainability.generator import (
    get_cached_explanation,
    get_explanation,
    register_alert_tokens,
)

log = logging.getLogger(__name__)

explain_router = APIRouter(prefix="/ml", tags=["Explainability"])


# ── Request / response models ─────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    alert_id: str = Field(..., description="UUID of the alert to explain")
    score_breakdown: dict[str, float] = Field(
        ...,
        description=(
            "Per-pattern scores: layering, circular, structuring, "
            "dormancy, profile_mismatch — each 0.0–1.0"
        ),
        example={
            "layering":         0.72,
            "circular":         0.55,
            "structuring":      0.10,
            "dormancy":         0.05,
            "profile_mismatch": 0.63,
        },
    )
    tokens_by_pattern: dict[str, dict] = Field(
        default_factory=dict,
        description=(
            "Optional: rich explanation tokens from each detector, keyed by "
            "pattern name (CIRCULAR, LAYERING, etc.). Populated automatically "
            "when called from anoma_score.py."
        ),
    )


class ExplainResponse(BaseModel):
    alert_id:    str
    explanation: str
    patterns:    list[str] = Field(
        description="Pattern names that were active (score ≥ 0.45)"
    )


class CachedExplainResponse(BaseModel):
    alert_id:    str
    explanation: str
    cached:      bool = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@explain_router.post("/explain", response_model=ExplainResponse)
async def generate_explanation(body: ExplainRequest) -> ExplainResponse:
    """
    Generate a plain-English explanation for an AnomaNet alert.

    Called by:
      - Muskan's Kafka consumer after an alert is published
      - Ratnesh's backend when an analyst opens an alert in the UI

    The explanation is cached in Redis so subsequent GET calls
    are served instantly without recomputation.
    """
    log.info("POST /ml/explain | alert_id=%s", body.alert_id)

    # Register tokens if provided (allows richer template filling)
    if body.tokens_by_pattern:
        register_alert_tokens(body.alert_id, body.tokens_by_pattern)

    explanation = get_explanation(body.alert_id, body.score_breakdown)

    # Determine which patterns were active for the response metadata
    active_patterns = [
        k.upper()
        for k, v in body.score_breakdown.items()
        if v >= 0.45
    ]

    return ExplainResponse(
        alert_id    = body.alert_id,
        explanation = explanation,
        patterns    = active_patterns,
    )


@explain_router.get("/explain/{alert_id}", response_model=CachedExplainResponse)
async def get_explanation_by_id(alert_id: str) -> CachedExplainResponse:
    """
    Retrieve a previously generated explanation from cache.

    Called by:
      - Ratnesh's backend when rendering the alert detail page
      - Manya's frontend alert modal

    Returns 404 if the explanation has not been generated yet or has expired.
    """
    log.info("GET /ml/explain/%s", alert_id)

    cached = get_cached_explanation(alert_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No cached explanation found for alert {alert_id}. "
                "POST to /ml/explain to generate one."
            ),
        )

    return CachedExplainResponse(
        alert_id    = alert_id,
        explanation = cached,
        cached      = True,
    )