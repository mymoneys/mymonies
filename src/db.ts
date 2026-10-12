import * as SQLite from 'expo-sqlite';
import { parseMpesaMessage, ParsedTransaction } from './parser';
import { applyRules, createRuleFromTransaction } from './rules';

export type TransactionRow = {
  id: string;
  raw_text: string;
  amount: number;
  transaction_type: string;
  counterparty_name: string;
  counterparty_number: string | null;
  account_number: string | null;
  timestamp: number;
  balance: number | null;
  transaction_cost: number | null;
  category: string;
  group: string;
  is_parsed: number;
  possible_duplicate: number;
};

export type SyncRunRow = {
  id: string;
  sync_type: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  messages_scanned: number;
  messages_inserted: number;
  error_message: string | null;
};

// Must stay in sync with android/app/src/main/java/com/anonymous/tracker/TransactionDb.kt
// (same file name, same schema, same id-hashing algorithm).
const DB_NAME = 'mpesa.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDb();
  }
  return dbPromise;
}

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // WAL + busy_timeout matter here because the Kotlin NotificationListenerService
  // writes into this exact same file from a different thread/entry point.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA busy_timeout = 3000;');

  // "group" is a reserved SQL keyword — it must always be double-quoted.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      raw_text TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      transaction_type TEXT NOT NULL DEFAULT 'INFO',
      counterparty_name TEXT NOT NULL DEFAULT '',
      counterparty_number TEXT,
      account_number TEXT,
      timestamp INTEGER NOT NULL,
      balance REAL,
      transaction_cost REAL,
      category TEXT NOT NULL DEFAULT 'Uncategorized',
      "group" TEXT NOT NULL DEFAULT 'Uncategorized',
      is_parsed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY NOT NULL,
      condition_field TEXT NOT NULL,
      condition_operator TEXT NOT NULL,
      condition_value TEXT NOT NULL,
      target_category TEXT NOT NULL,
      target_group TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority ASC);

    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY NOT NULL,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      messages_scanned INTEGER NOT NULL DEFAULT 0,
      messages_inserted INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      "group" TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'FIXED',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_budgets_sort ON budgets(sort_order ASC);
  `);

  // Migration for installs that already had a "transactions" table before
  // possible_duplicate existed — CREATE TABLE IF NOT EXISTS is a no-op against
  // an existing table, so a real ALTER is needed to backfill the column.
  await ensureColumn(db, 'transactions', 'possible_duplicate', "INTEGER NOT NULL DEFAULT 0");

  return db;
}

async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Deterministic FNV-1a hash used as the dedupe key (raw_text + timestamp).
 * Kept intentionally simple (not cryptographic) since this only needs to be
 * collision-resistant enough for dedup, not secure.
 *
 * IMPORTANT: mirrored exactly in TransactionDb.kt's `fnv1a`. If you change this,
 * change that too, or notification-captured rows and backfilled rows will no
 * longer dedupe against each other.
 */
export function makeTransactionId(rawText: string, timestamp: number): string {
  const input = `${rawText}:${timestamp}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * No limit by default — FlatList virtualizes rendering regardless of array
 * size, so there's no performance reason to cap this at this data volume.
 * Pass an explicit limit only if you actually want a capped preview.
 */
export async function getRecentTransactions(limit?: number): Promise<TransactionRow[]> {
  const db = await getDb();
  // FAILED messages (declined/insufficient-funds attempts) never moved money,
  // so they're excluded from the list entirely rather than shown as noise.
  if (limit != null) {
    return db.getAllAsync<TransactionRow>(
      `SELECT * FROM transactions WHERE transaction_type != 'FAILED' ORDER BY timestamp DESC LIMIT ?`,
      limit
    );
  }
  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM transactions WHERE transaction_type != 'FAILED' ORDER BY timestamp DESC`
  );
}

export async function insertParsedTransaction(
  rawText: string,
  timestamp: number
): Promise<boolean> {
  const db = await getDb();
  const id = makeTransactionId(rawText, timestamp);
  const parsed = parseMpesaMessage(id, rawText, timestamp);
  const categorized = await applyRules(parsed);

  const result = await db.runAsync(
    `INSERT OR IGNORE INTO transactions
      (id, raw_text, amount, transaction_type, counterparty_name, counterparty_number,
       account_number, timestamp, balance, transaction_cost, category, "group", is_parsed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    categorized.id,
    categorized.rawText,
    categorized.amount,
    categorized.transactionType,
    categorized.counterpartyName,
    categorized.counterpartyNumber,
    categorized.accountNumber,
    categorized.timestamp,
    categorized.balance,
    categorized.transactionCost,
    categorized.category,
    categorized.grp,
    categorized.isParsed ? 1 : 0
  );

  return result.changes > 0;
}

/**
 * Re-parses any row the Kotlin listener inserted raw (is_parsed = 0). This is
 * the primary place live-captured notifications get categorized — the
 * notification listener only ever writes the raw message text, so rules can't
 * run until this function parses it into the fields rules match against.
 *
 * Safe to call repeatedly (e.g. on every app foreground) — rows that
 * legitimately can't be parsed (FAILED/INFO messages) stay at is_parsed = 0
 * and get re-checked cheaply each time, which is fine at this data volume.
 */
export async function parsePendingTransactions(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<TransactionRow>(
    'SELECT * FROM transactions WHERE is_parsed = 0 ORDER BY timestamp ASC'
  );

  let updated = 0;
  for (const row of rows) {
    const parsed = parseMpesaMessage(row.id, row.raw_text, row.timestamp);
    const categorized = await applyRules(parsed);
    await db.runAsync(
      `UPDATE transactions
         SET amount = ?, transaction_type = ?, counterparty_name = ?, counterparty_number = ?,
             account_number = ?, balance = ?, transaction_cost = ?, is_parsed = ?,
             category = ?, "group" = ?
       WHERE id = ?`,
      categorized.amount,
      categorized.transactionType,
      categorized.counterpartyName,
      categorized.counterpartyNumber,
      categorized.accountNumber,
      categorized.balance,
      categorized.transactionCost,
      categorized.isParsed ? 1 : 0,
      categorized.category,
      categorized.grp,
      row.id
    );
    updated += 1;
  }

  return updated;
}

function rowToParsedTransaction(row: TransactionRow): ParsedTransaction {
  return {
    id: row.id,
    rawText: row.raw_text,
    amount: row.amount,
    transactionType: row.transaction_type as ParsedTransaction['transactionType'],
    counterpartyName: row.counterparty_name,
    counterpartyNumber: row.counterparty_number,
    accountNumber: row.account_number,
    timestamp: row.timestamp,
    balance: row.balance,
    transactionCost: row.transaction_cost,
    isParsed: row.is_parsed === 1,
  };
}

/**
 * Retroactively applies current rules to already-parsed transactions still
 * sitting at 'Uncategorized' — e.g. after the user adds a new rule that
 * should have matched older messages. Only touches rows a rule actually
 * matched, so re-running this repeatedly is cheap and idempotent.
 */
export async function reapplyRulesToUncategorized(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<TransactionRow>(
    `SELECT * FROM transactions WHERE category = 'Uncategorized' AND is_parsed = 1`
  );

  let updated = 0;
  for (const row of rows) {
    const categorized = await applyRules(rowToParsedTransaction(row));
    if (categorized.category !== 'Uncategorized' || categorized.grp !== 'Uncategorized') {
      await db.runAsync(
        `UPDATE transactions SET category = ?, "group" = ? WHERE id = ?`,
        categorized.category,
        categorized.grp,
        row.id
      );
      updated += 1;
    }
  }

  return updated;
}

/**
 * The tap-to-categorize flow: user picks a category for one transaction, and
 * that single action (a) updates this row immediately, (b) creates a reusable
 * rule keyed on this transaction's counterparty so future messages from the
 * same sender auto-categorize, and (c) sweeps any other already-stored
 * 'Uncategorized' transactions that rule now matches.
 *
 * `group` defaults to the category name — most users don't need a separate
 * "group" concept for a quick tap; they can still split it out later via the
 * full Rules screen if they want category/group to diverge.
 */
export async function categorizeTransaction(
  transactionId: string,
  category: string,
  group: string = category
): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<TransactionRow>(
    'SELECT * FROM transactions WHERE id = ?',
    transactionId
  );
  if (!row) {
    return;
  }

  await db.runAsync(`UPDATE transactions SET category = ?, "group" = ? WHERE id = ?`, category, group, transactionId);

  await createRuleFromTransaction(
    {
      counterpartyName: row.counterparty_name,
      counterpartyNumber: row.counterparty_number,
      accountNumber: row.account_number,
    },
    category,
    group
  );

  await reapplyRulesToUncategorized();
}

export async function getDistinctCategories(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category: string }>(
    `SELECT DISTINCT category FROM transactions WHERE category != 'Uncategorized' ORDER BY category ASC`
  );
  return rows.map((r) => r.category);
}

// ---- Sync bookkeeping (sync_runs, settings) ----

function makeSyncRunId(): string {
  return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Starts a new sync_runs row. Also sweeps up any row still marked RUNNING from
 * a previous run that never reached recordSyncRunFinish (e.g. the app got
 * killed mid-backfill) — without this, a crashed run would show "Syncing…"
 * forever instead of surfacing as incomplete.
 */
export async function recordSyncRunStart(syncType: 'BACKFILL' | 'INCREMENTAL'): Promise<string> {
  const db = await getDb();
  await db.runAsync(`UPDATE sync_runs SET status = 'PARTIAL', finished_at = ? WHERE status = 'RUNNING'`, Date.now());

  const id = makeSyncRunId();
  await db.runAsync(
    `INSERT INTO sync_runs (id, sync_type, status, started_at, messages_scanned, messages_inserted)
     VALUES (?, ?, 'RUNNING', ?, 0, 0)`,
    id,
    syncType,
    Date.now()
  );
  return id;
}

export async function updateSyncRunProgress(id: string, scanned: number, inserted: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sync_runs SET messages_scanned = ?, messages_inserted = ? WHERE id = ?`,
    scanned,
    inserted,
    id
  );
}

export async function recordSyncRunFinish(
  id: string,
  status: 'COMPLETE' | 'FAILED' | 'PARTIAL',
  scanned: number,
  inserted: number,
  errorMessage: string | null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sync_runs SET status = ?, finished_at = ?, messages_scanned = ?, messages_inserted = ?, error_message = ? WHERE id = ?`,
    status,
    Date.now(),
    scanned,
    inserted,
    errorMessage,
    id
  );
}

export async function getLastSyncRun(): Promise<SyncRunRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SyncRunRow>('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1');
  return row ?? null;
}

export async function getMaxIngestedTimestamp(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(timestamp) as m FROM transactions');
  return row?.m ?? 0;
}

export async function getCapturedTransactionCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM transactions');
  return row?.c ?? 0;
}

/**
 * Reconciliation pass for the cross-source dedup gap: the notification
 * listener's postTime and the SMS inbox's DATE column can differ by seconds
 * for the *same* real message, and raw_text can differ slightly (truncated
 * notification vs. full SMS body), so the id hash alone can't always catch a
 * cross-source duplicate. This flags (doesn't delete) same-amount,
 * same-counterparty-number rows within a tight time window, excluding rows
 * already flagged. Safe to call after every sync.
 */
export async function flagPossibleDuplicates(): Promise<number> {
  const db = await getDb();
  const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

  const rows = await db.getAllAsync<{ id: string; amount: number; counterparty_number: string | null; timestamp: number }>(
    `SELECT id, amount, counterparty_number, timestamp FROM transactions
     WHERE counterparty_number IS NOT NULL AND counterparty_number != '' AND possible_duplicate = 0
     ORDER BY counterparty_number ASC, amount ASC, timestamp ASC`
  );

  let flagged = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (
      a.counterparty_number === b.counterparty_number &&
      a.amount === b.amount &&
      Math.abs(a.timestamp - b.timestamp) <= DUPLICATE_WINDOW_MS
    ) {
      await db.runAsync('UPDATE transactions SET possible_duplicate = 1 WHERE id = ?', b.id);
      flagged += 1;
    }
  }
  return flagged;
}

// ---- Profile: payday + initial budget setup ----

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

export type BudgetKind = 'FIXED' | 'LOAN';

export type BudgetRow = {
  id: string;
  label: string;
  category: string;
  group: string;
  amount: number;
  kind: BudgetKind;
  sort_order: number;
};

export async function getBudgets(): Promise<BudgetRow[]> {
  const db = await getDb();
  return db.getAllAsync<BudgetRow>(`SELECT * FROM budgets ORDER BY sort_order ASC`);
}

/**
 * Insert a new budget line item, or update an existing one if `id` is passed.
 * `category`/`group` default to `label` — most fixed budget items (Rent,
 * KPLC) don't need a separate grouping concept, matching the same default
 * pattern used for the quick tap-to-categorize flow in categorizeTransaction.
 */
export async function upsertBudget(input: {
  id?: string;
  label: string;
  category?: string;
  group?: string;
  amount: number;
  kind?: BudgetKind;
  sortOrder?: number;
}): Promise<string> {
  const db = await getDb();
  const id = input.id ?? `budget_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const category = input.category ?? input.label;
  const group = input.group ?? input.label;
  const kind = input.kind ?? 'FIXED';
  const sortOrder = input.sortOrder ?? Date.now();

  await db.runAsync(
    `INSERT INTO budgets (id, label, category, "group", amount, kind, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label, category = excluded.category, "group" = excluded."group",
       amount = excluded.amount, kind = excluded.kind`,
    id,
    input.label,
    category,
    group,
    input.amount,
    kind,
    sortOrder
  );
  return id;
}

export async function deleteBudget(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM budgets WHERE id = ?', id);
}
