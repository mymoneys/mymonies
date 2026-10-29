import { getDb, getRecentTransactions, insertParsedTransaction, parsePendingTransactions, setSetting, upsertBudget } from '../db';
import { enableAkiba, setRate } from '../akiba/store.ts';
import { buildDemoInbox, demoInjections } from './demoInbox.ts';
import { DEMO_MODE } from './mode';

/**
 * Seeds a demo build with Amani's synthetic history and profile. Refuses to
 * run outside DEMO_MODE so synthetic rows can never mix into someone's real
 * transaction history.
 */

// Simulated on-ramp rate for the demo, shown with its date everywhere.
const DEMO_RATE = { kesPerUsdt: 129.25, rateDate: '2026-10-23' };

export async function loadDemoInbox(): Promise<number> {
  if (!DEMO_MODE) throw new Error('Demo data only loads in a demo build');
  const now = new Date();
  let inserted = 0;
  for (const m of buildDemoInbox(now)) {
    if (await insertParsedTransaction(m.body, m.date)) inserted++;
  }
  await parsePendingTransactions();
  await setSetting('payday_day', '28');
  await upsertBudget({ id: 'demo_rent', label: 'Rent', amount: 18_000 });
  await upsertBudget({ id: 'demo_power', label: 'Electricity', amount: 2_500 });
  await upsertBudget({ id: 'demo_net', label: 'Internet', amount: 1_200 });
  await setRate(DEMO_RATE.kesPerUsdt, DEMO_RATE.rateDate);
  // Only income from now on triggers the agent — not the seeded history.
  await enableAkiba(Date.now());
  return inserted;
}

/**
 * Empties the demo database for a fresh take: transactions, proposals, AI run
 * stats, budgets and rules. Settings stay (downloaded model, wallet), except
 * the ones "Load 4 months" sets again. The real database is a different file
 * (mpesa.db), and this refuses to run outside DEMO_MODE.
 */
export async function resetDemoData(): Promise<void> {
  if (!DEMO_MODE) throw new Error('Reset only works in a demo build');
  const db = await getDb();
  const existing = new Set(
    (await db.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r.name)
  );
  const tables = ['transactions', 'sweep_proposals', 'ai_runs', 'budgets', 'rules', 'sync_runs', 'contributions', 'label_overrides'];
  for (const table of tables.filter((t) => existing.has(t))) {
    await db.runAsync(`DELETE FROM ${table}`);
  }
  await db.runAsync(`DELETE FROM settings WHERE key IN ('akiba_enabled_since', 'payday_day')`);
}

export type DemoInjection = 'loan' | 'salary' | 'reversal';

/** Drops one hand-written M-Pesa SMS into the demo inbox, as if it just arrived. */
export async function injectDemoSms(kind: DemoInjection): Promise<void> {
  if (!DEMO_MODE) throw new Error('Demo injections only work in a demo build');
  const latest = (await getRecentTransactions(1))[0];
  const balance = latest?.balance ?? 2_000;
  const msg = demoInjections(new Date(), balance)[kind];
  await insertParsedTransaction(msg.body, Date.now());
}
