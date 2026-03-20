# AnomaNet — ML Layer

**Owner: Muskan | AI/ML Engineer**

The ML layer is the brain of AnomaNet. It receives every bank transaction, models the entire fund-flow network as a graph, runs five fraud detectors, and emits a composite risk score. This README explains what's built, why each decision was made, and how the pieces fit together.

---

## What this layer does

Every transaction that enters the bank flows through this pipeline:

1. A Kafka consumer picks up the transaction from `ml.scoring.queue`
2. Rolling features are fetched from Redis (velocity, counterparty counts)
3. A 2-hop subgraph is pulled from Neo4j around the accounts involved
4. A GraphSAGE neural network encodes every account into a 128-dimensional embedding that captures its structural position in the fraud network
5. Five pattern-specific detectors each produce a score between 0 and 1
6. A weighted formula combines them into a single **AnomaScore**
7. If AnomaScore ≥ threshold, an `AlertEvent` is published to Kafka for the backend to pick up

---

## Directory structure

```
ml/
├── data_simulator/          — synthetic data generation (DONE)
│   ├── models.py            — shared dataclasses and helpers
│   ├── simulator.py         — main orchestrator, generates 100k transactions
│   └── scenarios/           — one script per fraud typology
│       ├── layering.py
│       ├── circular.py
│       ├── structuring.py
│       ├── dormant_activation.py
│       └── profile_mismatch_gen.py
│
├── core/                    — inference service (IN PROGRESS)
│   ├── main.py              — FastAPI app entry point
│   ├── graph/
│   │   └── neo4j_client.py  — subgraph extraction from Neo4j
│   ├── gnn/
│   │   └── graphsage_encoder.py — GraphSAGE model definition
│   ├── scoring/
│   │   ├── circular_detector.py
│   │   ├── layering_scorer.py
│   │   ├── structuring_scorer.py
│   │   ├── dormancy_scorer.py
│   │   └── anoma_score.py   — composite aggregator
│   └── kafka/
│       └── consumer.py      — reads ml.scoring.queue, publishes alerts
│
├── training/                — offline training scripts
│   ├── train_gnn.py
│   └── train_classifiers.py
│
├── modules/                 — Rupali's modules (interface only, Muskan calls)
│   ├── profile_mismatch/
│   └── explainability/
│
├── shared/
│   └── feature_store/       — Rupali's Redis rolling-window features
│
├── interfaces.py            — the ONE file Muskan imports from Rupali
├── data/                    — generated parquet files (gitignored)
└── requirements.txt
```

---

## Data simulator

### Why we built a simulator

The ML models need labelled fraud data to train on. Real bank fraud data is confidential, heavily regulated, and impossible to get for a hackathon. The simulator generates 100,000 synthetic transactions that are realistic enough to train production-quality classifiers on — correct statistical distributions of amounts, channels, timings, and Indian banking behaviour.

### How it works

**`models.py`** is the single source of truth for all shared types. It defines the `Customer`, `Account`, and `Transaction` dataclasses, all Indian banking constants (IFSC prefixes, channel distributions, KYC income bands), and all pure helper functions. Every other file in the simulator imports from here. This is intentional — it prevents circular imports and keeps logic in one auditable place.

**`simulator.py`** is the orchestrator. It builds a universe of 2,000 accounts with realistic KYC tiers and declared incomes, calls each scenario generator to inject fraud clusters, generates the remaining clean transactions, shuffles everything together, and writes six parquet files.

The 95/5 split (95,000 clean, 5,000 fraud) mirrors real-world fraud rates and gives the classifiers a realistic class imbalance to learn from.

### The five fraud scenarios

**Layering (`layering.py`)**
One source account receives a large amount (₹30L–₹2Cr) and within 90 minutes fans it out to 5–8 mule accounts across different branches. Each mule holds the money for less than 15 minutes before forwarding it onward. Timestamps are biased to 2–5 AM. Every mule is on a different branch IFSC. This models Phase 2 of the money laundering cycle — the velocity and topology are the signals, not the amounts themselves.

**Circular / Round-tripping (`circular.py`)**
A ring of 2–7 accounts is created. Money travels A → B → C → ... → A, completing the cycle within 2–72 hours. Each hop deducts a small fake fee (0.5%–2%) so the amounts decay slightly — exactly what round-tripping looks like when laundering through fake invoices. In a flat transaction table this pattern is completely invisible. In a graph it is a directed cycle detectable in milliseconds with Johnson's Algorithm.

**Structuring (`structuring.py`)**
India's RBI mandates a Cash Transaction Report (CTR) for any cash transaction above ₹10 lakhs. This scenario generates 3–7 deposits from the same account, each clustered between 90%–98.5% of the threshold — close enough to be suspicious, below enough to avoid the filing. A smurfing variant (35% of clusters) spreads the deposits across multiple branches. The aggregate amount far exceeds the threshold but zero CTRs would be filed.

**Dormant account activation (`dormant_activation.py`)**
An account that has been silent for 14–24 months suddenly receives a large inbound transfer (≥₹50L, at least 10× its historical average transaction size). Within 2–6 hours the money is wired back out to 1–3 recipients. The metadata includes a `kyc_recently_updated` flag, which is a common real-world signal — fraudsters update mobile numbers and addresses before using a takeover account. These accounts are the hardest for rule-based systems to catch because their historical "normal" is near-zero activity.

**Profile mismatch (`profile_mismatch_gen.py`)**
A kirana shop owner or auto driver with a declared monthly income of ₹20k–₹50k suddenly starts receiving SWIFT transfers from offshore BICs, processing ₹15–₹80× their declared monthly income in a single month. The scenario generates several months of realistic small historical transactions first (so the autoencoder has a baseline), then injects the anomalous burst. The channel mismatch — a rural SAVINGS account receiving international SWIFT wires — is a strong signal on its own.

### Output files

| File | Contents |
|---|---|
| `transactions.parquet` | Full ledger — 100k rows, all fields including fraud labels |
| `accounts.parquet` | Account master with KYC fields, dormancy status |
| `customers.parquet` | Customer KYC — name, income, occupation, city, segment |
| `labels.parquet` | Ground truth only — id, is_fraud, fraud_type, cluster_id |
| `neo4j_nodes.parquet` | Account + Customer + Branch nodes, ready for Neo4j bulk import |
| `neo4j_edges.parquet` | TRANSFERRED_TO + OWNS + BELONGS_TO edges with all properties |

The labels file is kept separate so training scripts can load features and labels independently without risk of data leakage from the label column.

### How to regenerate

```bash
# From ml/ with venv active
python -m data_simulator.simulator --output data
```

Only regenerate if you change scenario logic. The parquet files are gitignored — every team member runs this once after cloning.

---

## Running the ML service

```bash
# Start infrastructure first
docker-compose up -d          # from repo root

# Install deps (once)
cd ml
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt

# Generate training data (once)
python -m data_simulator.simulator --output data

# Start inference service
uvicorn core.main:app --reload --port 8000
```

---


```

