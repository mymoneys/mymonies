import { getDb } from './db';

// EXPENSE_TYPES deliberately excludes 'WITHDRAWN' (cash withdrawals), matching
// the exact spec this was built against. A withdrawal is arguably an expense
// too — if you want it counted, add 'WITHDRAWN' to EXPENSE_TYPES below.
const INCOME_TYPES = ['RECEIVED', 'TRANSFER_IN'];
const EXPENSE_TYPES = ['SENT', 'PAID', 'EXPENSE'];

function sqlList(values: string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

/** month is 1-based (1 = January), matching how a human/UI picker thinks about months. */
export function getMonthDateRange(month: number, year: number): { startMs: number; endMs: number } {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export interface MonthlySummary {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
}

export async function getMonthlySummary(month: number, year: number): Promise<MonthlySummary> {
  const db = await getDb();
  const { startMs, endMs } = getMonthDateRange(month, year);

  const incomeRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM transactions
     WHERE transaction_type IN (${sqlList(INCOME_TYPES)}) AND timestamp >= ? AND timestamp < ?`,
    startMs,
    endMs
  );
  const expenseRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM transactions
     WHERE transaction_type IN (${sqlList(EXPENSE_TYPES)}) AND timestamp >= ? AND timestamp < ?`,
    startMs,
    endMs
  );

  const totalIncome = incomeRow?.total ?? 0;
  const totalExpenses = expenseRow?.total ?? 0;

  return { totalIncome, totalExpenses, netBalance: totalIncome - totalExpenses };
}

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface GroupTotal {
  group: string;
  total: number;
}

/** Super-group breakdown (the "Group" level from the Excel taxonomy) — the default pie view. */
export async function getGroupBreakdown(month: number, year: number): Promise<GroupTotal[]> {
  const db = await getDb();
  const { startMs, endMs } = getMonthDateRange(month, year);

  return db.getAllAsync<GroupTotal>(
    `SELECT "group" as "group", SUM(amount) as total FROM transactions
     WHERE transaction_type IN (${sqlList(EXPENSE_TYPES)}) AND timestamp >= ? AND timestamp < ?
     GROUP BY "group"
     ORDER BY total DESC`,
    startMs,
    endMs
  );
}

/** Category (the "Item" level) breakdown, optionally scoped to one super-group for drill-down. */
export async function getCategoryBreakdown(
  month: number,
  year: number,
  group?: string
): Promise<CategoryTotal[]> {
  const db = await getDb();
  const { startMs, endMs } = getMonthDateRange(month, year);

  if (group) {
    return db.getAllAsync<CategoryTotal>(
      `SELECT category, SUM(amount) as total FROM transactions
       WHERE transaction_type IN (${sqlList(EXPENSE_TYPES)}) AND timestamp >= ? AND timestamp < ? AND "group" = ?
       GROUP BY category
       ORDER BY total DESC`,
      startMs,
      endMs,
      group
    );
  }

  return db.getAllAsync<CategoryTotal>(
    `SELECT category, SUM(amount) as total FROM transactions
     WHERE transaction_type IN (${sqlList(EXPENSE_TYPES)}) AND timestamp >= ? AND timestamp < ?
     GROUP BY category
     ORDER BY total DESC`,
    startMs,
    endMs
  );
}

export interface DailyTotal {
  date: string; // 'YYYY-MM-DD', local time
  total: number;
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Buckets expense totals by local calendar day for the trailing `days`-day
 * window (including today). Bucketing happens in JS rather than via SQLite's
 * date()/'localtime' modifier — that modifier depends on tzdata being
 * correctly available to SQLite's C library inside the app sandbox, which is
 * not reliably the case on Android. JS's Date always uses the device's real
 * timezone, so this is the more portable option even though it pulls
 * row-level data instead of aggregating in SQL (fine at this data volume).
 */
export async function getDailySpending(days: number): Promise<DailyTotal[]> {
  const db = await getDb();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);

  const rows = await db.getAllAsync<{ timestamp: number; amount: number }>(
    `SELECT timestamp, amount FROM transactions
     WHERE transaction_type IN (${sqlList(EXPENSE_TYPES)}) AND timestamp >= ?`,
    start.getTime()
  );

  const totalsByDay = new Map<string, number>();
  for (const row of rows) {
    const key = toLocalDateKey(new Date(row.timestamp));
    totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + row.amount);
  }

  const result: DailyTotal[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = toLocalDateKey(d);
    result.push({ date: key, total: totalsByDay.get(key) ?? 0 });
  }
  return result;
}

export type FlowType = 'income' | 'expense';
export type TrendRange = '1D' | '1W' | '4M' | '8M' | 'All';

export interface TrendPoint {
  label: string;
  total: number;
}

function flowTypes(flow: FlowType): string[] {
  return flow === 'income' ? INCOME_TYPES : EXPENSE_TYPES;
}

const HOUR_LABELS = ['12am', '3am', '6am', '9am', '12pm', '3pm', '6pm', '9pm'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today, bucketed into 8 three-hour windows. */
async function getHourlyTrend(flow: FlowType): Promise<TrendPoint[]> {
  const db = await getDb();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  const rows = await db.getAllAsync<{ timestamp: number; amount: number }>(
    `SELECT timestamp, amount FROM transactions
     WHERE transaction_type IN (${sqlList(flowTypes(flow))}) AND timestamp >= ?`,
    start.getTime()
  );

  const buckets = new Array(8).fill(0);
  for (const row of rows) {
    const hour = new Date(row.timestamp).getHours();
    buckets[Math.floor(hour / 3)] += row.amount;
  }
  return HOUR_LABELS.map((label, i) => ({ label, total: buckets[i] }));
}

/** Trailing 7 days, bucketed by calendar day. */
async function getWeeklyTrend(flow: FlowType): Promise<TrendPoint[]> {
  const db = await getDb();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);

  const rows = await db.getAllAsync<{ timestamp: number; amount: number }>(
    `SELECT timestamp, amount FROM transactions
     WHERE transaction_type IN (${sqlList(flowTypes(flow))}) AND timestamp >= ?`,
    start.getTime()
  );

  const totalsByDay = new Map<string, number>();
  for (const row of rows) {
    const key = toLocalDateKey(new Date(row.timestamp));
    totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + row.amount);
  }

  const result: TrendPoint[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = toLocalDateKey(d);
    const label = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
    result.push({ label, total: totalsByDay.get(key) ?? 0 });
  }
  return result;
}

/** Trailing `months` calendar months (including the current one), bucketed by month. */
async function getMonthlyTrend(flow: FlowType, months: number): Promise<TrendPoint[]> {
  const db = await getDb();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1, 0, 0, 0, 0);

  const rows = await db.getAllAsync<{ timestamp: number; amount: number }>(
    `SELECT timestamp, amount FROM transactions
     WHERE transaction_type IN (${sqlList(flowTypes(flow))}) AND timestamp >= ?`,
    start.getTime()
  );

  const totalsByMonth = new Map<string, number>();
  for (const row of rows) {
    const d = new Date(row.timestamp);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    totalsByMonth.set(key, (totalsByMonth.get(key) ?? 0) + row.amount);
  }

  const result: TrendPoint[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    result.push({ label: MONTH_SHORT[d.getMonth()], total: totalsByMonth.get(key) ?? 0 });
  }
  return result;
}

/** All history, bucketed by calendar month from the earliest transaction to now. */
async function getAllTimeTrend(flow: FlowType): Promise<TrendPoint[]> {
  const db = await getDb();
  const earliest = await db.getFirstAsync<{ minTs: number | null }>(
    `SELECT MIN(timestamp) as minTs FROM transactions WHERE transaction_type IN (${sqlList(flowTypes(flow))})`
  );
  if (!earliest?.minTs) return [];

  const now = new Date();
  const start = new Date(earliest.minTs);
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;

  return getMonthlyTrendFrom(flow, start.getFullYear(), start.getMonth(), Math.max(1, months));
}

async function getMonthlyTrendFrom(
  flow: FlowType,
  startYear: number,
  startMonth: number,
  months: number
): Promise<TrendPoint[]> {
  const db = await getDb();
  const start = new Date(startYear, startMonth, 1, 0, 0, 0, 0);

  const rows = await db.getAllAsync<{ timestamp: number; amount: number }>(
    `SELECT timestamp, amount FROM transactions
     WHERE transaction_type IN (${sqlList(flowTypes(flow))}) AND timestamp >= ?`,
    start.getTime()
  );

  const totalsByMonth = new Map<string, number>();
  for (const row of rows) {
    const d = new Date(row.timestamp);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    totalsByMonth.set(key, (totalsByMonth.get(key) ?? 0) + row.amount);
  }

  const result: TrendPoint[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(startYear, startMonth + i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    result.push({ label: MONTH_SHORT[d.getMonth()], total: totalsByMonth.get(key) ?? 0 });
  }
  return result;
}

/** Unified trend series for the Income/Expenses chart's range pills (1D/1W/4M/8M/All). */
export async function getTrendSeries(flow: FlowType, range: TrendRange): Promise<TrendPoint[]> {
  switch (range) {
    case '1D':
      return getHourlyTrend(flow);
    case '1W':
      return getWeeklyTrend(flow);
    case '4M':
      return getMonthlyTrend(flow, 4);
    case '8M':
      return getMonthlyTrend(flow, 8);
    case 'All':
      return getAllTimeTrend(flow);
  }
}
