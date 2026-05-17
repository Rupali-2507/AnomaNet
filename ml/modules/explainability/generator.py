"""
ml/modules/explainability/generator.py

Explanation generator — the public function imported by interfaces.py.

Public API:
    get_explanation(alert_id: str, score_breakdown: dict) -> str

    Returns a plain-English explanation paragraph for why an alert fired.

How it works:
  1. Determine which patterns are active (score > threshold)
  2. If only one dominant pattern: fetch its detector explanation_tokens
     from the alert store (Redis or in-memory) and fill its template
  3. If multiple patterns: use the composite template
  4. Cache the explanation string back to Redis so the API can serve it
     without re-computing

Owner: Rupali
"""

from __future__ import annotations

import logging
from typing import Optional

from modules.explainability.templates import (
    TEMPLATES,
    composite_template,
    get_template,
    _generic_template,
)

log = logging.getLogger(__name__)

# Patterns are "active" if score exceeds this threshold
ACTIVE_PATTERN_THRESHOLD = 0.45

# ── Alert token store (populated by anoma_score.py at scoring time) ──────────
# Maps alert_id → explanation_tokens dict per detector.
# We use a simple in-memory dict as primary cache; Redis as secondary.
_token_cache: dict[str, dict] = {}


def register_alert_tokens(alert_id: str, tokens_by_pattern: dict):
    """
    Called by Muskan's scoring pipeline after an alert is triggered.
    Stores the rich explanation_tokens from each detector so that
    get_explanation() can fill the templates without re-running scoring.

    Args:
        alert_id: UUID of the alert
        tokens_by_pattern: {
            "CIRCULAR":  circular_result.explanation_tokens,
            "LAYERING":  layering_result.explanation_tokens,
            ...
        }
    """
    _token_cache[alert_id] = tokens_by_pattern

    try:
        import json
        from shared.feature_store.redis_store import _get_client
        client = _get_client()
        client.setex(
            f"alert_tokens:{alert_id}",
            3600 * 24,   # TTL: 24 hours
            json.dumps(tokens_by_pattern),
        )
    except Exception as e:
        log.debug("Could not cache alert tokens to Redis: %s", e)


def _fetch_tokens(alert_id: str) -> dict:
    """Retrieve explanation tokens for an alert (memory → Redis → empty)."""
    if alert_id in _token_cache:
        return _token_cache[alert_id]

    try:
        import json
        from shared.feature_store.redis_store import _get_client
        client = _get_client()
        raw = client.get(f"alert_tokens:{alert_id}")
        if raw:
            tokens = json.loads(raw)
            _token_cache[alert_id] = tokens
            return tokens
    except Exception as e:
        log.debug("Could not fetch alert tokens from Redis: %s", e)

    return {}


def _active_patterns(score_breakdown: dict) -> list[tuple[str, float]]:
    """
    Return (pattern_name, score) pairs sorted by score descending,
    filtered to patterns above ACTIVE_PATTERN_THRESHOLD.
    """
    pattern_map = {
        "circular":         "CIRCULAR",
        "layering":         "LAYERING",
        "structuring":      "STRUCTURING",
        "dormancy":         "DORMANT",
        "profile_mismatch": "PROFILE_MISMATCH",
    }
    active = []
    for key, label in pattern_map.items():
        score = score_breakdown.get(key, 0.0)
        if score >= ACTIVE_PATTERN_THRESHOLD:
            active.append((label, float(score)))

    return sorted(active, key=lambda x: x[1], reverse=True)


# ── Public function: get_explanation ─────────────────────────────────────────

def get_explanation(alert_id: str, score_breakdown: dict) -> str:
    """
    Generate a plain-English narrative explanation for an AnomaNet alert.

    Imported by interfaces.py as _real_explanation and called by
    Muskan's POST /ml/explain endpoint.

    Args:
        alert_id:        UUID of the alert (used to look up detector tokens)
        score_breakdown: {
            "layering":         0.0–1.0,
            "circular":         0.0–1.0,
            "structuring":      0.0–1.0,
            "dormancy":         0.0–1.0,
            "profile_mismatch": 0.0–1.0,
        }

    Returns:
        Plain-English explanation string (1–3 paragraphs).
        Never raises — returns a safe fallback on any error.
    """
    if not score_breakdown:
        return (
            f"Alert {alert_id} was flagged by AnomaNet. "
            "Score breakdown is unavailable — manual review recommended."
        )

    try:
        active = _active_patterns(score_breakdown)

        if not active:
            # All scores below threshold — composite low-signal alert
            dominant_key = max(score_breakdown, key=lambda k: score_breakdown.get(k, 0))
            tokens = _fetch_tokens(alert_id).get(dominant_key.upper(), {})
            tokens.setdefault("account_id", alert_id)
            return _generic_template(tokens)

        tokens_by_pattern = _fetch_tokens(alert_id)

        if len(active) == 1:
            # Single dominant pattern
            pattern_label, pattern_score = active[0]
            template_fn = get_template(pattern_label)
            tokens = tokens_by_pattern.get(pattern_label, {})
            tokens.setdefault("account_id", alert_id)
            explanation = template_fn(tokens)

        else:
            # Multiple patterns — composite explanation
            # Merge all tokens; account_id from most dominant pattern
            merged_tokens: dict = {}
            for label, _ in active:
                merged_tokens.update(tokens_by_pattern.get(label, {}))
            merged_tokens.setdefault("account_id", alert_id)

            explanation = composite_template(merged_tokens, score_breakdown)

            # Append single-pattern details for the top two patterns
            detail_parts = []
            for label, _score in active[:2]:
                t = get_template(label)
                tok = tokens_by_pattern.get(label, {})
                tok.setdefault("account_id", alert_id)
                detail_parts.append(t(tok))

            if detail_parts:
                explanation += "\n\n" + "\n\n".join(detail_parts)

        # Cache explanation in Redis
        _cache_explanation(alert_id, explanation)

        log.info(
            "get_explanation | alert=%s | patterns=%s | length=%d chars",
            alert_id, [p for p, _ in active], len(explanation),
        )

        return explanation

    except Exception as e:
        log.error("get_explanation failed for alert %s: %s", alert_id, e)
        return (
            f"Alert {alert_id} triggered AnomaNet's fraud detection pipeline. "
            f"Explanation generation encountered an error. Manual review is recommended."
        )


def _cache_explanation(alert_id: str, explanation: str):
    """Persist the generated explanation to Redis for fast API retrieval."""
    try:
        from shared.feature_store.redis_store import _get_client
        client = _get_client()
        client.setex(
            f"explanation:{alert_id}",
            3600 * 48,   # TTL: 48 hours
            explanation,
        )
    except Exception as e:
        log.debug("Could not cache explanation to Redis: %s", e)


def get_cached_explanation(alert_id: str) -> Optional[str]:
    """
    Retrieve a previously generated explanation from Redis.
    Returns None if not found or Redis unavailable.
    Called by the FastAPI router for GET /ml/explain/{alert_id}.
    """
    try:
        from shared.feature_store.redis_store import _get_client
        client = _get_client()
        result = client.get(f"explanation:{alert_id}")
        return result.decode() if isinstance(result, bytes) else result
    except Exception:
        return None