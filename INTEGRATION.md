# AnomaNet — Integration Guide

This document has zero ambiguity. Every section is addressed to a specific person by name.
Every field is explained. Every question is pre-answered.

---

# THE ONE-PAGE TRUTH (read this first, everything else is detail)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         WHO CALLS WHAT                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  RATNESH calls Muskan's ML service:                                           │
│    POST   http://localhost:8000/ml/score          after enriching a txn       │
│    POST   http://localhost:8000/ml/explain        when investigator views alert│
│    GET    http://localhost:8000/ml/health         health check                 │
│    PUT    http://localhost:8000/ml/weights        when admin changes weights   │
│    POST   http://localhost:8000/simulator/trigger  for demo scenarios          │
│                                                                                │
│  RATNESH publishes to Kafka → Muskan's consumer reads:                        │
│    Topic: ml.scoring.queue   (EnrichmentEvent after txn enrichment)           │
│                                                                                │
│  Muskan's consumer publishes to Kafka → RATNESH's alert-service reads:        │
│    Topic: alerts.generated   (AlertEvent when AnomaScore >= threshold)        │
│                                                                                │
│  MANYA never calls Muskan's ML service directly.                              │
│  MANYA reads alert data from RATNESH's Spring Boot APIs only.                 │
│                                                                                │
│  RUPALI implements 3 functions that Muskan's pipeline calls:                  │
│    score_profile_mismatch(account_id) → float     in interfaces.py            │
│    get_rolling_features(account_id)   → dict      in interfaces.py            │
│    get_explanation(alert_id, breakdown) → str     in interfaces.py            │
│                                                                                │
│  RUPALI exports explain_router from her router.py                             │
│  Muskan's core/main.py already has the line to register it.                   │
│                                                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│  SERVICE URLS                                                                  │
│    Muskan's ML service:  http://localhost:8000                                 │
│    Ratnesh's API gateway: http://localhost:8080                               │
│    Neo4j browser:        http://localhost:7474  (neo4j / anomanet2024)        │
│    Kafka UI:             http://localhost:8090                                 │
│    MLflow:               http://localhost:5000                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│  KAFKA TOPICS (frozen — do not rename)                                         │
│    raw.transactions      Ratnesh publishes, Rupali's feature store may read   │
│    ml.scoring.queue      Ratnesh publishes → Muskan's consumer reads          │
│    alerts.generated      Muskan publishes → Ratnesh's alert-service reads     │
│    ml.scoring.dlq        Muskan publishes failed messages here                │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

---

# SECTION 1 — FOR RATNESH

**Ratnesh owns the entire backend. This section tells Ratnesh exactly what to call on Muskan's ML service, what to send, and what comes back.**

---

## 1.1 — POST /ml/score

**When Ratnesh calls this:**
After Ratnesh's `transaction-service` receives a transaction from Kafka topic `raw.transactions` and enriches it with account KYC data from PostgreSQL. Ratnesh calls `/ml/score` before deciding whether to create an alert.

**What Ratnesh sends (JSON body):**

```json
{
  "transaction_id":                "3f7a2b1c-9d4e-4f8a-b5c6-7d8e9f0a1b2c",
  "account_id":                    "123456789012",
  "amount":                        950000.00,
  "channel":                       "NEFT",
  "initiated_at":                  "2026-03-20T14:32:00+00:00",
  "metadata":                      {"utr": "UTR12345678901234"},
  "recent_transactions":           [],
  "kyc_risk_tier":                 "MEDIUM",
  "declared_monthly_income":       200000.0,
  "post_activation_outbound_hours": 999.0,
  "residency_seconds":             9999.0
}
```

**Every field explained for Ratnesh:**

| Field | Type | Required | Where Ratnesh gets it | What to send if unavailable |
|---|---|---|---|---|
| `transaction_id` | string | YES | `transactions.id` in PostgreSQL | — must always have this |
| `account_id` | string | YES | `transactions.source_account_id` | — must always have this |
| `amount` | float | YES | `transactions.amount` | — must always have this |
| `channel` | string | YES | `transactions.channel` | — must always have this. Values: `NEFT RTGS IMPS UPI SWIFT CASH BRANCH` |
| `initiated_at` | string | YES | `transactions.initiated_at` as ISO8601 | — must always have this. **Must include timezone: `+00:00`** |
| `metadata` | object | NO | `transactions.metadata` JSONB field | Send `{}` if empty |
| `recent_transactions` | array | NO | Ratnesh queries last 7 days of cash/branch txns for this account from PostgreSQL | Send `[]` if Ratnesh doesn't want to query — structuring scorer just won't fire. Better to send them. Each item: `{"amount": float, "channel": "CASH", "branch_id": "HDFC0001", "initiated_at": "ISO8601"}` |
| `kyc_risk_tier` | string | NO | `accounts.kyc_risk_tier` | Send `"LOW"` if unknown |
| `declared_monthly_income` | float | NO | `accounts.declared_monthly_income` | Send `0.0` if unknown |
| `post_activation_outbound_hours` | float | NO | Ratnesh computes: hours between inbound arrival and first outbound after it, for dormant accounts | Send `999.0` if account is not dormant |
| `residency_seconds` | float | NO | Ratnesh computes: seconds between last inbound to this account and this outbound transaction | Send `9999.0` if Ratnesh doesn't compute it |

**What Muskan's service sends back (JSON body):**

```json
{
  "transaction_id":    "3f7a2b1c-9d4e-4f8a-b5c6-7d8e9f0a1b2c",
  "account_id":        "123456789012",
  "anoma_score":       0.87,
  "threshold_used":    0.65,
  "alert_triggered":   true,
  "score_breakdown": {
    "layering":         0.82,
    "circular":         0.91,
    "structuring":      0.45,
    "dormancy":         0.12,
    "profile_mismatch": 0.78
  },
  "detected_patterns": ["CIRCULAR", "LAYERING"],
  "scored_at":         "2026-03-20T14:32:05.124Z"
}
```

**What Ratnesh does with this response — step by step:**

```java
ScoreResponse score = mlClient.score(scoreRequest);

if (score.isAlertTriggered()) {

    // Step 1: Save alert to PostgreSQL alerts table
    Alert alert = new Alert();
    alert.setId(UUID.randomUUID());
    alert.setTransactionId(UUID.fromString(score.getTransactionId()));
    alert.setAccountId(score.getAccountId());
    alert.setAnomaScore(score.getAnomaScore());
    alert.setScoreBreakdown(objectMapper.writeValueAsString(score.getScoreBreakdown())); // store as JSONB
    alert.setAlertType(deriveAlertType(score.getDetectedPatterns())); // see below
    alert.setStatus(AlertStatus.NEW);
    alert.setCreatedAt(Instant.now());
    alertRepository.save(alert);

    // Step 2: Publish AlertEvent to alerts.generated Kafka topic
    // (Muskan already publishes this from her Kafka consumer — Ratnesh does NOT
    //  need to republish. Ratnesh only needs to consume alerts.generated.)
}

// How to derive alert type from detected patterns:
private AlertType deriveAlertType(List<String> patterns) {
    if (patterns.size() > 1)          return AlertType.COMPOSITE;
    if (patterns.contains("CIRCULAR")) return AlertType.CIRCULAR;
    if (patterns.contains("LAYERING")) return AlertType.LAYERING;
    if (patterns.contains("STRUCTURING")) return AlertType.STRUCTURING;
    if (patterns.contains("DORMANT")) return AlertType.DORMANT;
    if (patterns.contains("PROFILE_MISMATCH")) return AlertType.PROFILE_MISMATCH;
    return AlertType.COMPOSITE;
}
```

**HTTP status codes Muskan's service returns:**

| Code | Meaning | What Ratnesh should do |
|---|---|---|
| 200 | Scored successfully | Check `alert_triggered` in body |
| 422 | Bad request — invalid timestamp or missing required field | Log the error, fix the request |
| 500 | Internal scoring error | Log, do not create alert, continue processing next message |

---

## 1.2 — The AlertEvent Muskan publishes to Kafka

**Muskan's Kafka consumer** publishes this to `alerts.generated` whenever `anoma_score >= threshold`. **Ratnesh's `alert-service`** consumes this topic.

**Kafka topic:** `alerts.generated`

**Message shape:**

```json
{
  "event_type":        "ALERT_GENERATED",
  "alert_id":          "ALT_3f7a2b1c_1711026005",
  "transaction_id":    "3f7a2b1c-9d4e-4f8a-b5c6-7d8e9f0a1b2c",
  "account_id":        "123456789012",
  "anoma_score":       0.87,
  "score_breakdown": {
    "layering":         0.82,
    "circular":         0.91,
    "structuring":      0.45,
    "dormancy":         0.12,
    "profile_mismatch": 0.78
  },
  "detected_patterns": ["CIRCULAR", "LAYERING"],
  "threshold_used":    0.65,
  "timestamp":         "2026-03-20T14:32:05.124Z"
}
```

**What Ratnesh's `alert-service` does when it consumes this:**

```java
// In Ratnesh's AlertConsumer.java

@KafkaListener(topics = "alerts.generated")
public void onAlertGenerated(AlertEvent event) {

    // 1. Save to alerts table
    Alert alert = new Alert();
    alert.setId(UUID.randomUUID());
    alert.setTransactionId(UUID.fromString(event.getTransactionId()));
    alert.setAccountId(event.getAccountId());
    alert.setAnomaScore(event.getAnomaScore());
    alert.setScoreBreakdown(event.getScoreBreakdown()); // JSONB
    alert.setAlertType(deriveAlertType(event.getDetectedPatterns()));
    alert.setStatus(AlertStatus.NEW);
    alertRepository.save(alert);

    // 2. WebSocket broadcast to all connected investigator sessions
    messagingTemplate.convertAndSend("/topic/alerts",
        buildWebSocketPayload(alert));
}
```

---

## 1.3 — The EnrichmentEvent Ratnesh publishes to Kafka

**Ratnesh's `transaction-service`** publishes this to `ml.scoring.queue` after enriching the raw transaction with account KYC. **Muskan's Kafka consumer** reads this.

**Kafka topic:** `ml.scoring.queue`

**Message shape Ratnesh must publish:**

```json
{
  "event_type":     "TRANSACTION_ENRICHED",
  "event_id":       "uuid",
  "schema_version": "1.0",
  "timestamp":      "2026-03-20T14:32:00.000Z",
  "transaction": {
    "id":                "3f7a2b1c-9d4e-4f8a-b5c6-7d8e9f0a1b2c",
    "reference_number":  "NEFT20260320XYZ123",
    "source_account_id": "123456789012",
    "dest_account_id":   "987654321098",
    "amount":            950000.00,
    "currency":          "INR",
    "channel":           "NEFT",
    "initiated_at":      "2026-03-20T14:32:00.000Z",
    "branch_id":         "HDFC0001234"
  },
  "account": {
    "kyc_risk_tier":           "MEDIUM",
    "declared_monthly_income": 200000.0,
    "is_dormant":              false,
    "dormant_since":           null
  }
}
```

**Important for Ratnesh:** The `account` block is what Ratnesh adds during enrichment from PostgreSQL. If Ratnesh omits it, Muskan's consumer defaults to LOW KYC and 0 income — the dormancy and profile mismatch scorers will fire less accurately. Include it.

---

## 1.4 — POST /ml/explain

**When Ratnesh calls this:**
When Ratnesh's `alert-service` handles `GET /api/alerts/{id}/explanation` — the frontend requests an explanation for a specific alert.

**What Ratnesh sends (JSON body):**

```json
{
  "alert_id":       "ALT_3f7a2b1c_1711026005",
  "score_breakdown": {
    "layering":         0.82,
    "circular":         0.91,
    "structuring":      0.45,
    "dormancy":         0.12,
    "profile_mismatch": 0.78
  }
}
```

Ratnesh already stored `score_breakdown` as JSONB in the alerts table. Ratnesh reads it back and passes it here. No recomputation needed.

**What Muskan's service sends back:**

```json
{
  "explanation":     "Account 123456789012 transferred ₹48.2L to account 987654321098, which transferred ₹47.9L to account 111213141516, which transferred ₹47.6L back to account 123456789012 — completing a financial cycle in 3.8 hours across branches in Mumbai and Delhi. Two of the three counterparty relationships were first-time transactions.",
  "evidence_points": [
    "circular: 0.91",
    "layering: 0.82",
    "profile_mismatch: 0.78"
  ]
}
```

**What Ratnesh's `alert-service` sends back to the frontend:**

```json
{
  "explanation":     "Account 123456789012 transferred ₹48.2L...",
  "evidence_points": ["circular: 0.91", "layering: 0.82", "profile_mismatch: 0.78"]
}
```

Ratnesh passes this through directly to `GET /api/alerts/{id}/explanation`. No transformation needed.

---

## 1.5 — GET /ml/health

**When Ratnesh calls this:**
On Spring Boot startup health check. Ratnesh can aggregate this into `/actuator/health`.

**What Muskan's service sends back:**

```json
{
  "status":          "ok",
  "models_loaded":   ["isolation_forest_layering", "xgboost_structuring", "logistic_dormancy"],
  "models_missing":  [],
  "neo4j_healthy":   true,
  "uptime_seconds":  142.3,
  "version":         "1.0.0"
}
```

`status: "ok"` — all models loaded, full scoring available.
`status: "degraded"` — some models missing, rule-based fallbacks running.

---

## 1.6 — PUT /ml/weights

**When Ratnesh calls this:**
When Rupali's `AdminSettingsPage` sends `PUT /api/admin/config` to Ratnesh with new weights. Ratnesh forwards the weight update to Muskan.

**What Ratnesh sends (JSON body):**

```json
{
  "layering":         0.25,
  "circular":         0.30,
  "structuring":      0.20,
  "dormancy":         0.10,
  "profile_mismatch": 0.15
}
```

Weights must sum exactly to 1.0. Muskan's service returns 422 if they don't.

**What Muskan's service sends back:**

```json
{
  "status":  "updated",
  "weights": {
    "layering":         0.25,
    "circular":         0.30,
    "structuring":      0.20,
    "dormancy":         0.10,
    "profile_mismatch": 0.15
  }
}
```

---

## 1.7 — POST /simulator/trigger

**When Ratnesh calls this:**
When Rupali's `SimulatorPage` fires `POST /api/simulate/scenario?type=CIRCULAR`. Ratnesh's `simulator-bridge` service forwards it to Muskan.

**URL:**
```
POST http://localhost:8000/simulator/trigger?type=CIRCULAR
```

No request body. The `type` query parameter is one of:
`CIRCULAR` · `LAYERING` · `STRUCTURING` · `DORMANT` · `PROFILE_MISMATCH`

**What Muskan's service sends back:**

```json
{
  "triggered":   true,
  "scenario_id": "CIRCULAR_1711026000",
  "type":        "CIRCULAR"
}
```

Muskan generates fraud transactions in a background thread and publishes them to `raw.transactions`. Ratnesh's `transaction-service` picks them up exactly like real transactions. Within 2–3 seconds, alerts appear in `alerts.generated`.

**What Ratnesh sends back to the frontend:**
Pass through the response directly. Rupali's `SimulatorPage` shows the `scenario_id` in the "Recent Triggers" feed.

---

---

# SECTION 2 — FOR MANYA

**Manya owns the core frontend — dashboard, alerts, graph explorer. This section tells Manya exactly what data fields exist in ML-enriched objects and how to use them in the UI.**

**Critical fact for Manya: Manya never calls Muskan's ML service at `localhost:8000` directly. Manya calls Ratnesh's Spring Boot APIs at `localhost:8080` only. The ML data is already embedded in the objects Ratnesh returns.**

---

## 2.1 — What the Alert object looks like

When Manya's `useAlertFeed` WebSocket hook receives a new alert, or when Manya calls `GET /api/alerts/{id}`, the alert object contains these ML fields:

```typescript
interface Alert {
  // Ratnesh's fields
  id:            string;
  transactionId: string;
  accountId:     string;
  status:        "NEW" | "UNDER_REVIEW" | "ESCALATED" | "REPORTED_FIU" | "CLOSED_FP" | "CLOSED_SAR";
  assignedTo:    string | null;
  createdAt:     string;

  // ML fields — from Muskan's scoring, stored by Ratnesh
  alertType:     "LAYERING" | "CIRCULAR" | "STRUCTURING" | "DORMANT" | "PROFILE_MISMATCH" | "COMPOSITE";
  anomaScore:    number;          // 0.0–1.0 — THE main number to show on every alert card
  scoreBreakdown: {
    layering:         number;     // 0.0–1.0
    circular:         number;     // 0.0–1.0
    structuring:      number;     // 0.0–1.0
    dormancy:         number;     // 0.0–1.0
    profile_mismatch: number;     // 0.0–1.0
  };
  detectedPatterns: string[];     // e.g. ["CIRCULAR", "LAYERING"]
}
```

---

## 2.2 — AnomaScore badge — colour logic

Use this exact logic everywhere Manya shows an AnomaScore badge:

```typescript
const getScoreColour = (score: number): string => {
  if (score > 0.70) return '#E24B4A';   // red   — high risk
  if (score > 0.40) return '#BA7517';   // amber — medium risk
  return '#185FA5';                      // blue  — low risk
};

// Usage on alert card:
<span style={{ backgroundColor: getScoreColour(alert.anomaScore), color: '#fff', borderRadius: 4, padding: '2px 8px' }}>
  {alert.anomaScore.toFixed(2)}
</span>
```

---

## 2.3 — ScoreBreakdown component — what to render

Manya's `ScoreBreakdown` component receives `alert.scoreBreakdown` and needs to render:

**Part 1 — RadarChart (Recharts):**

```typescript
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from 'recharts';

const radarData = [
  { pattern: 'Layering',        score: alert.scoreBreakdown.layering         * 100 },
  { pattern: 'Circular',        score: alert.scoreBreakdown.circular          * 100 },
  { pattern: 'Structuring',     score: alert.scoreBreakdown.structuring       * 100 },
  { pattern: 'Dormancy',        score: alert.scoreBreakdown.dormancy          * 100 },
  { pattern: 'Profile Mismatch',score: alert.scoreBreakdown.profile_mismatch  * 100 },
];

<ResponsiveContainer width="100%" height={300}>
  <RadarChart data={radarData}>
    <PolarGrid />
    <PolarAngleAxis dataKey="pattern" />
    <Radar dataKey="score" fill="#E24B4A" fillOpacity={0.4} stroke="#E24B4A" />
  </RadarChart>
</ResponsiveContainer>
```

**Part 2 — Explanation text:**

Manya calls `GET /api/alerts/{id}/explanation` (Ratnesh's endpoint, which proxies to Muskan's `/ml/explain`). The response:

```typescript
interface ExplanationResponse {
  explanation:    string;    // the 2–3 sentence paragraph — show in a card below the radar chart
  evidencePoints: string[];  // list of "pattern: score" strings — show as bullet list
}
```

**Part 3 — Individual score cards:**

Below the radar chart, render 5 expandable cards — one per pattern. Each card shows the score for that pattern (coloured by the same red/amber/blue logic) and the explanation text.

```typescript
const patterns = [
  { key: 'layering',         label: 'Layering',         icon: '⚡' },
  { key: 'circular',         label: 'Circular',          icon: '🔄' },
  { key: 'structuring',      label: 'Structuring',       icon: '📊' },
  { key: 'dormancy',         label: 'Dormant Activation',icon: '💤' },
  { key: 'profile_mismatch', label: 'Profile Mismatch',  icon: '👤' },
];

// For each pattern:
const score = alert.scoreBreakdown[pattern.key];
const colour = getScoreColour(score);
```

---

## 2.4 — FundFlowGraph — node colouring and cycle highlighting

The `GET /api/graph/subgraph` response (Ratnesh's graph-service fetches from Neo4j) has this shape:

```typescript
interface SubgraphResponse {
  nodes: Array<{
    id:            string;
    label:         string;
    anoma_score:   number;   // ← USE THIS for node colour
    account_type:  string;
    is_dormant:    boolean;  // ← grey nodes
    kyc_risk_tier: string;
    branch_id:     string;
  }>;
  edges: Array<{
    source:    string;
    target:    string;
    amount:    number;       // ← USE THIS for edge stroke-width
    timestamp: string;
    channel:   string;
    tx_id:     string;
  }>;
  metadata: {
    total_nodes:     number;
    total_edges:     number;
    detected_cycles: string[][];  // ← USE THIS to highlight cycle edges
    // e.g. [["acc1","acc2","acc3","acc1"]]
  };
}
```

**D3 node colouring — use this exact logic:**

```typescript
const getNodeFill = (node: GraphNode): string => {
  if (node.is_dormant)          return '#888780';  // grey
  if (node.anoma_score > 0.70)  return '#E24B4A';  // red
  if (node.anoma_score >= 0.40) return '#BA7517';  // amber
  return '#185FA5';                                  // blue
};
```

**D3 node radius:**
```typescript
const getNodeRadius = (node: GraphNode, graph: D3Graph): number => {
  const degree = graph.links.filter(
    l => l.source === node.id || l.target === node.id
  ).length;
  return Math.max(8, Math.log(degree + 1) * 8);
};
```

**D3 edge stroke-width:**
```typescript
const getEdgeStrokeWidth = (edge: GraphEdge): number => {
  return Math.max(1, Math.log(edge.amount) / 2);
};
```

**Cycle edge animation — pulsing:**
```typescript
// Flatten all cycle paths into a set of "src-dst" strings
const cycleEdgeSet = new Set<string>();
subgraph.metadata.detected_cycles.forEach(cycle => {
  for (let i = 0; i < cycle.length - 1; i++) {
    cycleEdgeSet.add(`${cycle[i]}-${cycle[i+1]}`);
  }
});

// In D3 edge rendering:
const isCycleEdge = cycleEdgeSet.has(`${edge.source}-${edge.target}`);
// Apply CSS class "cycle-edge" if true → pulsing stroke-dashoffset animation
```

```css
.cycle-edge {
  stroke: #E24B4A;
  stroke-dasharray: 8 4;
  animation: pulse 1.5s linear infinite;
}

@keyframes pulse {
  to { stroke-dashoffset: -24; }
}
```

---

## 2.5 — Dashboard KPI cards — where data comes from

| KPI Card | API call | Field to show |
|---|---|---|
| Active Alerts | `GET /api/alerts?status=NEW&size=0` | `page.totalElements` |
| High-Risk Accounts Today | `GET /api/alerts?minScore=0.70&from=today` | `page.totalElements` |
| Avg AnomaScore Today | `GET /api/alerts?from=today` | average of `alert.anomaScore` |
| Transactions/min | `GET /api/transactions/stats` | Ratnesh's stats endpoint |

All from Ratnesh's Spring Boot APIs. No ML service calls.

---

## 2.6 — Alert feed (WebSocket)

The WebSocket message Manya's `useAlertFeed` receives:

```typescript
// Message on /topic/alerts WebSocket
interface AlertWebSocketMessage {
  id:               string;
  accountId:        string;
  anomaScore:       number;     // show as coloured badge immediately
  alertType:        string;     // show as pattern icon
  detectedPatterns: string[];
  createdAt:        string;
}
```

Manya prepends this to the React Query `['alerts']` cache. No need to refetch — the WebSocket message has everything needed for the alert card.

---

---

# SECTION 3 — FOR RUPALI

**Rupali owns the profile mismatch module, the explainability engine, the Redis feature store, and four frontend pages. This section tells Rupali exactly what to implement so Muskan's pipeline can call it.**

---

## 3.1 — The three functions Rupali must implement in interfaces.py

`interfaces.py` already exists in `AnomaNet/ml/` with safe fallbacks. Rupali replaces the fallback logic with real implementations. The file imports Rupali's real functions at module load time — if they fail to import, the fallback silently takes over.

---

### Function 1 — score_profile_mismatch

**File Rupali implements:** `AnomaNet/ml/modules/profile_mismatch/inference.py`

**Function Rupali exports:**

```python
def score(account_id: str) -> float:
    """
    Load the trained LSTM autoencoder.
    Fetch the last 30 transactions for account_id.
    Run them through the autoencoder.
    Return reconstruction error normalised to 0.0–1.0.

    RULES:
    - Must return a float between 0.0 and 1.0
    - Must complete in under 50 milliseconds
    - Must NEVER raise an exception — catch all errors and return 0.0
    - 0.0 means no mismatch detected
    - 1.0 means extreme mismatch — behaviour completely unlike declared profile
    """
    try:
        # Rupali's implementation here
        ...
        return float(result)
    except Exception as e:
        log.error("Profile mismatch score failed for %s: %s", account_id, e)
        return 0.0   # ALWAYS return 0.0 on failure, never raise
```

**How Muskan's interfaces.py calls it:**

```python
# interfaces.py — already written, Rupali does NOT edit this file
from modules.profile_mismatch.inference import score as _real_pm_score

def score_profile_mismatch(account_id: str) -> float:
    try:
        return float(_real_pm_score(account_id))
    except Exception:
        return 0.0
```

---

### Function 2 — get_rolling_features

**File Rupali implements:** `AnomaNet/ml/shared/feature_store/redis_store.py`

**Function Rupali exports:**

```python
def get_rolling_features(account_id: str) -> dict:
    """
    Read rolling-window velocity features from Redis sorted sets.
    Return a dict with EXACTLY these keys and types.

    RULES:
    - Must return all keys listed below — Muskan depends on these exact names
    - Missing keys are defaulted to 0 by interfaces.py, but include them all
    - Must NEVER raise an exception — catch all errors and return dict of zeros
    - Must complete in under 20 milliseconds
    """
    try:
        # Rupali's Redis implementation here
        ...
        return {
            "tx_count_1h":               int_value,    # number of txns in last 1 hour
            "tx_count_24h":              int_value,    # number of txns in last 24 hours
            "total_amount_24h":          float_value,  # total INR transacted in last 24 hours
            "unique_counterparties_24h": int_value,    # distinct accounts transacted with in 24h
            "avg_tx_amount_30d":         float_value,  # average transaction amount over 30 days
            "channel_entropy":           float_value,  # Shannon entropy of channel distribution
            "cross_branch_ratio":        float_value,  # fraction of txns that crossed branches
        }
    except Exception as e:
        log.error("get_rolling_features failed for %s: %s", account_id, e)
        return {
            "tx_count_1h": 0, "tx_count_24h": 0, "total_amount_24h": 0.0,
            "unique_counterparties_24h": 0, "avg_tx_amount_30d": 0.0,
            "channel_entropy": 0.0, "cross_branch_ratio": 0.0,
        }
```

**How Muskan's interfaces.py calls it:**

```python
# interfaces.py — already written, Rupali does NOT edit this file
from shared.feature_store.redis_store import get_rolling_features as _real_features

_ZERO_FEATURES = {
    "tx_count_1h": 0, "tx_count_24h": 0, "total_amount_24h": 0.0,
    "unique_counterparties_24h": 0, "avg_tx_amount_30d": 0.0,
    "channel_entropy": 0.0, "cross_branch_ratio": 0.0,
}

def get_rolling_features(account_id: str) -> dict:
    try:
        result = _real_features(account_id)
        return {**_ZERO_FEATURES, **result}  # merge to guarantee all keys present
    except Exception:
        return dict(_ZERO_FEATURES)
```

**Note for Rupali:** `set_transaction()` writes features to Redis. Something needs to call it when transactions arrive. Either Rupali's feature store subscribes to Kafka `raw.transactions` independently, or Ratnesh calls it after enrichment. Rupali and Ratnesh need to agree on this. By the time Muskan's pipeline calls `get_rolling_features()`, the current transaction should already be in Redis.

---

### Function 3 — get_explanation

**File Rupali implements:** `AnomaNet/ml/modules/explainability/generator.py`

**Function Rupali exports:**

```python
def get_explanation(alert_id: str, score_breakdown: dict) -> str:
    """
    Generate a 2–3 sentence plain-English explanation of why the alert fired.
    Use the score_breakdown to identify the dominant pattern.
    Fetch transaction details from Ratnesh's graph-service if needed.

    score_breakdown = {
        "layering":         0.82,
        "circular":         0.91,
        "structuring":      0.45,
        "dormancy":         0.12,
        "profile_mismatch": 0.78
    }

    Example return value for a circular pattern:
    "Account 123456789012 transferred ₹48.2L to account 987654321098, which
    transferred ₹47.9L to account 111213141516, which transferred ₹47.6L back
    to account 123456789012 — completing a financial cycle in 3.8 hours across
    branches in Mumbai and Delhi. Two of the three counterparty relationships
    were first-time transactions."

    RULES:
    - Must return a non-empty string
    - Must NEVER raise an exception
    - Aim for 2–3 sentences with specific amounts and account IDs if available
    """
    try:
        # Rupali's template-based generation here
        ...
        return explanation_string
    except Exception as e:
        log.error("get_explanation failed for alert %s: %s", alert_id, e)
        return f"Alert {alert_id} flagged for suspicious activity. Score breakdown: {score_breakdown}"
```

---

## 3.2 — The explainability router

**File Rupali implements:** `AnomaNet/ml/modules/explainability/router.py`

Rupali creates a FastAPI `APIRouter`. Muskan's `core/main.py` already has the import line — Rupali does not touch `core/main.py`.

```python
# modules/explainability/router.py — RUPALI'S FILE

from fastapi import APIRouter
from modules.explainability.generator import get_explanation

explain_router = APIRouter()   # MUST be named exactly "explain_router"

@explain_router.post("/ml/explain")
async def explain(body: dict):
    alert_id        = body.get("alert_id", "")
    score_breakdown = body.get("score_breakdown", {})
    explanation     = get_explanation(alert_id, score_breakdown)
    return {
        "explanation":     explanation,
        "evidence_points": [
            f"{k}: {v:.2f}"
            for k, v in score_breakdown.items()
            if v > 0.40
        ]
    }
```

**The line already in Muskan's core/main.py (Rupali does NOT edit this):**

```python
# core/main.py — already written by Muskan
try:
    from modules.explainability.router import explain_router
    app.include_router(explain_router)
    log.info("Explainability router registered")
except ImportError:
    log.warning("Explainability router not available — using fallback")
```

Once Rupali creates `router.py` with `explain_router` exported, it will load automatically next time uvicorn starts. No changes to Muskan's files needed.

---

## 3.3 — Rupali's frontend pages and what ML data they need

### CaseInvestigationPage (`app/cases/[id]/`)

**4 tabs:**

**Overview tab:**
- Alert summary: `alert.anomaScore`, `alert.scoreBreakdown`, `alert.detectedPatterns`
- All from `GET /api/cases/{id}` (Ratnesh's endpoint)
- No extra ML calls needed

**Graph tab:**
- Rupali imports Manya's `FundFlowGraph` component:
  ```typescript
  import FundFlowGraph from '@/components/FundFlowGraph';
  ```
- Passes data from `GET /api/graph/subgraph` (Ratnesh's endpoint)
- The node colouring (`anoma_score`), edge widths, cycle pulsing — all handled by Manya's component

**Timeline tab:**
- Rupali's `CaseTimeline` component
- Data from `GET /api/cases/{id}/trail` (Ratnesh's endpoint)
- Show transactions as a chronological bar chart with amounts

**Evidence tab:**
- Link button → navigates to EvidenceBuilderPage

---

### EvidenceBuilderPage (`app/cases/[id]/evidence/`)

**The explanation field needs ML data:**

```typescript
// In Rupali's EvidenceBuilderPage
const { data: explanation } = useQuery({
  queryKey: ['explanation', alert.id],
  queryFn: () => fetch(`/api/alerts/${alert.id}/explanation`).then(r => r.json())
});

// Pre-populate the narrative textarea:
<textarea defaultValue={explanation?.explanation} />

// Pre-populate evidence list:
{explanation?.evidencePoints.map(point => <li key={point}>{point}</li>)}
```

The `explanation` comes from Ratnesh's `GET /api/alerts/{id}/explanation` endpoint which proxies to Muskan's `/ml/explain`. Rupali does NOT call `localhost:8000` directly.

---

### SimulatorPage (`app/simulator/`)

**Fire scenario buttons:**

```typescript
// Each "Fire Scenario" button in Rupali's SimulatorPage:
const fireScenario = async (type: string) => {
  const response = await fetch(`/api/simulate/scenario?type=${type}`, {
    method: 'POST'
  });
  const data = await response.json();
  // data = { triggered: true, scenario_id: "CIRCULAR_1711026000", type: "CIRCULAR" }
  addToRecentTriggers(data);  // show in "Recent Triggers" feed below
};
```

Rupali calls Ratnesh's `POST /api/simulate/scenario?type=X`.
Ratnesh's `simulator-bridge` forwards to Muskan's `POST /simulator/trigger?type=X`.
Muskan generates fraud transactions → they flow through the full pipeline → alerts appear on the dashboard within 2–3 seconds.

---

### AdminSettingsPage (`app/admin/`)

**Weight sliders validation — must sum to 1.0:**

```typescript
// Rupali enforces this constraint in the UI
const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
const isValid = Math.abs(totalWeight - 1.0) < 0.001;

// Submit:
await fetch('/api/admin/config', {
  method: 'PUT',
  body: JSON.stringify({
    threshold:    standardThreshold,   // 0.5–0.9
    pepThreshold: pepThreshold,        // 0.3–0.7
    weights: {
      layering:         weights.layering,
      circular:         weights.circular,
      structuring:      weights.structuring,
      dormancy:         weights.dormancy,
      profile_mismatch: weights.profileMismatch,
    }
  })
});
// Ratnesh forwards → PUT /ml/weights on Muskan's service
```

---

---

# SECTION 4 — COMMON MISTAKES AND HOW TO AVOID THEM

## Mistake 1 — Wrong import paths

All Python code inside `AnomaNet/ml/` runs with `AnomaNet/ml/` as the working directory. **No `ml.` prefix.**

```python
# CORRECT
from interfaces import score_profile_mismatch
from core.scoring.circular_detector import score_circular
from modules.profile_mismatch.inference import score

# WRONG — causes ModuleNotFoundError
from ml.interfaces import score_profile_mismatch
from ml.core.scoring.circular_detector import score_circular
```

## Mistake 2 — Timestamps without timezone

Muskan's service will throw `422` if `initiated_at` is missing timezone info.

```python
# CORRECT
"2026-03-20T14:32:00+00:00"
"2026-03-20T14:32:00.566778+00:00"

# WRONG — will fail
"2026-03-20T14:32:00"         # no timezone
"2026-03-20 14:32:00+00:00"   # space instead of T
```

## Mistake 3 — Rupali's functions throwing exceptions

Muskan's pipeline wraps calls to `interfaces.py` functions in try/except but Rupali's functions must also be defensive internally.

```python
# CORRECT — Rupali's inference.py
def score(account_id: str) -> float:
    try:
        result = model.predict(features)
        return float(result)
    except Exception:
        return 0.0   # always return float, never raise

# WRONG — this will propagate through interfaces.py
def score(account_id: str) -> float:
    result = model.predict(features)  # unguarded — crashes on model not loaded
    return float(result)
```

## Mistake 4 — Wrong dict key names in get_rolling_features

Muskan's `layering_scorer.py` accesses these keys by exact name.

```python
# CORRECT — exact keys Muskan expects
return {
    "tx_count_1h":               8,
    "tx_count_24h":              12,
    "total_amount_24h":          5200000.0,
    "unique_counterparties_24h": 7,
    "avg_tx_amount_30d":         45000.0,
    "channel_entropy":           1.2,
    "cross_branch_ratio":        0.85,
}

# WRONG — wrong key names, Muskan gets zeros
return {
    "txCount1h":      8,        # camelCase — not found
    "count_1_hour":   8,        # wrong name — not found
    "total_24h":      5200000,  # wrong name — not found
}
```

## Mistake 5 — Manya calling localhost:8000 directly

Manya's frontend must never call `localhost:8000`. The ML service is not CORS-allowed for the frontend. Everything goes through Ratnesh's `localhost:8080`.

```typescript
// CORRECT — Manya calls Ratnesh
fetch('/api/alerts/123/explanation')     // → Ratnesh → ML

// WRONG — Manya calls Muskan directly
fetch('http://localhost:8000/ml/explain')  // CORS error
```

## Mistake 6 — Ratnesh not forwarding score_breakdown to the explain endpoint

The `POST /ml/explain` endpoint needs the stored `score_breakdown` from the alert record. Ratnesh must save it in the alerts table and pass it back.

```java
// Ratnesh saves this when consuming alerts.generated:
alert.setScoreBreakdown(objectMapper.writeValueAsString(event.getScoreBreakdown()));

// Ratnesh passes this when calling /ml/explain:
Map<String, Double> breakdown = objectMapper.readValue(alert.getScoreBreakdown(), Map.class);
ExplainRequest req = new ExplainRequest(alert.getId().toString(), breakdown);
mlClient.explain(req);
```

---

# SECTION 5 — END-TO-END GOLDEN PATH TEST

**When everything is running, use this sequence to verify the full integration works:**

**Step 1 — Start everything**
```powershell
# Terminal 1: Infrastructure
cd AnomaNet
docker-compose up -d

# Terminal 2: ML service (from AnomaNet/ml/)
uvicorn core.main:app --reload --port 8000

# Terminal 3: Ratnesh's Spring Boot services (from AnomaNet/backend/)
mvn spring-boot:run -pl api-gateway,auth-service,transaction-service,alert-service,graph-service

# Terminal 4: Frontend (from AnomaNet/frontend/app/)
npm run dev
```

**Step 2 — Verify ML service is healthy**
```powershell
curl http://localhost:8000/ml/health
# Expect: {"status":"ok", "models_loaded":["isolation_forest_layering","xgboost_structuring","logistic_dormancy"]}
```

**Step 3 — Fire a circular fraud scenario**
```powershell
curl -X POST "http://localhost:8080/api/simulate/scenario?type=CIRCULAR"
# Expect: {"triggered":true, "scenario_id":"CIRCULAR_...", "type":"CIRCULAR"}
```

**Step 4 — Watch it travel through the system**

In Terminal 2 (ML service logs), within 2–3 seconds:
```
INFO CIRCULAR detected | account=XXXX | score=0.91 | hops=3 | hours=3.8
INFO AnomaScore | tx=XXXX | score=0.91 | alert=True | patterns=['CIRCULAR']
INFO ALERT published | account=XXXX | score=0.91
```

**Step 5 — Verify alert was created**
```powershell
curl http://localhost:8080/api/alerts
# Expect: alert with anomaScore around 0.91, alertType CIRCULAR
```

**Step 6 — Verify explanation works**
```powershell
# Get the alert ID from step 5, then:
curl http://localhost:8080/api/alerts/{alertId}/explanation
# Expect: {"explanation":"...", "evidencePoints":["circular: 0.91", ...]}
```

**Step 7 — Verify Manya's dashboard shows the alert**
Open `http://localhost:3000` in browser. The alert card should have appeared automatically via WebSocket with a red AnomaScore badge showing 0.91.

**If step 3 works but step 4 doesn't:**
→ ML service Kafka consumer is not connected to Kafka. Check `KAFKA_BOOTSTRAP_SERVERS` env var.

**If step 4 works but step 5 doesn't:**
→ Ratnesh's alert-service Kafka consumer is not consuming `alerts.generated`. Check Ratnesh's consumer config.

**If step 5 works but step 6 doesn't:**
→ Ratnesh's alert-service is not calling Muskan's `/ml/explain` or not storing `score_breakdown`.

**If step 5 works but step 7 doesn't:**
→ Ratnesh's alert-service WebSocket broadcast is not working, or Manya's `useAlertFeed` hook is not connected.