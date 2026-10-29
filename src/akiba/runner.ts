import { getSetting, setSetting } from '../db';
import { decideSweep } from './agent.ts';
import { quoteKesToUsdt } from './conversion.ts';
import { daysToPayday } from './planner.ts';
import { senderHistory } from './senderHistory.ts';
import { avgDailySpend, computeProfile } from '../plan/metrics.ts';
import { AKIBA_MODEL_SIZE } from '../ai/modelChoice.ts';
import { isAkibaModelLoaded, loadAkibaModel, makeQvacCallTool, unloadAkibaModel } from '../ai/qvac.ts';
import {
  getBufferKes,
  getEnabledSince,
  getPaydayDay,
  getRate,
  incomeBefore,
  isNeedGroup,
  logAiRun,
  metricRows,
  nextUnprocessedIncome,
  saveProposal,
  totalSavedKes,
  unpaidBudgetsKes,
} from './store.ts';

/**
 * Called from the app-wide maintenance loop (src/backgroundSync.ts) every few
 * seconds. Handles at most one new income per call, and only after Akiba is
 * switched on. The model is loaded for the run and unloaded right after:
 * on a 3.6 GB phone it must never sit in memory next to the WDK wallet.
 *
 * The model is only used once the user has downloaded it from the Akiba tab
 * (a deliberate, Wi-Fi step) — loadModel() would otherwise silently start a
 * large download (~1.1 GB for 1.7B). Without it, every decision uses the rule-based path.
 */

// Per model size, so switching sizes asks for the new download.
const MODEL_READY_KEY = `akiba_model_ready_${AKIBA_MODEL_SIZE}`;
const SURVIVAL_THRESHOLD_MONTHS = 2;
const EMERGENCY_FUND_MONTHS = 6;

let running = false;
// Read by the Akiba tab: the background loop swallows errors, and release
// builds drop console output, so this is the only place a failure shows.
let busy = false;
let lastError: string | null = null;

/** Background steps other than Akiba report here, so their failures show too. */
export function noteMaintenanceError(step: string, e: unknown): void {
  if (step === 'akiba') return; // already recorded by runAkibaMaintenance
  lastError = `${step}: ${e instanceof Error ? e.message : String(e)}`;
}

export function agentStatus(): { busy: boolean; lastError: string | null } {
  return { busy, lastError };
}

export async function isModelDownloaded(): Promise<boolean> {
  return (await getSetting(MODEL_READY_KEY)) === '1';
}

/** Explicit download from the UI; also proves the model loads on this phone. */
export async function downloadModel(onProgress: (percent: number) => void): Promise<void> {
  await loadAkibaModel(AKIBA_MODEL_SIZE, onProgress);
  await unloadAkibaModel();
  await setSetting(MODEL_READY_KEY, '1');
}

export async function runAkibaMaintenance(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const since = await getEnabledSince();
    if (since == null) return;
    const tx = await nextUnprocessedIncome(since);
    if (!tx) return;
    busy = true;
    await processIncome(tx);
    lastError = null;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    busy = false;
    running = false;
  }
}

async function processIncome(tx: NonNullable<Awaited<ReturnType<typeof nextUnprocessedIncome>>>): Promise<void> {
  const now = new Date(tx.timestamp);
  const payday = (await getPaydayDay()) ?? 28;
  const days = daysToPayday(now, payday);
  // Start of the current pay cycle = the previous payday.
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), Math.min(payday, 28));
  if (cycleStart.getTime() > now.getTime()) cycleStart.setMonth(cycleStart.getMonth() - 1);

  const [rows, earlier, budgets, buffer, saved, rate] = await Promise.all([
    metricRows(now.getTime() - 200 * 86_400_000),
    incomeBefore(tx.timestamp),
    unpaidBudgetsKes(cycleStart.getTime()),
    getBufferKes(),
    totalSavedKes(),
    getRate(),
  ]);

  const profile = computeProfile({
    rows,
    now,
    isNeed: isNeedGroup,
    otherLiquidKes: saved,
    survivalThresholdMonths: SURVIVAL_THRESHOLD_MONTHS,
    emergencyFundMonths: EMERGENCY_FUND_MONTHS,
    emergencySavedKes: saved,
  });

  let useModel = false;
  if (await isModelDownloaded()) {
    try {
      await loadAkibaModel(AKIBA_MODEL_SIZE);
      useModel = true;
    } catch {
      // Out of memory or a broken download: this run goes rule-based.
    }
  }
  const callTool = useModel ? makeQvacCallTool((s) => void logAiRun(s)) : async () => null;

  try {
    const decision = await decideSweep(
      {
        smsText: tx.raw_text,
        counterparty: tx.counterparty_name,
        incomeKes: tx.amount,
        receivedAt: tx.timestamp,
        history: senderHistory(tx.counterparty_name, earlier),
        planner: {
          mpesaBalanceKes: tx.balance ?? profile.latestMpesaBalanceKes ?? 0,
          unpaidBudgetsKes: budgets.unpaid,
          avgDailySpendKes: avgDailySpend(rows, now, 30, budgets.budgetGroups),
          daysToPayday: days,
          bufferKes: buffer,
        },
        survivalMode: profile.mode === 'survival',
        runwayMonths: profile.runwayMonths,
      },
      callTool
    );

    const conversion =
      rate && decision.amountKes > 0
        ? (() => {
            const q = quoteKesToUsdt(decision.amountKes, rate.kesPerUsdt, rate.rateDate);
            return { rate: rate.kesPerUsdt, rateDate: rate.rateDate, baseUnits: q.baseUnits };
          })()
        : null;
    await saveProposal(tx, decision, conversion);
  } finally {
    if (isAkibaModelLoaded()) await unloadAkibaModel();
  }
}
