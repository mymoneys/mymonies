import {
  flagPossibleDuplicates,
  getCapturedTransactionCount,
  getMaxIngestedTimestamp,
  insertParsedTransaction,
  recordSyncRunFinish,
  recordSyncRunStart,
  updateSyncRunProgress,
} from './db';
import { getContributeSenders, insertContribution, isContributeEnabled, normalizeSender } from './contributions';
import { getInboxMessageCount, isSmsReaderAvailable, readInboxMessages } from './smsInbox';

export type BackfillResult = {
  scanned: number;
  inserted: number;
};

// Re-scan the last 24h on every incremental sync — cheap because INSERT OR
// IGNORE already makes overlap idempotent, and it's the guard against clock
// skew / a message landing in the inbox a few seconds "in the past" relative
// to when the last sync's cursor was taken.
const OVERLAP_MS = 24 * 60 * 60 * 1000;
const PROGRESS_CHECKPOINT_EVERY = 50;

/**
 * full=true re-scans the entire inbox (the explicit "Backfill history" button).
 * full=false (default) does an incremental sync from the last ingested
 * message's timestamp minus the overlap window — used by auto-sync and the
 * sync-health card's "Sync now" action.
 */
export async function backfillFromSmsInbox(full = false): Promise<BackfillResult> {
  if (!isSmsReaderAvailable()) {
    throw new Error(
      'SmsReaderModule is not available. Rebuild the native app after adding it ' +
        '(npx expo prebuild && npx expo run:android).'
    );
  }

  const lastMax = full ? 0 : await getMaxIngestedTimestamp();
  const sinceMs = full ? 0 : Math.max(0, lastMax - OVERLAP_MS);

  // Extra senders (banks, loan apps) only matter for opt-in contributions —
  // they're routed to that table below, never into transactions.
  const extraSenders = (await isContributeEnabled()) ? await getContributeSenders() : [];

  const runId = await recordSyncRunStart(full ? 'BACKFILL' : 'INCREMENTAL');
  let scanned = 0;
  let inserted = 0;

  try {
    const messages = await readInboxMessages(sinceMs, ['MPESA', ...extraSenders]);

    for (const message of messages) {
      const sender = normalizeSender(message.address);
      if (sender !== 'MPESA') {
        try {
          await insertContribution(sender, message.body, message.date, 'extra_sender');
        } catch {
          // Same as below — one bad row shouldn't abort the sync.
        }
        continue;
      }

      scanned += 1;
      try {
        const wasInserted = await insertParsedTransaction(message.body, message.date);
        if (wasInserted) {
          inserted += 1;
        }
      } catch {
        // One malformed row shouldn't abort the whole sync run.
      }

      if (scanned % PROGRESS_CHECKPOINT_EVERY === 0) {
        await updateSyncRunProgress(runId, scanned, inserted);
      }
    }

    await recordSyncRunFinish(runId, 'COMPLETE', scanned, inserted, null);
  } catch (error) {
    await recordSyncRunFinish(
      runId,
      'FAILED',
      scanned,
      inserted,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }

  await flagPossibleDuplicates();

  return { scanned, inserted };
}

export type SyncCoverage = {
  coverage: number; // 0..1, clamped
  captured: number;
  totalInInbox: number;
};

/** Backs the §1b sync-health "rule box". Returns null if the native module isn't available. */
export async function getSyncCoverage(): Promise<SyncCoverage | null> {
  const totalInInbox = await getInboxMessageCount();
  if (totalInInbox == null) {
    return null;
  }

  const captured = await getCapturedTransactionCount();
  const coverage = totalInInbox > 0 ? Math.min(1, captured / totalInInbox) : 1;

  return { coverage, captured, totalInInbox };
}
