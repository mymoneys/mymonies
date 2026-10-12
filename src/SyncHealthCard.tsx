import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { backfillFromSmsInbox, getSyncCoverage, SyncCoverage } from './backfill';
import { getLastSyncRun, SyncRunRow } from './db';

const COVERAGE_TARGET = 0.99;
const STALE_RUNNING_MS = 2 * 60 * 1000;

function formatRelativeTime(ms: number): string {
  const diffMinutes = Math.floor((Date.now() - ms) / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The §1b "rule box": shows what fraction of MPESA messages actually in the
 * SMS inbox have been captured into the app, and whether it's currently
 * meeting the 99% target. Renders nothing if the native SMS module isn't
 * available (e.g. before a rebuild, or on a platform without it).
 */
export default function SyncHealthCard() {
  const [coverage, setCoverage] = useState<SyncCoverage | null>(null);
  const [lastRun, setLastRun] = useState<SyncRunRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const [cov, run] = await Promise.all([getSyncCoverage(), getLastSyncRun()]);
    if (cov == null) {
      setAvailable(false);
      return;
    }
    setCoverage(cov);
    setLastRun(run);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSyncNow() {
    setSyncing(true);
    try {
      await backfillFromSmsInbox(false);
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  if (!available) {
    return null;
  }

  const pct = coverage != null ? Math.round(coverage.coverage * 100) : null;
  const healthy = coverage != null && coverage.coverage >= COVERAGE_TARGET;
  const isStaleRunning = lastRun?.status === 'RUNNING' && Date.now() - lastRun.started_at > STALE_RUNNING_MS;

  let lastRunLabel = 'Never synced';
  if (lastRun) {
    if (lastRun.status === 'RUNNING' && !isStaleRunning) {
      lastRunLabel = 'Syncing…';
    } else if (lastRun.status === 'COMPLETE') {
      lastRunLabel = `Last synced ${formatRelativeTime(lastRun.finished_at ?? lastRun.started_at)}`;
    } else {
      lastRunLabel = `Last sync: ${isStaleRunning ? 'PARTIAL' : lastRun.status}`;
    }
  }

  return (
    <View style={[styles.card, healthy ? styles.cardHealthy : styles.cardWarning]}>
      <View style={styles.row}>
        <Text style={styles.title}>Sync health</Text>
        {pct != null && (
          <Text style={[styles.pct, healthy ? styles.pctHealthy : styles.pctWarning]}>{pct}%</Text>
        )}
      </View>
      <Text style={styles.meta}>
        {coverage ? `${coverage.captured} of ${coverage.totalInInbox} MPESA messages captured` : 'Checking…'}
      </Text>
      <Text style={styles.meta}>{lastRunLabel}</Text>
      {!healthy && (
        <Pressable style={styles.syncButton} onPress={handleSyncNow} disabled={syncing}>
          <Text style={styles.syncButtonText}>{syncing ? 'Syncing…' : 'Sync now'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardHealthy: {
    backgroundColor: '#FFFDF9',
    borderColor: '#E3D8CA',
  },
  cardWarning: {
    backgroundColor: '#FBF0E4',
    borderColor: '#E8C9A0',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#1E1B18',
    fontSize: 14,
    fontWeight: '800',
  },
  pct: {
    fontSize: 16,
    fontWeight: '900',
  },
  pctHealthy: {
    color: '#2E6B3E',
  },
  pctWarning: {
    color: '#A3453C',
  },
  meta: {
    color: '#6B5E52',
    fontSize: 12,
    marginTop: 2,
  },
  syncButton: {
    backgroundColor: '#1E1B18',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    marginTop: 10,
  },
  syncButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
    fontSize: 13,
  },
});
