import type { IncomeLabel } from '../ai/schemas.ts';

/**
 * A synthetic M-Pesa inbox for one fictional person ("Amani"), so the demo
 * video, the screenshots and the eval never touch anyone's real messages.
 * Every name, number and transaction code here is made up. Templates follow
 * the real Safaricom wording the parser (src/parser.ts) already handles.
 *
 * Deterministic: the same `endDate` always produces the same inbox.
 */

export interface DemoSms {
  address: 'MPESA';
  body: string;
  date: number;
  /** Ground truth for RECEIVED messages — used by tests and scripts/eval. */
  incomeLabel?: IncomeLabel;
}

const PAYDAY = 28;
const SALARY = 58_000;
const EMPLOYER = 'JUA DIGITAL STUDIOS LIMITED';

// Small seeded PRNG (mulberry32) so amounts vary but runs are repeatable.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ksh = (n: number) => `Ksh${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
const timeStr = (d: Date) => {
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

export function buildDemoInbox(endDate: Date, months = 4): DemoSms[] {
  const rand = rng(20261024);
  const out: DemoSms[] = [];
  let balance = 4_200;
  let seq = 0;

  const code = () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let s = 'TJ';
    for (let i = 0; i < 8; i++) s += i % 3 === 2 ? String(Math.floor(rand() * 10)) : letters[Math.floor(rand() * letters.length)];
    seq++;
    return s;
  };
  const at = (d: Date, hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, Math.floor(rand() * 60));

  const received = (d: Date, amount: number, from: string, phone: string, label: IncomeLabel) => {
    balance += amount;
    out.push({
      address: 'MPESA',
      date: d.getTime(),
      incomeLabel: label,
      body: `${code()} Confirmed.You have received ${ksh(amount)} from ${from} ${phone} on ${dateStr(d)} at ${timeStr(d)} New M-PESA balance is ${ksh(balance)}. Separate personal and business funds through Pochi la Biashara.`,
    });
  };
  const outflow = (d: Date, amount: number, verb: 'sent to' | 'paid to', to: string, cost: number) => {
    if (balance < amount + cost) return;
    balance -= amount + cost;
    out.push({
      address: 'MPESA',
      date: d.getTime(),
      body: `${code()} Confirmed. ${ksh(amount)} ${verb} ${to} on ${dateStr(d)} at ${timeStr(d)}. New M-PESA balance is ${ksh(balance)}. Transaction cost, ${ksh(cost)}.`,
    });
  };
  const airtime = (d: Date, amount: number) => {
    if (balance < amount) return;
    balance -= amount;
    out.push({
      address: 'MPESA',
      date: d.getTime(),
      body: `${code()} confirmed.You bought ${ksh(amount)} of airtime on ${dateStr(d)} at ${timeStr(d)}.New M-PESA balance is ${ksh(balance)}. Transaction cost, Ksh0.00.`,
    });
  };

  const start = new Date(endDate.getFullYear(), endDate.getMonth() - months, 1);
  for (let day = new Date(start); day <= endDate; day.setDate(day.getDate() + 1)) {
    const d = new Date(day);
    const dom = d.getDate();

    if (dom === PAYDAY) received(at(d, 9), SALARY, EMPLOYER, '0700000101', 'salary');
    if (dom === 1) outflow(at(d, 10), 18_000, 'paid to', 'MAKAO BORA HOMES. for account RENT B4', 0);
    if (dom === 3) outflow(at(d, 19), 2_500, 'paid to', 'KPLC PREPAID. for account 54400000001', 0);
    if (dom === 5) outflow(at(d, 8), 6_000, 'sent to', 'MAMA AMANI 0700000202', 33);
    if (dom % 7 === 2) outflow(at(d, 18), 2_000 + Math.round(rand() * 2_500), 'paid to', 'NAIVAS SUPERMARKET', 0);
    if (dom % 2 === 0) outflow(at(d, 7), 100 + Math.round(rand() * 2) * 50, 'paid to', 'CITY HOPPA SHUTTLE SACCO', 0);
    if (dom % 3 === 0) outflow(at(d, 13), 150 + Math.round(rand() * 350), 'paid to', 'MAMA OLIECH EATERY', 0);
    if (dom % 10 === 4) airtime(at(d, 21), 100 + Math.round(rand() * 4) * 50);
    if (dom === 15) outflow(at(d, 20), 1_200, 'paid to', 'SAFARICOM HOME FIBRE. for account 0700000303', 0);
    // Discretionary spending that eats most of the month's slack.
    if (dom % 7 === 5) outflow(at(d, 17), 1_000 + Math.round(rand() * 6) * 250, 'sent to', 'KEVIN MWANGI 0700000808', 23);
    if (d.getDay() === 6) outflow(at(d, 22), 1_200 + Math.round(rand() * 4) * 200, 'paid to', 'THE TERRACE LOUNGE', 0);
    if (dom === 8 || dom === 20) outflow(at(d, 14), 3_000, 'sent to', 'KEVIN MWANGI 0700000808', 33);
    if (dom === 12 && rand() < 0.7) received(at(d, 16), 3_000 + Math.round(rand() * 6) * 500, 'BRIAN OTIENO', '0700000404', 'personal_gift');
    if (dom === 18 && rand() < 0.6) received(at(d, 11), 7_500 + Math.round(rand() * 5) * 1_000, 'KILIMO FRESH TRADERS', '0700000505', 'business_income');
    // Late in the cycle the money runs short — an app loan bridges to payday.
    if (dom === 22) received(at(d, 12), 4_000, 'ZENKA DIGITAL LIMITED', '0700000606', 'loan_disbursement');
    if (dom === PAYDAY && d.getMonth() % 2 === 0) outflow(at(d, 12), 4_400, 'paid to', 'ZENKA DIGITAL LIMITED. for account LN0001', 0);
  }

  return out.sort((a, b) => b.date - a.date);
}

/**
 * Hand-picked messages the demo injects live, one at a time, to trigger the
 * agent on camera. Includes a template the regex parser has never seen.
 */
export function demoInjections(now: Date, balanceAfterKes: number): Record<'salary' | 'loan' | 'reversal', DemoSms> {
  const t = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  return {
    loan: {
      address: 'MPESA',
      date: t(0).getTime(),
      incomeLabel: 'loan_disbursement',
      body: `TK2LN4QW8E Confirmed.You have received ${ksh(5_000)} from TALA KENYA LIMITED 0700000707 on ${dateStr(t(0))} at ${timeStr(t(0))} New M-PESA balance is ${ksh(balanceAfterKes)}.`,
    },
    salary: {
      address: 'MPESA',
      date: t(1).getTime(),
      incomeLabel: 'salary',
      body: `TK2SL7RT3Y Confirmed.You have received ${ksh(SALARY)} from ${EMPLOYER} 0700000101 on ${dateStr(t(1))} at ${timeStr(t(1))} New M-PESA balance is ${ksh(balanceAfterKes + SALARY)}.`,
    },
    reversal: {
      address: 'MPESA',
      date: t(2).getTime(),
      incomeLabel: 'reversal',
      body: `TK2RV1XC5P Confirmed. Transaction TJ8AB3CD2E has been reversed. You have received ${ksh(1_500)} from BRIAN OTIENO 0700000404 on ${dateStr(t(2))} at ${timeStr(t(2))} New M-PESA balance is ${ksh(balanceAfterKes + SALARY + 1_500)}.`,
    },
  };
}
