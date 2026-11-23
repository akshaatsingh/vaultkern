import { withTransaction } from "../../db/client.js";
import { Account, Transaction } from "../../common/types.js";
import {
  AccountInactiveError,
  AccountNotFoundError,
  CurrencyMismatchError,
  InsufficientFundsError,
  SameAccountTransferError,
} from "../../common/errors.js";
import { TransferInput } from "./transfers.schema.js";
import crypto from "crypto";

export class TransfersService {
  async executeTransfer(
    input: TransferInput,
    idempotencyKey: string
  ): Promise<{
    transaction: Transaction;
    from_account: {
      id: string;
      account_number: string;
      balance: string;
    };
    to_account: {
      id: string;
      account_number: string;
      balance: string;
    };
    amount: string;
  }> {
    if (input.from_account_id === input.to_account_id) {
      throw new SameAccountTransferError();
    }

    const amountBigInt = input.amount;

    return withTransaction(async (client) => {
      // 1. Deterministic Lock Acquisition (ORDER BY id ASC)
      // Eliminates circular lock deadlocks even with high-concurrency bidirectional transfers
      const sortedIds = [input.from_account_id, input.to_account_id].sort();

      const lockResult = await client.query<Account>(
        `SELECT * FROM accounts 
         WHERE id IN ($1, $2) 
         ORDER BY id ASC 
         FOR UPDATE;`,
        [sortedIds[0], sortedIds[1]]
      );

      if (lockResult.rows.length < 2) {
        // One or both accounts do not exist
        const foundIds = lockResult.rows.map((r) => r.id);
        if (!foundIds.includes(input.from_account_id)) {
          throw new AccountNotFoundError(input.from_account_id);
        }
        throw new AccountNotFoundError(input.to_account_id);
      }

      const fromAccount = lockResult.rows.find((a) => a.id === input.from_account_id)!;
      const toAccount = lockResult.rows.find((a) => a.id === input.to_account_id)!;

      // 2. Account Status Validation
      if (fromAccount.status !== "ACTIVE") {
        throw new AccountInactiveError(fromAccount.id, fromAccount.status);
      }
      if (toAccount.status !== "ACTIVE") {
        throw new AccountInactiveError(toAccount.id, toAccount.status);
      }

      // 3. Currency Match Validation
      if (fromAccount.currency !== toAccount.currency) {
        throw new CurrencyMismatchError(fromAccount.currency, toAccount.currency);
      }

      // 4. Overdraft Prevention (Strict Balance Verification under Row Lock)
      const fromBalanceBefore = BigInt(fromAccount.cached_balance);
      if (fromBalanceBefore < amountBigInt) {
        throw new InsufficientFundsError(
          `Insufficient funds in account ${fromAccount.account_number}. Current balance: ${fromBalanceBefore.toString()}, Required: ${amountBigInt.toString()}`,
          {
            current_balance: fromBalanceBefore.toString(),
            required_amount: amountBigInt.toString(),
            account_id: fromAccount.id,
          }
        );
      }

      const toBalanceBefore = BigInt(toAccount.cached_balance);

      const fromBalanceAfter = fromBalanceBefore - amountBigInt;
      const toBalanceAfter = toBalanceBefore + amountBigInt;

      // 5. Insert Transaction Record
      const referenceId = `TXN_TRF_${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
      const description =
        input.description ||
        `Transfer from ${fromAccount.account_number} to ${toAccount.account_number}`;

      const txResult = await client.query<Transaction>(
        `INSERT INTO transactions (reference_id, type, status, idempotency_key, description, metadata, completed_at)
         VALUES ($1, 'TRANSFER', 'POSTED', $2, $3, $4, NOW())
         RETURNING *;`,
        [
          referenceId,
          idempotencyKey,
          description,
          JSON.stringify({
            amount: amountBigInt.toString(),
            from_account_id: fromAccount.id,
            to_account_id: toAccount.id,
          }),
        ]
      );
      const transaction = txResult.rows[0];

      // 6. Insert Balanced Ledger Entries (Immutable)
      // Entry 1: Source Account -> DEBIT (reduces liability/balance)
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, balance_after, sequence_num)
         VALUES ($1, $2, 'DEBIT', $3, $4, 1);`,
        [transaction.id, fromAccount.id, amountBigInt.toString(), fromBalanceAfter.toString()]
      );

      // Entry 2: Destination Account -> CREDIT (increases liability/balance)
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, balance_after, sequence_num)
         VALUES ($1, $2, 'CREDIT', $3, $4, 2);`,
        [transaction.id, toAccount.id, amountBigInt.toString(), toBalanceAfter.toString()]
      );

      // 7. Update Cached Balances
      await client.query(
        `UPDATE accounts 
         SET cached_balance = $1, version = version + 1, updated_at = NOW() 
         WHERE id = $2;`,
        [fromBalanceAfter.toString(), fromAccount.id]
      );

      await client.query(
        `UPDATE accounts 
         SET cached_balance = $1, version = version + 1, updated_at = NOW() 
         WHERE id = $2;`,
        [toBalanceAfter.toString(), toAccount.id]
      );

      return {
        transaction,
        from_account: {
          id: fromAccount.id,
          account_number: fromAccount.account_number,
          balance: fromBalanceAfter.toString(),
        },
        to_account: {
          id: toAccount.id,
          account_number: toAccount.account_number,
          balance: toBalanceAfter.toString(),
        },
        amount: amountBigInt.toString(),
      };
    });
  }
}

export const transfersService = new TransfersService();
