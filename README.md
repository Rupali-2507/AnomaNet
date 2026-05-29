# AnomaNet — Real-Time AML Transaction Anomaly Detection

This project addresses **PS3 - Tracking of Funds within Bank for Fraud Detection**. AnomaNet detects money laundering patterns — circular transfers, layering, structuring, dormant account activation, and profile mismatch — by treating bank transactions as a live graph and scoring each incoming transaction through a 5-detector ML pipeline in real time.

---

## Live Demo

🔗 Live Demo: https://anoma-net-eight.vercel.app  
🎥 Demo Video: https://youtube.com/

## Demo Access

For demonstration and evaluation purposes, use the following credentials:

- **Username:** `admin`
- **Password:** `admin123`

> These credentials are intended only for the demo environment and provide access to the pre-seeded dashboard, alerts, cases, reports, and investigation workflows.
---


## Tech Stack

**ML Service (Python 3.11 · FastAPI · port 8000)**
- FastAPI + Uvicorn (inference HTTP service)
- Scikit-learn — Isolation Forest (layering detector)
- XGBoost (structuring detector)
- Logistic Regression (dormancy scorer)
- TensorFlow / Keras — LSTM Autoencoder (profile mismatch)
- PyTorch Geometric — GraphSAGE encoder (128-dim account embeddings)
- NetworkX — Johnson's Algorithm (directed cycle detection)
- Neo4j Python Driver (graph queries)
- Redis (rolling-window feature store)
- kafka-python (Kafka consumer/producer)
- MLflow (experiment tracking)
- Faker (synthetic data generation)

**Backend (Java 17 · Spring Boot 3.3 · single monolith, port 8080)**
- Spring Web, Spring Security, Spring WebSocket
- Spring Data JPA + PostgreSQL + Flyway migrations
- Spring Data Neo4j
- Spring Kafka (consumer + producer)
- Spring WebFlux (WebClient — ML service calls)
- iText 7 (PDF report generation)
- JJWT (JWT auth)
- SpringDoc / Swagger UI

**Frontend (TypeScript · Next.js 14 · port 3000)**
- Next.js App Router + Server Actions
- Three.js / D3.js — `FraudGraph3D.tsx` (3D fund-flow graph, node risk colouring, cycle animation)
- `NodeInspector.tsx` — interactive node detail panel on graph click
- TailwindCSS
- SockJS + STOMP — `useAlertStream.ts` (WebSocket real-time alert feed)
- MongoDB (via `lib/mongodb.ts` — session/user store)

**Infrastructure**
- PostgreSQL (transactions, accounts, alerts, cases, reports)
- Neo4j AuraDB (hosted) — live transaction graph
- Redpanda (hosted Kafka, SASL/SSL)
- Upstash Redis (hosted, TLS)
- MLflow (local experiment tracking in `ml/mlruns/`)

---

## How to Run Locally

**1. Clone the repository:**
```bash
git clone https://github.com/Rupali-2507/AnomaNet
cd AnomaNet
```

**2. Configure environment variables:**
```bash
# ML service
cp ml/.env ml/.env.local
# Edit: NEO4J_URI, NEO4J_PASSWORD, REDIS_HOST, REDIS_PASSWORD,
#        KAFKA_BOOTSTRAP_SERVERS, ANOMASCORE_THRESHOLD

# Backend
cp backend/.env backend/.env.local
# Edit: POSTGRES_URL, POSTGRES_USER, POSTGRES_PASSWORD,
#        NEO4J_URI, NEO4J_PASSWORD, KAFKA_BOOTSTRAP_SERVERS,
#        KAFKA_SASL_USERNAME, KAFKA_SASL_PASSWORD, JWT_SECRET
```

**3. Start PostgreSQL (if running locally):**
```bash
docker run -d --name pg -e POSTGRES_DB=anomanet \
  -e POSTGRES_USER=anomanet -e POSTGRES_PASSWORD=anomanet2024 \
  -p 5432:5432 postgres:15
# Flyway migrations run automatically on first backend startup
```

**4. Train ML models (first time only):**
```bash
cd ml
pip install -r requirements.txt
python training/train_classifiers.py
# Produces: core/models/isolation_forest_layering.pkl
#           core/models/xgboost_structuring.pkl
#           core/models/logistic_dormancy.pkl
```

**5. Start the ML service:**
```bash
cd ml
uvicorn core.main:app --reload --port 8000
# Loads all 3 .pkl models, checks Neo4j, starts Kafka consumer thread
```

**6. Start the Spring Boot backend:**
```bash
cd backend
mvn spring-boot:run
# Runs on port 8080, Flyway runs DB migrations, DataSeeder seeds demo alerts
```

**7. Start the frontend (control-tower):**
```bash
cd control-tower
npm install
npm run dev
# Runs on port 3000
```

**8. Open the dashboard:**
```
http://localhost:3000
```

Default login — `admin` / `password` (seeded by Flyway migration)

---

## Project Structure

```
AnomaNet/
│
├── ml/                                  # Python ML microservice (FastAPI, port 8000)
│   ├── core/
│   │   ├── main.py                      # FastAPI app: /ml/score, /ml/health, /ml/explain,
│   │   │                                #   /ml/weights, /ml/model-info, /simulator/trigger
│   │   ├── scoring/
│   │   │   ├── anoma_score.py           # Composite weighted aggregator — calls all 5 detectors
│   │   │   ├── circular_detector.py     # Johnson's Algorithm on Neo4j subgraph (cycle detection)
│   │   │   ├── layering_scorer.py       # Isolation Forest + hard velocity rule (max ensemble)
│   │   │   ├── structuring_scorer.py    # XGBoost on cash window features
│   │   │   └── dormancy_scorer.py       # State machine gate + logistic regression
│   │   ├── graph/
│   │   │   ├── neo4j_client.py          # All Neo4j Cypher queries (subgraph, cycles, edge writes)
│   │   │   └── graph_api.py             # FastAPI router for graph endpoints
│   │   ├── kafka/
│   │   │   └── consumer.py              # Consumes ml.scoring.queue → runs pipeline → publishes alerts.generated
│   │   ├── gnn/
│   │   │   └── graphsage_encoder.py     # 3-layer GraphSAGE, 128-dim account embeddings
│   │   └── models/                      # Trained .pkl artifacts (loaded at startup)
│   │       ├── isolation_forest_layering.pkl
│   │       ├── xgboost_structuring.pkl
│   │       └── logistic_dormancy.pkl
│   ├── modules/
│   │   ├── profile_mismatch/
│   │   │   ├── autoencoder.py           # LSTM Autoencoder architecture
│   │   │   ├── train.py                 # Training script
│   │   │   └── inference.py             # score(account_id) → float
│   │   └── explainability/
│   │       ├── templates.py             # Per-pattern explanation templates
│   │       ├── generator.py             # get_explanation(alert_id, breakdown) → str
│   │       └── router.py                # FastAPI explain_router (POST /ml/explain)
│   ├── shared/
│   │   └── feature_store/
│   │       └── redis_store.py           # Redis sorted-set rolling-window features
│   ├── data_simulator/
│   │   ├── models.py                    # Shared dataclasses (Transaction, Account, etc.)
│   │   ├── simulator.py                 # Orchestrator — 2,000 accounts, 100k transactions
│   │   └── scenarios/
│   │       ├── circular.py              # Ring-of-accounts patterns
│   │       ├── layering.py              # Fan-out mule patterns
│   │       ├── structuring.py           # Below-CTR cash deposit patterns
│   │       ├── dormant_activation.py    # Dormant account reactivation patterns
│   │       └── profile_mismatch_gen.py  # Behaviour-vs-KYC mismatch patterns
│   ├── training/
│   │   ├── train_classifiers.py         # Trains Isolation Forest + XGBoost + Logistic
│   │   └── train_gnn.py                 # Semi-supervised GraphSAGE training
│   ├── interfaces.py                    # Integration contract — safe fallbacks for all modules
│   └── requirements.txt
│
├── backend/                             # Java Spring Boot (single module, port 8080)
│   └── src/main/java/com/anomanet/
│       ├── AnomaNetApplication.java
│       ├── DataSeeder.java              # Seeds 12 demo alerts + cases on first startup
│       ├── account/                     # GET /api/accounts
│       ├── alert/
│       │   ├── AlertController.java     # GET/PUT /api/alerts, GET /api/alerts/{id}/explanation
│       │   └── kafka/AlertConsumer.java # Consumes alerts.generated → saves alert → WebSocket push
│       ├── cases/                       # CRUD /api/cases, case notes
│       ├── graph/
│       │   ├── GraphController.java     # GET /api/graph/subgraph
│       │   └── service/GraphQueryService.java  # Neo4j Cypher subgraph queries
│       ├── report/ReportController.java # POST /api/reports/generate → iText7 PDF
│       ├── simulator/SimulatorController.java  # POST /api/simulate/scenario → ML service
│       ├── transaction/
│       │   ├── kafka/TransactionConsumer.java  # Consumes raw.transactions → enriches → publishes ml.scoring.queue
│       │   └── neo4j/GraphWriterService.java   # Writes TRANSFERRED_TO edges to Neo4j
│       ├── auth/                        # POST /api/auth/login, /refresh — JWT
│       └── security/                    # JwtAuthFilter, SecurityConfig
│   └── src/main/resources/
│       ├── application.yml              # All config (Kafka, Neo4j, PostgreSQL, ML URL, JWT)
│       └── db/migration/V1__create_tables.sql  # Full DB schema (Flyway)
│
└── control-tower/                       # Next.js 14 frontend (port 3000)
    ├── app/
    │   ├── actions/                     # Next.js server actions
    │   ├── admin/                       # Scoring weight sliders, threshold config
    │   ├── api/                         # API route handlers
    │   ├── components/
    │   │   ├── graph/
    │   │   │   ├── FraudGraph3D.tsx     # 3D fund-flow graph (Three.js / D3)
    │   │   │   └── NodeInspector.tsx    # Node detail panel on graph click
    │   │   │   └── AccountLookupSection.tsx  # Account search + quick stats
    │   │   ├── AdminPanel.tsx
    │   │   ├── AlertSection.tsx         # Alert feed with AnomaScore badges
    │   │   ├── CapabilityCard.tsx
    │   │   ├── CaseSection.tsx          # Case list + status management
    │   │   ├── DashboardPage.tsx        # KPI cards + real-time WebSocket feed
    │   │   ├── Footer.tsx
    │   │   ├── GreenIconCircle.tsx
    │   │   ├── LoginForm.tsx
    │   │   ├── LogoutButton.tsx
    │   │   ├── Navbar.tsx
    │   │   ├── ReportSection.tsx        # PDF report generation trigger
    │   │   ├── Testimonial.tsx
    │   │   └── TransactionCard.tsx
    │   ├── hooks/
    │   │   ├── useAlertStream.ts        # WebSocket hook — subscribes to /topic/alerts
    │   │   └── useExplanation.ts        # Fetches ML explanation for an alert
    │   ├── investigation/               # Case investigation page (graph, timeline, evidence)
    │   ├── login/                       # Login page
    │   ├── monitoring/                  # Live transaction monitoring view
    │   ├── reporting/                   # Reports list + PDF download
    │   ├── service/                     # Frontend service layer (API calls)
    │   ├── stats/                       # Stats / analytics page
    │   ├── globals.css
    │   ├── layout.tsx
    │   ├── loading.tsx
    │   └── page.tsx                     # Landing / root page
    ├── lib/
    │   ├── api.ts                       # Axios / fetch wrappers for backend calls
    │   ├── auth.ts                      # JWT token helpers
    │   ├── hash.ts
    │   ├── mongodb.ts
    │   └── session-context.tsx          # React context for session state
    ├── models/
    │   ├── Node.ts                      # Graph node type definitions
    │   ├── Transaction.ts               # Transaction model
    │   └── User.ts                      # User model
    ├── public/                          # Static assets
    ├── types/                           # Shared TypeScript types
    ├── .env.local                       # Frontend environment variables
    ├── next.config.ts
    └── package.json
```

---

## Dataset

All data is 100% synthetic, generated by `ml/data_simulator/`.

The simulator builds **2,000 accounts** across 4 KYC risk tiers (LOW, MEDIUM, HIGH, PEP) with declared occupations and incomes, then generates **~100,000 transactions** across 7 channels (NEFT, RTGS, IMPS, UPI, SWIFT, CASH, BRANCH) over a 90-day simulation window. Five fraud typologies are injected:

- **Circular** — rings of 2–7 accounts completing a directed cycle within 72 hours, with ≤15% amount variance between hops
- **Layering** — a single source account fans out to 5–8 mule accounts within 90 minutes
- **Structuring** — 3–7 cash deposits landing in the 85–99% band of ₹10L / ₹5L / ₹2L CTR thresholds
- **Dormant activation** — a long-dormant account receives an inbound transfer and immediately sends a large outbound
- **Profile mismatch** — transaction patterns (amounts, channels, counterparties) inconsistent with declared KYC profile (e.g. a kirana shop owner receiving SWIFT wires)

No real customer or transaction data was used.

---

## Model Performance

All models were trained and evaluated on the **full 100,000-transaction synthetic dataset** (5,958 accounts, 8,921 labelled fraud transactions across 5 typologies, seed=42). Classical classifiers use a stratified 80/20 train-test split; the LSTM Autoencoder uses an 90/10 split on normal-only sequences with an unsupervised reconstruction-error threshold.

---

### 1. Isolation Forest — Layering Detector

| Metric | Value |
|---|---|
| **AUC-ROC** | **0.855** |
| Contamination | 0.023 |
| Eval accounts | 8,578 (200 fraud · 8,378 clean) |

**Why AUC is the right metric here:**
Isolation Forest is a one-class, unsupervised anomaly detector — it is trained *only* on clean accounts and has never seen a fraud label. Reporting F1 on such a model is misleading because F1 is highly sensitive to the binary decision threshold, which is arbitrary in an unsupervised setting. **AUC-ROC measures ranking quality regardless of threshold** — an AUC of 0.855 means the model correctly ranks a randomly chosen layering account as more anomalous than a randomly chosen clean account 85.5% of the time. In a real AML deployment, investigators triage by score rank (not a hard cutoff), making AUC the operationally relevant metric. The model's anomaly score feeds the `max(rule_score, if_score)` ensemble, where a hard velocity rule (`counterparty_ratio`, `off_hours_ratio`) recovers precision on the most obvious cases while the Isolation Forest catches subtle, gradual layering that evades rule-based systems.

---

### 2. XGBoost — Structuring Detector

| Metric | Value |
|---|---|
| **F1 Score** | **1.000** |
| **Precision** | **1.000** |
| **Recall** | **1.000** |
| **AUC-ROC** | **1.000** |
| Test set | 768 accounts (701 clean · 67 structuring) |

**Per-class breakdown:**

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Clean | 1.00 | 1.00 | 1.00 | 701 |
| Structuring | 1.00 | 1.00 | 1.00 | 67 |

**Why perfect scores are valid and expected:**
Cash structuring — repeatedly depositing amounts in the 85–99% band of ₹10L/₹5L/₹2L CTR thresholds — produces an **extremely distinctive feature signature**: `avg_pct_below_threshold` clusters tightly in [0.85, 0.99] while `n_txns_below_threshold_7d` spikes sharply. In a synthetic dataset where these patterns are generated precisely, the boundary is clean and XGBoost learns it perfectly with `n_estimators=300`. This is consistent with how structuring detection works in production AML engines — the regulatory definition of structuring is itself a mathematical condition, so a well-engineered feature set produces near-perfect discrimination. The model scores 1.000 because the features *are* the definition of the fraud pattern.

---

### 3. Logistic Regression — Dormancy Detector

| Metric | Value |
|---|---|
| **F1 Score** | **0.933** |
| **Precision** | **0.889** |
| **Recall** | **0.982** |
| **AUC-ROC** | **0.983** |
| **Accuracy** | **0.914** |
| Test set | 93 accounts (36 clean · 57 fraud) |

**Per-class breakdown:**

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Clean | 0.97 | 0.81 | 0.88 | 36 |
| Dormant Activation | 0.89 | 0.98 | 0.93 | 57 |

**What these numbers mean in practice:**
A Recall of **0.982** means the model catches **98.2% of all dormant account reactivation fraud** — only 1 in 57 fraudulent accounts slips through undetected. In AML compliance, missing a suspicious reactivation (false negative) is far more costly than a false alarm, so optimising for recall is the correct objective. The **AUC of 0.983** places this model in the *excellent* classification band (AUC > 0.97), meaning it almost perfectly separates dormant-activation fraud from legitimate account reactivations. The two-stage pipeline design (state-machine gate → logistic regression) is key: the gate eliminates ~94% of accounts before the model runs, which removes noise and concentrates the model's discriminative power on the ambiguous borderline cases where `dormancy_duration_months` and `amount_vs_historical_avg_ratio` interact non-trivially.

---

### 4. LSTM Autoencoder — Profile Mismatch Detector

| Metric | Value |
|---|---|
| **Best Validation Loss** | **0.0349** |
| **Reconstruction Error Threshold (p95 on val)** | **0.0982** |
| Training samples | 81,972 normal sequences |
| Validation samples | 9,107 normal sequences |
| Input features | 14 |
| Latent dimension | 16 |
| Early stopping (patience=5) | converged at epoch 9/30 |

**Why reconstruction loss is the right metric here:**
Profile mismatch detection is fundamentally a novelty detection problem — the model is trained *only* on normal transaction behaviour and flags accounts whose sequences it cannot reconstruct well. Unlike classification metrics, **reconstruction loss directly measures how well the model has learned the distribution of normal behaviour**: a val_loss of 0.0349 means the model reconstructs normal sequences with very low error. Any account whose reconstruction error exceeds the **p95 threshold of 0.0982** — meaning it behaves more anomalously than 95% of normal accounts — is flagged. This is a deliberate design choice: setting the threshold at p95 instead of p99 prioritises catching profile mismatches (high recall) while keeping false positives manageable for a PEP-heavy account base. The low, stable val_loss with early stopping at epoch 9 confirms the model did not overfit.

**MLflow run:** `8798aad8eb194e068bdb55cc8e217ed3`

---

### 5. Composite AnomaScore

```
AnomaScore = 0.25 × layering + 0.30 × circular + 0.20 × structuring
           + 0.10 × dormancy + 0.15 × profile_mismatch
```

| Parameter | Value |
|---|---|
| Alert threshold (standard accounts) | **0.65** |
| Alert threshold (PEP-tier accounts) | **0.45** |
| Pattern detected threshold (per component) | **0.50** |

**Design rationale:** Circular transfer detection carries the highest weight (0.30) because it is the hardest pattern to detect with classical rules and has the highest regulatory severity in Indian AML guidelines (PMLA 2002, FATF Recommendation 3). Layering (0.25) is weighted second because velocity-based fan-out is the most common money movement technique. Weights are runtime-configurable via `PUT /ml/weights` and the admin panel — compliance teams can adjust sensitivity without redeployment.

> All metrics are on the synthetic dataset generated by `ml/data_simulator/` (seed=42, 100k transactions, 5,958 accounts). To reproduce: `python -m training.train_classifiers --data data --no-mlflow`

---

# End-to-End Flow

```
Bank transaction arrives
        │
        ▼
Kafka: raw.transactions
        │
        ▼
TransactionConsumer.java (Spring Boot)
  ├── Saves Transaction to PostgreSQL
  ├── Writes TRANSFERRED_TO edge to Neo4j
  └── Publishes EnrichmentEvent → Kafka: ml.scoring.queue
        │
        ▼
consumer.py (ML Kafka consumer thread)
  ├── get_rolling_features(account_id)   ← Redis sorted sets
  ├── compute_residency()                ← Neo4j: time between last inbound → this outbound
  └── compute_anoma_score()
        ├── circular_detector    (Johnson's Algorithm on Neo4j subgraph)
        ├── layering_scorer      (Isolation Forest + hard rule)
        ├── structuring_scorer   (XGBoost)
        ├── dormancy_scorer      (state machine + logistic)
        └── profile_mismatch     (LSTM Autoencoder via interfaces.py)
              │
              ▼
       AnomaScore ≥ threshold?
              │
        YES   ▼
   Publishes AlertEvent → Kafka: alerts.generated
              │
              ▼
   AlertConsumer.java (Spring Boot)
     ├── Saves Alert to PostgreSQL (with score_breakdown JSONB)
     └── Broadcasts to WebSocket /topic/alerts
              │
              ▼
   control-tower (Next.js)
     └── DashboardPage.tsx — real-time alert card via useAlertStream (WebSocket)
         FraudGraph3D.tsx  — 3D fund-flow graph with cycle animation
```

---

## API Endpoints

**ML Service (`localhost:8000`)**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/ml/score` | Score a transaction — returns AnomaScore + breakdown |
| POST | `/ml/explain` | Generate plain-English explanation for an alert |
| GET | `/ml/health` | Models loaded, Neo4j status, uptime |
| GET | `/ml/model-info` | Model versions, weights, thresholds |
| PUT | `/ml/weights` | Update scoring weights at runtime |
| POST | `/simulator/trigger?type=X` | Trigger a fraud scenario (CIRCULAR, LAYERING, etc.) |

**Backend (`localhost:8080`)**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | JWT login |
| GET | `/api/alerts` | Paginated alert list |
| GET | `/api/alerts/{id}/explanation` | Proxies to ML explain endpoint |
| PUT | `/api/alerts/{id}/status` | Update alert status |
| GET | `/api/graph/subgraph?accountId=X` | Neo4j fund-flow subgraph |
| GET | `/api/cases` | Case management |
| POST | `/api/reports/generate` | Generate iText7 PDF report |
| POST | `/api/simulate/scenario?type=X` | Trigger scenario via ML service |
| PUT | `/api/admin/config` | Update thresholds and weights |

---

## Known Limitations

- All ML models are trained on synthetic data only. Production deployment requires retraining on real transaction histories under compliance supervision.
- The LSTM profile mismatch model should be retrained every 30 days as behavioural baselines shift.
- The circular detector runs Johnson's Algorithm on a 2-hop Neo4j subgraph per transaction; at very high TPS (>10K) this query would need caching or async batching.
- The Kafka consumer processes each message synchronously within a single Python thread; throughput is bounded by Neo4j query latency (~50–100ms per message in the current setup).
- The frontend WebSocket feed is live but the graph explorer loads on-demand via REST, not a streaming subscription.
- PDF report generation (iText7) produces a basic structured report; it does not yet include embedded transaction graph visualisations.

---

## Team

| Name | Role |
|---|---|
| **Muskan** | ML service architecture, `core/scoring/` (all 5 detectors), `core/kafka/consumer.py`, Neo4j client, `interfaces.py`, model training pipeline, MLflow integration |
| **Ratnesh** | Full Spring Boot backend — TransactionConsumer (Kafka → PostgreSQL → Neo4j → ml.scoring.queue), AlertConsumer (alerts.generated → PostgreSQL → WebSocket), GraphQueryService, ReportController (iText7 PDF), SimulatorController, AuthController, DataSeeder |
| **Manya** | Frontend core — `DashboardPage.tsx`, `AlertSection.tsx`, `useAlertStream.ts` (WebSocket feed), `FraudGraph3D.tsx` (Three.js/D3 3D graph + cycle animation), `NodeInspector.tsx`, `TransactionCard.tsx`, `CaseSection.tsx` |
| **Rupali** | Profile mismatch LSTM module, Redis feature store (`shared/feature_store/redis_store.py`), explainability engine (`modules/explainability/`), `useExplanation.ts`, frontend pages: `investigation/`, `reporting/`, `AdminPanel.tsx`, `ReportSection.tsx`, `stats/` |

---

## Contact

**Team Name:** AnomaNet
**Repository:** https://github.com/Rupali-2507/AnomaNet
**iDEA 2.0 Phase 2 Submission**
