"""
ml/modules/profile_mismatch/inference.py

Profile mismatch inference — the exposed function called by interfaces.py.

Public API:
    score(account_id: str) -> float

    Returns a 0–1 anomaly score: how much the account's recent transaction
    behaviour deviates from its trained KYC profile.

    0.0 = perfectly matches KYC profile
    1.0 = extreme mismatch (behaviour never seen for this profile class)

How it works:
  1. Fetch rolling features from Redis (via shared.feature_store)
  2. Fetch KYC metadata from Neo4j (income band, risk tier)
  3. Build a 14-dimensional feature vector
  4. Load the trained autoencoder (.pt file)
  5. Compute reconstruction error
  6. Normalise error to [0, 1] using the threshold learned during training

Owner: Rupali
"""

from __future__ import annotations

import logging
import math
import os
from typing import Optional

import numpy as np
import torch

from modules.profile_mismatch.autoencoder import ProfileAutoencoder, INPUT_DIM, LATENT_DIM

log = logging.getLogger(__name__)

# ── Model artifact path ───────────────────────────────────────────────────────
_DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "models", "profile_autoencoder.pt"
)
MODEL_PATH = os.getenv("PROFILE_AE_MODEL_PATH", _DEFAULT_MODEL_PATH)

# ── Reconstruction-error threshold (set during training, stored alongside model) ──
# Accounts with error above this threshold are flagged.
# Default is conservative — will be overridden by the .pt metadata if present.
_DEFAULT_THRESHOLD = 0.25

# ── Module-level model cache (loaded once per process) ───────────────────────
_model:     Optional[ProfileAutoencoder] = None
_threshold: float                        = _DEFAULT_THRESHOLD
_scaler_mean: Optional[np.ndarray]       = None
_scaler_std:  Optional[np.ndarray]       = None


# ── Model loading ─────────────────────────────────────────────────────────────

def _load_model() -> Optional[ProfileAutoencoder]:
    global _model, _threshold, _scaler_mean, _scaler_std

    if _model is not None:
        return _model

    if not os.path.exists(MODEL_PATH):
        log.warning(
            "Profile autoencoder model not found at %s — "
            "score() will return 0.0 until the model is trained.",
            MODEL_PATH,
        )
        return None

    try:
        checkpoint = torch.load(MODEL_PATH, map_location="cpu")

        model = ProfileAutoencoder(
            input_dim  = checkpoint.get("input_dim",  INPUT_DIM),
            latent_dim = checkpoint.get("latent_dim", LATENT_DIM),
        )
        model.load_state_dict(checkpoint["model_state_dict"])
        model.eval()

        _threshold   = checkpoint.get("threshold",    _DEFAULT_THRESHOLD)
        _scaler_mean = checkpoint.get("scaler_mean",  None)
        _scaler_std  = checkpoint.get("scaler_std",   None)

        _model = model
        log.info(
            "Profile autoencoder loaded from %s | threshold=%.4f",
            MODEL_PATH, _threshold,
        )
        return _model

    except Exception as e:
        log.error("Failed to load profile autoencoder: %s", e)
        return None


# ── Feature engineering ───────────────────────────────────────────────────────

def _encode_kyc_tier(tier: str) -> float:
    """Map KYC risk tier string to ordinal float."""
    return {"LOW": 0.0, "MEDIUM": 1.0, "HIGH": 2.0, "PEP": 3.0}.get(
        str(tier).upper(), 0.0
    )


def _income_band(declared_monthly_income: float) -> float:
    """
    Log-scale income into 0–4 band.
    0: < ₹10k/month
    1: ₹10k – ₹50k
    2: ₹50k – ₹2L
    3: ₹2L – ₹10L
    4: > ₹10L
    """
    if declared_monthly_income <= 0:
        return 0.0
    log_income = math.log10(declared_monthly_income + 1)
    # log10(10000)≈4, log10(50000)≈4.7, log10(200000)≈5.3, log10(1000000)≈6
    if log_income < 4.0:
        return 0.0
    elif log_income < 4.7:
        return 1.0
    elif log_income < 5.3:
        return 2.0
    elif log_income < 6.0:
        return 3.0
    else:
        return 4.0


def _build_feature_vector(
    rolling: dict,
    kyc_tier: str,
    declared_monthly_income: float,
    hour_of_day: int = 12,
    day_of_week: int = 2,
) -> np.ndarray:
    """
    Build 14-dim feature vector from rolling features + KYC metadata.
    All values normalised to roughly [0, 1] range.

    Feature order must match training — see autoencoder.py docstring.
    """
    avg_tx_30d              = float(rolling.get("avg_tx_amount_30d",         0.0))
    tx_count_1h             = float(rolling.get("tx_count_1h",               0.0))
    tx_count_24h            = float(rolling.get("tx_count_24h",              0.0))
    total_amount_24h        = float(rolling.get("total_amount_24h",          0.0))
    unique_counterparties   = float(rolling.get("unique_counterparties_24h", 0.0))
    channel_entropy         = float(rolling.get("channel_entropy",           0.0))
    cross_branch_ratio      = float(rolling.get("cross_branch_ratio",        0.0))

    # Normalise absolute amounts (log scale, clipped to [0, 1])
    avg_tx_norm      = min(math.log1p(avg_tx_30d)   / 15.0, 1.0)
    total_24h_norm   = min(math.log1p(total_amount_24h) / 18.0, 1.0)

    # Normalise counts
    tx_1h_norm  = min(tx_count_1h  / 20.0, 1.0)
    tx_24h_norm = min(tx_count_24h / 50.0, 1.0)
    cp_norm     = min(unique_counterparties / 20.0, 1.0)

    # Cyclical time encoding
    h_sin = math.sin(2 * math.pi * hour_of_day / 24)
    h_cos = math.cos(2 * math.pi * hour_of_day / 24)
    d_sin = math.sin(2 * math.pi * day_of_week / 7)
    d_cos = math.cos(2 * math.pi * day_of_week / 7)

    # KYC features
    tier_enc   = _encode_kyc_tier(kyc_tier) / 3.0          # normalise to [0,1]
    inc_band   = _income_band(declared_monthly_income) / 4.0

    # Amount vs income ratio
    monthly_spend = total_amount_24h * 30
    income_ratio  = (
        min(monthly_spend / declared_monthly_income, 10.0) / 10.0
        if declared_monthly_income > 0 else 0.5
    )

    features = np.array([
        avg_tx_norm,
        tx_1h_norm,
        tx_24h_norm,
        total_24h_norm,
        cp_norm,
        channel_entropy,        # already 0–1 (entropy / max_entropy)
        cross_branch_ratio,     # already 0–1
        h_sin,
        h_cos,
        d_sin,
        d_cos,
        tier_enc,
        inc_band,
        income_ratio,
    ], dtype=np.float32)

    return features


def _normalise(features: np.ndarray) -> np.ndarray:
    """Apply z-score normalisation using training statistics if available."""
    if _scaler_mean is not None and _scaler_std is not None:
        std = np.where(_scaler_std > 0, _scaler_std, 1.0)
        return (features - _scaler_mean) / std
    return features


def _reconstruction_error_to_score(error: float, threshold: float) -> float:
    """
    Map raw MSE reconstruction error to a [0, 1] anomaly score.

    - error < threshold/2   → score ≈ 0   (well within profile)
    - error == threshold     → score ≈ 0.5 (borderline)
    - error == 2× threshold  → score ≈ 0.8
    - error >> threshold     → score → 1.0

    Uses a sigmoid-like mapping so the score is smooth and bounded.
    """
    if threshold <= 0:
        threshold = _DEFAULT_THRESHOLD
    ratio = error / threshold
    # sigmoid shifted so ratio=1 → 0.5
    score = 1.0 / (1.0 + math.exp(-3.0 * (ratio - 1.0)))
    return float(np.clip(score, 0.0, 1.0))


# ── Public function: score ────────────────────────────────────────────────────

def score(account_id: str) -> float:
    """
    Compute the profile mismatch anomaly score for an account.

    This is the function imported by interfaces.py (as _real_pm_score).

    Args:
        account_id: the account to score

    Returns:
        float in [0.0, 1.0]
        0.0 = behaviour fully consistent with KYC profile
        1.0 = extreme deviation (possible fraud / mule account)

    Raises:
        No exceptions — all errors are caught and logged; returns 0.0 on failure.
    """
    model = _load_model()
    if model is None:
        return 0.0

    try:
        # ── 1. Fetch rolling features from Redis ──────────────────────────────
        from shared.feature_store.redis_store import get_rolling_features
        rolling = get_rolling_features(account_id)
    except Exception as e:
        log.warning("Could not fetch rolling features for %s: %s", account_id, e)
        rolling = {}

    try:
        # ── 2. Fetch KYC metadata from Neo4j ──────────────────────────────────
        from core.graph.neo4j_client import get_account_features
        account_meta = get_account_features(account_id) or {}
    except Exception as e:
        log.warning("Could not fetch account metadata for %s: %s", account_id, e)
        account_meta = {}

    kyc_tier    = account_meta.get("kyc_risk_tier", "LOW")
    declared_income = float(account_meta.get("declared_monthly_income") or 0.0)

    try:
        # ── 3. Build & normalise feature vector ───────────────────────────────
        import datetime
        now         = datetime.datetime.utcnow()
        hour_of_day = now.hour
        day_of_week = now.weekday()   # 0=Monday

        features = _build_feature_vector(
            rolling                  = rolling,
            kyc_tier                 = kyc_tier,
            declared_monthly_income  = declared_income,
            hour_of_day              = hour_of_day,
            day_of_week              = day_of_week,
        )
        features = _normalise(features)

        # ── 4. Inference ──────────────────────────────────────────────────────
        x = torch.tensor(features, dtype=torch.float32).unsqueeze(0)  # (1, 14)

        with torch.no_grad():
            error_tensor = model.reconstruction_error(x)

        raw_error = float(error_tensor.item())

        # ── 5. Map error → score ──────────────────────────────────────────────
        anomaly_score = _reconstruction_error_to_score(raw_error, _threshold)

        log.debug(
            "profile_mismatch | account=%s | recon_error=%.5f | threshold=%.4f | score=%.4f",
            account_id, raw_error, _threshold, anomaly_score,
        )

        return anomaly_score

    except Exception as e:
        log.error("profile_mismatch inference failed for account %s: %s", account_id, e)
        return 0.0