import { useEffect } from 'react';
import { backfillFromSmsInbox } from './backfill';
import { runContributionMaintenance } from './contributions';
import { parsePendingTransactions, reapplyRulesToUncategorized } from './db';
import { useSmsPermission } from './hooks/useSmsPermission';
import { DEMO_MODE } from './demo/mode';
import { applyLabelOverrides } from './labelsBackup';
import { noteMaintenanceError, runAkibaMaintenance } from './akiba/runner';

const SYNC_INTERVAL_MS = 60000;
const MAINTENANCE_INTERVAL_MS = 5000;

/**
 * App-wide upkeep: parsing, rule re-application, and incremental SMS sync.
 *
 * This used to live inside TransactionsScreen's own effects, which only run
 * while that screen is mounted — but bottom-tabs lazy-mounts screens, so all
 * of it silently stopped whenever a different tab was open (the actual cause
 * of a withdrawal sitting "unparsed" for an extra day: the fix was live, but
 * nothing re-ran it until Transactions happened to be opened again). Calling
 * this once from App's root means it keeps running no matter which tab is
 * visible, with no button to remember to tap.
 *
 * SMS permission is requested automatically the first time this runs (status
 * 'unknown' only — never re-prompted after an explicit deny) so backfill can
 * start right after install without a manual "Backfill history" tap. The
 * very first sync naturally scans the whole inbox: incremental sync's lookback
 * is `lastIngestedTimestamp - 24h`, and with no data yet that's clamped to 0.
 */
export function useBackgroundMaintenance() {
  const smsPermission = useSmsPermission();

  useEffect(() => {
    async function requestOnFirstRun() {
      if (!DEMO_MODE && smsPermission.status === 'unknown') {
        await smsPermission.request();
      }
    }
    requestOnFirstRun();
    // Only re-run when the status actually flips (e.g. unknown -> granted),
    // not on every render — request()/check() are stable useCallbacks.
  }, [smsPermission.status]);

  useEffect(() => {
    async function maintain() {
      // Each step on its own: one failing step (e.g. contributions) must not
      // stop the Akiba agent, which runs last.
      const steps: [string, () => Promise<unknown>][] = [
        ['parse', parsePendingTransactions],
        ['rules', reapplyRulesToUncategorized],
        // Restored labels for messages that have only just been imported.
        ['labels', applyLabelOverrides],
        // After parsing, so it only picks up messages the parser truly couldn't handle.
        ['contributions', runContributionMaintenance],
        // Last: needs parsed RECEIVED rows. Self-throttled, see src/akiba/runner.ts.
        ['akiba', runAkibaMaintenance],
      ];
      for (const [name, step] of steps) {
        try {
          await step();
        } catch (e) {
          // Best-effort upkeep: no alert, but the Akiba tab shows the error.
          noteMaintenanceError(name, e);
        }
      }
    }

    maintain();
    const interval = setInterval(maintain, MAINTENANCE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (DEMO_MODE || smsPermission.status !== 'granted') {
      return;
    }

    async function autoSync() {
      try {
        await backfillFromSmsInbox(false);
      } catch {
        // Best-effort — failures surface via the Sync Health card, not an alert.
      }
    }

    autoSync();
    const interval = setInterval(autoSync, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [smsPermission.status]);
}
