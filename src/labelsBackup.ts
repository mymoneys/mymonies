import * as FileSystem from 'expo-file-system/legacy';
import { getDb, getSetting, reapplyRulesToUncategorized, setSetting } from './db';
import { invalidateRulesCache } from './rules';

/**
 * Back up and restore everything the user has taught the app: rules, the
 * category on each transaction, budgets and payday. All of it lives in the
 * app's private SQLite file, which Android deletes on uninstall — so without
 * this, an uninstall (or a package-name change) silently loses every label.
 *
 * The file goes to a folder the user picks through Android's Storage Access
 * Framework, so no extra native dependency or storage permission is needed.
 *
 * Transaction labels are keyed by transaction id, which is a hash of the SMS
 * text and timestamp — stable across reinstalls, because the same messages
 * get re-imported. Labels for messages not imported yet wait in
 * `label_overrides` and are applied by applyLabelOverrides() as they arrive.
 */

const KIND = 'mymonies-labels';
const VERSION = 1;
const FILE_PREFIX = 'mymonies-labels-';
const LAST_BACKUP_KEY = 'labels_last_backup';
const RESTORED_SETTINGS = ['payday_day'];

type RuleRow = {
  id: string;
  condition_field: string;
  condition_operator: string;
  condition_value: string;
  target_category: string;
  target_group: string;
  priority: number;
};
type BudgetRow = {
  id: string;
  label: string;
  category: string;
  group: string;
  amount: number;
  kind: string;
  sort_order: number;
};
type LabelRow = { id: string; category: string; group: string };

export type LabelsBackup = {
  kind: typeof KIND;
  version: number;
  createdAt: string;
  rules: RuleRow[];
  labels: LabelRow[];
  budgets: BudgetRow[];
  settings: Record<string, string>;
};

export type BackupSummary = { rules: number; labels: number; budgets: number };

async function ensureOverridesTable(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS label_overrides (
      id TEXT PRIMARY KEY NOT NULL,
      category TEXT NOT NULL,
      "group" TEXT NOT NULL
    );
  `);
}

export async function buildBackup(): Promise<LabelsBackup> {
  const db = await getDb();
  const rules = await db.getAllAsync<RuleRow>(
    `SELECT id, condition_field, condition_operator, condition_value, target_category, target_group, priority FROM rules`
  );
  const labels = await db.getAllAsync<LabelRow>(
    `SELECT id, category, "group" AS "group" FROM transactions WHERE category != 'Uncategorized'`
  );
  const budgets = await db.getAllAsync<BudgetRow>(
    `SELECT id, label, category, "group" AS "group", amount, kind, sort_order FROM budgets`
  );
  const settings: Record<string, string> = {};
  for (const key of RESTORED_SETTINGS) {
    const value = await getSetting(key);
    if (value != null) settings[key] = value;
  }
  return { kind: KIND, version: VERSION, createdAt: new Date().toISOString(), rules, labels, budgets, settings };
}

export function summarize(backup: LabelsBackup): BackupSummary {
  return { rules: backup.rules.length, labels: backup.labels.length, budgets: backup.budgets.length };
}

export function parseBackup(text: string): LabelsBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a MyMonies labels backup.');
  }
  const b = data as Partial<LabelsBackup>;
  if (b?.kind !== KIND || !Array.isArray(b.rules) || !Array.isArray(b.labels)) {
    throw new Error('That file is not a MyMonies labels backup.');
  }
  if ((b.version ?? 0) > VERSION) {
    throw new Error('This backup was made by a newer version of MyMonies. Update the app first.');
  }
  return { budgets: [], settings: {}, ...b } as LabelsBackup;
}

/** Restoring replaces matching rules/budgets and re-labels transactions; nothing else is deleted. */
export async function restoreBackup(backup: LabelsBackup): Promise<BackupSummary> {
  await ensureOverridesTable();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const r of backup.rules) {
      // A rule for the same sender may already exist under another id (made
      // since the reinstall); the backup's version wins rather than stacking two.
      await db.runAsync(
        `DELETE FROM rules WHERE condition_field = ? AND condition_operator = ? AND LOWER(condition_value) = LOWER(?)`,
        r.condition_field,
        r.condition_operator,
        r.condition_value
      );
      await db.runAsync(
        `INSERT OR REPLACE INTO rules (id, condition_field, condition_operator, condition_value, target_category, target_group, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        r.id,
        r.condition_field,
        r.condition_operator,
        r.condition_value,
        r.target_category,
        r.target_group,
        r.priority
      );
    }
    for (const b of backup.budgets) {
      await db.runAsync(
        `INSERT OR REPLACE INTO budgets (id, label, category, "group", amount, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        b.id,
        b.label,
        b.category,
        b.group,
        b.amount,
        b.kind,
        b.sort_order
      );
    }
    for (const l of backup.labels) {
      await db.runAsync(
        `INSERT OR REPLACE INTO label_overrides (id, category, "group") VALUES (?, ?, ?)`,
        l.id,
        l.category,
        l.group
      );
    }
  });
  for (const key of RESTORED_SETTINGS) {
    const value = backup.settings?.[key];
    if (value != null) await setSetting(key, value);
  }
  invalidateRulesCache();
  await applyLabelOverrides();
  await reapplyRulesToUncategorized();
  return summarize(backup);
}

/**
 * Applies restored labels to transactions that exist now, then forgets them,
 * so a later re-categorization by the user isn't reverted. Labels for
 * messages not imported yet stay until they arrive. Called from background
 * maintenance after parsing.
 */
export async function applyLabelOverrides(): Promise<number> {
  await ensureOverridesTable();
  const db = await getDb();
  const result = await db.runAsync(
    `UPDATE transactions
     SET category = (SELECT o.category FROM label_overrides o WHERE o.id = transactions.id),
         "group" = (SELECT o."group" FROM label_overrides o WHERE o.id = transactions.id)
     WHERE id IN (SELECT id FROM label_overrides)`
  );
  await db.runAsync(`DELETE FROM label_overrides WHERE id IN (SELECT id FROM transactions)`);
  return result.changes;
}

const SAF = FileSystem.StorageAccessFramework;

async function pickFolder(): Promise<string | null> {
  const permission = await SAF.requestDirectoryPermissionsAsync();
  return permission.granted ? permission.directoryUri : null;
}

/** Returns the saved file's name, or null if the user cancelled the folder picker. */
export async function saveBackupToFolder(): Promise<{ fileName: string; summary: BackupSummary } | null> {
  const dir = await pickFolder();
  if (!dir) return null;
  const backup = await buildBackup();
  // Date and time (UTC) so names are unique and sort newest-last: 2026-10-28T18-42.
  const fileName = `${FILE_PREFIX}${backup.createdAt.slice(0, 16).replace(':', '-')}`;
  const uri = await SAF.createFileAsync(dir, fileName, 'application/json');
  await SAF.writeAsStringAsync(uri, JSON.stringify(backup), { encoding: FileSystem.EncodingType.UTF8 });
  await setSetting(LAST_BACKUP_KEY, backup.createdAt);
  return { fileName: `${fileName}.json`, summary: summarize(backup) };
}

/** Restores the newest backup in the folder the user picks. Null if they cancelled. */
export async function restoreNewestFromFolder(): Promise<{ fileName: string; summary: BackupSummary } | null> {
  const dir = await pickFolder();
  if (!dir) return null;
  const candidates = (await SAF.readDirectoryAsync(dir))
    .map((uri) => ({ uri, name: decodeURIComponent(uri).split('/').pop() ?? '' }))
    .filter((f) => f.name.startsWith(FILE_PREFIX));
  if (candidates.length === 0) {
    throw new Error('No MyMonies labels backup in that folder. Pick the folder you backed up to.');
  }
  // Names carry the date and time, so the newest sorts first in reverse order.
  candidates.sort((a, b) => b.name.localeCompare(a.name));
  const newest = candidates[0];
  const backup = parseBackup(await SAF.readAsStringAsync(newest.uri, { encoding: FileSystem.EncodingType.UTF8 }));
  const summary = await restoreBackup(backup);
  return { fileName: newest.name, summary };
}

export async function getLastBackupTime(): Promise<string | null> {
  return getSetting(LAST_BACKUP_KEY);
}
