"""
ml/modules/explainability/templates.py

Plain-English explanation templates for each fraud pattern detected by AnomaNet.

Each template is a callable that accepts token dicts from the detector's
`explanation_tokens` field and returns a filled string.

Patterns covered:
  - CIRCULAR        (circular fund flow / round-tripping)
  - LAYERING        (rapid fan-out through multiple accounts)
  - STRUCTURING     (below-threshold cash splitting)
  - DORMANT         (dormant account suddenly activated)
  - PROFILE_MISMATCH (behaviour inconsistent with KYC profile)
  - COMPOSITE       (multiple patterns in one alert)

Owner: Rupali
"""

from __future__ import annotations

from typing import Callable

# ── Type alias ────────────────────────────────────────────────────────────────
Template = Callable[[dict], str]


# ── Individual pattern templates ──────────────────────────────────────────────

def circular_template(tokens: dict) -> str:
    """
    tokens expected:
        account_id, cycle_length (int), cycle_nodes (list[str]),
        total_cycle_amount (float), max_edge_weight (float),
        cycle_detected_at (str ISO timestamp)
    """
    account_id    = tokens.get("account_id", "unknown")
    cycle_length  = tokens.get("cycle_length", "unknown")
    total_amount  = tokens.get("total_cycle_amount", 0.0)
    cycle_nodes   = tokens.get("cycle_nodes", [])
    max_edge      = tokens.get("max_edge_weight", 0.0)

    node_chain = " → ".join(str(n) for n in cycle_nodes) if cycle_nodes else "multiple accounts"

    return (
        f"Account {account_id} was identified as part of a circular fund flow involving "
        f"{cycle_length} linked accounts ({node_chain}). "
        f"Funds totalling ₹{total_amount:,.2f} were traced moving through this cycle, "
        f"with the largest single transfer in the loop amounting to ₹{max_edge:,.2f}. "
        f"This pattern—where money leaves an account and returns to it via intermediaries—"
        f"is a strong indicator of round-tripping or fictitious transaction layering. "
        f"Recommend reviewing all accounts in the cycle for common beneficial ownership."
    )


def layering_template(tokens: dict) -> str:
    """
    tokens expected:
        account_id, tx_count_1h (int), total_amount_1h (float),
        unique_counterparties (int), cross_branch_ratio (float),
        residency_seconds (float), is_off_hours (bool), rule_fired (bool)
    """
    account_id     = tokens.get("account_id", "unknown")
    tx_count_1h    = tokens.get("tx_count_1h", 0)
    total_amount   = tokens.get("total_amount_1h", 0.0)
    unique_cp      = tokens.get("unique_counterparties", 0)
    cross_branch   = tokens.get("cross_branch_ratio", 0.0)
    residency      = tokens.get("residency_seconds", 0.0)
    off_hours      = tokens.get("is_off_hours", False)
    rule_fired     = tokens.get("rule_fired", False)

    residency_str = (
        f"{residency:.0f} seconds" if residency < 60
        else f"{residency / 60:.1f} minutes"
    )

    trigger = (
        f"exceeded the velocity threshold ({tx_count_1h} outbound transfers "
        f"totalling ₹{total_amount:,.2f} within one hour)"
        if rule_fired else
        f"showed anomalous velocity detected by the Isolation Forest model "
        f"({tx_count_1h} transfers in one hour, ₹{total_amount:,.2f} total)"
    )

    parts = [
        f"Account {account_id} {trigger}.",
        f"Funds were dispersed to {unique_cp} unique counterparties, "
        f"with {cross_branch * 100:.0f}% of transfers crossing branch boundaries.",
        f"The average residency time of funds in this account was {residency_str}, "
        f"suggesting rapid pass-through movement rather than genuine economic activity.",
    ]

    if off_hours:
        parts.append(
            "Activity occurred during off-hours (2–5 AM), which is atypical for "
            "legitimate business transactions and commonly associated with layering schemes."
        )

    return " ".join(parts)


def structuring_template(tokens: dict) -> str:
    """
    tokens expected:
        account_id, deposit_count (int), total_amount (float),
        avg_deposit (float), ctr_threshold (float),
        period_days (int), xgboost_score (float)
    """
    account_id    = tokens.get("account_id", "unknown")
    deposit_count = tokens.get("deposit_count", 0)
    total_amount  = tokens.get("total_amount", 0.0)
    avg_deposit   = tokens.get("avg_deposit", 0.0)
    threshold     = tokens.get("ctr_threshold", 1_000_000.0)
    period_days   = tokens.get("period_days", 7)

    return (
        f"Account {account_id} made {deposit_count} cash deposits over {period_days} days, "
        f"totalling ₹{total_amount:,.2f} with an average deposit of ₹{avg_deposit:,.2f}. "
        f"Each individual deposit was kept below the Currency Transaction Report (CTR) "
        f"threshold of ₹{threshold:,.0f}. "
        f"This pattern is consistent with structuring—the deliberate breaking of large cash "
        f"amounts into smaller deposits to avoid mandatory regulatory reporting. "
        f"Recommend cross-referencing with source-of-funds declarations and any prior SARs."
    )


def dormancy_template(tokens: dict) -> str:
    """
    tokens expected:
        account_id, dormancy_months (float), amount_ratio (float),
        current_amount (float), outbound_hours (float),
        kyc_recently_updated (bool)
    """
    account_id      = tokens.get("account_id", "unknown")
    dormancy_months = tokens.get("dormancy_months", 0.0)
    amount_ratio    = tokens.get("amount_ratio", 0.0)
    current_amount  = tokens.get("current_amount", 0.0)
    outbound_hours  = tokens.get("outbound_hours", 999.0)
    kyc_updated     = tokens.get("kyc_recently_updated", False)

    outbound_str = (
        f"within {outbound_hours:.1f} hours of the inbound credit"
        if outbound_hours < 24
        else "shortly after the inbound credit"
    )

    parts = [
        f"Account {account_id} had been dormant for {dormancy_months:.0f} months "
        f"before suddenly receiving ₹{current_amount:,.2f}—approximately "
        f"{amount_ratio:.0f}× the account's historical average transaction amount.",
        f"Outbound transfers were initiated {outbound_str}, "
        f"indicating the account may have been used as a pass-through vehicle.",
    ]

    if kyc_updated:
        parts.append(
            "KYC details for this account were recently updated, which is a known signal "
            "of account takeover prior to fraudulent activation."
        )

    parts.append(
        "Recommend verifying account ownership and source of inbound funds with the originating institution."
    )

    return " ".join(parts)


def profile_mismatch_template(tokens: dict) -> str:
    """
    tokens expected:
        account_id, recon_error (float), threshold (float),
        kyc_tier (str), declared_income (float),
        total_amount_24h (float), tx_count_24h (int),
        channel_entropy (float)
    """
    account_id     = tokens.get("account_id", "unknown")
    recon_error    = tokens.get("recon_error", 0.0)
    threshold      = tokens.get("threshold", 1.0)
    kyc_tier       = tokens.get("kyc_tier", "LOW")
    declared_income = tokens.get("declared_income", 0.0)
    total_24h      = tokens.get("total_amount_24h", 0.0)
    tx_count_24h   = tokens.get("tx_count_24h", 0)
    channel_entropy = tokens.get("channel_entropy", 0.0)

    deviation_pct = ((recon_error / threshold) - 1.0) * 100 if threshold > 0 else 0

    return (
        f"Account {account_id} (KYC risk tier: {kyc_tier}) is exhibiting transaction behaviour "
        f"that deviates significantly from its declared financial profile. "
        f"Over the past 24 hours, the account processed {tx_count_24h} transactions "
        f"totalling ₹{total_24h:,.2f}—against a declared monthly income of "
        f"₹{declared_income:,.2f}. "
        f"The account's behaviour scored {deviation_pct:.0f}% above the anomaly threshold "
        f"in the profile-mismatch autoencoder model (reconstruction error: {recon_error:.4f}). "
        f"Channel diversity entropy of {channel_entropy:.2f} suggests activity across "
        f"an unusually wide range of payment channels. "
        f"Recommend enhanced due diligence review and source-of-funds verification."
    )


def composite_template(tokens: dict, score_breakdown: dict) -> str:
    """
    Used when multiple patterns fire simultaneously.

    tokens: merged dict from all detectors
    score_breakdown: {pattern_name: score_float}
    """
    account_id = tokens.get("account_id", "unknown")

    pattern_labels = {
        "circular":         "circular fund flow",
        "layering":         "rapid transaction layering",
        "structuring":      "cash structuring",
        "dormancy":         "dormant account activation",
        "profile_mismatch": "KYC profile mismatch",
    }

    active = sorted(
        [(k, v) for k, v in score_breakdown.items() if v > 0.4],
        key=lambda kv: kv[1], reverse=True,
    )

    if not active:
        return (
            f"Account {account_id} triggered AnomaNet's composite fraud alert. "
            f"Multiple low-to-medium signals were detected across different detection modules. "
            f"Manual review is recommended."
        )

    primary_key, primary_score = active[0]
    primary_label = pattern_labels.get(primary_key, primary_key)

    lines = [
        f"Account {account_id} triggered a composite AnomaNet alert driven primarily by "
        f"{primary_label} (score: {primary_score:.2f})."
    ]

    if len(active) > 1:
        secondary = [pattern_labels.get(k, k) for k, _ in active[1:]]
        lines.append(
            f"Secondary signals detected: {', '.join(secondary)}. "
            f"The convergence of multiple fraud indicators significantly elevates overall risk."
        )

    lines.append(
        "This account should be prioritised for immediate manual review and potential SAR filing."
    )

    return " ".join(lines)


# ── Template registry ─────────────────────────────────────────────────────────

TEMPLATES: dict[str, Template] = {
    "CIRCULAR":         circular_template,
    "LAYERING":         layering_template,
    "STRUCTURING":      structuring_template,
    "DORMANT":          dormancy_template,
    "PROFILE_MISMATCH": profile_mismatch_template,
}


def get_template(pattern: str) -> Template:
    """
    Return the template function for a given pattern name.
    Falls back to a generic template if pattern is unrecognised.
    """
    return TEMPLATES.get(pattern.upper(), _generic_template)


def _generic_template(tokens: dict) -> str:
    account_id = tokens.get("account_id", "unknown")
    return (
        f"Account {account_id} was flagged by AnomaNet's fraud detection pipeline. "
        f"Unusual transaction patterns were detected that warrant further investigation."
    )