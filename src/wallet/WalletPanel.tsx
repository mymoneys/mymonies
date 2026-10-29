import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAccount, useWalletManager, useWdkApp } from '@tetherto/wdk-react-native-core';
import { SAVINGS_ACCOUNT, SPENDING_ACCOUNT, WALLET_ID, explorerTxUrl, testTokenAddress, testUsdt } from './config';
import { sepoliaReachable } from './network';
import { resolveUserOpTxHash } from './sepolia';
import { formatUsdt } from '../akiba/conversion.ts';
import { getSendable, transition } from '../akiba/store.ts';
import { isAkibaModelLoaded } from '../ai/qvac.ts';
import { useI18n } from '../i18n';

const SEND_LOOP_MS = 15_000;

export async function confirmWithFingerprint(prompt: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: 'Cancel' });
  return result.success;
}

/**
 * Wallet status, the two account addresses and balances, plus the loop that
 * pushes approved sweeps to Sepolia. Rendered only inside WalletProvider.
 */
export default function WalletPanel({ onSent }: { onSent: () => void }) {
  const { state } = useWdkApp();
  const { createWallet, unlock } = useWalletManager();
  const spending = useAccount({ network: 'ethereum', accountIndex: SPENDING_ACCOUNT });
  const savings = useAccount({ network: 'ethereum', accountIndex: SAVINGS_ACCOUNT });
  const [balances, setBalances] = useState<{ spending: string; savings: string } | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const { t } = useI18n();
  const token = testTokenAddress()!;

  const refreshBalances = useCallback(async () => {
    if (state.status !== 'READY') return;
    const usdt = testUsdt(token);
    const [a, b] = await Promise.all([spending.getBalance([usdt]), savings.getBalance([usdt])]);
    const pick = (r: typeof a) => (r[0] && 'balance' in r[0] && r[0].balance ? String(r[0].balance) : '0');
    setBalances({ spending: formatUsdt(pick(a)), savings: formatUsdt(pick(b)) });
  }, [state.status, spending, savings, token]);

  const sendApproved = useCallback(async () => {
    if (sending.current || state.status !== 'READY' || !savings.address) return;
    // Never sign while the LLM is resident: one heavy runtime at a time.
    if (isAkibaModelLoaded()) return;
    sending.current = true;
    try {
      const queue = await getSendable();
      if (!queue.length) return;
      const isOnline = await sepoliaReachable();
      setOnline(isOnline);
      for (const sweep of queue) {
        if (!sweep.amount_usdt_base || sweep.amount_usdt_base === '0') continue;
        if (!isOnline) {
          if (sweep.status === 'approved') await transition(sweep.id, 'offline');
          continue;
        }
        await transition(sweep.id, sweep.status === 'approved' ? 'send' : sweep.status === 'queued_offline' ? 'online' : 'retry');
        // Destination is always our own savings account — never from the model.
        const result = await spending.send({ to: savings.address, asset: testUsdt(token), amount: sweep.amount_usdt_base });
        if (result.success) {
          // result.hash is the UserOperation hash; store the real tx hash when known.
          const txHash = (await resolveUserOpTxHash(result.hash)) ?? result.hash;
          await transition(sweep.id, 'ok', { txHash });
          setLastTx(txHash);
        } else {
          await transition(sweep.id, 'error', { error: result.error ?? 'Send failed' });
        }
      }
      await refreshBalances();
      onSent();
    } finally {
      sending.current = false;
    }
  }, [state.status, savings.address, spending, token, refreshBalances, onSent]);

  useEffect(() => {
    sendApproved();
    refreshBalances();
    const t = setInterval(sendApproved, SEND_LOOP_MS);
    return () => clearInterval(t);
  }, [sendApproved, refreshBalances]);

  async function create() {
    if (!(await confirmWithFingerprint(t('wallet.createPrompt')))) return;
    setBusy(true);
    try {
      await createWallet(WALLET_ID);
    } finally {
      setBusy(false);
    }
  }

  async function open() {
    setBusy(true);
    try {
      await unlock(state.status === 'LOCKED' ? state.walletId : WALLET_ID);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{t('wallet.title')}</Text>
      {state.status === 'INITIALIZING' || state.status === 'REINITIALIZING' ? (
        <Text style={styles.hint}>{t('wallet.starting')}</Text>
      ) : state.status === 'ERROR' ? (
        <Text style={styles.error}>{t('wallet.error', { error: state.error.message })}</Text>
      ) : state.status === 'NO_WALLET' ? (
        <Pressable style={styles.button} onPress={create} disabled={busy}>
          <Text style={styles.buttonText}>{busy ? t('wallet.creating') : t('wallet.create')}</Text>
        </Pressable>
      ) : state.status === 'LOCKED' ? (
        <Pressable style={styles.button} onPress={open} disabled={busy}>
          <Text style={styles.buttonText}>{busy ? t('wallet.unlocking') : t('wallet.unlock')}</Text>
        </Pressable>
      ) : (
        <>
          <Row title={t('wallet.spending')} address={spending.address} balance={balances?.spending} />
          <Row title={t('wallet.savings')} address={savings.address} balance={balances?.savings} />
          <Text style={styles.hint}>
            {t('wallet.network', {
              state: t(online == null ? 'wallet.network.checking' : online ? 'wallet.network.online' : 'wallet.network.offline'),
            })}
          </Text>
          {lastTx && (
            <Pressable onPress={() => Linking.openURL(explorerTxUrl(lastTx))}>
              <Text style={styles.link}>{t('wallet.lastSweep')}</Text>
            </Pressable>
          )}
          <Pressable style={styles.secondary} onPress={sendApproved}>
            <Text style={styles.secondaryText}>{t('wallet.sendNow')}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function Row({ title, address, balance }: { title: string; address: string | null; balance?: string }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.address} selectable numberOfLines={1} ellipsizeMode="middle">
          {address ?? '…'}
        </Text>
      </View>
      <Text style={styles.balance}>{balance ?? '–'} USDt</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFDF9', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#E3D8CA', marginBottom: 14 },
  label: { color: '#1E1B18', fontSize: 15, fontWeight: '800', marginBottom: 10 },
  hint: { color: '#6B5E52', fontSize: 13, lineHeight: 18, marginTop: 6 },
  error: { color: '#A3362A', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EFE6DA' },
  rowTitle: { color: '#1E1B18', fontWeight: '700', fontSize: 14 },
  address: { color: '#8C7F73', fontSize: 11, marginTop: 2, marginRight: 8 },
  balance: { color: '#1E1B18', fontWeight: '800', fontSize: 15 },
  link: { color: '#8A6A3C', fontWeight: '700', marginTop: 8 },
  button: { backgroundColor: '#1E1B18', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#FFFDF9', fontWeight: '800' },
  secondary: { borderWidth: 1, borderColor: '#D8CCBC', borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  secondaryText: { color: '#1E1B18', fontWeight: '700' },
});
