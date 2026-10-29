import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountForStrategy, computeMaxSafe, daysToPayday } from './planner.ts';
import { formatUsdt, formatUsdtExact, quoteKesToUsdt } from './conversion.ts';
import { validateIncomeLabel, validateSweep } from './validate.ts';
import { nextStatus } from './queue.ts';
import { certainIncomeLabel, fallbackIncomeLabel, fallbackSweep } from '../ai/fallback.ts';
import { senderHistory } from './senderHistory.ts';
import type { SweepContext } from '../ai/schemas.ts';
import { computeProfile } from '../plan/metrics.ts';
import { buildDemoInbox, demoInjections } from '../demo/demoInbox.ts';
import { parseMpesaMessage } from '../parser.ts';
import { decideSweep, type AkibaInput, type CallTool } from './agent.ts';

const agentInput: AkibaInput = {
  smsText: 'Confirmed.You have received Ksh58,000.00 from JUA DIGITAL STUDIOS LIMITED',
  counterparty: 'JUA DIGITAL STUDIOS LIMITED',
  incomeKes: 58_000,
  receivedAt: new Date(2026, 9, 28, 9).getTime(),
  history: { timesBefore: 3, typicalKes: 58_000, typicalDay: 28, looksLikeCompany: true },
  planner: { mpesaBalanceKes: 60_000, unpaidBudgetsKes: 20_500, avgDailySpendKes: 800, daysToPayday: 30, bufferKes: 3_000 },
  survivalMode: false,
  runwayMonths: 2.5,
};

test('agent uses the model when rules are unsure and its output is valid', async () => {
  const model: CallTool = async (_m, tool) =>
    tool.name === 'classify_income'
      ? { label: 'salary', confidence: 'high' }
      : { strategy: 'conservative', reason: 'big_bills' };
  // First payment from this sender: no history pattern, so the model decides.
  const d = await decideSweep({ ...agentInput, history: { ...agentInput.history, timesBefore: 0, typicalKes: null, typicalDay: null } }, model);
  assert.equal(d.labelSource, 'ai');
  assert.equal(d.strategySource, 'ai');
  assert.equal(d.maxSafeKes, 12_500);
  assert.equal(d.amountKes, 3_100);
  assert.match(d.reasonSw, /Bili za Ksh 20,500 bado hazijalipwa/);
});

test('agent falls back to rules when the model is missing or broken', async () => {
  const d = await decideSweep(agentInput, async () => {
    throw new Error('model not loaded');
  });
  assert.equal(d.labelSource, 'rule');
  assert.equal(d.incomeLabel, 'salary');
  assert.equal(d.strategySource, 'rule');
  assert.ok(d.amountKes > 0);
});

test('agent never asks the model about a loan', async () => {
  const calls: string[] = [];
  const model: CallTool = async (_m, tool) => {
    calls.push(tool.name);
    return null;
  };
  const d = await decideSweep({ ...agentInput, counterparty: 'TALA KENYA LIMITED' }, model);
  assert.deepEqual(calls, []);
  assert.equal(d.incomeLabel, 'loan_disbursement');
  assert.equal(d.amountKes, 0);
  assert.equal(d.strategy, 'skip');
});

const ctx = (over: Partial<SweepContext> = {}): SweepContext => ({
  incomeLabel: 'salary',
  incomeKes: 58_000,
  maxSafeKes: 10_000,
  daysToPayday: 10,
  unpaidBudgetsKes: 0,
  survivalMode: false,
  runwayMonths: 3,
  ...over,
});

test('planner deducts bills, spending until payday and buffer, then rounds down', () => {
  const r = computeMaxSafe({
    mpesaBalanceKes: 60_000,
    incomeKes: 58_000,
    unpaidBudgetsKes: 20_500,
    avgDailySpendKes: 800,
    daysToPayday: 30,
    bufferKes: 3_000,
  });
  // 60,000 - 20,500 - 24,000 - 3,000 = 12,500
  assert.equal(r.maxSafeKes, 12_500);
  assert.equal(r.breakdown.reduce((s, b) => s + b.kes, 0), 12_500);
});

test('planner never exceeds the income and never goes negative', () => {
  const base = { unpaidBudgetsKes: 0, avgDailySpendKes: 0, daysToPayday: 5, bufferKes: 0 };
  assert.equal(computeMaxSafe({ ...base, mpesaBalanceKes: 100_000, incomeKes: 5_000 }).maxSafeKes, 5_000);
  assert.equal(computeMaxSafe({ ...base, mpesaBalanceKes: 1_000, incomeKes: 5_000, bufferKes: 5_000 }).maxSafeKes, 0);
});

test('strategy amounts are fractions of the ceiling, rounded to 50, min 100', () => {
  assert.equal(amountForStrategy(12_500, 'standard'), 6_250);
  assert.equal(amountForStrategy(12_500, 'conservative'), 3_100);
  assert.equal(amountForStrategy(12_500, 'skip'), 0);
  assert.equal(amountForStrategy(300, 'conservative'), 0);
});

test('days to payday handles month ends', () => {
  assert.equal(daysToPayday(new Date(2026, 9, 22), 28), 6);
  assert.equal(daysToPayday(new Date(2026, 9, 28), 28), 31); // payday itself -> next month
  assert.equal(daysToPayday(new Date(2026, 8, 25), 31), 5); // Sept has 30 days
});

test('conversion is exact in 6-decimal base units', () => {
  const q = quoteKesToUsdt(1_000, 129.25, '2026-10-22');
  // 1000 / 129.25 = 7.736943...
  assert.equal(q.baseUnits, '7736943');
  assert.equal(q.usdtDisplay, '7.73');
  assert.equal(formatUsdt('1000000'), '1.00');
  assert.equal(formatUsdtExact('80077369'), '80.077369');
  assert.equal(formatUsdtExact('2500000'), '2.5');
  assert.equal(formatUsdtExact('1000000'), '1');
  assert.throws(() => quoteKesToUsdt(100, 0, 'x'));
});

test('income label validation accepts only the AI labels and confidence levels', () => {
  assert.deepEqual(validateIncomeLabel({ label: 'salary', confidence: 'high' }), { label: 'salary', confidence: 0.9 });
  assert.equal(validateIncomeLabel({ label: 'salary', confidence: 200 }), null);
  assert.equal(validateIncomeLabel({ label: 'loan_disbursement', confidence: 'high' }), null); // rules' job
  assert.equal(validateIncomeLabel('salary'), null);
});

test('loans are never swept, whatever the model says', () => {
  const v = validateSweep({ strategy: 'standard', reason: 'low_headroom' }, ctx({ incomeLabel: 'loan_disbursement', maxSafeKes: 1_000 }));
  assert.equal(v?.strategy, 'skip');
  assert.equal(v?.overridden, true);
});

test('survival mode caps the strategy at conservative', () => {
  const v = validateSweep({ strategy: 'standard', reason: 'survival_mode' }, ctx({ survivalMode: true }));
  assert.equal(v?.strategy, 'conservative');
});

test('outside Survival Mode, skipping a safe amount becomes conservative', () => {
  // The case seen on the Redmi 10: Ksh 58,000 salary, Ksh 10,350 safe, AI said skip.
  const v = validateSweep({ strategy: 'skip', reason: 'low_headroom' }, ctx({ maxSafeKes: 10_350 }));
  assert.equal(v?.strategy, 'conservative');
  assert.equal(v?.overridden, true);
  // Survival Mode may still skip, and nothing safe means nothing saved.
  assert.equal(validateSweep({ strategy: 'skip', reason: 'low_headroom' }, ctx({ maxSafeKes: 10_350, survivalMode: true }))?.strategy, 'skip');
  assert.equal(validateSweep({ strategy: 'skip', reason: 'low_headroom' }, ctx({ maxSafeKes: 0 }))?.strategy, 'skip');
});

test('reason codes must be known and fit the facts; text comes from templates', () => {
  assert.equal(validateSweep({ strategy: 'skip', reason: 'vibes' }, ctx()), null);
  assert.equal(validateSweep({ strategy: 'conservative' }, ctx()), null);
  // "survival_mode" when Survival Mode is off contradicts the context.
  assert.equal(validateSweep({ strategy: 'conservative', reason: 'survival_mode' }, ctx()), null);
  const v = validateSweep({ strategy: 'conservative', reason: 'survival_mode' }, ctx({ survivalMode: true, runwayMonths: 0.6 }));
  assert.equal(v?.reason_en, 'Survival Mode is on (0.6 months of cash left), so only a small amount is saved.');
  assert.match(v!.reason_sw, /^Hali ya dharura imewashwa/);
});

test('sweep queue: offline approval waits, then sends on reconnect', () => {
  let s = nextStatus('proposed', 'approve');
  s = nextStatus(s, 'offline');
  assert.equal(s, 'queued_offline');
  s = nextStatus(s, 'online');
  assert.equal(nextStatus(s, 'ok'), 'sent');
  assert.throws(() => nextStatus('sent', 'retry'));
  assert.throws(() => nextStatus('declined', 'approve'));
});

test('rules settle lenders and reversals; fallback uses sender history', () => {
  assert.equal(certainIncomeLabel('received from TALA KENYA LIMITED', 'TALA KENYA LIMITED')?.label, 'loan_disbursement');
  assert.equal(certainIncomeLabel('Transaction X has been reversed.', 'BRIAN')?.label, 'reversal');
  assert.equal(certainIncomeLabel('received', 'JUA DIGITAL STUDIOS LIMITED'), null);
  const employer = { timesBefore: 3, typicalKes: 58_000, typicalDay: 28, looksLikeCompany: true };
  assert.equal(fallbackIncomeLabel('JUA DIGITAL STUDIOS LIMITED', 58_000, employer).label, 'salary');
  assert.equal(fallbackIncomeLabel('KILIMO FRESH TRADERS', 9_500, { ...employer, timesBefore: 0, typicalKes: null }).label, 'business_income');
  assert.equal(fallbackIncomeLabel('BRIAN OTIENO', 3_000, { timesBefore: 1, typicalKes: 3_500, typicalDay: 12, looksLikeCompany: false }).label, 'personal_gift');
  assert.equal(fallbackSweep(ctx({ maxSafeKes: 0 })).strategy, 'skip');
  assert.equal(fallbackSweep(ctx({ survivalMode: true })).strategy, 'conservative');
});

test('demo inbox parses with the existing regex parser', () => {
  const inbox = buildDemoInbox(new Date(2026, 9, 22));
  assert.ok(inbox.length > 150, `only ${inbox.length} messages`);
  const unparsed = inbox.filter((m, i) => !parseMpesaMessage(String(i), m.body, m.date).isParsed);
  assert.deepEqual(unparsed.map((m) => m.body), []);

  const salary = inbox.find((m) => m.incomeLabel === 'salary')!;
  const p = parseMpesaMessage('s', salary.body, salary.date);
  assert.equal(p.transactionType, 'RECEIVED');
  assert.equal(p.amount, 58_000);
  assert.equal(p.counterpartyName, 'JUA DIGITAL STUDIOS LIMITED');

  for (const m of Object.values(demoInjections(new Date(2026, 9, 22, 12), 2_000))) {
    assert.equal(parseMpesaMessage('i', m.body, m.date).transactionType, 'RECEIVED', m.body);
  }
});

test('profile: lean burn from Needs, loans kept out of income, survival mode', () => {
  const now = new Date(2026, 9, 22);
  const inbox = buildDemoInbox(now);
  const rows = inbox.map((m, i) => {
    const p = parseMpesaMessage(String(i), m.body, m.date);
    const group = /MAKAO|KPLC|NAIVAS|SHUTTLE|FIBRE/.test(p.counterpartyName) ? 'Household' : 'Other';
    return { amount: p.amount, transaction_type: p.transactionType, group, counterparty_name: p.counterpartyName, timestamp: p.timestamp, balance: p.balance };
  });
  const profile = computeProfile({
    rows,
    now,
    isNeed: (g) => g === 'Household',
    otherLiquidKes: 0,
    survivalThresholdMonths: 2,
    emergencyFundMonths: 6,
    emergencySavedKes: 0,
  });
  assert.equal(profile.monthsCovered, 4);
  assert.equal(profile.loanMonths, 4);
  assert.ok(profile.leanBurnKes > 20_000, `lean burn ${profile.leanBurnKes}`);
  assert.ok(profile.avgMonthlyIncomeKes >= 58_000);
  assert.equal(profile.mode, 'survival'); // a few thousand Ksh vs ~30k/month
});

test('sender history: count, median amount and day', () => {
  const day = (d: number, m: number) => new Date(2026, m, d, 9).getTime();
  const h = senderHistory('Jua Digital Studios Limited', [
    { counterparty_name: 'JUA DIGITAL STUDIOS LIMITED', amount: 58_000, timestamp: day(28, 6) },
    { counterparty_name: 'JUA DIGITAL STUDIOS LIMITED', amount: 58_000, timestamp: day(28, 7) },
    { counterparty_name: 'JUA DIGITAL STUDIOS LIMITED', amount: 60_000, timestamp: day(29, 8) },
    { counterparty_name: 'BRIAN OTIENO', amount: 3_000, timestamp: day(12, 8) },
  ]);
  assert.deepEqual(h, { timesBefore: 3, typicalKes: 58_000, typicalDay: 28, looksLikeCompany: true });
});
