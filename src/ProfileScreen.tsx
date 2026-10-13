import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  BudgetRow,
  deleteBudget,
  getBudgets,
  getSetting,
  setSetting,
  upsertBudget,
} from './db';
import { getCategoryBreakdown } from './analytics';
import SyncHealthCard from './SyncHealthCard';
import { useSmsPermission } from './hooks/useSmsPermission';

const PAYDAY_KEY = 'payday_day';

// These double as both the display label AND the `category` budgets are
// matched against (upsertBudget defaults category to label) — so each one
// must exactly match a real transaction category, e.g. "Electricity" (what
// KPLC gets consolidated into), not a parenthetical display name like
// "KPLC (Electricity)" that no transaction's category will ever equal.
const SUGGESTIONS = ['Rent', 'Electricity', 'Water', 'Internet', 'Loan repayment'];

export default function ProfileScreen() {
  const [payday, setPayday] = useState('');
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [spentByCategory, setSpentByCategory] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'FIXED' | 'LOAN'>('FIXED');
  const [saving, setSaving] = useState(false);
  const smsPermission = useSmsPermission();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const [savedPayday, allBudgets, categoryTotals] = await Promise.all([
        getSetting(PAYDAY_KEY),
        getBudgets(),
        getCategoryBreakdown(now.getMonth() + 1, now.getFullYear()),
      ]);
      setPayday(savedPayday ?? '');
      setBudgets(allBudgets);
      setSpentByCategory(new Map(categoryTotals.map((c) => [c.category, c.total])));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSavePayday(value: string) {
    setPayday(value);
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 31) {
      await setSetting(PAYDAY_KEY, String(parsed));
    }
  }

  async function handleAddBudget() {
    const parsedAmount = Number.parseFloat(amount);
    if (!label.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Missing fields', 'Give the item a name and an amount greater than 0.');
      return;
    }

    setSaving(true);
    try {
      await upsertBudget({ label: label.trim(), amount: parsedAmount, kind });
      setLabel('');
      setAmount('');
      setKind('FIXED');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(item: BudgetRow) {
    Alert.alert('Remove budget item?', item.label, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteBudget(item.id);
          await refresh();
        },
      },
    ]);
  }

  const totalBudgeted = budgets.reduce((sum, b) => sum + b.amount, 0);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Profile</Text>
          <Text style={styles.title}>Budget setup</Text>
          <Text style={styles.subtitle}>
            Set your payday and the fixed costs you cover every month. This month's spending
            against each item is pulled from your categorized transactions below.
          </Text>
        </View>

        <SyncHealthCard />

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

        {smsPermission.status !== 'granted' && smsPermission.status !== 'unsupported' && (
          <Pressable style={styles.linkButton} onPress={() => smsPermission.request()}>
            <Text style={styles.linkButtonText}>
              {smsPermission.status === 'blocked'
                ? 'SMS access blocked — enable it in system settings'
                : 'Grant SMS access (for history backfill)'}
            </Text>
          </Pressable>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Payday</Text>
          <Text style={styles.cardHint}>Day of the month you usually get paid (1–31).</Text>
          <TextInput
            value={payday}
            onChangeText={handleSavePayday}
            placeholder="e.g. 28"
            placeholderTextColor="#8C7F73"
            keyboardType="number-pad"
            maxLength={2}
            style={[styles.input, styles.paydayInput]}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Add a fixed monthly cost</Text>
          <Text style={styles.cardHint}>Rent, KPLC, loan repayments — anything with a predictable amount.</Text>

          <View style={styles.suggestionRow}>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} style={styles.suggestionPill} onPress={() => setLabel(s)}>
                <Text style={styles.suggestionText}>{s}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Name (e.g. Rent)"
            placeholderTextColor="#8C7F73"
            style={styles.input}
          />
          <View style={styles.formRow}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="Amount (Ksh)"
              placeholderTextColor="#8C7F73"
              keyboardType="numeric"
              style={[styles.input, styles.formRowItem]}
            />
            <Pressable
              style={[styles.kindPill, kind === 'LOAN' && styles.kindPillActive]}
              onPress={() => setKind(kind === 'LOAN' ? 'FIXED' : 'LOAN')}
            >
              <Text style={[styles.kindPillText, kind === 'LOAN' && styles.kindPillTextActive]}>
                {kind === 'LOAN' ? 'Loan' : 'Fixed'}
              </Text>
            </Pressable>
          </View>

          <Pressable style={styles.primaryButton} onPress={handleAddBudget} disabled={saving}>
            <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Add to budget'}</Text>
          </Pressable>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.cardLabel}>Your monthly budget</Text>
          <Text style={styles.totalText}>Ksh {totalBudgeted.toLocaleString()} / month</Text>
        </View>

        {!loading && budgets.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.cardHint}>
              No budget items yet — add rent, KPLC, or a loan repayment above to start tracking
              against them.
            </Text>
          </View>
        )}

        {budgets.map((item) => {
          const spent = spentByCategory.get(item.category) ?? 0;
          const pct = item.amount > 0 ? Math.min(999, (spent / item.amount) * 100) : 0;
          const over = spent > item.amount;
          return (
            <View key={item.id} style={styles.budgetCard}>
              <View style={styles.budgetHeaderRow}>
                <Text style={styles.budgetLabel}>{item.label}</Text>
                <Pressable onPress={() => handleDelete(item)} hitSlop={8}>
                  <Text style={styles.deleteText}>Remove</Text>
                </Pressable>
              </View>
              {item.kind === 'LOAN' && <Text style={styles.loanBadge}>Loan repayment</Text>}
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(100, pct)}%` },
                    over && styles.progressFillOver,
                  ]}
                />
              </View>
              <Text style={[styles.budgetMeta, over && styles.budgetMetaOver]}>
                Ksh {spent.toLocaleString()} spent of Ksh {item.amount.toLocaleString()} budgeted this month
                {over ? ' — over budget' : ''}
              </Text>
            </View>
          );
        })}

        <View style={styles.futureNote}>
          <Text style={styles.futureNoteText}>
            Coming later: detecting loan repayments automatically from M-Pesa messages instead of
            entering them by hand here.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F1EA',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 14,
  },
  linkButtonText: {
    color: '#8A6A3C',
    fontWeight: '700',
    fontSize: 13,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 12,
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
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  subtitle: {
    color: '#4E463E',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#FFFDF9',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E3D8CA',
    marginBottom: 14,
  },
  cardLabel: {
    color: '#1E1B18',
    fontSize: 15,
    fontWeight: '800',
  },
  cardHint: {
    color: '#6B5E52',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFFFF',
    color: '#1E1B18',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  paydayInput: {
    width: 100,
    marginBottom: 0,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  suggestionPill: {
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  suggestionText: {
    color: '#4E463E',
    fontSize: 12,
    fontWeight: '600',
  },
  formRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  formRowItem: {
    flex: 1,
  },
  kindPill: {
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  kindPillActive: {
    backgroundColor: '#1E1B18',
    borderColor: '#1E1B18',
  },
  kindPillText: {
    color: '#4E463E',
    fontSize: 13,
    fontWeight: '700',
  },
  kindPillTextActive: {
    color: '#FFFDF9',
  },
  primaryButton: {
    backgroundColor: '#1E1B18',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
  },
  totalText: {
    color: '#6B5E52',
    fontSize: 13,
    fontWeight: '700',
  },
  budgetCard: {
    backgroundColor: '#FFFDF9',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E3D8CA',
    marginBottom: 10,
  },
  budgetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetLabel: {
    color: '#1E1B18',
    fontSize: 15,
    fontWeight: '700',
  },
  deleteText: {
    color: '#B3413B',
    fontSize: 13,
    fontWeight: '700',
  },
  loanBadge: {
    color: '#8A6A3C',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 4,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F0E9DC',
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8A6A3C',
  },
  progressFillOver: {
    backgroundColor: '#A3453C',
  },
  budgetMeta: {
    color: '#6B5E52',
    fontSize: 12,
    marginTop: 8,
  },
  budgetMetaOver: {
    color: '#A3453C',
    fontWeight: '700',
  },
  futureNote: {
    marginTop: 10,
    paddingHorizontal: 4,
  },
  futureNoteText: {
    color: '#8C7F73',
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
