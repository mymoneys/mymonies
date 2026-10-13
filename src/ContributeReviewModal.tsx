import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  ContributionRow,
  dismissContribution,
  getReadyContributions,
  sendByEmail,
  sendByWhatsApp,
  sendViaShareSheet,
  updateRedactedText,
} from './contributions';

type Props = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Last stop before anything leaves the phone: every redacted sample is shown
 * in full and editable, because the redactor is heuristic and the user is
 * the only one who can spot a name it missed.
 */
export default function ContributeReviewModal({ visible, onClose }: Props) {
  const [rows, setRows] = useState<ContributionRow[]>([]);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setRows(await getReadyContributions());
  }, []);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  async function handleSend(send: (rows: ContributionRow[]) => Promise<number>) {
    setSending(true);
    try {
      const sent = await send(rows);
      await refresh();
      if (sent > 0 && sent < rows.length) {
        Alert.alert('Sent a batch', `${sent} sent. Tap again to send the remaining ${rows.length - sent}.`);
      } else if (sent > 0) {
        onClose();
      }
    } catch (error) {
      Alert.alert("Couldn't send", error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  async function handleRemove(id: string) {
    await dismissContribution(id);
    setRows((current) => current.filter((r) => r.id !== id));
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Review before sending</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            Names, numbers, codes and amounts have been replaced automatically. Read each one —
            edit or remove anything that still looks personal.
          </Text>
        </View>

        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>Nothing waiting to be sent.</Text>}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <View style={styles.itemHeader}>
                <Text style={styles.sender}>
                  {item.sender} · {item.reason === 'unparsed_mpesa' ? 'not understood' : 'new sender'}
                </Text>
                <Pressable onPress={() => handleRemove(item.id)} hitSlop={8}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
              <TextInput
                defaultValue={item.redacted_text}
                multiline
                style={styles.textInput}
                onChangeText={(text) =>
                  setRows((current) => current.map((r) => (r.id === item.id ? { ...r, redacted_text: text } : r)))
                }
                onEndEditing={(e) => updateRedactedText(item.id, e.nativeEvent.text)}
              />
            </View>
          )}
        />

        {rows.length > 0 && (
          <View style={styles.footer}>
            <Text style={styles.footerHint}>Send {rows.length} message{rows.length === 1 ? '' : 's'} via</Text>
            <View style={styles.buttonRow}>
              <Pressable style={styles.sendButton} disabled={sending} onPress={() => handleSend(sendByEmail)}>
                <Text style={styles.sendButtonText}>Email</Text>
              </Pressable>
              <Pressable style={styles.sendButton} disabled={sending} onPress={() => handleSend(sendByWhatsApp)}>
                <Text style={styles.sendButtonText}>WhatsApp</Text>
              </Pressable>
              <Pressable
                style={[styles.sendButton, styles.sendButtonSecondary]}
                disabled={sending}
                onPress={() => handleSend(sendViaShareSheet)}
              >
                <Text style={[styles.sendButtonText, styles.sendButtonTextSecondary]}>Other app</Text>
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F1EA',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#1E1B18',
    fontSize: 22,
    fontWeight: '900',
  },
  closeText: {
    color: '#8A6A3C',
    fontWeight: '700',
    fontSize: 14,
  },
  subtitle: {
    color: '#4E463E',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  empty: {
    color: '#6B5E52',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 40,
  },
  item: {
    backgroundColor: '#FFFDF9',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E3D8CA',
    marginTop: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sender: {
    color: '#8A6A3C',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  removeText: {
    color: '#B3413B',
    fontSize: 12,
    fontWeight: '700',
  },
  textInput: {
    color: '#1E1B18',
    fontSize: 13,
    lineHeight: 19,
    borderWidth: 1,
    borderColor: '#EFE6D8',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#E3D8CA',
    backgroundColor: '#FFFDF9',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  footerHint: {
    color: '#6B5E52',
    fontSize: 12,
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sendButton: {
    flex: 1,
    backgroundColor: '#1E1B18',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  sendButtonSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8CCBC',
  },
  sendButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
    fontSize: 13,
  },
  sendButtonTextSecondary: {
    color: '#4E463E',
  },
});
