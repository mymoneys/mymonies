import type { SweepStrategy } from '../akiba/planner.ts';
import { REASON_CODES, reasonFits } from '../akiba/reasons.ts';

/**
 * Tool schemas and prompts for the two on-device decisions. Kept free of any
 * QVAC import so they can be unit-tested and reused by the Node eval script
 * (scripts/eval/) against the exact same prompts the phone runs.
 *
 * Every call is single-shot with tool_choice "required": QVAC constrains the
 * sampler to the tool-call grammar, which is what makes a 0.6B model usable
 * here. Enums do the heavy lifting; free text is limited to the reasons.
 */

export const INCOME_LABELS = [
  'salary',
  'business_income',
  'personal_gift',
  'loan_disbursement',
  'refund',
  'reversal',
] as const;
export type IncomeLabel = (typeof INCOME_LABELS)[number];

/** Money that must never be swept: it's borrowed, or it's going back out. */
export const NEVER_SWEEP: ReadonlySet<IncomeLabel> = new Set(['loan_disbursement', 'reversal', 'refund']);

export const SWEEP_STRATEGIES: readonly SweepStrategy[] = ['skip', 'conservative', 'standard'];

/**
 * Labels the AI chooses between. Loans, refunds and reversals are decided by
 * rules before the model is asked (src/akiba/agent.ts) — they're keyword-
 * certain, and a 0.6B model was seen calling a Tala loan a "refund" — so the
 * model only gets the genuinely ambiguous question rules can't answer.
 */
export const AI_INCOME_LABELS = ['salary', 'business_income', 'personal_gift'] as const;

// Grammar-constrained decoding enforces enums but not numeric bounds (the
// model returned confidence 200 against minimum/maximum), so confidence is an
// enum too.
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export const CONFIDENCE_VALUE: Record<(typeof CONFIDENCE_LEVELS)[number], number> = { low: 0.4, medium: 0.7, high: 0.9 };

export const CLASSIFY_INCOME_TOOL = {
  name: 'classify_income',
  description: 'Record what kind of money this M-Pesa message received.',
  parameters: {
    type: 'object',
    properties: {
      label: { type: 'string', enum: [...AI_INCOME_LABELS] },
      confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] },
    },
    required: ['label', 'confidence'],
    additionalProperties: false,
  },
} as const;

export const PROPOSE_SWEEP_TOOL = {
  name: 'propose_sweep',
  description: 'Choose how much of the safe-to-save amount to move to savings, and the main reason.',
  parameters: {
    type: 'object',
    properties: {
      strategy: { type: 'string', enum: [...SWEEP_STRATEGIES] },
      // A code, not free text: the app writes it out in English and Swahili
      // (src/akiba/reasons.ts). Free-text reasons from the 0.6B model were
      // cut off mid-word and its "Swahili" wasn't Swahili.
      reason: { type: 'string', enum: [...REASON_CODES] },
    },
    required: ['strategy', 'reason'],
    additionalProperties: false,
  },
} as const;

/**
 * The schema for one decision, offering only reasons that are true for these
 * facts. Grammar-constrained output then can't pick a false one: the 0.6B model
 * answered "low_headroom" for every salary, even with plenty of headroom.
 * At least one reason always fits (survival_mode, big_bills or bills_covered).
 */
export function proposeSweepTool(ctx: SweepContext) {
  const fitting: string[] = REASON_CODES.filter((c) => reasonFits(c, ctx));
  const { properties } = PROPOSE_SWEEP_TOOL.parameters;
  return {
    ...PROPOSE_SWEEP_TOOL,
    parameters: { ...PROPOSE_SWEEP_TOOL.parameters, properties: { ...properties, reason: { type: 'string', enum: fitting } } },
  };
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Code-computed history of the sender, so the model judges patterns, not one SMS. */
export interface SenderHistory {
  /** Earlier payments from this sender in the lookback window. */
  timesBefore: number;
  /** Typical (median) earlier amount, if any. */
  typicalKes: number | null;
  /** Typical day of month of earlier payments, if any. */
  typicalDay: number | null;
  /** True when the sender name looks like a company (LTD, LIMITED, …). */
  looksLikeCompany: boolean;
}

export function classifyIncomeMessages(
  counterparty: string,
  amountKes: number,
  dayOfMonth: number,
  history: SenderHistory
): ChatMessage[] {
  // Deliberately short: prompt processing dominates latency on a phone CPU.
  // The raw SMS isn't included — the parser already extracted what matters,
  // and leaving it out also keeps untrusted SMS text away from the model.
  const facts = [
    `Sender: ${counterparty || 'unknown'} (${history.looksLikeCompany ? 'company' : 'person or shop'})`,
    `Amount: Ksh ${amountKes.toLocaleString('en-KE')}, on day ${dayOfMonth} of the month`,
    history.timesBefore === 0
      ? 'First payment from this sender'
      : `Paid before: ${history.timesBefore} times, usually Ksh ${history.typicalKes?.toLocaleString('en-KE')} around day ${history.typicalDay}`,
  ];
  // Few-shot pairs: without them the 0.6B model labelled almost everything
  // business_income (29% on the demo eval).
  return [
    {
      role: 'system',
      content:
        'Label money received on M-Pesa. salary: a company paying a similar amount around the same day each month. ' +
        'business_income: a company or shop paying different amounts at different times. ' +
        'personal_gift: a person (a first and last name) sending money. Answer in JSON.',
    },
    {
      role: 'user',
      content:
        'Sender: ACME SOLUTIONS LTD (company)\nAmount: Ksh 45,000, on day 30 of the month\nPaid before: 5 times, usually Ksh 45,000 around day 30',
    },
    { role: 'assistant', content: '{"label":"salary","confidence":"high"}' },
    { role: 'user', content: 'Sender: JANE WANJIKU (person or shop)\nAmount: Ksh 2,000, on day 9 of the month\nFirst payment from this sender' },
    { role: 'assistant', content: '{"label":"personal_gift","confidence":"high"}' },
    {
      role: 'user',
      content:
        'Sender: SUNRISE HARDWARE TRADERS (company)\nAmount: Ksh 12,300, on day 17 of the month\nPaid before: 2 times, usually Ksh 6,800 around day 4',
    },
    { role: 'assistant', content: '{"label":"business_income","confidence":"medium"}' },
    { role: 'user', content: facts.join('\n') },
  ];
}

export interface SweepContext {
  incomeLabel: IncomeLabel;
  incomeKes: number;
  maxSafeKes: number;
  daysToPayday: number;
  unpaidBudgetsKes: number;
  survivalMode: boolean;
  runwayMonths: number | null;
}

// Facts as short bullets, numbers pre-formatted: the model reasons over them
// but never computes with them.
function sweepFacts(ctx: SweepContext): string {
  return [
    `Income: ${ctx.incomeLabel}, Ksh ${ctx.incomeKes.toLocaleString('en-KE')}`,
    `Safe to save at most: Ksh ${ctx.maxSafeKes.toLocaleString('en-KE')}`,
    `Days to payday: ${ctx.daysToPayday}`,
    `Unpaid bills this cycle: Ksh ${ctx.unpaidBudgetsKes.toLocaleString('en-KE')}`,
    ctx.runwayMonths == null ? 'Runway: unknown' : `Runway: ${ctx.runwayMonths.toFixed(1)} months`,
    ctx.survivalMode ? 'Survival Mode: ON (protect cash first)' : 'Survival Mode: off',
  ]
    .map((f) => `- ${f}`)
    .join('\n');
}

export function proposeSweepMessages(ctx: SweepContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You help a Kenyan M-Pesa user save. Pick a strategy: skip (save nothing), conservative (a quarter of the safe amount) ' +
        'or standard (half). In Survival Mode never pick standard. Many days to payday or large unpaid bills mean be careful. ' +
        'Pick the main reason: survival_mode, payday_far, big_bills, bills_covered, low_headroom or irregular_income. Answer in JSON.',
    },
    // Few-shot pairs: without them the 0.6B model answered "skip" +
    // "survival_mode" (the first option of each list) for every case.
    {
      role: 'user',
      content: sweepFacts({ incomeLabel: 'salary', incomeKes: 60_000, maxSafeKes: 20_000, daysToPayday: 27, unpaidBudgetsKes: 0, survivalMode: false, runwayMonths: 4 }),
    },
    { role: 'assistant', content: '{"strategy":"conservative","reason":"payday_far"}' },
    {
      role: 'user',
      content: sweepFacts({ incomeLabel: 'salary', incomeKes: 45_000, maxSafeKes: 15_000, daysToPayday: 3, unpaidBudgetsKes: 0, survivalMode: false, runwayMonths: 3 }),
    },
    { role: 'assistant', content: '{"strategy":"standard","reason":"bills_covered"}' },
    {
      role: 'user',
      content: sweepFacts({ incomeLabel: 'salary', incomeKes: 50_000, maxSafeKes: 30_000, daysToPayday: 6, unpaidBudgetsKes: 0, survivalMode: true, runwayMonths: 1.2 }),
    },
    { role: 'assistant', content: '{"strategy":"conservative","reason":"survival_mode"}' },
    {
      role: 'user',
      content: sweepFacts({ incomeLabel: 'business_income', incomeKes: 8_000, maxSafeKes: 1_200, daysToPayday: 10, unpaidBudgetsKes: 6_000, survivalMode: false, runwayMonths: 2.5 }),
    },
    { role: 'assistant', content: '{"strategy":"skip","reason":"low_headroom"}' },
    { role: 'user', content: sweepFacts(ctx) },
  ];
}
