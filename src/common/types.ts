export type AccountType = "USER_WALLET" | "SYSTEM_EXTERNAL_FUNDING" | "SYSTEM_FEE";
export type AccountStatus = "ACTIVE" | "FROZEN" | "CLOSED";
export type TransactionType = "DEPOSIT" | "TRANSFER" | "WITHDRAWAL" | "ADJUSTMENT";
export type TransactionStatus = "PENDING" | "POSTED" | "FAILED";
export type LedgerDirection = "DEBIT" | "CREDIT";
export type IdempotencyStatus = "IN_FLIGHT" | "COMPLETED" | "FAILED";

export interface Account {
  id: string;
  account_number: string;
  user_id: string;
  type: AccountType;
  currency: string;
  status: AccountStatus;
  cached_balance: string; // BIGINT represented as string in JS for precision
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface Transaction {
  id: string;
  reference_id: string;
  type: TransactionType;
  status: TransactionStatus;
  idempotency_key: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  completed_at: Date | null;
}

export interface LedgerEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: LedgerDirection;
  amount: string; // BIGINT represented as string in JS
  balance_after: string; // BIGINT represented as string in JS
  sequence_num: number;
  created_at: Date;
}

export interface IdempotencyRecord {
  key: string;
  endpoint: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown | null;
  status: IdempotencyStatus;
  created_at: Date;
  expires_at: Date;
}
