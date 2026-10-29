import { COMPANY } from '../ai/fallback.ts';
import type { SenderHistory } from '../ai/schemas.ts';

export interface IncomeRow {
  counterparty_name: string;
  amount: number;
  timestamp: number;
}

/**
 * What the model is told about a sender: how often they've paid before, how
 * much and on which day. Pure; `earlier` is the RECEIVED rows before the one
 * being classified (src/akiba/store.ts queries them).
 */
export function senderHistory(counterparty: string, earlier: IncomeRow[], lookbackMs = 180 * 86_400_000): SenderHistory {
  const key = counterparty.trim().toUpperCase();
  const newest = earlier.reduce((m, r) => Math.max(m, r.timestamp), 0);
  const same = earlier.filter(
    (r) => r.counterparty_name.trim().toUpperCase() === key && newest - r.timestamp <= lookbackMs
  );
  return {
    timesBefore: same.length,
    typicalKes: same.length ? median(same.map((r) => r.amount)) : null,
    typicalDay: same.length ? median(same.map((r) => new Date(r.timestamp).getDate())) : null,
    looksLikeCompany: COMPANY.test(counterparty),
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}
