"""
ml/modules/profile_mismatch/train.py

Training script for the ProfileAutoencoder.

Workflow:
  1. Load synthetic / real transaction data (CSV or Parquet)
  2. Engineer features (same pipeline as inference.py)
  3. Split into train / validation (clean transactions only for AE training)
  4. Train autoencoder with MSE loss + early stopping
  5. Determine reconstruction-error threshold (95th percentile on val set)
  6. Log metrics, params, and artifact to MLflow
  7. Save checkpoint to models/profile_autoencoder.pt

Run:
    python -m modules.profile_mismatch.train --data data/clean_transactions.parquet

Owner: Rupali
"""

from __future__ import annotations

import argparse
import logging
import math
import os
from datetime import datetime
from typing import Optional

import mlflow
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset, random_split

from modules.profile_mismatch.autoencoder import ProfileAutoencoder, INPUT_DIM, LATENT_DIM

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── Defaults ──────────────────────────────────────────────────────────────────
DEFAULT_EPOCHS      = 60
DEFAULT_BATCH_SIZE  = 256
DEFAULT_LR          = 1e-3
DEFAULT_LATENT      = LATENT_DIM
DEFAULT_THRESHOLD_P = 95.0         # percentile on val set for anomaly threshold
PATIENCE            = 8            # early stopping patience

MODEL_OUT = os.path.join(
    os.path.dirname(__file__), "..", "..", "models", "profile_autoencoder.pt"
)


# ── Feature engineering (mirrors inference.py _build_feature_vector) ──────────

def _encode_kyc_tier(tier: str) -> float:
    return {"LOW": 0.0, "MEDIUM": 1.0, "HIGH": 2.0, "PEP": 3.0}.get(
        str(tier).upper(), 0.0
    )


def _income_band(income: float) -> float:
    if income <= 0:
        return 0.0
    log_income = math.log10(income + 1)
    if log_income < 4.0:   return 0.0
    elif log_income < 4.7: return 1.0
    elif log_income < 5.3: return 2.0
    elif log_income < 6.0: return 3.0
    else:                  return 4.0

def _prepare_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["initiated_at"] = pd.to_datetime(df["initiated_at"], utc=True, errors="coerce")
    df["tx_hour"]      = df["initiated_at"].dt.hour.fillna(12).astype(int)
    df["tx_dow"]       = df["initiated_at"].dt.dayofweek.fillna(2).astype(int)

    agg = df.groupby("source_account_id").agg(
        avg_tx_amount   = ("amount", "mean"),
        total_amount    = ("amount", "sum"),
        tx_count        = ("amount", "count"),
        unique_dests    = ("dest_account_id", "nunique"),
        unique_channels = ("channel", "nunique"),
        unique_branches = ("branch_id", "nunique"),
    ).reset_index()

    df = df.merge(agg, on="source_account_id", how="left")
    df["channel_entropy"]    = (df["unique_channels"] / 5.0).clip(0, 1)
    df["cross_branch_ratio"] = (df["unique_branches"] / df["tx_count"].clip(1)).clip(0, 1)

    def _extract_kyc(meta):
        if isinstance(meta, dict):
            return meta.get("kyc_risk_tier", "LOW")
        return "LOW"

    df["kyc_risk_tier"]           = df["metadata"].apply(_extract_kyc)
    df["declared_monthly_income"] = df["metadata"].apply(
        lambda m: float(m.get("declared_monthly_income", 0)) if isinstance(m, dict) else 0.0
    )
    return df


def build_features(df: pd.DataFrame) -> np.ndarray:
    df = _prepare_df(df)
    rows = []
    for _, row in df.iterrows():
        avg_tx_30d  = float(row.get("avg_tx_amount",   0))
        tx_count    = float(row.get("tx_count",        0))
        total       = float(row.get("total_amount",    0))
        unique_cp   = float(row.get("unique_dests",    0))
        ch_entropy  = float(row.get("channel_entropy", 0))
        cross_br    = float(row.get("cross_branch_ratio", 0))
        hour        = int(row.get("tx_hour", 12))
        dow         = int(row.get("tx_dow",  2))
        kyc_tier    = str(row.get("kyc_risk_tier", "LOW"))
        income      = float(row.get("declared_monthly_income", 0))
        amount      = float(row.get("amount", 0))

        avg_norm    = min(math.log1p(avg_tx_30d) / 15.0, 1.0)
        tx_1h_norm  = min(tx_count / 20.0,  1.0)
        tx_24h_norm = min(tx_count / 50.0,  1.0)
        total_norm  = min(math.log1p(total) / 18.0, 1.0)
        cp_norm     = min(unique_cp / 20.0,  1.0)

        h_sin = math.sin(2 * math.pi * hour / 24)
        h_cos = math.cos(2 * math.pi * hour / 24)
        d_sin = math.sin(2 * math.pi * dow  / 7)
        d_cos = math.cos(2 * math.pi * dow  / 7)

        tier_enc     = _encode_kyc_tier(kyc_tier) / 3.0
        inc_band     = _income_band(income) / 4.0
        income_ratio = (
            min((amount * 30) / income, 10.0) / 10.0 if income > 0 else 0.5
        )

        rows.append([
            avg_norm, tx_1h_norm, tx_24h_norm, total_norm, cp_norm,
            ch_entropy, cross_br,
            h_sin, h_cos, d_sin, d_cos,
            tier_enc, inc_band, income_ratio,
        ])

    return np.array(rows, dtype=np.float32)

# ── Training loop ─────────────────────────────────────────────────────────────

def train(
    data_path:       str,
    epochs:          int   = DEFAULT_EPOCHS,
    batch_size:      int   = DEFAULT_BATCH_SIZE,
    lr:              float = DEFAULT_LR,
    latent_dim:      int   = DEFAULT_LATENT,
    threshold_pct:   float = DEFAULT_THRESHOLD_P,
    model_out:       str   = MODEL_OUT,
    mlflow_run_name: Optional[str] = None,
    fraud_col:       str   = "is_fraud",
):
    """
    Main training entry point.

    Args:
        data_path:     path to CSV or Parquet with transaction features
        epochs:        max training epochs
        batch_size:    mini-batch size
        lr:            Adam learning rate
        latent_dim:    bottleneck size
        threshold_pct: percentile of clean val errors used as alert threshold
        model_out:     where to save the .pt checkpoint
        mlflow_run_name: optional MLflow run name
        fraud_col:     column marking known fraudulent transactions (excluded)
    """
    log.info("Loading data from %s", data_path)
    if data_path.endswith(".parquet"):
        df = pd.read_parquet(data_path)
    else:
        df = pd.read_csv(data_path)

    log.info("Loaded %d rows", len(df))

    # Use only clean (non-fraud) transactions for autoencoder training
    if fraud_col in df.columns:
        df_clean = df[df[fraud_col] == 0].copy()
        log.info("After filtering frauds: %d clean rows", len(df_clean))
    else:
        log.warning("'%s' column not found — training on all rows", fraud_col)
        df_clean = df.copy()

    # ── Feature matrix ────────────────────────────────────────────────────────
    X = build_features(df_clean)

    # z-score normalisation
    scaler_mean = X.mean(axis=0)
    scaler_std  = X.std(axis=0)
    scaler_std  = np.where(scaler_std > 0, scaler_std, 1.0)
    X_scaled    = (X - scaler_mean) / scaler_std

    # ── Train / val split (90/10) ─────────────────────────────────────────────
    n_val   = max(1, int(len(X_scaled) * 0.1))
    n_train = len(X_scaled) - n_val

    dataset          = TensorDataset(torch.tensor(X_scaled))
    train_ds, val_ds = random_split(dataset, [n_train, n_val])

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True,  drop_last=True)
    val_loader   = DataLoader(val_ds,   batch_size=batch_size, shuffle=False)

    # ── Model & optimiser ─────────────────────────────────────────────────────
    model     = ProfileAutoencoder(input_dim=INPUT_DIM, latent_dim=latent_dim)
    optimiser = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimiser, mode="min", patience=3, factor=0.5, verbose=True
    )
    criterion = nn.MSELoss()

    # ── MLflow run ────────────────────────────────────────────────────────────
    run_name = mlflow_run_name or f"profile_ae_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

    with mlflow.start_run(run_name=run_name):
        mlflow.log_params({
            "input_dim":     INPUT_DIM,
            "latent_dim":    latent_dim,
            "epochs":        epochs,
            "batch_size":    batch_size,
            "lr":            lr,
            "threshold_pct": threshold_pct,
            "n_train":       n_train,
            "n_val":         n_val,
        })

        best_val_loss  = float("inf")
        patience_count = 0
        best_state     = None

        for epoch in range(1, epochs + 1):
            # ── Train ─────────────────────────────────────────────────────────
            model.train()
            train_losses = []
            for (batch,) in train_loader:
                optimiser.zero_grad()
                recon  = model(batch)
                loss   = criterion(recon, batch)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimiser.step()
                train_losses.append(loss.item())

            train_loss = float(np.mean(train_losses))

            # ── Validate ──────────────────────────────────────────────────────
            model.eval()
            val_losses = []
            with torch.no_grad():
                for (batch,) in val_loader:
                    recon = model(batch)
                    loss  = criterion(recon, batch)
                    val_losses.append(loss.item())

            val_loss = float(np.mean(val_losses))
            scheduler.step(val_loss)

            mlflow.log_metrics({
                "train_loss": round(train_loss, 6),
                "val_loss":   round(val_loss,   6),
            }, step=epoch)

            log.info(
                "Epoch %3d/%d | train_loss=%.5f | val_loss=%.5f",
                epoch, epochs, train_loss, val_loss,
            )

            # ── Early stopping ────────────────────────────────────────────────
            if val_loss < best_val_loss:
                best_val_loss  = val_loss
                best_state     = {k: v.clone() for k, v in model.state_dict().items()}
                patience_count = 0
            else:
                patience_count += 1
                if patience_count >= PATIENCE:
                    log.info("Early stopping at epoch %d", epoch)
                    break

        # ── Compute threshold on validation set ───────────────────────────────
        if best_state:
            model.load_state_dict(best_state)

        model.eval()
        val_errors = []
        with torch.no_grad():
            for (batch,) in val_loader:
                errors = model.reconstruction_error(batch)
                val_errors.extend(errors.numpy().tolist())

        threshold = float(np.percentile(val_errors, threshold_pct))
        log.info(
            "Reconstruction-error threshold (p%.0f on val): %.5f",
            threshold_pct, threshold,
        )
        mlflow.log_metric("recon_error_threshold", threshold)
        mlflow.log_metric("best_val_loss",          best_val_loss)

        # ── Save checkpoint ───────────────────────────────────────────────────
        os.makedirs(os.path.dirname(model_out), exist_ok=True)
        checkpoint = {
            "model_state_dict": model.state_dict(),
            "input_dim":        INPUT_DIM,
            "latent_dim":       latent_dim,
            "threshold":        threshold,
            "scaler_mean":      scaler_mean,
            "scaler_std":       scaler_std,
            "trained_at":       datetime.utcnow().isoformat(),
        }
        torch.save(checkpoint, model_out)
        log.info("Model saved to %s", model_out)
        mlflow.log_artifact(model_out, artifact_path="model")

    log.info("Training complete. Best val_loss=%.5f | threshold=%.5f", best_val_loss, threshold)
    return model, threshold


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train profile mismatch autoencoder")
    parser.add_argument("--data",           required=True,               help="Path to clean transactions CSV/Parquet")
    parser.add_argument("--epochs",         type=int,   default=DEFAULT_EPOCHS)
    parser.add_argument("--batch-size",     type=int,   default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--lr",             type=float, default=DEFAULT_LR)
    parser.add_argument("--latent-dim",     type=int,   default=DEFAULT_LATENT)
    parser.add_argument("--threshold-pct",  type=float, default=DEFAULT_THRESHOLD_P)
    parser.add_argument("--model-out",      default=MODEL_OUT)
    parser.add_argument("--run-name",       default=None)
    parser.add_argument("--fraud-col",      default="is_fraud")
    args = parser.parse_args()

    train(
        data_path       = args.data,
        epochs          = args.epochs,
        batch_size      = args.batch_size,
        lr              = args.lr,
        latent_dim      = args.latent_dim,
        threshold_pct   = args.threshold_pct,
        model_out       = args.model_out,
        mlflow_run_name = args.run_name,
        fraud_col       = args.fraud_col,
    )