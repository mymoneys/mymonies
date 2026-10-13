import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { addRule, ConditionField, ConditionOperator, deleteRule, getAllRules, Rule } from './rules';
import { applyCategoryGroupMap, consolidateElectricityCategory, normalizeGroupCasing } from './groupMapping';

const FIELD_OPTIONS: { value: ConditionField; label: string }[] = [
  { value: 'counterpartyName', label: 'Counterparty Name' },
  { value: 'counterpartyNumber', label: 'Counterparty Number' },
  { value: 'accountNumber', label: 'Account Number' },
];

const OPERATOR_OPTIONS: { value: ConditionOperator; label: string }[] = [
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'EQUALS', label: 'Equals' },
];

function fieldLabel(value: ConditionField): string {
  return FIELD_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function operatorLabel(value: ConditionOperator): string {
  return OPERATOR_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// A row of Pressable pills instead of @react-native-picker/picker — avoids
// adding a native dependency (and another prebuild/device install) for what
// is only ever 2-3 options.
function OptionPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.pickerRow}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={[styles.pickerPill, selected && styles.pickerPillSelected]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.pickerPillText, selected && styles.pickerPillTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RulesScreen() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [conditionField, setConditionField] = useState<ConditionField>('counterpartyNumber');
  const [conditionOperator, setConditionOperator] = useState<ConditionOperator>('CONTAINS');
  const [conditionValue, setConditionValue] = useState('');
  const [targetCategory, setTargetCategory] = useState('');
  const [targetGroup, setTargetGroup] = useState('');
  const [priority, setPriority] = useState('1');
  const [saving, setSaving] = useState(false);
  const [groupingByCategory, setGroupingByCategory] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getAllRules();
      setRules(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSave() {
    if (!conditionValue.trim() || !targetCategory.trim() || !targetGroup.trim()) {
      Alert.alert('Missing fields', 'Condition value, category, and group are all required.');
      return;
    }

    const parsedPriority = Number.parseInt(priority, 10);

    setSaving(true);
    try {
      await addRule({
        conditionField,
        conditionOperator,
        conditionValue: conditionValue.trim(),
        targetCategory: targetCategory.trim(),
        targetGroup: targetGroup.trim(),
        priority: Number.isNaN(parsedPriority) ? 1 : parsedPriority,
      });
      setConditionValue('');
      setTargetCategory('');
      setTargetGroup('');
      setPriority('1');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyGroupMap() {
    setGroupingByCategory(true);
    try {
      const result = await applyCategoryGroupMap();
      const electricity = await consolidateElectricityCategory();
      const casing = await normalizeGroupCasing();
      await refresh();

      const totalTx = result.transactionsUpdated + electricity.transactionsUpdated + casing.transactionsUpdated;
      const totalBudgets = result.budgetsUpdated + electricity.budgetsUpdated + casing.budgetsUpdated;
      const totalRules = result.rulesUpdated + electricity.rulesUpdated + casing.rulesUpdated;
      const casingNote =
        casing.merged.length > 0
          ? ` Merged case-duplicate groups: ${casing.merged.map((m) => `"${m.from}"→"${m.into}"`).join(', ')}.`
          : '';

      Alert.alert(
        'Groups applied',
        `${totalTx} transaction(s), ${totalBudgets} budget item(s), and ${totalRules} rule(s) regrouped ` +
          `into Household, Travel, Electronics, Education, Social, Foodstuff, and Snacks/Drinks ` +
          `(KPLC folded into Electricity/Household${electricity.ruleAdded ? ', Kenya Power rule added' : ''}).` +
          casingNote
      );
    } catch (error) {
      Alert.alert('Grouping failed', error instanceof Error ? error.message : String(error));
    } finally {
      setGroupingByCategory(false);
    }
  }

  function handleDelete(rule: Rule) {
    Alert.alert('Delete rule?', `IF ${fieldLabel(rule.conditionField)} ${operatorLabel(rule.conditionOperator)} "${rule.conditionValue}"`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteRule(rule.id);
          await refresh();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Categorization</Text>
        <Text style={styles.title}>Rules</Text>
        <Text style={styles.subtitle}>
          New transactions are categorized automatically (built in, no setup needed). Rules you
          add here take priority over that — they run in order (lowest first), and the first
          match wins.
        </Text>
      </View>

      <Pressable style={styles.importButton} onPress={handleApplyGroupMap} disabled={groupingByCategory}>
        <Text style={styles.importButtonText}>
          {groupingByCategory ? 'Applying…' : 'Apply super-groups (Household, Travel, etc.)'}
        </Text>
      </Pressable>

      <View style={styles.form}>
        <Text style={styles.formLabel}>If</Text>
        <OptionPicker options={FIELD_OPTIONS} value={conditionField} onChange={setConditionField} />

        <Text style={styles.formLabel}>Operator</Text>
        <OptionPicker options={OPERATOR_OPTIONS} value={conditionOperator} onChange={setConditionOperator} />

        <Text style={styles.formLabel}>Value</Text>
        <TextInput
          value={conditionValue}
          onChangeText={setConditionValue}
          placeholder="e.g. 0700000000 or KPLC"
          placeholderTextColor="#8C7F73"
          style={styles.input}
        />

        <View style={styles.formRow}>
          <View style={styles.formRowItem}>
            <Text style={styles.formLabel}>Category</Text>
            <TextInput
              value={targetCategory}
              onChangeText={setTargetCategory}
              placeholder="Electricity"
              placeholderTextColor="#8C7F73"
              style={styles.input}
            />
          </View>
          <View style={styles.formRowItem}>
            <Text style={styles.formLabel}>Group</Text>
            <TextInput
              value={targetGroup}
              onChangeText={setTargetGroup}
              placeholder="Household"
              placeholderTextColor="#8C7F73"
              style={styles.input}
            />
          </View>
        </View>

        <Text style={styles.formLabel}>Priority (lower runs first)</Text>
        <TextInput
          value={priority}
          onChangeText={setPriority}
          placeholder="1"
          placeholderTextColor="#8C7F73"
          keyboardType="number-pad"
          style={styles.input}
        />

        <Pressable style={styles.primaryButton} onPress={handleSave} disabled={saving}>
          <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save rule'}</Text>
        </Pressable>
      </View>

      <FlatList
        data={rules}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={refresh}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No custom rules yet</Text>
            <Text style={styles.emptyBody}>
              Transactions are still categorized automatically — add a rule here only when you
              want to override the built-in guess for a specific sender.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardRule}>
                IF {fieldLabel(item.conditionField)} {operatorLabel(item.conditionOperator)} "
                {item.conditionValue}"
              </Text>
              <Pressable onPress={() => handleDelete(item)} hitSlop={8}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
            <Text style={styles.cardTarget}>
              THEN Category: "{item.targetCategory}" · Group: "{item.targetGroup}"
            </Text>
            <Text style={styles.cardMeta}>Priority {item.priority}</Text>
          </View>
        )}
      />
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
  importButton: {
    backgroundColor: '#E7DDCF',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 14,
  },
  importButtonText: {
    color: '#2F2924',
    fontWeight: '700',
    fontSize: 13,
  },
  form: {
    backgroundColor: '#FFFDF9',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E3D8CA',
    marginBottom: 14,
    gap: 4,
  },
  formLabel: {
    color: '#6B5E52',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 6,
  },
  formRow: {
    flexDirection: 'row',
    gap: 10,
  },
  formRowItem: {
    flex: 1,
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
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  primaryButton: {
    backgroundColor: '#1E1B18',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
  },
  list: {
    paddingBottom: 12,
    gap: 10,
  },
  card: {
    backgroundColor: '#FFFDF9',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E3D8CA',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardRule: {
    flex: 1,
    color: '#1E1B18',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteText: {
    color: '#B3413B',
    fontSize: 13,
    fontWeight: '700',
  },
  cardTarget: {
    color: '#4E463E',
    fontSize: 13,
    marginTop: 6,
  },
  cardMeta: {
    color: '#887B6E',
    fontSize: 12,
    marginTop: 6,
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
