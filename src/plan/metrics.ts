/**
 * The "financial profile": a handful of numbers computed from the whole
 * transaction history in code. No model ever reads the raw history — on a
 * 3.6 GB phone it couldn't, and numbers must not be generated anyway. The
 * round-up screen, the interview and the sweep agent all read from this.
 *
 * Pure: callers pass rows in (see src/plan/store.ts for the SQL).
 */

export interface MetricRow {
  amount: number;
  transaction_type: string;
  group: string;
  counterparty_name: string;
  timestamp: number;
  balance: number | null;
}

export interface ProfileInputs {
  rows: MetricRow[];
  now: Date;
  /** Maps a transaction group to whether it is an essential cost (Needs). */
  isNeed: (group: string) => boolean;
  /** Liquid money outside M-Pesa, already in KES (savings wallet, user-reported). */
  otherLiquidKes: number;
  /** Below this many months of runway, Survival Mode turns on. */
  survivalThresholdMonths: number;
  /** Months of lean burn the emergency fund should hold. */
  emergencyFundMonths: number;
  /** KES already set aside for emergencies (savings account, in KES). */
  emergencySavedKes: number;
  lookbackMonths?: number;
}

export type PlanMode = 'survival' | 'building' | 'stable';

export interface FinancialProfile {
  monthsCovered: number;
  /** Average monthly spending on Needs groups — the "lean survival budget". */
  leanBurnKes: number;
  avgMonthlyIncomeKes: number;
  avgMonthlySpendKes: number;
  /** Months where at least one Fuliza/app-loan inflow happened. */
  loanMonths: number;
  avgMonthlyLoanKes: number;
  latestMpesaBalanceKes: number | null;
  liquidKes: number;
  runwayMonths: number | null;
  emergencyTargetKes: number;
  mode: PlanMode;
}

// TRANSFER_IN (e.g. "transferred from M-Shwari account") is the user moving
// their own savings back, so it is neither income nor a loan.
const INCOME_TYPES = new Set(['RECEIVED']);
const EXPENSE_TYPES = new Set(['SENT', 'PAID', 'EXPENSE', 'WITHDRAWN']);
const LOAN_SOURCE = /FULIZA|M-?SHWARI\s*LOAN|KCB\s*M-?PESA\s*LOAN|\bTALA\b|\bBRANCH\b|ZENKA|OKASH|HUSTLER|LOAN/i;

export function computeProfile(input: ProfileInputs): FinancialProfile {
  const lookback = input.lookbackMonths ?? 6;
  // Whole calendar months only: the current, partial month would drag every
  // average down.
  const end = new Date(input.now.getFullYear(), input.now.getMonth(), 1).getTime();
  const start = new Date(input.now.getFullYear(), input.now.getMonth() - lookback, 1).getTime();
  const inWindow = input.rows.filter((r) => r.timestamp >= start && r.timestamp < end);

  const monthKey = (ts: number) => {
    const d = new Date(ts);
    return d.getFullYear() * 12 + d.getMonth();
  };
  const months = new Set(inWindow.map((r) => monthKey(r.timestamp)));
  const monthsCovered = months.size;

  let needs = 0;
  let income = 0;
  let spend = 0;
  let loans = 0;
  const loanMonthKeys = new Set<number>();
  for (const r of inWindow) {
    if (INCOME_TYPES.has(r.transaction_type)) {
      if (LOAN_SOURCE.test(r.counterparty_name)) {
        loans += r.amount;
        loanMonthKeys.add(monthKey(r.timestamp));
      } else {
        income += r.amount;
      }
    } else if (EXPENSE_TYPES.has(r.transaction_type)) {
      spend += r.amount;
      if (input.isNeed(r.group)) needs += r.amount;
    }
  }

  const per = (total: number) => (monthsCovered ? Math.round(total / monthsCovered) : 0);
  const leanBurnKes = per(needs);

  const latest = [...input.rows]
    .filter((r) => r.balance != null)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const latestMpesaBalanceKes = latest?.balance ?? null;

  const liquidKes = Math.max(0, (latestMpesaBalanceKes ?? 0) + input.otherLiquidKes);
  const runwayMonths = leanBurnKes > 0 ? Math.round((liquidKes / leanBurnKes) * 10) / 10 : null;
  const emergencyTargetKes = leanBurnKes * input.emergencyFundMonths;

  let mode: PlanMode = 'stable';
  if (runwayMonths != null && runwayMonths < input.survivalThresholdMonths) mode = 'survival';
  else if (input.emergencySavedKes < emergencyTargetKes) mode = 'building';

  return {
    monthsCovered,
    leanBurnKes,
    avgMonthlyIncomeKes: per(income),
    avgMonthlySpendKes: per(spend),
    loanMonths: loanMonthKeys.size,
    avgMonthlyLoanKes: per(loans),
    latestMpesaBalanceKes,
    liquidKes,
    runwayMonths,
    emergencyTargetKes,
    mode,
  };
}

/**
 * Average non-budget daily spend over the last `days`, for the planner's
 * "spending until payday" deduction. Budget categories are excluded because
 * the planner already deducts their unpaid remainder separately.
 */
export function avgDailySpend(rows: MetricRow[], now: Date, days: number, budgetGroups: ReadonlySet<string>): number {
  const since = now.getTime() - days * 86_400_000;
  const total = rows
    .filter((r) => r.timestamp >= since && EXPENSE_TYPES.has(r.transaction_type) && !budgetGroups.has(r.group))
    .reduce((sum, r) => sum + r.amount, 0);
  return days > 0 ? Math.round(total / days) : 0;
}
