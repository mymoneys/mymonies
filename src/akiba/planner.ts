/**
 * Deterministic "safe to save" ceiling. All arithmetic for a sweep lives
 * here, never in the model: the LLM only picks a strategy (see
 * src/ai/proposeSweep.ts), and the amount is always a fraction of the
 * ceiling this returns. That keeps a 0.6B on-device model from ever
 * inventing a number.
 */

export interface PlannerFacts {
  /** Latest "New M-PESA balance" from SMS, after the income landed. */
  mpesaBalanceKes: number;
  /** The income that triggered this run — a sweep never exceeds it. */
  incomeKes: number;
  /** Sum over budget items of what is still unpaid this pay cycle. */
  unpaidBudgetsKes: number;
  /** Average day-to-day spending outside budget items, from history. */
  avgDailySpendKes: number;
  daysToPayday: number;
  /** Cash kept untouched regardless of the plan. */
  bufferKes: number;
}

export type BreakdownKey = 'balance' | 'bills' | 'spending' | 'buffer';
export interface BreakdownItem {
  key?: BreakdownKey;
  label: string;
  kes: number;
  days?: number;
}

export interface PlannerResult {
  maxSafeKes: number;
  /**
   * Each deduction, in the order applied, for the "why this amount" card.
   * `key` is what the UI translates; `label` (English) is kept for rows
   * stored before translation existed.
   */
  breakdown: BreakdownItem[];
}

/** Sweeps below this aren't worth a transaction (or the user's attention). */
export const MIN_SWEEP_KES = 100;
const ROUND_TO_KES = 50;

export function computeMaxSafe(facts: PlannerFacts): PlannerResult {
  const spendTillPayday = Math.max(0, facts.avgDailySpendKes) * Math.max(0, facts.daysToPayday);
  const breakdown: BreakdownItem[] = [
    { key: 'balance', label: 'M-Pesa balance', kes: facts.mpesaBalanceKes },
    { key: 'bills', label: 'Unpaid bills this cycle', kes: -Math.max(0, facts.unpaidBudgetsKes) },
    {
      key: 'spending',
      label: `Spending until payday (${facts.daysToPayday} days)`,
      kes: -Math.round(spendTillPayday),
      days: facts.daysToPayday,
    },
    { key: 'buffer', label: 'Safety buffer', kes: -Math.max(0, facts.bufferKes) },
  ];
  const headroom = breakdown.reduce((sum, item) => sum + item.kes, 0);
  const capped = Math.min(headroom, Math.max(0, facts.incomeKes));
  const rounded = Math.floor(Math.max(0, capped) / ROUND_TO_KES) * ROUND_TO_KES;
  return { maxSafeKes: rounded >= MIN_SWEEP_KES ? rounded : 0, breakdown };
}

/**
 * Days from `now` until the next occurrence of `paydayDay` (1–31). A payday
 * past the end of a short month falls on that month's last day, which is
 * how Kenyan employers pay a "31st" salary in September.
 */
export function daysToPayday(now: Date, paydayDay: number): number {
  const day = Math.min(Math.max(1, Math.floor(paydayDay)), 31);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const clamp = (year: number, month: number) =>
    new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));

  let next = clamp(today.getFullYear(), today.getMonth());
  if (next.getTime() <= today.getTime()) next = clamp(today.getFullYear(), today.getMonth() + 1);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

export type SweepStrategy = 'skip' | 'conservative' | 'standard';

export const STRATEGY_FRACTION: Record<SweepStrategy, number> = {
  skip: 0,
  conservative: 0.25,
  standard: 0.5,
};

export function amountForStrategy(maxSafeKes: number, strategy: SweepStrategy): number {
  const raw = maxSafeKes * STRATEGY_FRACTION[strategy];
  const rounded = Math.floor(raw / ROUND_TO_KES) * ROUND_TO_KES;
  return rounded >= MIN_SWEEP_KES ? rounded : 0;
}
