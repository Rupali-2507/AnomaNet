"""
ml/modules/profile_mismatch/autoencoder.py

PyTorch Autoencoder model definition for profile mismatch detection.

Architecture:
  Encoder: input_dim → 64 → 32 → latent_dim (16)
  Decoder: latent_dim → 32 → 64 → input_dim

The reconstruction error (MSE) between input and reconstructed output
is used as the anomaly score. High reconstruction error = behaviour
that does not match the account's trained KYC profile.

Feature vector (input_dim = 14):
  - avg_tx_amount_30d      (normalised)
  - tx_count_1h
  - tx_count_24h
  - total_amount_24h       (normalised)
  - unique_counterparties_24h
  - channel_entropy
  - cross_branch_ratio
  - hour_of_day            (sin encoded)
  - hour_of_day            (cos encoded)
  - day_of_week            (sin encoded)
  - day_of_week            (cos encoded)
  - kyc_risk_tier_encoded  (0=LOW, 1=MEDIUM, 2=HIGH, 3=PEP)
  - declared_income_band   (0–4 band, log-scaled)
  - amount_vs_income_ratio (normalised)

Owner: Rupali
"""

from __future__ import annotations

import torch
import torch.nn as nn

INPUT_DIM  = 14
LATENT_DIM = 16


class ProfileAutoencoder(nn.Module):
    """
    Symmetric autoencoder for KYC profile anomaly detection.

    Trained on clean (non-fraudulent) transaction feature vectors so
    that fraudulent / mismatched behaviour yields high reconstruction
    error at inference time.
    """

    def __init__(
        self,
        input_dim:  int = INPUT_DIM,
        latent_dim: int = LATENT_DIM,
        dropout:    float = 0.2,
    ):
        super().__init__()

        self.input_dim  = input_dim
        self.latent_dim = latent_dim

        # ── Encoder ───────────────────────────────────────────────────────────
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(dropout),

            nn.Linear(64, 32),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.Dropout(dropout),

            nn.Linear(32, latent_dim),
            nn.ReLU(),
        )

        # ── Decoder ───────────────────────────────────────────────────────────
        self.decoder = nn.Sequential(
            nn.Linear(latent_dim, 32),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.Dropout(dropout),

            nn.Linear(32, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(dropout),

            nn.Linear(64, input_dim),
            # No activation on output — features are pre-normalised to [0,1]
            # so sigmoid would clip; we let MSELoss handle the raw values.
        )

    # ── Forward ───────────────────────────────────────────────────────────────

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (batch_size, input_dim) float tensor

        Returns:
            reconstructed: (batch_size, input_dim) — same shape as input
        """
        latent        = self.encoder(x)
        reconstructed = self.decoder(latent)
        return reconstructed

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Return only the latent representation (used for visualisation)."""
        return self.encoder(x)

    def reconstruction_error(self, x: torch.Tensor) -> torch.Tensor:
        """
        Per-sample MSE reconstruction error.

        Args:
            x: (batch_size, input_dim)

        Returns:
            errors: (batch_size,) — scalar error per sample
        """
        reconstructed = self.forward(x)
        errors = torch.mean((x - reconstructed) ** 2, dim=1)
        return errors


# ── Convenience factory ───────────────────────────────────────────────────────

def build_autoencoder(
    input_dim:  int   = INPUT_DIM,
    latent_dim: int   = LATENT_DIM,
    dropout:    float = 0.2,
) -> ProfileAutoencoder:
    """Instantiate and return a fresh (untrained) autoencoder."""
    return ProfileAutoencoder(
        input_dim  = input_dim,
        latent_dim = latent_dim,
        dropout    = dropout,
    )