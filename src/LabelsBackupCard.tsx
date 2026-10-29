import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from './i18n';
import { getLastBackupTime, restoreNewestFromFolder, saveBackupToFolder, type BackupSummary } from './labelsBackup';

/**
 * Profile → "Your labels": save rules, categories, budgets and payday to a
 * file the user keeps, and bring them back after a reinstall. See
 * src/labelsBackup.ts for what's in the file and how restore works.
 */
export default function LabelsBackupCard() {
  const { t } = useI18n();
  const [busy, setBusy] = useState<'save' | 'restore' | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getLastBackupTime().then(setLastBackup).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const counts = (s: BackupSummary) =>
    t('labels.counts', { rules: s.rules, labels: s.labels, budgets: s.budgets });

  async function handleSave() {
    setBusy('save');
    try {
      const result = await saveBackupToFolder();
      if (result) {
        Alert.alert(t('labels.saved.title'), `${result.fileName}\n${counts(result.summary)}`);
        refresh();
      }
    } catch (error) {
      Alert.alert(t('labels.failed'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    setBusy('restore');
    try {
      const result = await restoreNewestFromFolder();
      if (result) {
        Alert.alert(t('labels.restored.title'), `${result.fileName}\n${counts(result.summary)}\n\n${t('labels.restored.hint')}`);
      }
    } catch (error) {
      Alert.alert(t('labels.failed'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('labels.title')}</Text>
      <Text style={styles.cardHint}>{t('labels.hint')}</Text>
      <Text style={styles.lastBackup}>
        {lastBackup
          ? t('labels.last', { date: new Date(lastBackup).toLocaleString() })
          : t('labels.never')}
      </Text>
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.primaryButton, busy != null && styles.buttonDisabled]}
          disabled={busy != null}
          onPress={handleSave}
        >
          {busy === 'save' ? <ActivityIndicator color="#FFFDF9" /> : <Text style={styles.primaryButtonText}>{t('labels.save')}</Text>}
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, busy != null && styles.buttonDisabled]}
          disabled={busy != null}
          onPress={handleRestore}
        >
          {busy === 'restore' ? <ActivityIndicator color="#1E1B18" /> : <Text style={styles.secondaryButtonText}>{t('labels.restore')}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    marginBottom: 8,
  },
  lastBackup: {
    color: '#4E463E',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  buttonRow: {
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
    borderWidth: 1,
    borderColor: '#1E1B18',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#1E1B18',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
