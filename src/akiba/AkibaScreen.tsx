import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AKIBA_MODEL_SIZE } from '../ai/modelChoice.ts';
import { AKIBA_MODELS } from '../ai/qvac.ts';
import { formatUsdt, formatUsdtExact } from './conversion.ts';
import { agentStatus, downloadModel, isModelDownloaded } from './runner.ts';
import { aiRunSummary, enableAkiba, getEnabledSince, getProposals, getRate, transition, type SweepRow } from './store.ts';
import { DEMO_MODE } from '../demo/mode';
import { injectDemoSms, loadDemoInbox, resetDemoData, type DemoInjection } from '../demo/loadDemo.ts';
import WalletPanel, { confirmWithFingerprint } from '../wallet/WalletPanel';
import { WALLET_SIGNER, walletConfigured } from '../wallet/WalletProvider';
import { syncLaptopSweeps } from '../wallet/laptopSync';
import { explorerTxUrl } from '../wallet/config';
import { useI18n, type StringKey } from '../i18n';
import type { BreakdownItem } from './planner.ts';

export default function AkibaScreen() {
  const [proposals, setProposals] = useState<SweepRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [download, setDownload] = useState<number | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof aiRunSummary>> | null>(null);
  const [rate, setRate] = useState<Awaited<ReturnType<typeof getRate>>>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState(agentStatus());
  const { t } = useI18n();

  const refresh = useCallback(async () => {
    const [p, since, ready, s, r] = await Promise.all([getProposals(), getEnabledSince(), isModelDownloaded(), aiRunSummary(), getRate()]);
    setProposals(p);
    setEnabled(since != null);
    setModelReady(ready);
    setStats(s);
    setRate(r);
    setAgent(agentStatus());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      // Proposals are written by the background loop; poll while visible.
      const t = setInterval(refresh, 3000);
      // Laptop signer: notice approved sweeps that landed on-chain.
      const sync = () =>
        void syncLaptopSweeps()
          .then((n) => {
            if (n) refresh();
          })
          .catch(() => {});
      const s = WALLET_SIGNER === 'laptop' ? setInterval(sync, 15_000) : null;
      if (s) sync();
      return () => {
        clearInterval(t);
        if (s) clearInterval(s);
      };
    }, [refresh])
  );

  async function startDownload() {
    setError(null);
    setDownload(0);
    try {
      await downloadModel((p) => setDownload(p));
      await refresh();
    } catch (e) {
      setError(t('akiba.ai.failed', { error: String(e) }));
    } finally {
      setDownload(null);
    }
  }

  async function approve(row: SweepRow) {
    if (!(await confirmWithFingerprint(t('akiba.approvePrompt', { amount: row.amount_kes.toLocaleString() })))) return;
    await transition(row.id, 'approve');
    refresh();
  }

  async function decline(row: SweepRow) {
    await transition(row.id, 'decline');
    refresh();
  }

  function confirmReset() {
    Alert.alert(t('akiba.demo.reset.title'), t('akiba.demo.reset.body'), [
      { text: t('card.decline'), style: 'cancel' },
      { text: t('akiba.demo.reset'), style: 'destructive', onPress: () => demo('reset') },
    ]);
  }

  async function demo(action: 'load' | 'reset' | DemoInjection) {
    setDemoBusy(true);
    setError(null);
    try {
      if (action === 'load') await loadDemoInbox();
      else if (action === 'reset') await resetDemoData();
      else await injectDemoSms(action);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.kicker}>
            {t('akiba.kicker')}
            {DEMO_MODE ? t('akiba.demoKicker') : ''}
          </Text>
          <Text style={styles.title}>{t('akiba.title')}</Text>
          <Text style={styles.subtitle}>{t('akiba.subtitle')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>{t('akiba.ai.title')}</Text>
          {modelReady ? (
            <Text style={styles.hint}>
              {t('akiba.ai.ready', { model: AKIBA_MODELS[AKIBA_MODEL_SIZE].name })}
              {stats?.runs ? t('akiba.ai.stats', { runs: stats.runs, secs: (stats.medianMs! / 1000).toFixed(1) }) : ''}
            </Text>
          ) : (
            <>
              <Text style={styles.hint}>{t('akiba.ai.download.hint', { size: AKIBA_MODELS[AKIBA_MODEL_SIZE].downloadSize })}</Text>
              <Pressable style={styles.button} onPress={startDownload} disabled={download != null}>
                <Text style={styles.buttonText}>
                  {download != null ? t('akiba.ai.downloading', { pct: download.toFixed(0) }) : t('akiba.ai.download')}
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {!enabled && !DEMO_MODE && (
          <Pressable style={[styles.button, styles.spaced]} onPress={() => enableAkiba(Date.now()).then(refresh)}>
            <Text style={styles.buttonText}>{t('akiba.enable')}</Text>
          </Pressable>
        )}

        {DEMO_MODE && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('akiba.demo.title')}</Text>
            <Text style={styles.hint}>{t('akiba.demo.hint')}</Text>
            <View style={styles.pills}>
              {(['load', 'loan', 'salary', 'reversal'] as const).map((a) => (
                <Pressable key={a} style={styles.pill} onPress={() => demo(a)} disabled={demoBusy}>
                  <Text style={styles.pillText}>{t(`akiba.demo.${a}`)}</Text>
                </Pressable>
              ))}
              <Pressable style={styles.pill} onPress={confirmReset} disabled={demoBusy}>
                <Text style={styles.pillText}>{t('akiba.demo.reset')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {proposals.map((p) => (
          <ProposalCard key={p.id} row={p} onApprove={() => approve(p)} onDecline={() => decline(p)} />
        ))}
        {agent.busy && <Text style={styles.hint}>{t('akiba.thinking')}</Text>}
        {agent.lastError && <Text style={styles.error}>{t('akiba.agentError', { error: agent.lastError })}</Text>}
        {enabled && proposals.length === 0 && !agent.busy && (
          <Text style={styles.hint}>{t('akiba.empty')}</Text>
        )}

        {walletConfigured() ? (
          <WalletPanel onSent={refresh} />
        ) : WALLET_SIGNER === 'laptop' ? (
          <LaptopSignerCard proposals={proposals} />
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>{t('akiba.noWallet.title')}</Text>
            <Text style={styles.hint}>{t('akiba.noWallet.hint')}</Text>
          </View>
        )}

        <Text style={styles.footnote}>
          {rate ? t('akiba.footnote.rate', { rate: rate.kesPerUsdt, date: rate.rateDate }) : ''}
          {t('akiba.footnote')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Testnet stopgap while the in-app WDK worklet can't start next to QVAC:
 * shows the self-custodial wallet's public addresses and, for each approved
 * sweep, the exact laptop command that signs it. The AI decision and the
 * approval still happen on the phone, offline.
 */
function LaptopSignerCard({ proposals }: { proposals: SweepRow[] }) {
  const approved = proposals.filter((p) => p.status === 'approved' && p.amount_usdt_base);
  const { t } = useI18n();
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{t('wallet.title')}</Text>
      <Text style={styles.hint}>{t('wallet.laptop.hint')}</Text>
      <Text style={styles.small}>{t('wallet.spending')}</Text>
      <Text style={styles.address} selectable>{process.env.EXPO_PUBLIC_SPENDING_ADDRESS ?? '–'}</Text>
      <Text style={styles.small}>{t('wallet.savings')}</Text>
      <Text style={styles.address} selectable>{process.env.EXPO_PUBLIC_SAVINGS_ADDRESS ?? '–'}</Text>
      {approved.length > 0 && (
        <>
          <Text style={[styles.label, styles.topGap]}>{t('wallet.waiting')}</Text>
          {approved.map((p) => (
            <Text key={p.id} style={styles.command} selectable>
              npm run wallet -- sweep {formatUsdtExact(p.amount_usdt_base!)}
            </Text>
          ))}
        </>
      )}
    </View>
  );
}

function ProposalCard({ row, onApprove, onDecline }: { row: SweepRow; onApprove: () => void; onDecline: () => void }) {
  const [open, setOpen] = useState(false);
  const { lang, t } = useI18n();
  const breakdown: BreakdownItem[] = JSON.parse(row.breakdown_json);
  const skip = row.amount_kes <= 0;
  const source = (s: string) => t(s === 'ai' ? 'source.ai' : 'source.rule');
  const status =
    row.status === 'approved' && WALLET_SIGNER === 'laptop' ? t('status.approvedLaptop') : t(`status.${row.status}` as StringKey);
  return (
    <View style={styles.card}>
      <Text style={styles.small}>
        {t('card.from', { amount: row.income_kes.toLocaleString(), who: row.counterparty })}
      </Text>
      <Text style={styles.label}>
        {t(`label.${row.income_label}` as StringKey)}
        <Text style={styles.source}> · {source(row.label_source)}</Text>
      </Text>

      <Text style={styles.amount}>{skip ? t('card.saveNothing') : t('card.save', { amount: row.amount_kes.toLocaleString() })}</Text>
      {!skip && row.amount_usdt_base && (
        <Text style={styles.hint}>{t('card.usdt', { usdt: formatUsdt(row.amount_usdt_base), date: row.rate_date ?? '' })}</Text>
      )}
      {/* Both languages are stored; show the one chosen in Profile. */}
      <Text style={styles.reason}>{lang === 'sw' ? row.reason_sw : row.reason_en}</Text>
      <Text style={styles.source}>
        {t('card.strategy', {
          strategy: t(`strategy.${row.strategy}` as StringKey),
          source: source(row.strategy_source),
          capped: row.overridden ? t('card.capped') : '',
        })}
      </Text>

      <Pressable onPress={() => setOpen(!open)}>
        <Text style={styles.link}>{open ? t('card.hide') : t('card.why')}</Text>
      </Pressable>
      {open && (
        <View style={styles.breakdown}>
          {breakdown.map((b) => (
            <View key={b.label} style={styles.bRow}>
              <Text style={styles.bLabel}>{b.key ? t(`breakdown.${b.key}`, { days: b.days ?? '' }) : b.label}</Text>
              <Text style={styles.bValue}>{b.kes.toLocaleString()}</Text>
            </View>
          ))}
          <View style={styles.bRow}>
            <Text style={[styles.bLabel, styles.bold]}>{t('card.safeMax')}</Text>
            <Text style={[styles.bValue, styles.bold]}>{row.max_safe_kes.toLocaleString()}</Text>
          </View>
        </View>
      )}

      {row.status === 'proposed' ? (
        <View style={styles.actions}>
          <Pressable style={[styles.button, styles.flex]} onPress={onApprove}>
            <Text style={styles.buttonText}>{t('card.approve')}</Text>
          </Pressable>
          <Pressable style={[styles.secondary, styles.flex]} onPress={onDecline}>
            <Text style={styles.secondaryText}>{t('card.decline')}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.status, row.status === 'failed' && styles.error]}>
          {status}
          {row.error ? ` (${row.error})` : ''}
        </Text>
      )}
      {row.tx_hash && (
        <Pressable onPress={() => Linking.openURL(explorerTxUrl(row.tx_hash!))}>
          <Text style={styles.link}>{t('card.etherscan')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F1EA' },
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
  header: { paddingTop: 12, paddingBottom: 12 },
  kicker: { color: '#8A6A3C', fontSize: 12, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 },
  title: { color: '#1E1B18', fontSize: 30, lineHeight: 36, fontWeight: '900' },
  subtitle: { color: '#4E463E', fontSize: 14, lineHeight: 20, marginTop: 8 },
  card: { backgroundColor: '#FFFDF9', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#E3D8CA', marginBottom: 14 },
  label: { color: '#1E1B18', fontSize: 15, fontWeight: '800' },
  small: { color: '#6B5E52', fontSize: 12, marginBottom: 4 },
  source: { color: '#8C7F73', fontSize: 12, fontWeight: '600' },
  hint: { color: '#6B5E52', fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  amount: { color: '#1E1B18', fontSize: 24, fontWeight: '900', marginTop: 10 },
  reason: { color: '#1E1B18', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 6 },
  link: { color: '#8A6A3C', fontWeight: '700', marginTop: 8 },
  breakdown: { marginTop: 8, padding: 10, backgroundColor: '#F7F2EA', borderRadius: 10 },
  bRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  bLabel: { color: '#4E463E', fontSize: 13 },
  bValue: { color: '#1E1B18', fontSize: 13, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  flex: { flex: 1 },
  button: { backgroundColor: '#1E1B18', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center' },
  buttonText: { color: '#FFFDF9', fontWeight: '800' },
  secondary: { borderWidth: 1, borderColor: '#D8CCBC', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: '#1E1B18', fontWeight: '700' },
  spaced: { marginBottom: 14 },
  status: { color: '#2F6B3B', fontWeight: '800', marginTop: 12 },
  error: { color: '#A3362A', fontSize: 13, marginBottom: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderColor: '#D8CCBC', backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  pillText: { color: '#1E1B18', fontWeight: '700', fontSize: 13 },
  address: { color: '#4E463E', fontSize: 12, fontFamily: 'monospace', marginBottom: 8 },
  command: { color: '#1E1B18', fontSize: 12, fontFamily: 'monospace', backgroundColor: '#F7F2EA', padding: 8, borderRadius: 8, marginTop: 6 },
  topGap: { marginTop: 10 },
  footnote: { color: '#8C7F73', fontSize: 12, lineHeight: 17, marginTop: 4 },
});
