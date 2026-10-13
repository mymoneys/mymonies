import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { categorizeTransaction, getDistinctCategories, getRecentTransactions, TransactionRow } from './db';

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
  const [categorizeTarget, setCategorizeTarget] = useState<TransactionRow | null>(null);
  const [categoryInput, setCategoryInput] = useState('');
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [savingCategory, setSavingCategory] = useState(false);

  // Parsing, rule re-application, and SMS sync all run from App's root now
  // (useBackgroundMaintenance) so they keep working no matter which tab is
  // open — this screen just reads whatever that background job has produced.
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
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
    // Rows that never became a real transaction (balance checks, failed
    // messages, or anything still waiting on the background parser) are
    // noise, not data to review — hide them rather than requiring a manual
    // cleanup action. The background job in useBackgroundMaintenance keeps
    // retrying these, so a parser improvement surfaces a row automatically
    // instead of it staying stuck.
    let list = transactions.filter((item) => item.is_parsed === 1);

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
          Captured automatically from notifications and your SMS inbox — nothing to trigger by hand.
        </Text>
      </View>

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

        <Pressable style={[styles.primaryButton, styles.primaryButtonStandalone]} onPress={refresh}>
          <Text style={styles.primaryButtonText}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyBody}>
              Grant notification access (in Profile) and send or receive M-Pesa — it'll show up
              here automatically, with history backfilled from SMS in the background.
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
  primaryButton: {
    // flex:1 here is only meaningful in modalActions (a row, shared 50/50
    // with Cancel) — the standalone Refresh button below overrides it with
    // primaryButtonStandalone, or flex:1 on a lone column child collapses
    // its own content height to 0 (no row sibling to share the axis with).
    flex: 1,
    backgroundColor: '#1E1B18',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButtonStandalone: {
    flex: 0,
    alignSelf: 'stretch',
  },
  primaryButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
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
