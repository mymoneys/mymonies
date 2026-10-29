import { amountForStrategy, computeMaxSafe, type BreakdownItem, type PlannerFacts, type SweepStrategy } from './planner.ts';
import { enforceSweepRules, validateIncomeLabel, validateSweep } from './validate.ts';
import { certainIncomeLabel, fallbackIncomeLabel, fallbackSweep } from '../ai/fallback.ts';
import {
  CLASSIFY_INCOME_TOOL,
  NEVER_SWEEP,
  proposeSweepTool,
  classifyIncomeMessages,
  proposeSweepMessages,
  type ChatMessage,
  type IncomeLabel,
  type SenderHistory,
} from '../ai/schemas.ts';

/**
 * One Akiba run for one income transaction: label it, size the ceiling,
 * pick a strategy. The model is injected as `callTool` (QVAC on the phone,
 * QVAC-on-Node in scripts/eval, a stub in tests), so this file has no
 * native dependency. Returning null from callTool — model missing, timeout,
 * malformed call — drops to the rule-based path for that step only.
 */

/** Rule confidence at or above which the model isn't consulted. */
export const RULE_CONFIDENT = 0.7;

export type ToolDef = typeof CLASSIFY_INCOME_TOOL | ReturnType<typeof proposeSweepTool>;
export type CallTool = (messages: ChatMessage[], tool: ToolDef) => Promise<unknown | null>;

export interface AkibaInput {
  smsText: string;
  counterparty: string;
  incomeKes: number;
  receivedAt: number;
  history: SenderHistory;
  planner: Omit<PlannerFacts, 'incomeKes'>;
  survivalMode: boolean;
  runwayMonths: number | null;
}

export interface AkibaDecision {
  incomeLabel: IncomeLabel;
  labelConfidence: number;
  labelSource: 'ai' | 'rule';
  maxSafeKes: number;
  breakdown: BreakdownItem[];
  strategy: SweepStrategy;
  amountKes: number;
  reasonEn: string;
  reasonSw: string;
  strategySource: 'ai' | 'rule';
  /** A safety rule changed the model's strategy (loan income, Survival Mode). */
  overridden: boolean;
}

export async function decideSweep(input: AkibaInput, callTool: CallTool): Promise<AkibaDecision> {
  // Rules first: keyword-certain cases (lenders, reversals) and confident
  // history patterns (a company paying the same amount monthly). The model
  // only sees what rules can't settle — on the demo eval, asking it about
  // everything scored lower than rules alone.
  const ruleLabel = fallbackIncomeLabel(input.counterparty, input.incomeKes, input.history);
  const certain =
    certainIncomeLabel(input.smsText, input.counterparty) ??
    (ruleLabel.confidence >= RULE_CONFIDENT ? ruleLabel : null);
  const aiLabel = certain
    ? null
    : validateIncomeLabel(
        await safeCall(
          callTool,
          classifyIncomeMessages(input.counterparty, input.incomeKes, new Date(input.receivedAt).getDate(), input.history),
          CLASSIFY_INCOME_TOOL
        )
      );
  const { label, confidence } = certain ?? aiLabel ?? ruleLabel;
  const labelSource = aiLabel ? 'ai' : 'rule';

  const { maxSafeKes, breakdown } = computeMaxSafe({ ...input.planner, incomeKes: input.incomeKes });
  const ctx = {
    incomeLabel: label,
    incomeKes: input.incomeKes,
    maxSafeKes,
    daysToPayday: input.planner.daysToPayday,
    unpaidBudgetsKes: input.planner.unpaidBudgetsKes,
    survivalMode: input.survivalMode,
    runwayMonths: input.runwayMonths,
  };

  // Borrowed or returned money: no point asking the model, the answer is fixed.
  if (NEVER_SWEEP.has(label)) {
    const why = label === 'loan_disbursement' ? 'This is a loan, so none of it is saved.' : 'This money is going back out, so none of it is saved.';
    const whySw = label === 'loan_disbursement' ? 'Huu ni mkopo, kwa hivyo hakuna akiba kutoka kwake.' : 'Pesa hii inarudi, kwa hivyo hakuna akiba kutoka kwake.';
    return { incomeLabel: label, labelConfidence: confidence, labelSource, maxSafeKes, breakdown, strategy: 'skip', amountKes: 0, reasonEn: why, reasonSw: whySw, strategySource: 'rule', overridden: false };
  }

  const aiSweep = validateSweep(await safeCall(callTool, proposeSweepMessages(ctx), proposeSweepTool(ctx)), ctx);
  const sweep =
    aiSweep ??
    (() => {
      const f = fallbackSweep(ctx);
      return { ...f, ...enforceSweepRules(f.strategy, ctx) };
    })();

  return {
    incomeLabel: label,
    labelConfidence: confidence,
    labelSource,
    maxSafeKes,
    breakdown,
    strategy: sweep.strategy,
    amountKes: amountForStrategy(maxSafeKes, sweep.strategy),
    reasonEn: sweep.reason_en,
    reasonSw: sweep.reason_sw,
    strategySource: aiSweep ? 'ai' : 'rule',
    overridden: sweep.overridden,
  };
}

async function safeCall(callTool: CallTool, messages: ChatMessage[], tool: ToolDef): Promise<unknown | null> {
  try {
    return await callTool(messages, tool);
  } catch {
    return null;
  }
}
