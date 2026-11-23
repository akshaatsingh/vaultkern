import { withTransaction } from "../../db/client.js";
import { Account, Transaction } from "../../common/types.js";
import {
  AccountInactiveError,
  AccountNotFoundError,
  CurrencyMismatchError,
} from "../../common/errors.js";
import { DepositInput } from "./deposits.schema.js";
import crypto from "crypto";

export class DepositsService {
  async executeDeposit(
    input: DepositInput,
    idempotencyKey: string
  ): Promise<{
    transaction: Transaction;
    user_account: {
      id: string;
      account_number: string;
      balance: string;
    };
    amount: string;
  }> {
    const amountBigInt = input.amount;

    return withTransaction(async (client) => {
      // 1. Identify system funding account and target account
      const targetQuery = await client.query<Account>(
        `SELECT * FROM accounts WHERE id = $1`,
        [input.account_id]
      );

      if (targetQuery.rows.length === 0) {
        throw new AccountNotFoundError(input.account_id);
      }
      const targetAccountPre = targetQuery.rows[0];

      if (targetAccountPre.status !== "ACTIVE") {
        throw new AccountInactiveError(targetAccountPre.id, targetAccountPre.status);
      }

      const systemQuery = await client.query<Account>(
        `SELECT * FROM accounts 
         WHERE type = 'SYSTEM_EXTERNAL_FUNDING' AND currency = $1 
         LIMIT 1`,
        [targetAccountPre.currency]
      );

      if (systemQuery.rows.length === 0) {
        throw new AccountNotFoundError(
          `System external funding account for currency ${targetAccountPre.currency}`
        );
      }
      const systemAccountPre = systemQuery.rows[0];

      // 2. Row-Level Pessimistic Locking with Deterministic Sorting (id ASC)
      const lockIds = [systemAccountPre.id, targetAccountPre.id].sort();
      const lockResult = await client.query<Account>(
        `SELECT * FROM accounts 
         WHERE id IN ($1, $2) 
         ORDER BY id ASC 
         FOR UPDATE;`,
        [lockIds[0], lockIds[1]]
      );

      const lockedSystem = lockResult.rows.find((a) => a.id === systemAccountPre.id)!;
      const lockedTarget = lockResult.rows.find((a) => a.id === targetAccountPre.id)!;

      if (lockedTarget.status !== "ACTIVE") {
        throw new AccountInactiveError(lockedTarget.id, lockedTarget.status);
      }
      if (lockedSystem.currency !== lockedTarget.currency) {
        throw new CurrencyMismatchError(lockedSystem.currency, lockedTarget.currency);
      }

      const sysBalanceBefore = BigInt(lockedSystem.cached_balance);
      const userBalanceBefore = BigInt(lockedTarget.cached_balance);

      const sysBalanceAfter = sysBalanceBefore + amountBigInt;
      const userBalanceAfter = userBalanceBefore + amountBigInt;

      // 3. Insert Transaction Record
      const referenceId = `TXN_DEP_${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
      const description = input.description || `Deposit to wallet ${lockedTarget.account_number}`;

      const txResult = await client.query<Transaction>(
        `INSERT INTO transactions (reference_id, type, status, idempotency_key, description, metadata, completed_at)
         VALUES ($1, 'DEPOSIT', 'POSTED', $2, $3, $4, NOW())
         RETURNING *;`,
        [
          referenceId,
          idempotencyKey,
          description,
          JSON.stringify({
            amount: amountBigInt.toString(),
            target_account: lockedTarget.id,
            system_account: lockedSystem.id,
          }),
        ]
      );
      const transaction = txResult.rows[0];

      // 4. Insert Balanced Ledger Entries (Immutable)
      // Entry 1: System Funding Reserve (Asset Account) -> DEBIT
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, balance_after, sequence_num)
         VALUES ($1, $2, 'DEBIT', $3, $4, 1);`,
        [transaction.id, lockedSystem.id, amountBigInt.toString(), sysBalanceAfter.toString()]
      );

      // Entry 2: User Wallet (Liability Account) -> CREDIT
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, balance_after, sequence_num)
         VALUES ($1, $2, 'CREDIT', $3, $4, 2);`,
        [transaction.id, lockedTarget.id, amountBigInt.toString(), userBalanceAfter.toString()]
      );

      // 5. Update Cached Balances
      await client.query(
        `UPDATE accounts 
         SET cached_balance = $1, version = version + 1, updated_at = NOW() 
         WHERE id = $2;`,
        [sysBalanceAfter.toString(), lockedSystem.id]
      );

      await client.query(
        `UPDATE accounts 
         SET cached_balance = $1, version = version + 1, updated_at = NOW() 
         WHERE id = $2;`,
        [userBalanceAfter.toString(), lockedTarget.id]
      );

      return {
        transaction,
        user_account: {
          id: lockedTarget.id,
          account_number: lockedTarget.account_number,
          balance: userBalanceAfter.toString(),
        },
        amount: amountBigInt.toString(),
      };
    });
  }
}

export const depositsService = new DepositsService();
