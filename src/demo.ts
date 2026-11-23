/**
 * Vaultkern Interactive CLI Demo
 * Executes an end-to-end financial transaction lifecycle:
 * 1. Healthcheck
 * 2. Create User A (Alice) & User B (Bob) wallets
 * 3. Double-entry Deposit from external reserve into Alice (₹500 / 50,000 paise)
 * 4. Idempotent transfer from Alice to Bob (₹200 / 20,000 paise)
 * 5. Fetch updated balance & immutable ledger history
 * 6. System-wide Double-Entry Reconciliation Audit
 */

const API_BASE = "http://localhost:3001";

async function request(path: string, options: RequestInit = {}): Promise<{ status: number; data: any }> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function runDemo() {
  console.log("\n==========================================================");
  console.log("       🏦 VAULTKERN DIGITAL WALLET & LEDGER DEMO         ");
  console.log("==========================================================\n");

  // 1. Healthcheck
  console.log("1. Checking Server Health...");
  const health = await request("/health");
  console.log("   Status:", health.data.status, `(${health.data.timestamp})\n`);

  // 2. Create Accounts
  console.log("2. Creating User Wallets...");
  const aliceRes = await request("/api/v1/accounts", {
    method: "POST",
    body: JSON.stringify({ user_id: "alice_smith", currency: "INR" }),
  });
  const alice = aliceRes.data.data;
  console.log(`   Created Alice Wallet: ID=${alice.id} (Account #${alice.account_number})`);

  const bobRes = await request("/api/v1/accounts", {
    method: "POST",
    body: JSON.stringify({ user_id: "bob_jones", currency: "INR" }),
  });
  const bob = bobRes.data.data;
  console.log(`   Created Bob Wallet:   ID=${bob.id} (Account #${bob.account_number})\n`);

  // 3. Deposit Funds
  console.log("3. Depositing ₹500 (50,000 paise) into Alice's Wallet (Double-Entry)...");
  const depRes = await request("/api/v1/deposits", {
    method: "POST",
    headers: { "Idempotency-Key": `dep_demo_${Date.now()}` },
    body: JSON.stringify({
      account_id: alice.id,
      amount: 50000,
      description: "Initial payroll funding",
    }),
  });
  console.log(`   Deposit Posted: Txn ID=${depRes.data.data.transaction.reference_id}`);
  console.log(`   Alice New Balance: ₹${(parseInt(depRes.data.data.user_account.balance) / 100).toFixed(2)} (${depRes.data.data.user_account.balance} paise)\n`);

  // 4. Transfer Funds
  console.log("4. Transferring ₹200 (20,000 paise) from Alice to Bob (Row-Locked & Idempotent)...");
  const trfRes = await request("/api/v1/transfers", {
    method: "POST",
    headers: { "Idempotency-Key": `trf_demo_${Date.now()}` },
    body: JSON.stringify({
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 20000,
      description: "Alice payment to Bob for freelance services",
    }),
  });
  console.log(`   Transfer Posted: Txn ID=${trfRes.data.data.transaction.reference_id}`);
  console.log(`   Alice Balance: ₹${(parseInt(trfRes.data.data.from_account.balance) / 100).toFixed(2)} (${trfRes.data.data.from_account.balance} paise)`);
  console.log(`   Bob Balance:   ₹${(parseInt(trfRes.data.data.to_account.balance) / 100).toFixed(2)} (${trfRes.data.data.to_account.balance} paise)\n`);

  // 5. Fetch Ledger History
  console.log("5. Fetching Alice's Audit Ledger History...");
  const historyRes = await request(`/api/v1/accounts/${alice.id}/balance`);
  console.log(`   Alice Balance: ₹${(parseInt(historyRes.data.data.account.balance) / 100).toFixed(2)}`);
  console.log("   Ledger Postings:");
  for (const entry of historyRes.data.data.history) {
    const amountFormatted = (parseInt(entry.amount) / 100).toFixed(2);
    console.log(`     [${entry.direction}] ₹${amountFormatted} | Type: ${entry.transaction_type} | Balance After: ₹${(parseInt(entry.balance_after) / 100).toFixed(2)}`);
  }
  console.log();

  // 6. System Reconciliation
  console.log("6. Running Full System-Wide Double-Entry Reconciliation Audit...");
  const auditRes = await request("/api/v1/audit/reconcile");
  const summary = auditRes.data.data.summary;
  console.log("   System Reconciled?       ", auditRes.data.data.reconciled ? "✅ TRUE (100% Balanced)" : "❌ FALSE");
  console.log("   Total Transactions:      ", summary.total_transactions);
  console.log("   Total Ledger Entries:    ", summary.total_ledger_entries);
  console.log("   Total System Debits:     ", summary.total_debits, "paise");
  console.log("   Total System Credits:    ", summary.total_credits, "paise");
  console.log("   Net System Delta:        ", summary.system_net_delta, "paise (Must be 0)");
  console.log("\n==========================================================");
  console.log("           DEMO COMPLETED SUCCESSFULLY! 🎉               ");
  console.log("==========================================================\n");
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
});
