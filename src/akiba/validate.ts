import type { SweepStrategy } from './planner.ts';
import { REASON_CODES, reasonFits, reasonText, type ReasonCode } from './reasons.ts';
import {
  AI_INCOME_LABELS,
  CONFIDENCE_VALUE,
  NEVER_SWEEP,
  SWEEP_STRATEGIES,
  type IncomeLabel,
  type SweepContext,
} from '../ai/schemas.ts';

/**
 * Checks model tool-call arguments before anything is stored or shown. The
 * SMS text that reaches the model is untrusted (anyone can send an SMS), so
 * these rules are the safety boundary — not the prompt:
 *   - only enum values pass;
 *   - borrowed/returned money is never swept, whatever the model says;
 *   - Survival Mode caps the strategy at conservative;
 *   - outside Survival Mode, "save nothing" with a safe amount above zero
 *     becomes conservative (the 0.6B model skipped Ksh 10,350 of headroom);
 *   - the stated reason must fit the facts.
 * Returning null means "use the rule-based fallback instead".
 */

export function validateIncomeLabel(args: unknown): { label: IncomeLabel; confidence: number } | null {
  if (!isRecord(args)) return null;
  const { label, confidence } = args;
  // Only the labels the model is allowed to choose; loans/refunds/reversals
  // come from rules, so a model claiming one is treated as invalid output.
  if (typeof label !== 'string' || !(AI_INCOME_LABELS as readonly string[]).includes(label)) return null;
  if (typeof confidence !== 'string' || !(confidence in CONFIDENCE_VALUE)) return null;
  return { label: label as IncomeLabel, confidence: CONFIDENCE_VALUE[confidence as keyof typeof CONFIDENCE_VALUE] };
}

export interface ValidSweep {
  strategy: SweepStrategy;
  reason: ReasonCode;
  reason_en: string;
  reason_sw: string;
  /** True when a rule overrode the model's strategy (shown in the UI). */
  overridden: boolean;
}

export function validateSweep(args: unknown, ctx: SweepContext): ValidSweep | null {
  if (!isRecord(args)) return null;
  const { strategy, reason } = args;
  if (typeof strategy !== 'string' || !(SWEEP_STRATEGIES as readonly string[]).includes(strategy)) return null;
  if (typeof reason !== 'string' || !(REASON_CODES as readonly string[]).includes(reason)) return null;
  // A reason that contradicts the facts (e.g. "survival_mode" when it's off)
  // means the model didn't follow the context; don't show it.
  if (!reasonFits(reason as ReasonCode, ctx)) return null;
  const text = reasonText(reason as ReasonCode, ctx);
  return { ...enforceSweepRules(strategy as SweepStrategy, ctx), reason: reason as ReasonCode, reason_en: text.en, reason_sw: text.sw };
}

/** Applied to model AND fallback output alike, so the rules can't diverge. */
export function enforceSweepRules(
  strategy: SweepStrategy,
  ctx: SweepContext
): { strategy: SweepStrategy; overridden: boolean } {
  if (NEVER_SWEEP.has(ctx.incomeLabel) || ctx.maxSafeKes <= 0) {
    return { strategy: 'skip', overridden: strategy !== 'skip' };
  }
  if (ctx.survivalMode && strategy === 'standard') {
    return { strategy: 'conservative', overridden: true };
  }
  // Survival Mode may still skip; otherwise money the plan says is safe to
  // save shouldn't be left out just because the model was over-cautious.
  if (!ctx.survivalMode && strategy === 'skip') {
    return { strategy: 'conservative', overridden: true };
  }
  return { strategy, overridden: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
