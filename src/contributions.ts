import { Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import { getDb, getSetting, makeTransactionId, setSetting } from './db';
import { messageSignature, redactMessage } from './redact';
import { readInboxMessages } from './smsInbox';

/**
 * Opt-in "help improve parsing" flow. Messages the app can't handle — M-Pesa
 * templates the parser doesn't know, plus SMS from extra senders the user
 * picked (banks, loan apps) — are collected into the `contributions` table,
 * redacted on-device, and shown to the user for review. Nothing leaves the
 * phone until the user taps one of the send buttons; there is no backend.
 *
 * Row lifecycle (`status`):
 *   pending   → captured, not yet redacted (native code can only insert raw)
 *   ready     → redacted, unique template, waiting for the user to review/send
 *   duplicate → same template as a row we already have — never shown
 *   shared / dismissed → done; raw_text is cleared so we don't keep bank SMS
 *                        around longer than needed (the id still dedupes)
 */

export const CONTRIBUTE_EMAIL = 'mfredgitonga@gmail.com';
export const CONTRIBUTE_WHATSAPP = '254743913802';

// Read by NotificationCaptureListenerService/TransactionDb.kt too — keep the
// key names and the JSON-array-of-uppercase-strings format in sync.
const ENABLED_KEY = 'contribute_enabled';
const SENDERS_KEY = 'contribute_senders';

const MPESA_SENDER = 'MPESA';
const SENDER_BACKFILL_LIMIT = 50;
// wa.me links carry the text in the URL; keep well under what WhatsApp and
// Android intents reliably accept.
const WHATSAPP_MAX_CHARS = 3500;

export type ContributionReason = 'extra_sender' | 'unparsed_mpesa';

export type ContributionRow = {
  id: string;
  sender: string;
  redacted_text: string;
  timestamp: number;
  reason: ContributionReason;
};

export function normalizeSender(sender: string): string {
  return sender.trim().toUpperCase();
}

export async function isContributeEnabled(): Promise<boolean> {
  return (await getSetting(ENABLED_KEY)) === '1';
}

export async function getContributeSenders(): Promise<string[]> {
  const raw = await getSetting(SENDERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Turning it off drops everything not yet sent — opting out means we stop holding samples. */
export async function setContributeEnabled(enabled: boolean): Promise<void> {
  await setSetting(ENABLED_KEY, enabled ? '1' : '0');
  if (!enabled) {
    const db = await getDb();
    await db.runAsync(`DELETE FROM contributions WHERE status IN ('pending', 'ready')`);
  }
}

export async function addContributeSender(sender: string): Promise<void> {
  const normalized = normalizeSender(sender);
  if (!normalized || normalized === MPESA_SENDER) return;
  const current = await getContributeSenders();
  if (current.includes(normalized)) return;
  await setSetting(SENDERS_KEY, JSON.stringify([...current, normalized]));
  // The incremental sync only looks back from the newest M-Pesa message, so
  // a newly-added sender's history would otherwise never be read.
  await backfillSender(normalized);
}

export async function removeContributeSender(sender: string): Promise<void> {
  const normalized = normalizeSender(sender);
  const current = await getContributeSenders();
  await setSetting(SENDERS_KEY, JSON.stringify(current.filter((s) => s !== normalized)));
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM contributions WHERE sender = ? AND status IN ('pending', 'ready')`,
    normalized
  );
}

async function backfillSender(sender: string): Promise<void> {
  try {
    const messages = await readInboxMessages(0, [sender]);
    for (const m of messages.slice(0, SENDER_BACKFILL_LIMIT)) {
      await insertContribution(sender, m.body, m.date, 'extra_sender');
    }
  } catch {
    // No SMS permission / native module — the notification listener will
    // still pick up new messages from this sender going forward.
  }
}

/** Same id formula as transactions (and TransactionDb.kt), so notification + inbox copies dedupe. */
export async function insertContribution(
  sender: string,
  rawText: string,
  timestamp: number,
  reason: ContributionReason
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO contributions (id, sender, raw_text, timestamp, reason, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    makeTransactionId(rawText, timestamp),
    normalizeSender(sender),
    rawText,
    timestamp,
    reason
  );
}

/**
 * Background upkeep, called from useBackgroundMaintenance right after
 * parsePendingTransactions(). No-op unless the user opted in.
 */
export async function runContributionMaintenance(): Promise<void> {
  if (!(await isContributeEnabled())) return;
  const db = await getDb();

  // M-Pesa messages the parser couldn't turn into a transaction. FAILED is
  // excluded (we parse those fine, they just never moved money), and rows
  // with no "Ksh" are OTPs/promos with nothing to parse.
  await db.runAsync(
    `INSERT OR IGNORE INTO contributions (id, sender, raw_text, timestamp, reason, status)
     SELECT id, ?, raw_text, timestamp, 'unparsed_mpesa', 'pending' FROM transactions
     WHERE transaction_type != 'FAILED'
       AND (is_parsed = 0 OR (transaction_type != 'INFO' AND TRIM(counterparty_name) = ''))
       AND raw_text LIKE '%Ksh%'`,
    MPESA_SENDER
  );

  // A parser fix since collection means we no longer need that sample.
  await db.runAsync(
    `DELETE FROM contributions
     WHERE reason = 'unparsed_mpesa' AND status IN ('pending', 'ready')
       AND id IN (SELECT id FROM transactions WHERE is_parsed = 1 AND TRIM(counterparty_name) != '')`
  );

  const pending = await db.getAllAsync<{ id: string; raw_text: string }>(
    `SELECT id, raw_text FROM contributions WHERE status = 'pending' ORDER BY timestamp DESC`
  );
  for (const row of pending) {
    const redacted = redactMessage(row.raw_text);
    const signature = messageSignature(redacted);
    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM contributions WHERE signature = ? AND status != 'pending' LIMIT 1`,
      signature
    );
    if (existing) {
      await db.runAsync(
        `UPDATE contributions SET status = 'duplicate', signature = ?, raw_text = '' WHERE id = ?`,
        signature,
        row.id
      );
    } else {
      await db.runAsync(
        `UPDATE contributions SET status = 'ready', redacted_text = ?, signature = ? WHERE id = ?`,
        redacted,
        signature,
        row.id
      );
    }
  }
}

export async function getReadyContributions(): Promise<ContributionRow[]> {
  const db = await getDb();
  return db.getAllAsync<ContributionRow>(
    `SELECT id, sender, redacted_text, timestamp, reason FROM contributions
     WHERE status = 'ready' ORDER BY timestamp DESC`
  );
}

export async function getReadyContributionCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM contributions WHERE status = 'ready'`
  );
  return row?.c ?? 0;
}

export async function updateRedactedText(id: string, text: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE contributions SET redacted_text = ? WHERE id = ?`, text, id);
}

async function markContributions(ids: string[], status: 'shared' | 'dismissed'): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE contributions SET status = ?, raw_text = '' WHERE id IN (${placeholders})`,
    status,
    ...ids
  );
}

export function dismissContribution(id: string): Promise<void> {
  return markContributions([id], 'dismissed');
}

function formatSample(row: ContributionRow, index: number): string {
  const label = row.reason === 'unparsed_mpesa' ? 'unparsed M-Pesa' : 'new sender';
  return `[${index + 1}] ${row.sender} (${label})\n${row.redacted_text}`;
}

function buildBody(rows: ContributionRow[]): string {
  return [
    `MyMonies message samples (${rows.length}). Redacted on-device and reviewed before sending.`,
    ...rows.map(formatSample),
  ].join('\n\n');
}

async function writeSampleFile(rows: ContributionRow[]): Promise<string> {
  const payload = {
    kind: 'mymonies-message-samples',
    version: 1,
    createdAt: new Date().toISOString(),
    messages: rows.map((r) => ({ sender: r.sender, reason: r.reason, text: r.redacted_text })),
  };
  const path = `${FileSystem.cacheDirectory}mymonies-samples-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return path;
}

/** Returns how many samples were handed off. Throws if no mail app is set up. */
export async function sendByEmail(rows: ContributionRow[]): Promise<number> {
  if (!(await MailComposer.isAvailableAsync())) {
    throw new Error('No email app is set up on this phone. Try WhatsApp or "Other app" instead.');
  }
  const path = await writeSampleFile(rows);
  const result = await MailComposer.composeAsync({
    recipients: [CONTRIBUTE_EMAIL],
    subject: `MyMonies message samples (${rows.length})`,
    body: buildBody(rows),
    attachments: [path],
  });
  // Android can't report whether the user actually hit send, so anything
  // short of an explicit cancel counts as shared.
  if (result.status === MailComposer.MailComposerStatus.CANCELLED) return 0;
  await markContributions(rows.map((r) => r.id), 'shared');
  return rows.length;
}

/**
 * WhatsApp can't take a file via a link, so samples go as message text —
 * as many as fit in one message. Returns how many were included; the rest
 * stay 'ready' for the next tap.
 */
export async function sendByWhatsApp(rows: ContributionRow[]): Promise<number> {
  const included: ContributionRow[] = [];
  for (const row of rows) {
    if (included.length > 0 && buildBody([...included, row]).length > WHATSAPP_MAX_CHARS) break;
    included.push(row);
  }
  if (included.length === 0) return 0;
  const url = `https://wa.me/${CONTRIBUTE_WHATSAPP}?text=${encodeURIComponent(buildBody(included))}`;
  await Linking.openURL(url);
  await markContributions(included.map((r) => r.id), 'shared');
  return included.length;
}

/** Fallback: the system share sheet with the JSON file, for any app the user prefers. */
export async function sendViaShareSheet(rows: ContributionRow[]): Promise<number> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const path = await writeSampleFile(rows);
  await Sharing.shareAsync(path, {
    mimeType: 'application/json',
    dialogTitle: `Send to ${CONTRIBUTE_EMAIL}`,
  });
  await markContributions(rows.map((r) => r.id), 'shared');
  return rows.length;
}
