// Scores the on-device income classifier against labelled messages, using the
// exact prompts and model the phone runs (QVAC on Linux instead of Android).
//
//   node --experimental-strip-types --no-warnings scripts/eval/income.ts [inbox.json]
//
// Default input: the synthetic demo inbox. An optional JSON file of
// [{ body, date, incomeLabel }] lets you score your own labelled messages
// (keep those in data/, which is gitignored).
import { readFileSync } from 'node:fs';
import { close } from '@qvac/sdk';
import { parseMpesaMessage } from '../../src/parser.ts';
import { buildDemoInbox, demoInjections, type DemoSms } from '../../src/demo/demoInbox.ts';
import { senderHistory, type IncomeRow } from '../../src/akiba/senderHistory.ts';
import { certainIncomeLabel, fallbackIncomeLabel } from '../../src/ai/fallback.ts';
import { validateIncomeLabel } from '../../src/akiba/validate.ts';
import { RULE_CONFIDENT } from '../../src/akiba/agent.ts';
import { CLASSIFY_INCOME_TOOL, classifyIncomeMessages } from '../../src/ai/schemas.ts';
import { AKIBA_MODELS, loadAkibaModel, makeQvacCallTool, unloadAkibaModel, type RunStats } from '../../src/ai/qvac.ts';

const now = new Date(2026, 9, 23, 12);
const inbox: DemoSms[] = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : [...buildDemoInbox(now), ...Object.values(demoInjections(now, 2_000))];

const parsed = inbox
  .map((m, i) => ({ m, p: parseMpesaMessage(String(i), m.body, m.date) }))
  .filter(({ m, p }) => p.transactionType === 'RECEIVED' && m.incomeLabel)
  .sort((a, b) => a.p.timestamp - b.p.timestamp);

const stats: RunStats[] = [];
const size = process.env.AKIBA_MODEL === 'large' ? 'large' : 'small';
await loadAkibaModel(size);
const callTool = makeQvacCallTool((s) => stats.push(s));

const rows: IncomeRow[] = [];
let aiRight = 0, aiAsked = 0, aiInvalid = 0, ruleRight = 0, ruleAsked = 0, hybridRight = 0, fallbackOnlyRight = 0;
for (const { m, p } of parsed) {
  const history = senderHistory(p.counterpartyName, rows);
  const fallback = fallbackIncomeLabel(p.counterpartyName, p.amount, history);
  // Same routing as src/akiba/agent.ts: rules when certain or confident.
  const certain = certainIncomeLabel(p.rawText, p.counterpartyName) ?? (fallback.confidence >= RULE_CONFIDENT ? fallback : null);
  let label: string;
  if (certain) {
    ruleAsked++;
    label = certain.label;
    if (label === m.incomeLabel) ruleRight++;
  } else {
    aiAsked++;
    const raw = await callTool(classifyIncomeMessages(p.counterpartyName, p.amount, new Date(p.timestamp).getDate(), history), CLASSIFY_INCOME_TOOL);
    const ai = validateIncomeLabel(raw);
    if (!ai) aiInvalid++;
    label = ai?.label ?? fallback.label;
    if (ai?.label === m.incomeLabel) aiRight++;
    console.log(`${String(m.incomeLabel).padEnd(16)} ai=${String(ai?.label ?? 'INVALID ' + JSON.stringify(raw)).padEnd(16)} rule=${fallback.label.padEnd(16)} ${p.counterpartyName}`);
  }
  if (label === m.incomeLabel) hybridRight++;
  if ((certain?.label ?? fallback.label) === m.incomeLabel) fallbackOnlyRight++;
  rows.push({ counterparty_name: p.counterpartyName, amount: p.amount, timestamp: p.timestamp });
}

const lat = stats.map((s) => s.latencyMs).sort((a, b) => a - b);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}% (${a}/${b})` : 'n/a');
console.log(`\nModel: ${AKIBA_MODELS[size].name}`);
console.log(`Income messages: ${parsed.length} — rule-certain ${ruleAsked}, sent to AI ${aiAsked}`);
console.log(`Rules on certain cases:   ${pct(ruleRight, ruleAsked)}`);
console.log(`AI on ambiguous cases:    ${pct(aiRight, aiAsked)}, invalid output ${aiInvalid}`);
console.log(`Rules-only (no AI):       ${pct(fallbackOnlyRight, parsed.length)}`);
console.log(`Hybrid (rules + AI):      ${pct(hybridRight, parsed.length)}`);
console.log(`AI latency median ${lat[Math.floor(lat.length / 2)] ?? '-'} ms, max ${lat.at(-1) ?? '-'} ms`);
await unloadAkibaModel();
await close();
