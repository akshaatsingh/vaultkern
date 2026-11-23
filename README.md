# Vaultkern 🏦

> Production-Grade Double-Entry Digital Wallet & Payment Ledger API designed for fintech-level consistency and zero race conditions.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.2-black.svg)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D.svg)](https://redis.io/)
[![Vitest](https://img.shields.io/badge/Vitest-3.0-6E9F18.svg)](https://vitest.dev/)

---

## Architecture Overview

```
                        +---------------------------------------+
                        |           Client Application          |
                        +---------------------------------------+
                                            |
                               [ HTTPS + Idempotency-Key ]
                                            v
+---------------------------------------------------------------------------------------+
|  Vaultkern API Service (Fastify + TypeScript)                                         |
|                                                                                       |
|  +---------------------------+    +----------------------------+   +---------------+  |
|  |   Idempotency Middleware  |--->| Account & Transfer Service |<--| Audit Service |  |
|  +---------------------------+    +----------------------------+   +---------------+  |
|               |                                  |                         |          |
+---------------|----------------------------------|-------------------------|----------+
                |                                  |                         |
       [ Atomic Leader Election ]         [ Row-Level Locks ]         [ Integrity Check ]
       [ & Response Caching ]             [ SELECT ... FOR UPDATE ]   [ Balance Verification ]
                v                         [ (id ASC order) ]                 v
+-----------------------------+     +---------------------------------------------------+
|     Redis 7 (Alpine)        |     |             PostgreSQL 16 (Alpine)                |
| - Fast idempotency keys     |     | - Strict double-entry (Debit + Credit = 0)        |
| - Distributed locking       |     | - Check constraints (cached_balance >= 0)         |
| - Concurrent request dedupe |     | - Immutable ledger entries (triggers prevent edit)|
+-----------------------------+     +---------------------------------------------------+
```

---

## Non-Negotiable Core Engineering Guarantees

1. **Strict Double-Entry Accounting:** Money is never created or destroyed. Every transaction generates balanced, immutable `ledger_entries` (one `DEBIT` and one `CREDIT` that sum to 0) linked to an immutable `transactions` audit record. A PostgreSQL trigger prohibits any updates or deletes on ledger records.
2. **Integer-Only Currency Storage (`BIGINT`):** All currency amounts are stored in their smallest atomic unit (e.g., paise for INR, cents for USD) as 64-bit integers (`BIGINT`), completely eliminating floating-point rounding errors.
3. **Deadlock-Free ACID Transactions:** Bidirectional concurrent transfers (e.g., Alice $\leftrightarrow$ Bob) acquire pessimistic row locks (`SELECT ... FOR UPDATE`) in deterministic alphanumeric order (`ORDER BY id ASC`), mathematically eliminating circular wait graphs and Postgres deadlock errors (`40P01`).
4. **Defense-in-Depth Balance Invariants:** User wallet balances are protected by application-level row locks and an underlying database CHECK constraint (`CONSTRAINT chk_wallet_non_negative_balance CHECK (type != 'USER_WALLET' OR cached_balance >= 0)`). Overdrafts are impossible.
5. **Two-Tier Idempotency Framework:** Distributed atomic leader election with Redis (`SET NX EX`) backed by PostgreSQL persistence and canonical SHA-256 payload hashing. Duplicate requests return identical cached responses, and payload tampering with an existing key triggers an instant `409 Conflict`.
6. **Mathematical Ledger Reconciliation Engine:** Admin endpoint (`GET /api/v1/audit/reconcile`) validates that the entire system ledger balances to zero ($\sum \text{Debits} - \sum \text{Credits} = 0$) and verifies every single wallet's cached balance against the historical sum of its ledger entries.

---

## Quickstart & Local Setup

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 20+](https://nodejs.org/)

### 2. Clone and Install Dependencies
```bash
git clone https://github.com/akshaatsingh/vaultkern.git
cd vaultkern
npm install
```

### 3. Start Database & Cache
```bash
docker compose up -d
```

### 4. Run Migrations & Seed System Funding Account
```bash
npm run migrate
```

### 5. Start Development Server
```bash
npm run dev
```
The API is available at `http://localhost:3000`.

---

## API Reference

### 1. Create User Wallet
```http
POST /api/v1/accounts
Content-Type: application/json

{
  "user_id": "usr_99812",
  "currency": "INR"
}
```
**Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "id": "1d8b9e6f-7607-4f80-9ce8-16ec711a7f05",
    "account_number": "VK_INR_E5B2889A147C",
    "user_id": "usr_99812",
    "type": "USER_WALLET",
    "currency": "INR",
    "status": "ACTIVE",
    "cached_balance": "0",
    "version": 1
  }
}
```

---

### 2. Fetch Wallet Balance & Paginated Ledger History
```http
GET /api/v1/accounts/:id/balance?limit=20&offset=0
```
**Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "account": {
      "id": "1d8b9e6f-7607-4f80-9ce8-16ec711a7f05",
      "account_number": "VK_INR_E5B2889A147C",
      "user_id": "usr_99812",
      "type": "USER_WALLET",
      "currency": "INR",
      "status": "ACTIVE",
      "balance": "10000"
    },
    "history": [
      {
        "id": "76ba3e18-655f-40c2-9a0d-b4bcf7f6db01",
        "direction": "CREDIT",
        "amount": "10000",
        "balance_after": "10000",
        "transaction_type": "DEPOSIT",
        "reference_id": "TXN_DEP_99A04B1D"
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "total": 1
    }
  }
}
```

---

### 3. Deposit Funds (External Settlement $\to$ Wallet)
```http
POST /api/v1/deposits
Idempotency-Key: dep_9981_001
Content-Type: application/json

{
  "account_id": "1d8b9e6f-7607-4f80-9ce8-16ec711a7f05",
  "amount": 10000,
  "description": "Initial account deposit"
}
```
**Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "1d3f9821-2e6b-4e12-b52b-748956cc6b7a",
      "reference_id": "TXN_DEP_99A04B1D",
      "type": "DEPOSIT",
      "status": "POSTED"
    },
    "user_account": {
      "id": "1d8b9e6f-7607-4f80-9ce8-16ec711a7f05",
      "account_number": "VK_INR_E5B2889A147C",
      "balance": "10000"
    },
    "amount": "10000"
  }
}
```

---

### 4. Transfer Funds (Wallet A $\to$ Wallet B)
```http
POST /api/v1/transfers
Idempotency-Key: trf_8911_001
Content-Type: application/json

{
  "from_account_id": "1d8b9e6f-7607-4f80-9ce8-16ec711a7f05",
  "to_account_id": "2e4a8123-99b8-472d-864a-25ec88219c01",
  "amount": 3500,
  "description": "Payment for services"
}
```
**Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "f8a02c3d-6b19-4f75-9e6b-12a84b5c7e90",
      "reference_id": "TXN_TRF_4981BCDA",
      "type": "TRANSFER",
      "status": "POSTED"
    },
    "from_account": {
      "id": "1d8b9e6f-7607-4f80-9ce8-16ec711a7f05",
      "account_number": "VK_INR_E5B2889A147C",
      "balance": "6500"
    },
    "to_account": {
      "id": "2e4a8123-99b8-472d-864a-25ec88219c01",
      "account_number": "VK_INR_88A19DF482E1",
      "balance": "3500"
    },
    "amount": "3500"
  }
}
```

---

### 5. System-Wide Audit & Reconciliation
```http
GET /api/v1/audit/reconcile
x-admin-key: vaultkern_admin_secret_key_2026
```
**Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "reconciled": true,
    "timestamp": "2026-11-23T09:36:11.000Z",
    "summary": {
      "total_transactions": 142,
      "total_ledger_entries": 284,
      "total_accounts": 12,
      "total_debits": "15000000",
      "total_credits": "15000000",
      "system_net_delta": "0"
    },
    "discrepancies": []
  }
}
```

---

## Automated Concurrency Proof of Work

Run the full automated test suite:
```bash
npm test
```

### Verified Test Proofs:
1. **Idempotency Proof (`tests/integration/idempotency.test.ts`):**
   - 10 simultaneous concurrent requests with the identical `Idempotency-Key` transfer funds exactly ONCE.
   - All 10 requests receive identical transaction IDs and response payloads.
   - Payload tampering with an existing key is blocked with `409 Conflict`.
2. **Overdraft Race-Condition Proof (`tests/integration/overdraft-race.test.ts`):**
   - Source Account starts with ₹100 (10,000 paise).
   - 5 simultaneous concurrent transfers of ₹80 (8,000 paise) each fire to a destination account.
   - Exactly **1 transfer succeeds** (`201 Created`), and exactly **4 fail** (`422 Unprocessable Entity - INSUFFICIENT_FUNDS`).
   - Source balance finishes at ₹20 (2,000 paise) and never drops below zero.
3. **Deadlock Elimination Proof (`tests/integration/deadlock.test.ts`):**
   - 20 simultaneous interleaved transfers ($10 \times A \to B$ and $10 \times B \to A$) fire simultaneously.
   - All 20 succeed with zero PostgreSQL deadlock errors (`40P01`).
4. **Reconciliation Audit Proof (`tests/integration/reconciliation.test.ts`):**
   - Proves system-wide zero-sum balance and detects simulated database balance tampering.

---

## License
MIT License. Crafted with precision for mission-critical financial applications.
