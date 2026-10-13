import { getDb } from './db';
import { ParsedTransaction } from './parser';
import { classifyByKeyword } from './builtinClassifier';

export type ConditionField = 'counterpartyName' | 'counterpartyNumber' | 'accountNumber';
export type ConditionOperator = 'CONTAINS' | 'EQUALS';

export interface Rule {
  id: string;
  conditionField: ConditionField;
  conditionOperator: ConditionOperator;
  conditionValue: string;
  targetCategory: string;
  targetGroup: string;
  priority: number;
}

type RuleRow = {
  id: string;
  condition_field: string;
  condition_operator: string;
  condition_value: string;
  target_category: string;
  target_group: string;
  priority: number;
};

/**
 * A parsed transaction with categorization applied. `grp` (not `group`, which
 * is a reserved SQL keyword the "transactions" table already has to quote
 * everywhere) is the field name used across the rules engine; it maps to the
 * "group" column when persisted.
 */
export type CategorizedTransaction = ParsedTransaction & {
  category: string;
  grp: string;
};

// NOTE: schema lives in db.ts's openDb() alongside the transactions table, so
// there's a single place that owns the database schema. This file only knows
// how to query/mutate the rules table, not create it.

function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    conditionField: row.condition_field as ConditionField,
    conditionOperator: row.condition_operator as ConditionOperator,
    conditionValue: row.condition_value,
    targetCategory: row.target_category,
    targetGroup: row.target_group,
    priority: row.priority,
  };
}

function makeRuleId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function getAllRules(): Promise<Rule[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RuleRow>('SELECT * FROM rules ORDER BY priority ASC, id ASC');
  return rows.map(rowToRule);
}

export async function addRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
  const db = await getDb();
  const id = makeRuleId();

  await db.runAsync(
    `INSERT INTO rules
      (id, condition_field, condition_operator, condition_value, target_category, target_group, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    rule.conditionField,
    rule.conditionOperator,
    rule.conditionValue,
    rule.targetCategory,
    rule.targetGroup,
    rule.priority
  );

  invalidateRulesCache();
  return { id, ...rule };
}

export async function deleteRule(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM rules WHERE id = ?', id);
  invalidateRulesCache();
}

// Rules rarely change relative to how often applyRules() runs (once per
// captured/backfilled message), so cache them and invalidate on write rather
// than round-tripping to SQLite for every single transaction.
let cachedRules: Rule[] | null = null;

export function invalidateRulesCache(): void {
  cachedRules = null;
}

async function loadRulesSortedByPriority(): Promise<Rule[]> {
  if (!cachedRules) {
    cachedRules = await getAllRules();
  }
  return cachedRules;
}

function matchesCondition(transaction: ParsedTransaction, rule: Rule): boolean {
  const fieldValue = (transaction[rule.conditionField] ?? '').toString().toLowerCase();
  const needle = rule.conditionValue.toLowerCase();

  if (fieldValue === '') {
    return false;
  }

  return rule.conditionOperator === 'EQUALS' ? fieldValue === needle : fieldValue.includes(needle);
}

/**
 * Evaluates rules in priority order (lowest number first) and applies the
 * first match's category/group. Rules are cached in memory — call
 * invalidateRulesCache() (done automatically by addRule/deleteRule) if rules
 * change out from under a long-lived process.
 *
 * If no user rule matches, falls back to the generic built-in keyword
 * classifier (src/builtinClassifier.ts) before giving up to 'Uncategorized'
 * — this is what makes categorization work for a brand-new user with no
 * rules and no Excel import at all. User rules always take priority, so a
 * manual override still wins over the generic guess.
 */
export async function applyRules(transaction: ParsedTransaction): Promise<CategorizedTransaction> {
  const rules = await loadRulesSortedByPriority();

  for (const rule of rules) {
    if (matchesCondition(transaction, rule)) {
      return { ...transaction, category: rule.targetCategory, grp: rule.targetGroup };
    }
  }

  const builtin = classifyByKeyword(transaction);
  if (builtin) {
    return { ...transaction, category: builtin.category, grp: builtin.group };
  }

  return { ...transaction, category: 'Uncategorized', grp: 'Uncategorized' };
}

export type QuickCategorizeTarget = {
  counterpartyName: string;
  counterpartyNumber: string | null;
  accountNumber: string | null;
};

/**
 * Builds an EQUALS rule from a single transaction's identity so that
 * categorizing one message (via the tap-to-categorize flow) automatically
 * categorizes every future message from the same sender. Prefers the most
 * specific identifier available: a phone number over a name over a paybill
 * account, since names/text can repeat loosely across unrelated senders.
 *
 * Returns null if the transaction has no identifiable counterparty at all
 * (e.g. an unparsed message) — in that case the caller should still update
 * that one row directly, just without a reusable rule.
 */
export async function createRuleFromTransaction(
  target: QuickCategorizeTarget,
  category: string,
  group: string = category
): Promise<Rule | null> {
  let conditionField: ConditionField;
  let conditionValue: string;

  if (target.counterpartyNumber) {
    conditionField = 'counterpartyNumber';
    conditionValue = target.counterpartyNumber;
  } else if (target.counterpartyName) {
    conditionField = 'counterpartyName';
    conditionValue = target.counterpartyName;
  } else if (target.accountNumber) {
    conditionField = 'accountNumber';
    conditionValue = target.accountNumber;
  } else {
    return null;
  }

  // Idempotent: re-running the same categorization (tap-to-categorize twice,
  // or re-running the Excel import) must not pile up duplicate identical
  // rules. If an EQUALS rule for this exact identifier already exists, update
  // it in place instead of inserting a new one — this also lets a later,
  // corrected categorization overwrite an earlier mistaken one rather than
  // leaving two contradictory rules whose priority order decides the winner.
  const existingRules = await getAllRules();
  const existing = existingRules.find(
    (r) =>
      r.conditionField === conditionField &&
      r.conditionOperator === 'EQUALS' &&
      r.conditionValue.toLowerCase() === conditionValue.toLowerCase()
  );

  if (existing) {
    if (existing.targetCategory === category && existing.targetGroup === group) {
      return existing;
    }
    const db = await getDb();
    await db.runAsync(
      'UPDATE rules SET target_category = ?, target_group = ? WHERE id = ?',
      category,
      group,
      existing.id
    );
    invalidateRulesCache();
    return { ...existing, targetCategory: category, targetGroup: group };
  }

  return addRule({
    conditionField,
    conditionOperator: 'EQUALS',
    conditionValue,
    targetCategory: category,
    targetGroup: group,
    priority: 1,
  });
}
