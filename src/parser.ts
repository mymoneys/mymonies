export interface ParsedTransaction {
  id: string;
  rawText: string;
  amount: number;
  transactionType: 'RECEIVED' | 'SENT' | 'PAID' | 'WITHDRAWN' | 'EXPENSE' | 'TRANSFER_IN' | 'FAILED' | 'INFO';
  counterpartyName: string;
  counterpartyNumber: string | null;
  accountNumber: string | null;
  timestamp: number;
  balance: number | null;
  transactionCost: number | null;
  isParsed: boolean;
}

const DATE_TAIL = '\\s+on\\s+\\d{1,2}/\\d{1,2}/\\d{2,4}';

function emptyResult(
  id: string,
  text: string,
  timestamp: number,
  type: ParsedTransaction['transactionType']
): ParsedTransaction {
  return {
    id,
    rawText: text,
    amount: 0,
    transactionType: type,
    counterpartyName: '',
    counterpartyNumber: null,
    accountNumber: null,
    timestamp,
    balance: null,
    transactionCost: null,
    isParsed: false,
  };
}

function cleanCounterparty(raw: string): string {
  return raw
    .replace(/\s+for account\s+.*$/i, '')
    .replace(/\s+(?:for\s+)?(?:07\d{8}|01\d{8}|\d{2,4}\*{2,4}\d{2,4}|\d{9,12})\s*$/i, '')
    // Agent withdrawals prefix the name with the till/store number, e.g.
    // "2104953 - SUPERSHELL Ltd" — the number alone isn't the agent's name.
    .replace(/^\d{4,10}\s*-\s*/, '')
    .replace(/\.\s*$/, '')
    .trim();
}

/**
 * Parses a raw M-Pesa SMS/notification body into structured transaction data.
 *
 * Tuned against common Safaricom confirmation templates. Send real (redacted)
 * message samples to tighten this further — templates vary by transaction type
 * and have changed over time.
 */
export function parseMpesaMessage(
  smsId: string,
  rawText: string,
  fallbackTimestamp: number
): ParsedTransaction {
  const text = rawText.replace(/\s+/g, ' ').trim();

  if (/failed|sufficient funds|unable to process/i.test(text)) {
    return emptyResult(smsId, text, fallbackTimestamp, 'FAILED');
  }
  if (!/confirmed/i.test(text)) {
    return emptyResult(smsId, text, fallbackTimestamp, 'INFO');
  }

  // Deliberately NOT anchored to "Confirmed." — templates put varying words
  // ("You have received", "You have withdrawn", "You bought") between
  // "Confirmed." and the amount. The first Ksh figure in the message is always
  // the transaction amount; the second (later) one is the resulting balance.
  const amountMatch = text.match(/Ksh\.?\s?([\d,]+\.?\d*)/i);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

  const dateMatch = text.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i);
  let timestamp = fallbackTimestamp;
  if (dateMatch) {
    const [, dateStr, timeStr] = dateMatch;
    const [day, month, year] = dateStr.split('/');
    const fullYear = year.length === 2 ? `20${year}` : year;
    const jsDate = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timeStr}`);
    if (!isNaN(jsDate.getTime())) timestamp = jsDate.getTime();
  }

  // Type detection is keyword-based rather than assuming a fixed word order,
  // because real templates differ: "received Ksh.. from X" (verb before amount)
  // vs. "Ksh.. sent to X" / "Ksh.. paid to X" (amount before verb).
  let transactionType: ParsedTransaction['transactionType'] = 'INFO';
  let counterpartyName = '';

  if (/withdraw(?:n)?\b/i.test(text)) {
    // Safaricom uses both "you have withdrawn Ksh X from Y" (ATM) and the
    // present-tense "Withdraw KshX.00 from Y" (agent/over-the-counter) — the
    // latter was falling through to INFO entirely when only "withdrawn" was
    // matched, silently dropping real cash withdrawals.
    transactionType = 'WITHDRAWN';
    // ATM withdrawals end in "...from <agent> on <date>" (DATE_TAIL); agent/
    // over-the-counter ones have no second date and instead run straight into
    // "New M-PESA balance is...", so that's the fallback terminator.
    const m =
      text.match(new RegExp(`withdraw(?:n)?\\s+(?:Ksh[\\d,]+\\.?\\d*\\s+)?from\\s+(.+?)${DATE_TAIL}`, 'i')) ??
      text.match(/withdraw(?:n)?\s+(?:Ksh[\d,]+\.?\d*\s+)?from\s+(.+?)\s+New M-PESA balance/i);
    if (m) counterpartyName = m[1];
  } else if (/bought\s+Ksh[\d,]+\.?\d*\s+of\s+/i.test(text)) {
    transactionType = 'EXPENSE';
    const m = text.match(new RegExp(`of\\s+(.+?)${DATE_TAIL}`, 'i'));
    if (m) counterpartyName = m[1];
  } else if (/transferred\s+.*from/i.test(text)) {
    transactionType = 'TRANSFER_IN';
    // Real format: "transferred from M-Shwari account on <date>" — no
    // "...to your M-PESA account" phrase. Fall back to a couple of other
    // plausible templates in case Safaricom varies this by product/region.
    const m =
      text.match(/transferred\s+(?:Ksh[\d,]+\.?\d*\s+)?from\s+(.+?)\s+account\b/i) ??
      text.match(/transferred\s+(?:Ksh[\d,]+\.?\d*\s+)?from\s+(?:your\s+)?(.+?)\s+(?:account\s+)?to\s+your\s+M-PESA\s+account/i) ??
      text.match(new RegExp(`transferred\\s+from\\s+(.+?)${DATE_TAIL}`, 'i'));
    if (m) counterpartyName = `${m[1]} Account`;
  } else if (/received/i.test(text)) {
    transactionType = 'RECEIVED';
    const m = text.match(new RegExp(`from\\s+(.+?)${DATE_TAIL}`, 'i'));
    if (m) counterpartyName = m[1];
  } else if (/paid\s+to/i.test(text)) {
    transactionType = 'PAID';
    const m = text.match(new RegExp(`paid\\s+to\\s+(.+?)${DATE_TAIL}`, 'i'));
    if (m) counterpartyName = m[1];
  } else if (/sent\s+to/i.test(text)) {
    transactionType = 'SENT';
    const m = text.match(new RegExp(`sent\\s+to\\s+(.+?)${DATE_TAIL}`, 'i'));
    if (m) counterpartyName = m[1];
  }

  counterpartyName = cleanCounterparty(counterpartyName);

  // Matches local (07xx/01xx) and masked (e.g. "0714***073") formats.
  const phoneMatch = text.match(/\b(07\d{8}|01\d{8}|\d{2,4}\*{2,4}\d{2,4})\b/);
  const counterpartyNumber = phoneMatch ? phoneMatch[1] : null;

  // Anchored to an actual date (via DATE_TAIL), not just the bare word "on" —
  // an unanchored `\s+on` false-matches inside account names like "Google One"
  // (the "On" in "One" satisfies a case-insensitive "on"), truncating the name.
  const accountMatch = text.match(new RegExp(`for account\\s+([A-Za-z0-9\\s\\-]+?)${DATE_TAIL}`, 'i'));
  const accountNumber = accountMatch ? accountMatch[1].trim() : null;

  const balanceMatch = text.match(/M-PESA balance is Ksh([\d,]+\.?\d*)/i);
  const costMatch = text.match(/Transaction cost,?\s*Ksh\.?([\d,]+\.?\d*)/i);

  // A "confirmed" message that matched none of the known transaction keywords
  // (e.g. a balance-check confirmation like "Your account balance was...")
  // isn't a real transaction. The Ksh figure grabbed above is usually a
  // balance, not money moved, so don't report it as `amount`.
  const isRealTransaction = transactionType !== 'INFO';

  return {
    id: smsId,
    rawText: text,
    amount: isRealTransaction ? amount : 0,
    transactionType,
    counterpartyName,
    counterpartyNumber,
    accountNumber,
    timestamp,
    balance: balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : null,
    transactionCost: costMatch ? parseFloat(costMatch[1].replace(/,/g, '')) : null,
    isParsed: isRealTransaction,
  };
}
