CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    kyc_id VARCHAR(100) UNIQUE NOT NULL,
    risk_tier VARCHAR(20) NOT NULL CHECK (risk_tier IN ('LOW','MEDIUM','HIGH','PEP')),
    city VARCHAR(100),
    occupation VARCHAR(200),
    declared_monthly_income DECIMAL(15,2),
    segment VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE branches (
    id VARCHAR(16) PRIMARY KEY,
    ifsc VARCHAR(16) UNIQUE NOT NULL,
    city VARCHAR(100) NOT NULL,
    region VARCHAR(100),
    zone VARCHAR(50)
);

CREATE TABLE accounts (
    id VARCHAR(32) PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(id),
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('SAVINGS','CURRENT','OD','LOAN','NRE','NRO')),
    kyc_risk_tier VARCHAR(20) NOT NULL CHECK (kyc_risk_tier IN ('LOW','MEDIUM','HIGH','PEP')),
    declared_monthly_income DECIMAL(15,2),
    declared_occupation VARCHAR(100),
    open_date DATE,
    last_transaction_date DATE,
    is_dormant BOOLEAN DEFAULT FALSE,
    dormant_since DATE,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DORMANT','FROZEN','CLOSED')),
    branch_id VARCHAR(16) REFERENCES branches(id),
    anoma_score FLOAT DEFAULT 0.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_number VARCHAR(64) UNIQUE NOT NULL,
    source_account_id VARCHAR(32) NOT NULL REFERENCES accounts(id),
    dest_account_id VARCHAR(32) NOT NULL REFERENCES accounts(id),
    amount DECIMAL(18,2) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('NEFT','RTGS','IMPS','UPI','SWIFT','CASH','BRANCH')),
    initiated_at TIMESTAMPTZ NOT NULL,
    settled_at TIMESTAMPTZ,
    branch_id VARCHAR(16) REFERENCES branches(id),
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','SETTLED','FAILED','REVERSED')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(200),
    role VARCHAR(20) NOT NULL CHECK (role IN ('INVESTIGATOR','ADMIN')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID REFERENCES transactions(id),
    account_id VARCHAR(32) NOT NULL REFERENCES accounts(id),
    alert_type VARCHAR(30) NOT NULL CHECK (alert_type IN ('LAYERING','CIRCULAR','STRUCTURING','DORMANT','PROFILE_MISMATCH','COMPOSITE')),
    anoma_score FLOAT NOT NULL,
    score_breakdown JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(30) DEFAULT 'NEW' CHECK (status IN ('NEW','UNDER_REVIEW','ESCALATED','REPORTED_FIU','CLOSED_FP','CLOSED_SAR')),
    assigned_to UUID REFERENCES users(id),
    evidence_package_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID NOT NULL REFERENCES alerts(id),
    title VARCHAR(300),
    description TEXT,
    status VARCHAR(30) DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','CLOSED','REPORTED')),
    assigned_to UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE case_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id),
    author_id UUID REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id),
    format VARCHAR(10) DEFAULT 'PDF' CHECK (format IN ('PDF','JSON')),
    download_url VARCHAR(500),
    generated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_source ON transactions(source_account_id);
CREATE INDEX idx_transactions_dest ON transactions(dest_account_id);
CREATE INDEX idx_transactions_initiated_at ON transactions(initiated_at);
CREATE INDEX idx_transactions_amount ON transactions(amount);
CREATE INDEX idx_alerts_account ON alerts(account_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_score ON alerts(anoma_score DESC);
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX idx_accounts_dormant ON accounts(is_dormant);
CREATE INDEX idx_accounts_customer ON accounts(customer_id);

INSERT INTO users (username, password_hash, full_name, role)
VALUES ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'System Admin', 'ADMIN'),
       ('investigator1', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Priya Sharma', 'INVESTIGATOR');
