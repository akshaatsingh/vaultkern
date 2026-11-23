# Vaultkern 🏦
> **Production-Grade Double-Entry Digital Wallet & Payment Ledger API**  
> Built with Node.js, Fastify, TypeScript, PostgreSQL 16, and Redis 7. Designed for institutional fintech-grade concurrency, zero race conditions, and zero overdrafts.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.2-black.svg)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D.svg)](https://redis.io/)
[![Vitest](https://img.shields.io/badge/Vitest-3.0-6E9F18.svg)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 📸 Visual Showcase & Web Experience

Vaultkern includes a high-fidelity web interface inspired by **Revolut**, featuring real-time 3D card tilt physics, dark/light theme switching, phone P2P transfer simulators, and live concurrency stress-test terminals.

### 1. Revolut-Style Hero & 3D Interactive Metal Card
Clean default white canvas with mouse-tracking 3D card physics, real-time balance display, and institutional proof metrics.

![Vaultkern Light Mode Hero](docs/screenshots/01_hero_light.png)

---

### 2. Dark Mode Experience
One-click theme toggle to an obsidian dark palette with dynamic holographic card lighting and neon cyber accents.

![Vaultkern Dark Mode](docs/screenshots/02_hero_dark.png)

---

### 3. Passwordless Gmail Sign-In & 6-Digit OTP Verification
Instant user onboarding via Gmail address verification. Codes are cryptographically generated, tracked in Redis with 5-minute TTL, and delivered via Google SMTP or local dev simulator.

![Gmail Sign-In and OTP Verification](docs/screenshots/03_gmail_auth_modal.png)

---

### 4. Fintech Profile & Identity Customizer
Customizable personal profiles with editable display name, `@Revtag` handle for P2P transfers, contact phone, country of tax residence, and bio.

![Profile Customization Settings](docs/screenshots/04_profile_customizer.png)

---

### 5. Virtual Metal Card & Avatar Studio
Real-time material customization across 4 finishes (**Space Grey**, **Obsidian Black**, **Cyan Pulse**, **Brushed Gold**) paired with vector avatar generators (DiceBear Avatars, Fintech Bots, Lorelei, Micah).

![Virtual Card and Avatar Studio](docs/screenshots/05_card_avatar_studio.png)

---

### 6. P2P Phone Simulator & Multi-Currency Engine
Simulate real-time peer-to-peer transfers between `@Revtags` with instant ledger updates, currency exchange calculators, and automated savings vaults projections.

![Phone Simulator and P2P Transfers](docs/screenshots/06_p2p_phone_transfers.png)

---

### 7. Interactive Concurrency Stress-Test Arena
Live in-browser proof console executing 10x idempotency bursts, 5x overdraft attacks, and 20x cross-deadlock storms against the running backend engine.

![Concurrency Arena Tests](docs/screenshots/07_concurrency_stress_arena.png)

---

## ⚡ Non-Negotiable Core Engineering Guarantees

1. **Strict Double-Entry Accounting**: Money is never created or destroyed. Every transfer generates balanced, paired `ledger_entries` (one `DEBIT` and one `CREDIT` that sum to exactly 0) linked to an immutable transaction audit record. A PostgreSQL trigger (`trg_ledger_entries_immutable`) prohibits any `UPDATE` or `DELETE` on ledger records at the database engine level.
2. **Integer-Only Currency Storage (`BIGINT`)**: All currency amounts are stored in their smallest atomic unit (e.g., paise for INR, cents for USD) as 64-bit integers (`BIGINT`), completely eliminating IEEE 754 floating-point rounding errors.
3. **Deadlock-Free ACID Transactions**: Bidirectional concurrent transfers (e.g., Alice $\leftrightarrow$ Bob) acquire pessimistic row locks (`SELECT ... FOR UPDATE`) in deterministic alphanumeric order (`ORDER BY id ASC`), mathematically eliminating circular wait graphs and Postgres deadlock errors (`40P01`).
4. **Defense-in-Depth Balance Invariants**: User wallet balances are protected by application-level row locks and an underlying database CHECK constraint (`CONSTRAINT chk_wallet_non_negative_balance CHECK (type != 'USER_WALLET' OR cached_balance >= 0)`). Overdrafts are impossible.
5. **Two-Tier Idempotency Framework**: Distributed atomic leader election with Redis (`SET NX EX`) backed by PostgreSQL persistence and canonical SHA-256 payload hashing. Duplicate requests return identical cached responses, and payload tampering with an existing key triggers an instant `409 Conflict`.
6. **Mathematical Ledger Reconciliation Engine**: System reconciliation endpoint (`GET /api/v1/audit/reconcile`) validates that the entire system ledger balances to zero ($\sum \text{Debits} - \sum \text{Credits} = 0$) and verifies every single wallet's cached balance against the historical sum of its ledger entries.

---

## 🏛️ System Architecture

```
                        +---------------------------------------+
                        |           Client Application          |
                        +---------------------------------------+
                                            |
                                [ HTTPS + Idempotency-Key ]
                                            v
+---------------------------------------------------------------------------------------+
|  Vaultkern API Service (Fastify 5 + TypeScript)                                       |
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
| - Ephemeral Gmail OTP state |     | - User profiles, wallets, transactions            |
+-----------------------------+     +---------------------------------------------------+
```

---

## 🗄️ Where Data Is Recorded (Three-Tier Persistence)

| Storage Layer | Technology | Data Stored | Durability / TTL |
| :--- | :--- | :--- | :--- |
| **Relational Record of Truth** | **PostgreSQL 16** | `users` (profiles, bio, phone, tier, card finish), `accounts` (wallets, reserves), `transactions` (posted transfers, deposits), `ledger_entries` (immutable paired double-entry postings). | Permanent, ACID durable, guarded by triggers. |
| **Distributed Cache & Locks** | **Redis 7** | `otp:gmail:<email>` (6-digit OTP verification codes), `otp:rate:<email>` (30s rate-limit cooldown), `idempotency:<key>` (in-flight atomic locks & cached responses). | Ephemeral, 30s to 5m TTLs, instant cluster invalidation. |
| **Client Session Cache** | **Browser LocalStorage** | `vaultkern_session` (authenticated user profile, active wallet ID, chosen theme). | Local to client browser for instant rendering on reload. |

---

## 🚀 Quickstart & Local Setup

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
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

### 4. Run Migrations & Seed System Reserves
```bash
npm run migrate
```

### 5. Start Development Server
```bash
npm run dev
```
Open **`http://localhost:3001`** in your browser to experience the dashboard.

---

## 🧪 Automated Concurrency Proof of Work

Run the complete Vitest integration test suite:
```bash
npm test
```

### Verified Test Proofs (18 Tests Across 7 Suites):
1. **Idempotency Proof (`tests/integration/idempotency.test.ts`)**:
   - 10 simultaneous concurrent requests with the identical `Idempotency-Key` transfer funds exactly ONCE.
   - All 10 requests receive identical transaction IDs and response payloads.
   - Payload tampering with an existing key is rejected with `409 Conflict`.
2. **Overdraft Race-Condition Proof (`tests/integration/overdraft-race.test.ts`)**:
   - Source Account starts with ₹100 (10,000 paise).
   - 5 simultaneous concurrent transfers of ₹80 (8,000 paise) each fire to a destination account.
   - Exactly **1 transfer succeeds** (`201 Created`), and exactly **4 fail** (`422 Unprocessable Entity - INSUFFICIENT_FUNDS`).
   - Source balance finishes at ₹20 (2,000 paise) and never drops below zero.
3. **Deadlock Elimination Proof (`tests/integration/deadlock.test.ts`)**:
   - 20 simultaneous interleaved transfers ($10 \times A \to B$ and $10 \times B \to A$) fire simultaneously.
   - All 20 succeed with zero PostgreSQL deadlock errors (`40P01`).
4. **Gmail OTP & Wallet Provisioning (`tests/integration/auth-otp.test.ts`)**:
   - Validates `@gmail.com` domain, enforces 30s rate limits, rejects invalid codes, and automatically credits ₹1,000 welcome capital.
5. **Profile Customization Proof (`tests/integration/auth-otp.test.ts`)**:
   - Verifies profile updates (Bio, Phone, Country, Card Finishes, Discreet Mode) persist in PostgreSQL.
6. **Reconciliation Audit Proof (`tests/integration/reconciliation.test.ts`)**:
   - Proves system-wide zero-sum balance and detects simulated database balance tampering.

---

## 📡 API Reference Summary

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/auth/send-otp` | `POST` | Dispatches 6-digit verification code to user's Gmail address. |
| `/api/v1/auth/verify-otp` | `POST` | Verifies OTP, activates account, and provisions wallet with ₹1,000 bonus. |
| `/api/v1/auth/profile/:id` | `PUT` | Updates profile customizations, avatar styles, card finishes, and privacy mode. |
| `/api/v1/accounts` | `POST` | Creates a new digital currency wallet. |
| `/api/v1/accounts/:id/balance` | `GET` | Fetches cached balance and paginated audit ledger history. |
| `/api/v1/deposits` | `POST` | External funding deposit into a wallet (creates paired double-entry ledger records). |
| `/api/v1/transfers` | `POST` | P2P transfer between wallets with row-level locks and idempotency protection. |
| `/api/v1/audit/reconcile` | `GET` | Full system mathematical audit verifying balance conservation ($\sum \Delta = 0$). |

---

## 📄 License
MIT License. Crafted with precision for mission-critical financial applications.
