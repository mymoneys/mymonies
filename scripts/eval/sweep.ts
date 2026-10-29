// Checks the propose_sweep step end to end with the phone's model and
// settings: does the output parse, validate, and how long does it take?
//   node --experimental-strip-types --no-warnings scripts/eval/sweep.ts
import { close } from '@qvac/sdk';
import { proposeSweepMessages, proposeSweepTool, type SweepContext } from '../../src/ai/schemas.ts';
import { validateSweep } from '../../src/akiba/validate.ts';
import { loadAkibaModel, makeQvacCallTool, unloadAkibaModel, type RunStats } from '../../src/ai/qvac.ts';

// expected = the reason a careful person would give; scored loosely (any
// reason that fits the facts passes validation, matching expected is a bonus).
const cases: (SweepContext & { expected: string })[] = [
  { expected: 'survival_mode', incomeLabel: 'salary', incomeKes: 58_000, maxSafeKes: 41_400, daysToPayday: 5, unpaidBudgetsKes: 19_200, survivalMode: true, runwayMonths: 0.6 },
  { expected: 'payday_far', incomeLabel: 'salary', incomeKes: 58_000, maxSafeKes: 22_000, daysToPayday: 28, unpaidBudgetsKes: 0, survivalMode: false, runwayMonths: 3.1 },
  { expected: 'irregular_income', incomeLabel: 'business_income', incomeKes: 9_500, maxSafeKes: 3_500, daysToPayday: 12, unpaidBudgetsKes: 0, survivalMode: false, runwayMonths: 2.4 },
  { expected: 'bills_covered', incomeLabel: 'salary', incomeKes: 40_000, maxSafeKes: 18_000, daysToPayday: 2, unpaidBudgetsKes: 0, survivalMode: false, runwayMonths: 5 },
  { expected: 'big_bills', incomeLabel: 'salary', incomeKes: 70_000, maxSafeKes: 25_000, daysToPayday: 8, unpaidBudgetsKes: 30_000, survivalMode: false, runwayMonths: 2.2 },
  { expected: 'low_headroom', incomeLabel: 'salary', incomeKes: 50_000, maxSafeKes: 2_000, daysToPayday: 9, unpaidBudgetsKes: 12_000, survivalMode: false, runwayMonths: 2.1 },
  { expected: 'irregular_income', incomeLabel: 'personal_gift', incomeKes: 3_000, maxSafeKes: 2_500, daysToPayday: 14, unpaidBudgetsKes: 0, survivalMode: false, runwayMonths: 3 },
  { expected: 'survival_mode', incomeLabel: 'business_income', incomeKes: 12_000, maxSafeKes: 6_000, daysToPayday: 20, unpaidBudgetsKes: 0, survivalMode: true, runwayMonths: 1.1 },
];

const stats: RunStats[] = [];
await loadAkibaModel(process.env.AKIBA_MODEL === 'large' ? 'large' : 'small');
const call = makeQvacCallTool((s) => stats.push(s));
let valid = 0, matched = 0;
for (const { expected, ...ctx } of cases) {
  const raw = await call(proposeSweepMessages(ctx), proposeSweepTool(ctx));
  const v = validateSweep(raw, ctx);
  if (v) valid++;
  if (v?.reason === expected) matched++;
  console.log(`expected ${expected.padEnd(16)} got ${JSON.stringify(raw)} -> ${v ? `${v.strategy}${v.overridden ? ' (capped)' : ''}` : 'INVALID'}`);
}
const lat = stats.map((s) => s.latencyMs).sort((a, b) => a - b);
console.log(`latency median ${lat[Math.floor(lat.length / 2)]} ms, failures ${stats.filter((s) => !s.ok).length}`);
console.log(`valid ${valid}/${cases.length}, reason as expected ${matched}/${cases.length}`);
await unloadAkibaModel();
await close();
