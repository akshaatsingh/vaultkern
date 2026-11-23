import { query } from "../../db/client.js";

export interface ReconciliationDiscrepancy {
  type: "GLOBAL_IMBALANCE" | "TRANSACTION_IMBALANCE" | "ACCOUNT_BALANCE_MISMATCH";
  id?: string;
  expected?: string;
  actual?: string;
  details?: unknown;
}

export interface ReconciliationReport {
  reconciled: boolean;
  timestamp: string;
  summary: {
    total_transactions: number;
    total_ledger_entries: number;
    total_accounts: number;
    total_debits: string;
    total_credits: string;
    system_net_delta: string;
  };
  discrepancies: ReconciliationDiscrepancy[];
}

export class AuditService {
  async reconcile(): Promise<ReconciliationReport> {
    const discrepancies: ReconciliationDiscrepancy[] = [];

    // 1. Global Double-Entry Equilibrium Check
    const globalSumResult = await query<{
      total_entries: string;
      total_debits: string | null;
      total_credits: string | null;
    }>(`
      SELECT 
        COUNT(*) as total_entries,
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0) as total_debits,
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) as total_credits
      FROM ledger_entries;
    `);

    const totalEntries = parseInt(globalSumResult.rows[0].total_entries, 10);
    const totalDebits = BigInt(globalSumResult.rows[0].total_debits || "0");
    const totalCredits = BigInt(globalSumResult.rows[0].total_credits || "0");
    const systemNetDelta = totalDebits - totalCredits;

    if (systemNetDelta !== 0n) {
      discrepancies.push({
        type: "GLOBAL_IMBALANCE",
        expected: "0",
        actual: systemNetDelta.toString(),
        details: {
          total_debits: totalDebits.toString(),
          total_credits: totalCredits.toString(),
        },
      });
    }

    // 2. Per-Transaction Zero-Sum Verification
    const unbalancedTxResult = await query<{
      transaction_id: string;
      net_balance: string;
    }>(`
      SELECT 
        transaction_id,
        SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) as net_balance
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) != 0;
    `);

    for (const row of unbalancedTxResult.rows) {
      discrepancies.push({
        type: "TRANSACTION_IMBALANCE",
        id: row.transaction_id,
        expected: "0",
        actual: row.net_balance,
      });
    }

    // 3. Per-Account Balance vs. Historical Ledger Proof
    const accountAuditResult = await query<{
      id: string;
      account_number: string;
      type: string;
      cached_balance: string;
      computed_balance: string;
    }>(`
      SELECT 
        a.id,
        a.account_number,
        a.type,
        a.cached_balance,
        COALESCE(
          SUM(
            CASE 
              WHEN a.type = 'SYSTEM_EXTERNAL_FUNDING' THEN
                (CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
              ELSE
                (CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END)
            END
          ), 0
        ) as computed_balance
      FROM accounts a
      LEFT JOIN ledger_entries le ON a.id = le.account_id
      GROUP BY a.id, a.account_number, a.type, a.cached_balance;
    `);

    for (const row of accountAuditResult.rows) {
      if (BigInt(row.cached_balance) !== BigInt(row.computed_balance)) {
        discrepancies.push({
          type: "ACCOUNT_BALANCE_MISMATCH",
          id: row.id,
          expected: row.computed_balance,
          actual: row.cached_balance,
          details: {
            account_number: row.account_number,
            type: row.type,
          },
        });
      }
    }

    // Total transactions count
    const txCountResult = await query<{ count: string }>(`SELECT COUNT(*) as count FROM transactions;`);
    const totalTransactions = parseInt(txCountResult.rows[0].count, 10);

    return {
      reconciled: discrepancies.length === 0,
      timestamp: new Date().toISOString(),
      summary: {
        total_transactions: totalTransactions,
        total_ledger_entries: totalEntries,
        total_accounts: accountAuditResult.rows.length,
        total_debits: totalDebits.toString(),
        total_credits: totalCredits.toString(),
        system_net_delta: systemNetDelta.toString(),
      },
      discrepancies,
    };
  }
}

export const auditService = new AuditService();
