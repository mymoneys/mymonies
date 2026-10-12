import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  categorizeTransaction,
  getDistinctCategories,
  getRecentTransactions,
  parsePendingTransactions,
  reapplyRulesToUncategorized,
  TransactionRow,
} from './db';
import { backfillFromSmsInbox } from './backfill';
import { useSmsPermission } from './hooks/useSmsPermission';
import SyncHealthCard from './SyncHealthCard';

const AUTO_SYNC_INTERVAL_MS = 60000;

type DirectionFilter = 'ALL' | 'INCOME' | 'EXPENSE';

function directionOf(transactionType: string): 'IN' | 'OUT' | null {
  if (transactionType === 'RECEIVED' || transactionType === 'TRANSFER_IN') return 'IN';
  if (transactionType === 'SENT' || transactionType === 'PAID' || transactionType === 'WITHDRAWN' || transactionType === 'EXPENSE') {
    return 'OUT';
  }
  return null;
}

export default function TransactionsScreen() {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [query, setQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [categorizeTarget, setCategorizeTarget] = useState<TransactionRow | null>(null);
  const [categoryInput, setCategoryInput] = useState('');
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [savingCategory, setSavingCategory] = useState(false);
  const smsPermission = useSmsPermission();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await parsePendingTransactions();
      const [rows, categories] = await Promise.all([getRecentTransactions(), getDistinctCategories()]);
      setTransactions(rows);
      setKnownCategories(categories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  // §1/§1b: auto-sync in the background whenever SMS permission is already
  // granted — not just on an explicit button tap. Runs once immediately and
  // then on an interval, each time as an incremental (not full) sync, so this
  // stays cheap. This is what keeps the sync-health card's coverage % current
  // without the user having to remember to tap "Backfill history".
  useEffect(() => {
    if (smsPermission.status !== 'granted') {
      return;
    }

    let cancelled = false;

    async function autoSync() {
      try {
        await backfillFromSmsInbox(false);
        if (!cancelled) {
          await refresh();
        }
      } catch {
        // Best-effort background sync — failures surface via the sync-health
        // card (last-run status), not an interrupting alert.
      }
    }

    autoSync();
    const interval = setInterval(autoSync, AUTO_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [smsPermission.status, refresh]);

  async function handleBackfill() {
    let status = smsPermission.status;
    if (status !== 'granted') {
      status = await smsPermission.request();
    }

    if (status !== 'granted') {
      Alert.alert(
        'SMS permission needed',
        'Grant SMS access to import past MPESA messages from your inbox.'
      );
      return;
    }

    setBackfilling(true);
    try {
      const result = await backfillFromSmsInbox(true);
      await refresh();
      Alert.alert(
        'Backfill complete',
        `Scanned ${result.scanned} MPESA messages, added ${result.inserted} new transactions.`
      );
    } catch (error) {
      Alert.alert('Backfill failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBackfilling(false);
    }
  }

  async function handleReapplyRules() {
    setReapplying(true);
    try {
      const count = await reapplyRulesToUncategorized();
      await refresh();
      Alert.alert('Rules re-applied', `${count} transaction(s) re-categorized.`);
    } finally {
      setReapplying(false);
    }
  }

  function openCategorize(item: TransactionRow) {
    setCategorizeTarget(item);
    setCategoryInput(item.category === 'Uncategorized' ? '' : item.category);
  }

  async function handleSaveCategory() {
    if (!categorizeTarget || !categoryInput.trim()) {
      return;
    }

    setSavingCategory(true);
    try {
      await categorizeTransaction(categorizeTarget.id, categoryInput.trim());
      setCategorizeTarget(null);
      await refresh();
    } finally {
      setSavingCategory(false);
    }
  }

  const filtered = useMemo(() => {
    let list = transactions;

    if (directionFilter === 'INCOME') {
      list = list.filter((item) => directionOf(item.transaction_type) === 'IN');
    } else if (directionFilter === 'EXPENSE') {
      list = list.filter((item) => directionOf(item.transaction_type) === 'OUT');
    }

    const needle = query.trim().toLowerCase();
    if (needle) {
      list = list.filter((item) => item.counterparty_name.toLowerCase().includes(needle));
    }

    return list;
  }, [transactions, query, directionFilter]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.kicker}>Local finance tracker</Text>
        <Text style={styles.title}>MPESA transactions</Text>
        <Text style={styles.subtitle}>
          Live notifications are captured automatically. Use Backfill to import older messages
          from your SMS inbox.
        </Text>
      </View>

      <SyncHealthCard />

      <View style={styles.controls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by counterparty name"
          placeholderTextColor="#8C7F73"
          style={styles.input}
        />

        <View style={styles.filterRow}>
          {(['ALL', 'INCOME', 'EXPENSE'] as DirectionFilter[]).map((option) => {
            const selected = directionFilter === option;
            return (
              <Pressable
                key={option}
                style={[styles.filterChip, selected && styles.filterChipSelected]}
                onPress={() => setDirectionFilter(option)}
              >
                <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                  {option === 'ALL' ? 'All' : option === 'INCOME' ? 'Income' : 'Expenses'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={refresh}>
            <Text style={styles.primaryButtonText}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={handleBackfill} disabled={backfilling}>
            <Text style={styles.secondaryButtonText}>
              {backfilling ? 'Importing…' : 'Backfill history'}
            </Text>
          </Pressable>
        </View>
        <Pressable style={styles.secondaryButton} onPress={handleReapplyRules} disabled={reapplying}>
          <Text style={styles.secondaryButtonText}>
            {reapplying ? 'Re-applying…' : 'Re-apply rules'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.linkButton}
          onPress={() => {
            IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.NOTIFICATION_LISTENER_SETTINGS
            ).catch(() => {});
          }}
        >
          <Text style={styles.linkButtonText}>Grant notification access</Text>
        </Pressable>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{transactions.length}</Text>
          <Text style={styles.summaryLabel}>Stored</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{filtered.length}</Text>
          <Text style={styles.summaryLabel}>Visible</Text>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyBody}>
              Grant Notification Access and wait for an MPESA SMS, or tap Backfill history to
              import past messages.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const direction = directionOf(item.transaction_type);
          const sign = direction === 'IN' ? '+' : direction === 'OUT' ? '−' : '';
          return (
            <Pressable style={styles.card} onPress={() => openCategorize(item)}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardAmount, direction === 'IN' && styles.cardAmountIn]}>
                  {item.is_parsed ? `${sign} Ksh ${item.amount.toLocaleString()}` : 'Unparsed'}
                </Text>
                <View style={[styles.categoryChip, item.category === 'Uncategorized' && styles.categoryChipEmpty]}>
                  <Text
                    style={[
                      styles.categoryChipText,
                      item.category === 'Uncategorized' && styles.categoryChipTextEmpty,
                    ]}
                  >
                    {item.category === 'Uncategorized' ? 'Tap to categorize' : item.category}
                  </Text>
                </View>
              </View>
              <View style={styles.cardSubRow}>
                <Text style={styles.cardCounterparty}>{item.counterparty_name || 'Unknown'}</Text>
                {direction && (
                  <Text style={styles.directionBadge}>{direction === 'IN' ? 'Received' : 'Sent'}</Text>
                )}
              </View>
              <Text style={styles.cardMeta}>
                {new Date(item.timestamp).toLocaleString()}
                {item.balance != null ? ` · Bal Ksh ${item.balance.toLocaleString()}` : ''}
              </Text>
            </Pressable>
          );
        }}
      />

      <Modal visible={categorizeTarget != null} transparent animationType="fade" onRequestClose={() => setCategorizeTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Categorize {categorizeTarget?.counterparty_name || 'transaction'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {categorizeTarget ? `Ksh ${categorizeTarget.amount.toLocaleString()} · ${categorizeTarget.transaction_type}` : ''}
            </Text>
            <Text style={styles.modalHint}>
              This will also apply to every future message from this sender.
            </Text>

            {knownCategories.length > 0 && (
              <View style={styles.chipRow}>
                {knownCategories.map((category) => (
                  <Pressable
                    key={category}
                    style={[styles.pickerPill, categoryInput === category && styles.pickerPillSelected]}
                    onPress={() => setCategoryInput(category)}
                  >
                    <Text
                      style={[
                        styles.pickerPillText,
                        categoryInput === category && styles.pickerPillTextSelected,
                      ]}
                    >
                      {category}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <TextInput
              value={categoryInput}
              onChangeText={setCategoryInput}
              placeholder="e.g. Electricity, Family, Groceries"
              placeholderTextColor="#8C7F73"
              style={styles.input}
              autoFocus
            />

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={() => setCategorizeTarget(null)}>
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={handleSaveCategory}
                disabled={savingCategory || !categoryInput.trim()}
              >
                <Text style={styles.primaryButtonText}>{savingCategory ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F1EA',
    paddingHorizontal: 20,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 16,
  },
  kicker: {
    color: '#8A6A3C',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: '#1E1B18',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
  },
  subtitle: {
    color: '#4E463E',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  controls: {
    gap: 12,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFDF9',
    color: '#1E1B18',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFDF9',
    borderRadius: 999,
    paddingVertical: 9,
    alignItems: 'center',
  },
  filterChipSelected: {
    backgroundColor: '#1E1B18',
    borderColor: '#1E1B18',
  },
  filterChipText: {
    color: '#4E463E',
    fontSize: 13,
    fontWeight: '700',
  },
  filterChipTextSelected: {
    color: '#FFFDF9',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#1E1B18',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#E7DDCF',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#2F2924',
    fontWeight: '700',
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkButtonText: {
    color: '#8A6A3C',
    fontWeight: '700',
    fontSize: 13,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFDF9',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E3D8CA',
  },
  summaryValue: {
    color: '#1E1B18',
    fontSize: 24,
    fontWeight: '900',
  },
  summaryLabel: {
    color: '#6B5E52',
    marginTop: 4,
    fontSize: 13,
  },
  list: {
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFDF9',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E3D8CA',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardAmount: {
    color: '#1E1B18',
    fontSize: 18,
    fontWeight: '900',
  },
  cardAmountIn: {
    color: '#2E6B3E',
  },
  cardSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardCounterparty: {
    color: '#4E463E',
    fontSize: 14,
    fontWeight: '600',
  },
  directionBadge: {
    color: '#8A6A3C',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cardMeta: {
    color: '#887B6E',
    fontSize: 12,
  },
  categoryChip: {
    backgroundColor: '#E7DDCF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryChipEmpty: {
    backgroundColor: '#F1E4C9',
  },
  categoryChipText: {
    color: '#2F2924',
    fontSize: 11,
    fontWeight: '700',
  },
  categoryChipTextEmpty: {
    color: '#8A6A3C',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 27, 24, 0.5)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: '#FFFDF9',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    color: '#1E1B18',
    fontSize: 19,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: '#4E463E',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  modalHint: {
    color: '#8A6A3C',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  pickerPill: {
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pickerPillSelected: {
    backgroundColor: '#1E1B18',
    borderColor: '#1E1B18',
  },
  pickerPillText: {
    color: '#4E463E',
    fontSize: 13,
    fontWeight: '600',
  },
  pickerPillTextSelected: {
    color: '#FFFDF9',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: '#E7DDCF',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalCancelButtonText: {
    color: '#2F2924',
    fontWeight: '700',
  },
  emptyState: {
    backgroundColor: '#FFFDF9',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E3D8CA',
  },
  emptyTitle: {
    color: '#1E1B18',
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 6,
  },
  emptyBody: {
    color: '#4E463E',
    fontSize: 14,
    lineHeight: 20,
  },
});
