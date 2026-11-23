-- Vaultkern Initial Schema Migration
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum Types
DO $$ BEGIN
    CREATE TYPE account_type AS ENUM ('USER_WALLET', 'SYSTEM_EXTERNAL_FUNDING', 'SYSTEM_FEE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE account_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE transaction_type AS ENUM ('DEPOSIT', 'TRANSFER', 'WITHDRAWAL', 'ADJUSTMENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE transaction_status AS ENUM ('PENDING', 'POSTED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE ledger_direction AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE idempotency_status AS ENUM ('IN_FLIGHT', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Accounts Table
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number VARCHAR(64) NOT NULL UNIQUE,
    user_id VARCHAR(64) NOT NULL,
    type account_type NOT NULL DEFAULT 'USER_WALLET',
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status account_status NOT NULL DEFAULT 'ACTIVE',
    cached_balance BIGINT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_wallet_non_negative_balance 
        CHECK (type != 'USER_WALLET' OR cached_balance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_id VARCHAR(64) NOT NULL UNIQUE,
    type transaction_type NOT NULL,
    status transaction_status NOT NULL DEFAULT 'PENDING',
    idempotency_key VARCHAR(255) UNIQUE,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transactions_idempotency_key ON transactions(idempotency_key);

-- Ledger Entries Table (Strictly append-only)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    direction ledger_direction NOT NULL,
    amount BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    sequence_num INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_positive_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id ON ledger_entries(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction_id ON ledger_entries(transaction_id);

-- Enforce Ledger Immutability via Trigger
CREATE OR REPLACE FUNCTION prevent_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are strictly immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();

-- Idempotency Keys Persistence Table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    endpoint VARCHAR(255) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    response_status INT,
    response_body JSONB,
    status idempotency_status NOT NULL DEFAULT 'IN_FLIGHT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys(expires_at);

-- Seed System Reserve Account for External Funding
INSERT INTO accounts (id, account_number, user_id, type, currency, status, cached_balance)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'SYS_EXTERNAL_RESERVE_INR',
    'SYSTEM',
    'SYSTEM_EXTERNAL_FUNDING',
    'INR',
    'ACTIVE',
    0
)
ON CONFLICT (id) DO NOTHING;
