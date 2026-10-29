import type { SweepStrategy } from '../akiba/planner.ts';
import type { IncomeLabel, SenderHistory, SweepContext } from './schemas.ts';
import { reasonText, type ReasonCode } from '../akiba/reasons.ts';

/**
 * Rule-based answers. Two roles:
 *   - certainIncomeLabel: keyword-certain cases (lenders, reversals, refunds)
 *     decided BEFORE the model is asked — rules are simply better at these.
 *   - fallback*: used when the model isn't loaded or its output fails
 *     validation, so the Akiba flow never stalls. Stored with source 'rule'
 *     and labelled as such in the UI.
 */

const LOAN = /FULIZA|M-?SHWARI\s*LOAN|KCB\s*M-?PESA\s*LOAN|\bTALA\b|\bBRANCH\b|ZENKA|OKASH|HUSTLER\s*FUND|\bLOAN\b/i;
const REVERSAL = /REVERS/i;
const REFUND = /REFUND/i;
export const COMPANY = /\b(LTD|LIMITED|PLC|BANK|PAYROLL|SALARY|SACCO|GOVERNMENT|COUNTY|INC|CO\.|TRADERS|ENTERPRISES?|SUPPLIES|SERVICES)\b/i;

export function certainIncomeLabel(smsText: string, counterparty: string): { label: IncomeLabel; confidence: number } | null {
  if (LOAN.test(counterparty) || /FULIZA/i.test(smsText)) return { label: 'loan_disbursement', confidence: 0.95 };
  if (REVERSAL.test(smsText)) return { label: 'reversal', confidence: 0.95 };
  if (REFUND.test(smsText)) return { label: 'refund', confidence: 0.9 };
  return null;
}

export function fallbackIncomeLabel(counterparty: string, amountKes: number, history: SenderHistory): { label: IncomeLabel; confidence: number } {
  const similar = history.typicalKes != null && Math.abs(amountKes - history.typicalKes) <= history.typicalKes * 0.15;
  if (history.looksLikeCompany && history.timesBefore >= 2 && similar) return { label: 'salary', confidence: 0.7 };
  if (history.looksLikeCompany || COMPANY.test(counterparty)) return { label: 'business_income', confidence: 0.5 };
  return { label: 'personal_gift', confidence: 0.4 };
}

export function fallbackSweep(ctx: SweepContext): { strategy: SweepStrategy; reason: ReasonCode; reason_en: string; reason_sw: string } {
  const pick = (strategy: SweepStrategy, reason: ReasonCode) => {
    const text = reasonText(reason, ctx);
    return { strategy, reason, reason_en: text.en, reason_sw: text.sw };
  };
  if (ctx.maxSafeKes <= 0) return pick('skip', 'low_headroom');
  if (ctx.survivalMode) return pick('conservative', 'survival_mode');
  if (ctx.daysToPayday >= 15) return pick('conservative', 'payday_far');
  if (ctx.unpaidBudgetsKes > 0) return pick('conservative', 'big_bills');
  return pick('standard', 'bills_covered');
}
