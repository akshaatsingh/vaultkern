import { query } from "../../db/client.js";
import { Account, LedgerEntry } from "../../common/types.js";
import { AccountNotFoundError } from "../../common/errors.js";
import { CreateAccountInput } from "./accounts.schema.js";
import crypto from "crypto";

export class AccountsService {
  async createAccount(input: CreateAccountInput): Promise<Account> {
    const currency = input.currency || "INR";
    const accountNumber =
      input.account_number ||
      `VK_${currency}_${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

    const result = await query<Account>(
      `INSERT INTO accounts (account_number, user_id, type, currency, status, cached_balance, version)
       VALUES ($1, $2, 'USER_WALLET', $3, 'ACTIVE', 0, 1)
       RETURNING *;`,
      [accountNumber, input.user_id, currency]
    );

    return result.rows[0];
  }

  async getAccountById(id: string): Promise<Account> {
    const result = await query<Account>(
      `SELECT * FROM accounts WHERE id = $1;`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new AccountNotFoundError(id);
    }

    return result.rows[0];
  }

  async getAccountBalanceAndHistory(
    id: string,
    limit = 20,
    offset = 0
  ): Promise<{
    account: {
      id: string;
      account_number: string;
      user_id: string;
      type: string;
      currency: string;
      status: string;
      balance: string; // Smallest unit, e.g. paise
    };
    history: Array<
      LedgerEntry & {
        transaction_type: string;
        reference_id: string;
        description: string | null;
      }
    >;
    pagination: {
      limit: number;
      offset: number;
      total: number;
    };
  }> {
    const account = await this.getAccountById(id);

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ledger_entries WHERE account_id = $1;`,
      [id]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const historyResult = await query<
      LedgerEntry & {
        transaction_type: string;
        reference_id: string;
        description: string | null;
      }
    >(
      `SELECT 
         le.id,
         le.transaction_id,
         le.account_id,
         le.direction,
         le.amount,
         le.balance_after,
         le.sequence_num,
         le.created_at,
         t.type as transaction_type,
         t.reference_id,
         t.description
       FROM ledger_entries le
       JOIN transactions t ON le.transaction_id = t.id
       WHERE le.account_id = $1
       ORDER BY le.created_at DESC, le.sequence_num DESC
       LIMIT $2 OFFSET $3;`,
      [id, limit, offset]
    );

    return {
      account: {
        id: account.id,
        account_number: account.account_number,
        user_id: account.user_id,
        type: account.type,
        currency: account.currency,
        status: account.status,
        balance: account.cached_balance,
      },
      history: historyResult.rows,
      pagination: {
        limit,
        offset,
        total,
      },
    };
  }
}

export const accountsService = new AccountsService();
