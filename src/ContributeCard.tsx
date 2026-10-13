import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  addContributeSender,
  getContributeSenders,
  getReadyContributionCount,
  isContributeEnabled,
  removeContributeSender,
  setContributeEnabled,
} from './contributions';
import { getInboxSenders, InboxSender } from './smsInbox';
import ContributeReviewModal from './ContributeReviewModal';

const COUNT_REFRESH_MS = 5000;

function useReadyCount(): [number, () => Promise<void>] {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    setCount(await getReadyContributionCount());
  }, []);
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, COUNT_REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh]);
  return [count, refresh];
}

/**
 * Profile → "Help improve MyMonies": the opt-in switch, which extra senders
 * (banks, loan apps) to collect samples from, and the entry point to review
 * and send what's been collected.
 */
export default function ContributeCard() {
  const [enabled, setEnabled] = useState(false);
  const [senders, setSenders] = useState<string[]>([]);
  const [inboxSenders, setInboxSenders] = useState<InboxSender[]>([]);
  const [newSender, setNewSender] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [readyCount, refreshCount] = useReadyCount();

  const refresh = useCallback(async () => {
    const [isOn, list] = await Promise.all([isContributeEnabled(), getContributeSenders()]);
    setEnabled(isOn);
    setSenders(list);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    getInboxSenders().then(setInboxSenders).catch(() => setInboxSenders([]));
  }, [enabled]);

  function handleToggle(value: boolean) {
    if (value) {
      setContributeEnabled(true).then(refresh);
      return;
    }
    Alert.alert('Stop helping?', "Messages collected but not yet sent will be deleted from this phone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: async () => {
          await setContributeEnabled(false);
          await Promise.all([refresh(), refreshCount()]);
        },
      },
    ]);
  }

  async function handleAdd(sender: string) {
    if (!sender.trim()) return;
    await addContributeSender(sender);
    setNewSender('');
    await refresh();
  }

  async function handleRemove(sender: string) {
    await removeContributeSender(sender);
    await Promise.all([refresh(), refreshCount()]);
  }

  const suggestions = inboxSenders.filter((s) => !senders.includes(s.address)).slice(0, 12);

  return (
    <View style={styles.card}>
      <View style={styles.toggleRow}>
        <Text style={styles.cardLabel}>Help improve MyMonies</Text>
        <Switch value={enabled} onValueChange={handleToggle} trackColor={{ true: '#8A6A3C' }} />
      </View>
      <Text style={styles.cardHint}>
        Collects M-Pesa messages the app couldn't understand, plus messages from banks or loan apps
        you pick below, so we can add support for them. Names, numbers and amounts are scrubbed on
        your phone, and nothing is sent until you review it and tap send.
      </Text>

      {enabled && (
        <>
          <Text style={styles.sectionLabel}>Also collect from</Text>
          {senders.length === 0 && <Text style={styles.cardHint}>Only M-Pesa for now.</Text>}
          <View style={styles.pillRow}>
            {senders.map((s) => (
              <Pressable key={s} style={[styles.pill, styles.pillActive]} onPress={() => handleRemove(s)}>
                <Text style={[styles.pillText, styles.pillTextActive]}>{s}  ✕</Text>
              </Pressable>
            ))}
          </View>

          {suggestions.length > 0 && (
            <>
              <Text style={styles.sectionHint}>Senders in your inbox — tap to add</Text>
              <View style={styles.pillRow}>
                {suggestions.map((s) => (
                  <Pressable key={s.address} style={styles.pill} onPress={() => handleAdd(s.address)}>
                    <Text style={styles.pillText}>
                      {s.address} · {s.count}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <View style={styles.addRow}>
            <TextInput
              value={newSender}
              onChangeText={setNewSender}
              placeholder="Sender name, e.g. KCB"
              placeholderTextColor="#8C7F73"
              autoCapitalize="characters"
              style={styles.input}
              onSubmitEditing={() => handleAdd(newSender)}
            />
            <Pressable style={styles.addButton} onPress={() => handleAdd(newSender)}>
              <Text style={styles.addButtonText}>Add</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.primaryButton, readyCount === 0 && styles.primaryButtonDisabled]}
            disabled={readyCount === 0}
            onPress={() => setReviewing(true)}
          >
            <Text style={styles.primaryButtonText}>
              {readyCount === 0 ? 'Nothing to send yet' : `Review & send ${readyCount} message${readyCount === 1 ? '' : 's'}`}
            </Text>
          </Pressable>
        </>
      )}

      <ContributeReviewModal
        visible={reviewing}
        onClose={() => {
          setReviewing(false);
          refreshCount();
        }}
      />
    </View>
  );
}

/** Dashboard nudge — only shows when the user opted in and something's waiting. */
export function ContributeBanner() {
  const [enabled, setEnabled] = useState(false);
  const [readyCount, refreshCount] = useReadyCount();
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    isContributeEnabled().then(setEnabled);
  }, [readyCount]);

  if (!enabled || readyCount === 0) return null;

  return (
    <>
      <Pressable style={styles.banner} onPress={() => setReviewing(true)}>
        <Text style={styles.bannerText}>
          {readyCount} message{readyCount === 1 ? '' : 's'} could improve MyMonies — review & send
        </Text>
        <Text style={styles.bannerArrow}>›</Text>
      </Pressable>
      <ContributeReviewModal
        visible={reviewing}
        onClose={() => {
          setReviewing(false);
          refreshCount();
        }}
      />
    </>
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
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  sectionLabel: {
    color: '#1E1B18',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionHint: {
    color: '#6B5E52',
    fontSize: 12,
    marginBottom: 6,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillActive: {
    backgroundColor: '#1E1B18',
    borderColor: '#1E1B18',
  },
  pillText: {
    color: '#4E463E',
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#FFFDF9',
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFFFF',
    color: '#1E1B18',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  addButton: {
    borderWidth: 1,
    borderColor: '#D8CCBC',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#4E463E',
    fontWeight: '700',
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: '#1E1B18',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: '#B5AA9D',
  },
  primaryButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FBF0E4',
    borderColor: '#E8C9A0',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 14,
  },
  bannerText: {
    flex: 1,
    color: '#4E463E',
    fontSize: 13,
    fontWeight: '600',
  },
  bannerArrow: {
    color: '#8A6A3C',
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
  },
});
