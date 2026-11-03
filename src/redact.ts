// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Fred Gitonga

/**
 * Strips identifying details from a financial SMS before it's shared with us
 * as a parser sample, while keeping the message's *shape* intact — keywords,
 * punctuation, field order and number formats are what a parser is written
 * against, so those survive; names, phone numbers, account numbers, codes and
 * real amounts/dates don't.
 *
 * This is heuristic and WILL miss things (a lowercase name, an unusual ID
 * format), which is why the user always sees and can edit the redacted text
 * before anything leaves the phone. Don't rely on this alone.
 */

type Rng = () => number;

// Words that commonly appear in ALL CAPS in financial SMS but aren't names —
// a caps run made only of these is left alone instead of becoming PERSON.
const CAPS_ALLOWLIST = new Set([
  'MPESA', 'PESA', 'M', 'KES', 'KSH', 'KSHS', 'USD', 'OTP', 'PIN', 'ATM', 'POS', 'SMS', 'USSD',
  'FULIZA', 'SHWARI', 'KCB', 'MPESA', 'NCBA', 'LOOP', 'ACCOUNT', 'BALANCE', 'NEW', 'TILL',
  'PAYBILL', 'BANK', 'EQUITY', 'COOP', 'STANBIC', 'ABSA', 'DTB', 'IMB', 'NOT', 'YOU', 'DEAR',
  'CUSTOMER', 'REF', 'REFERENCE', 'ID', 'NO', 'AM', 'PM', 'EAT', 'TALA', 'BRANCH', 'ZENKA',
  'HUSTLER', 'FUND', 'SACCO', 'KPLC', 'DSTV', 'GOTV', 'NHIF', 'SHA', 'NSSF', 'KRA', 'HELB',
]);

const AMOUNT_RE = /\b(Kshs?|KES|KSH|Ksh)(\.?\s?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/gi;
const DATE_RE = /\b(\d{1,2})([/-])(\d{1,2})\2(\d{4}|\d{2})\b/g;

function formatScaledAmount(original: string, decimals: string | undefined, factor: number): string {
  const value = Number.parseFloat(original.replace(/,/g, '') + (decimals ?? ''));
  const decimalPlaces = decimals ? decimals.length - 1 : 0;
  const scaled = Math.max(1, value * factor);
  const fixed = scaled.toFixed(decimalPlaces);
  if (!original.includes(',')) {
    return fixed;
  }
  const [whole, frac] = fixed.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac != null ? `${withCommas}.${frac}` : withCommas;
}

function shiftDate(day: string, sep: string, month: string, year: string, offsetDays: number): string {
  const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
  const d = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  if (Number.isNaN(d.getTime()) || Number(month) > 12 || Number(day) > 31) {
    return `${day}${sep}${month}${sep}${year}`;
  }
  d.setUTCDate(d.getUTCDate() + offsetDays);
  // Keep each field's width: M-Pesa always writes a two-digit month, so
  // "13/10/26" must not come back as "17/9/26".
  const pad = (n: number, like: string) => (like.length === 2 ? String(n).padStart(2, '0') : String(n));
  const outYear = year.length === 2 ? String(d.getUTCFullYear() % 100).padStart(2, '0') : String(d.getUTCFullYear());
  return `${pad(d.getUTCDate(), day)}${sep}${pad(d.getUTCMonth() + 1, month)}${sep}${outYear}`;
}

export function redactMessage(text: string, rng: Rng = Math.random): string {
  // One factor/offset per message, so relative relationships inside a single
  // message (amount vs. balance, two dates) still look realistic.
  const amountFactor = 0.5 + rng();
  const dayOffset = (rng() < 0.5 ? -1 : 1) * (3 + Math.floor(rng() * 25));

  // Every replacement is parked behind a sentinel token until the end, so a
  // later rule can't re-match an earlier rule's output (e.g. "07XXXXXXXX"
  // looking like a transaction code, or PERSON joining an ALL-CAPS name run).
  const tokens: string[] = [];
  const park = (value: string) => {
    tokens.push(value);
    return `\u0000${tokens.length - 1}\u0000`;
  };
  const maskDigits = (m: string) => park(m.replace(/\d/g, '#'));

  let out = text
    // Amounts first, so the digit-based rules below can't chew on them.
    .replace(AMOUNT_RE, (_m, currency: string, gap: string, whole: string, decimals?: string) =>
      park(`${currency}${gap}${formatScaledAmount(whole, decimals, amountFactor)}`)
    )
    // URLs: keep the domain (tells us who sent it), drop personalised paths/tokens.
    .replace(/\b(https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s]*)/gi, (_m, scheme = '', host: string) =>
      park(`${scheme}${host}/LINK`)
    )
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => park('EMAIL'))
    // Phones: +2547…, 2547…, 07…, 01….
    .replace(/(?:\+?254|\b0)[17]\d{8}\b/g, () => park('07XXXXXXXX'))
    // Masked phones/cards/accounts: 0712***678, 1234****5678, ****1234, XXXX4521.
    .replace(/\b\d{0,6}\*{2,8}\d{0,6}\b|(?:\*{2,}|\b[Xx]{2,})\d{2,6}\b/g, maskDigits)
    // Agent/till number + name: "from 123456 - Kamau Agencies Ruaka New M-PESA…".
    // The name usually ends in the agent's location, so it goes whatever its
    // casing; it runs up to the next fixed M-Pesa phrase or the end.
    .replace(
      /\b(from|to|at)\s+(\d{4,})\s+-\s+(.{1,80}?)(?=\.?\s+(?:New\s+M-?PESA|on\s+\d)|\.?\s*$)/gi,
      (_m, prep: string, num: string) => `${prep} ${maskDigits(num)} - ${park('PERSON')}`
    )
    // Transaction/reference codes: mixed letters+digits, 8–14 chars (SJK1ABC2DE, FT24286ABCD).
    .replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,14}\b/g, () => park('TXNCODE'))
    // Account / ID / till numbers: any remaining run of 5+ digits.
    .replace(/\b\d{5,}\b/g, maskDigits)
    // Greeting + name: "Dear John", "Hi JANE", "Hello Mary Wanjiku,".
    .replace(/\b(Dear|Hi|Hello|Hey|Jambo|Habari)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)*)/g, (_m, greet: string) =>
      `${greet} ${park('PERSON')}`
    )
    // ALL-CAPS name runs (M-Pesa's "JOHN DOE KAMAU"), unless every word is a known keyword.
    .replace(/\b[A-Z][A-Z'.&]+(?:\s+[A-Z][A-Z'.&]+)+\b/g, (run) =>
      run.split(/\s+/).every((w) => CAPS_ALLOWLIST.has(w.replace(/[^A-Z]/g, ''))) ? run : park('PERSON')
    )
    // Title-case names right after to/from/by: "sent to John Doe on…".
    .replace(/\b(to|from|by)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){1,3})\b/g, (_m, prep: string) =>
      `${prep} ${park('PERSON')}`
    )
    .replace(DATE_RE, (_m, d: string, sep: string, mo: string, y: string) => shiftDate(d, sep, mo, y, dayOffset));

  // Tokens can't nest (each rule only ever sees un-parked text), so one pass restores everything.
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)]);
  return out;
}

/**
 * Template fingerprint: two messages with the same wording but different
 * numbers/names collapse to the same signature, so we don't ask the user to
 * share 200 near-identical Fuliza reminders.
 */
export function messageSignature(redacted: string): string {
  return redacted
    .replace(/[\d,.]*\d[\d,.]*/g, '#')
    .replace(/#+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
