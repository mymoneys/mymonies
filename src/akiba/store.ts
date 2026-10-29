import { getBudgets, getDb, getSetting, setSetting } from '../db';
import { LIFE_CATEGORY_GROUPS } from '../lifeCategory';
import type { AkibaDecision } from './agent.ts';
import type { SweepEvent, SweepStatus } from './queue.ts';
import { nextStatus } from './queue.ts';
import type { RunStats } from '../ai/qvac.ts';
import type { IncomeRow } from './senderHistory.ts';
import type { MetricRow } from '../plan/metrics.ts';

/**
 * Akiba's tables live in the same mpesa.db as transactions (created lazily
 * here, not in db.ts's openDb, so the pre-existing schema code is untouched).
 */

export type SweepRow = {
  id: string;
  transaction_id: string;
  created_at: number;
  updated_at: number;
  income_kes: number;
  counterparty: string;
  income_label: string;
  label_source: string;
  max_safe_kes: number;
  breakdown_json: string;
  strategy: string;
  strategy_source: string;
  overridden: number;
  amount_kes: number;
  reason_en: string;
  reason_sw: string;
  rate: number | null;
  rate_date: string | null;
  amount_usdt_base: string | null;
  status: SweepStatus;
  tx_hash: string | null;
  error: string | null;
};

let ready: Promise<void> | null = null;

async function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sweep_proposals (
          id TEXT PRIMARY KEY NOT NULL,
          transaction_id TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          income_kes REAL NOT NULL,
          counterparty TEXT NOT NULL,
          income_label TEXT NOT NULL,
          label_source TEXT NOT NULL,
          max_safe_kes REAL NOT NULL,
          breakdown_json TEXT NOT NULL,
          strategy TEXT NOT NULL,
          strategy_source TEXT NOT NULL,
          overridden INTEGER NOT NULL DEFAULT 0,
          amount_kes REAL NOT NULL,
          reason_en TEXT NOT NULL,
          reason_sw TEXT NOT NULL,
          rate REAL,
          rate_date TEXT,
          amount_usdt_base TEXT,
          status TEXT NOT NULL,
          tx_hash TEXT,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sweeps_created ON sweep_proposals(created_at DESC);

        CREATE TABLE IF NOT EXISTS ai_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          task TEXT NOT NULL,
          latency_ms INTEGER NOT NULL,
          tokens_per_s REAL,
          ok INTEGER NOT NULL,
          error TEXT
        );
      `);
    })();
  }
  return ready;
}

// ---- Settings ----

const ENABLED_SINCE_KEY = 'akiba_enabled_since';
const RATE_KEY = 'akiba_kes_per_usdt';
const RATE_DATE_KEY = 'akiba_rate_date';
const BUFFER_KEY = 'akiba_buffer_kes';
const PAYDAY_KEY = 'payday_day'; // shared with ProfileScreen

/**
 * Only income received after Akiba was switched on is considered — never the
 * whole history, which would ask the user to approve months of old sweeps.
 */
export async function getEnabledSince(): Promise<number | null> {
  const v = await getSetting(ENABLED_SINCE_KEY);
  return v ? Number(v) : null;
}

export async function enableAkiba(sinceMs: number): Promise<void> {
  await setSetting(ENABLED_SINCE_KEY, String(sinceMs));
}

export async function getRate(): Promise<{ kesPerUsdt: number; rateDate: string } | null> {
  const [rate, date] = await Promise.all([getSetting(RATE_KEY), getSetting(RATE_DATE_KEY)]);
  const n = rate ? Number(rate) : NaN;
  return n > 0 && date ? { kesPerUsdt: n, rateDate: date } : null;
}

export async function setRate(kesPerUsdt: number, rateDate: string): Promise<void> {
  await setSetting(RATE_KEY, String(kesPerUsdt));
  await setSetting(RATE_DATE_KEY, rateDate);
}

export async function getBufferKes(): Promise<number> {
  const v = await getSetting(BUFFER_KEY);
  return v ? Number(v) : 2_000;
}

export async function getPaydayDay(): Promise<number | null> {
  const v = await getSetting(PAYDAY_KEY);
  const n = v ? Number(v) : NaN;
  return n >= 1 && n <= 31 ? n : null;
}

// ---- Inputs for the agent ----

export type IncomeTx = { id: string; raw_text: string; amount: number; counterparty_name: string; timestamp: number; balance: number | null };

/** Oldest RECEIVED transaction after `since` that has no proposal yet. */
export async function nextUnprocessedIncome(since: number): Promise<IncomeTx | null> {
  await ensureTables();
  const db = await getDb();
  const row = await db.getFirstAsync<IncomeTx>(
    `SELECT t.id, t.raw_text, t.amount, t.counterparty_name, t.timestamp, t.balance
       FROM transactions t
       LEFT JOIN sweep_proposals s ON s.transaction_id = t.id
      WHERE t.transaction_type = 'RECEIVED' AND t.is_parsed = 1 AND t.timestamp >= ? AND s.id IS NULL
      ORDER BY t.timestamp ASC LIMIT 1`,
    since
  );
  return row ?? null;
}

export async function incomeBefore(timestamp: number): Promise<IncomeRow[]> {
  const db = await getDb();
  return db.getAllAsync<IncomeRow>(
    `SELECT counterparty_name, amount, timestamp FROM transactions
      WHERE transaction_type = 'RECEIVED' AND timestamp < ? AND timestamp >= ?`,
    timestamp,
    timestamp - 200 * 86_400_000
  );
}

export async function metricRows(sinceMs: number): Promise<MetricRow[]> {
  const db = await getDb();
  return db.getAllAsync<MetricRow>(
    `SELECT amount, transaction_type, "group" as "group", counterparty_name, timestamp, balance
       FROM transactions WHERE timestamp >= ? AND transaction_type NOT IN ('FAILED', 'INFO')`,
    sinceMs
  );
}

export function isNeedGroup(group: string): boolean {
  return LIFE_CATEGORY_GROUPS[group] === 'Needs';
}

/**
 * Sum over budget items of what's still unpaid since the last payday —
 * spending is matched to a budget by category, like ProfileScreen does.
 */
export async function unpaidBudgetsKes(cycleStartMs: number): Promise<{ unpaid: number; budgetGroups: Set<string> }> {
  const db = await getDb();
  const budgets = await getBudgets();
  let unpaid = 0;
  for (const b of budgets) {
    const spent = await db.getFirstAsync<{ s: number | null }>(
      `SELECT SUM(amount) as s FROM transactions
        WHERE transaction_type IN ('SENT', 'PAID', 'EXPENSE') AND category = ? AND timestamp >= ?`,
      b.category,
      cycleStartMs
    );
    unpaid += Math.max(0, b.amount - (spent?.s ?? 0));
  }
  return { unpaid, budgetGroups: new Set(budgets.map((b) => b.group)) };
}

// ---- Proposals ----

export async function saveProposal(
  tx: IncomeTx,
  d: AkibaDecision,
  conversion: { rate: number; rateDate: string; baseUnits: string } | null
): Promise<void> {
  await ensureTables();
  const db = await getDb();
  const now = Date.now();
  // A skip is complete as soon as it's decided — nothing to approve.
  const status: SweepStatus = d.amountKes > 0 ? 'proposed' : 'declined';
  await db.runAsync(
    `INSERT OR IGNORE INTO sweep_proposals
       (id, transaction_id, created_at, updated_at, income_kes, counterparty, income_label, label_source,
        max_safe_kes, breakdown_json, strategy, strategy_source, overridden, amount_kes, reason_en, reason_sw,
        rate, rate_date, amount_usdt_base, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `sweep_${tx.id}`,
    tx.id,
    now,
    now,
    tx.amount,
    tx.counterparty_name,
    d.incomeLabel,
    d.labelSource,
    d.maxSafeKes,
    JSON.stringify(d.breakdown),
    d.strategy,
    d.strategySource,
    d.overridden ? 1 : 0,
    d.amountKes,
    d.reasonEn,
    d.reasonSw,
    conversion?.rate ?? null,
    conversion?.rateDate ?? null,
    conversion?.baseUnits ?? null,
    status
  );
}

export async function getProposals(limit = 30): Promise<SweepRow[]> {
  await ensureTables();
  const db = await getDb();
  return db.getAllAsync<SweepRow>(`SELECT * FROM sweep_proposals ORDER BY created_at DESC LIMIT ?`, limit);
}

export async function getSendable(): Promise<SweepRow[]> {
  await ensureTables();
  const db = await getDb();
  return db.getAllAsync<SweepRow>(
    `SELECT * FROM sweep_proposals WHERE status IN ('approved', 'queued_offline', 'failed') ORDER BY created_at ASC`
  );
}

/** Applies a queue transition (throws on an illegal one) and records extras. */
export async function transition(
  id: string,
  event: SweepEvent,
  extra: { txHash?: string; error?: string | null } = {}
): Promise<SweepStatus> {
  await ensureTables();
  const db = await getDb();
  const row = await db.getFirstAsync<{ status: SweepStatus }>(`SELECT status FROM sweep_proposals WHERE id = ?`, id);
  if (!row) throw new Error(`No sweep ${id}`);
  const status = nextStatus(row.status, event);
  await db.runAsync(
    `UPDATE sweep_proposals SET status = ?, updated_at = ?, tx_hash = COALESCE(?, tx_hash), error = ? WHERE id = ?`,
    status,
    Date.now(),
    extra.txHash ?? null,
    extra.error ?? null,
    id
  );
  return status;
}

export async function totalSavedKes(): Promise<number> {
  await ensureTables();
  const db = await getDb();
  const row = await db.getFirstAsync<{ s: number | null }>(`SELECT SUM(amount_kes) as s FROM sweep_proposals WHERE status = 'sent'`);
  return row?.s ?? 0;
}

// ---- AI run log (evidence for judges + the AI status card) ----

export async function logAiRun(s: RunStats): Promise<void> {
  // Also to logcat (tag ReactNativeJS), so failures can be read off a
  // release build where the database isn't accessible.
  console.log(`[akiba-ai] ${s.task} ${s.ok ? 'ok' : 'FAIL'} ${s.latencyMs}ms ${s.tokensPerSecond?.toFixed(1) ?? '-'} tok/s ${s.error ?? ''}`);
  await ensureTables();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO ai_runs (at, task, latency_ms, tokens_per_s, ok, error) VALUES (?, ?, ?, ?, ?, ?)`,
    Date.now(),
    s.task,
    s.latencyMs,
    s.tokensPerSecond,
    s.ok ? 1 : 0,
    s.error ?? null
  );
}

export async function aiRunSummary(): Promise<{ runs: number; medianMs: number | null; okRate: number | null }> {
  await ensureTables();
  const db = await getDb();
  const rows = await db.getAllAsync<{ latency_ms: number; ok: number }>(`SELECT latency_ms, ok FROM ai_runs ORDER BY id DESC LIMIT 50`);
  if (!rows.length) return { runs: 0, medianMs: null, okRate: null };
  const lat = rows.map((r) => r.latency_ms).sort((a, b) => a - b);
  return { runs: rows.length, medianMs: lat[Math.floor(lat.length / 2)], okRate: rows.filter((r) => r.ok).length / rows.length };
}
