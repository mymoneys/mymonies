import { getDb } from './db';
import { addRule, getAllRules } from './rules';

/**
 * Default category -> super-group mapping, per the user's own classification
 * (confirmed explicitly, not inferred): Rent/Water/Shopping are Household,
 * Uber/Fare are Travel, Washing Machine is Electronics, Masters Fees is
 * Education, and Alcohol/Friends share a Social group. This is one person's
 * taxonomy, not a universal one — it's deliberately a plain editable map
 * rather than baked into the parser, so a different user (or this user,
 * later) can redefine it without touching ingestion code.
 */
export const DEFAULT_CATEGORY_GROUPS: Record<string, string> = {
  Rent: 'Household',
  Water: 'Household',
  Shopping: 'Household',
  Uber: 'Travel',
  Fare: 'Travel',
  'Washing Machine': 'Electronics',
  'Masters Fees': 'Education',
  Alcohol: 'Social',
  Friends: 'Social',

  // Foodstuff: groceries, meal ingredients, and prepared meals — confirmed
  // explicitly, including the extra items beyond what was first named.
  // Snacks/drinks (chewing gum, soda, sweets, chips, smokies, uji power,
  // water) were deliberately kept OUT of this group per the same decision.
  Milk: 'Foodstuff',
  milk: 'Foodstuff',
  Meat: 'Foodstuff',
  Meals: 'Foodstuff',
  Vegetables: 'Foodstuff',
  Veggies: 'Foodstuff',
  Vegies: 'Foodstuff',
  veggies: 'Foodstuff',
  veges: 'Foodstuff',
  Mutura: 'Foodstuff',
  mutura: 'Foodstuff',
  Beef: 'Foodstuff',
  beef: 'Foodstuff',
  Bread: 'Foodstuff',
  bread: 'Foodstuff',
  Fruits: 'Foodstuff',
  fruits: 'Foodstuff',
  Matumbo: 'Foodstuff',
  matumbo: 'Foodstuff',
  Pork: 'Foodstuff',
  pork: 'Foodstuff',
  avocado: 'Foodstuff',
  cabbage: 'Foodstuff',
  chapo: 'Foodstuff',
  chicken: 'Foodstuff',
  eggs: 'Foodstuff',
  githeri: 'Foodstuff',
  grapes: 'Foodstuff',
  kuku: 'Foodstuff',
  'maize meal': 'Foodstuff',
  mala: 'Foodstuff',
  mandazi: 'Foodstuff',
  mayai: 'Foodstuff',
  maziwa: 'Foodstuff',
  mkate: 'Foodstuff',
  ndizi: 'Foodstuff',
  njugu: 'Foodstuff',
  nyanya: 'Foodstuff',
  omena: 'Foodstuff',
  orange: 'Foodstuff',
  oranges: 'Foodstuff',
  peas: 'Foodstuff',
  pizza: 'Foodstuff',
  rice: 'Foodstuff',
  samosa: 'Foodstuff',
  smokie: 'Foodstuff',
  soup: 'Foodstuff',
  sugar: 'Foodstuff',
  tomatos: 'Foodstuff',
  uji: 'Foodstuff',
  yogurt: 'Foodstuff',

  // Snacks/Drinks: kept separate from Foodstuff per explicit confirmation.
  'Chewing gum': 'Snacks/Drinks',
  'chewing gum': 'Snacks/Drinks',
  'chewing-gum': 'Snacks/Drinks',
  gum: 'Snacks/Drinks',
  soda: 'Snacks/Drinks',
  sweets: 'Snacks/Drinks',
  chips: 'Snacks/Drinks',
  smokies: 'Snacks/Drinks',
  'Uji Power': 'Snacks/Drinks',
  'uji power': 'Snacks/Drinks',
  water: 'Snacks/Drinks',

  Cooker: 'Electronics',
  'Cooking Gas': 'Household',
  Airtime: 'Household',
  airtime: 'Household',
  Girl: 'Social',
  girl: 'Social',
};

export interface ApplyGroupMapResult {
  transactionsUpdated: number;
  budgetsUpdated: number;
  rulesUpdated: number;
}

/**
 * Applies a category->group map to everything that carries a group alongside
 * a category: existing transactions (so the Dashboard's super-group pie
 * reflects it immediately), budget line items (so Profile's progress bars
 * group correctly too), and existing rules (so future auto-categorization
 * keeps assigning the right group without re-running this).
 */
export async function applyCategoryGroupMap(
  mapping: Record<string, string> = DEFAULT_CATEGORY_GROUPS
): Promise<ApplyGroupMapResult> {
  const db = await getDb();
  let transactionsUpdated = 0;
  let budgetsUpdated = 0;
  let rulesUpdated = 0;

  for (const [category, group] of Object.entries(mapping)) {
    const txResult = await db.runAsync(
      `UPDATE transactions SET "group" = ? WHERE category = ? AND "group" != ?`,
      group,
      category,
      group
    );
    transactionsUpdated += txResult.changes ?? 0;

    const budgetResult = await db.runAsync(
      `UPDATE budgets SET "group" = ? WHERE category = ? AND "group" != ?`,
      group,
      category,
      group
    );
    budgetsUpdated += budgetResult.changes ?? 0;

    const rulesResult = await db.runAsync(
      `UPDATE rules SET target_group = ? WHERE target_category = ? AND target_group != ?`,
      group,
      category,
      group
    );
    rulesUpdated += rulesResult.changes ?? 0;
  }

  return { transactionsUpdated, budgetsUpdated, rulesUpdated };
}

export interface ConsolidateElectricityResult {
  transactionsUpdated: number;
  budgetsUpdated: number;
  rulesUpdated: number;
  ruleAdded: boolean;
}

/**
 * Folds KPLC (and a future Kenya Power variant) into a single "Electricity"
 * category under the "Household" group, rather than leaving "kplc"/"KPLC"
 * sitting as their own self-named category+group pair (an artifact of the
 * Excel import, which used the raw item text as-is). Existing data is
 * relabeled directly; a CONTAINS rule for "KENYA POWER" is added so a
 * message using that wording — none exist yet, but Safaricom's templates
 * vary — gets the same treatment automatically instead of landing
 * Uncategorized.
 */
export async function consolidateElectricityCategory(): Promise<ConsolidateElectricityResult> {
  const db = await getDb();
  const category = 'Electricity';
  const group = 'Household';
  const oldCategories = ['kplc', 'KPLC'];

  let transactionsUpdated = 0;
  let budgetsUpdated = 0;
  let rulesUpdated = 0;

  for (const oldCategory of oldCategories) {
    const txResult = await db.runAsync(
      `UPDATE transactions SET category = ?, "group" = ? WHERE category = ?`,
      category,
      group,
      oldCategory
    );
    transactionsUpdated += txResult.changes ?? 0;

    const budgetResult = await db.runAsync(
      `UPDATE budgets SET category = ?, "group" = ? WHERE category = ?`,
      category,
      group,
      oldCategory
    );
    budgetsUpdated += budgetResult.changes ?? 0;

    const rulesResult = await db.runAsync(
      `UPDATE rules SET target_category = ?, target_group = ? WHERE target_category = ?`,
      category,
      group,
      oldCategory
    );
    rulesUpdated += rulesResult.changes ?? 0;
  }

  const existingRules = await getAllRules();
  const hasKenyaPowerRule = existingRules.some(
    (rule) =>
      rule.conditionField === 'counterpartyName' &&
      rule.conditionValue.toUpperCase() === 'KENYA POWER'
  );

  let ruleAdded = false;
  if (!hasKenyaPowerRule) {
    await addRule({
      conditionField: 'counterpartyName',
      conditionOperator: 'CONTAINS',
      conditionValue: 'KENYA POWER',
      targetCategory: category,
      targetGroup: group,
      priority: 1,
    });
    ruleAdded = true;
  }

  return { transactionsUpdated, budgetsUpdated, rulesUpdated, ruleAdded };
}

export interface NormalizeCasingResult {
  transactionsUpdated: number;
  budgetsUpdated: number;
  rulesUpdated: number;
  merged: { from: string; into: string }[];
}

/**
 * Merges group names that only differ by case (e.g. "Household" and
 * "household") into one canonical spelling — the Excel import carried over
 * whatever casing a given month's sheet happened to use, so the same group
 * can exist as several "different" groups that the Dashboard pie then
 * splits apart. The most common casing in each case-insensitive bucket wins
 * (ties keep whichever is already capitalized), and every row referencing a
 * losing variant is rewritten to the winner — across transactions, budgets,
 * and rules, so future categorization doesn't reintroduce the split.
 */
export async function normalizeGroupCasing(): Promise<NormalizeCasingResult> {
  const db = await getDb();

  const rows = await db.getAllAsync<{ group: string; c: number }>(
    `SELECT "group" as "group", COUNT(*) as c FROM transactions GROUP BY "group"`
  );

  const buckets = new Map<string, { group: string; c: number }[]>();
  for (const row of rows) {
    const key = row.group.toLowerCase();
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  let transactionsUpdated = 0;
  let budgetsUpdated = 0;
  let rulesUpdated = 0;
  const merged: { from: string; into: string }[] = [];

  for (const variants of buckets.values()) {
    if (variants.length <= 1) continue;

    variants.sort((a, b) => {
      if (b.c !== a.c) return b.c - a.c;
      const aCapitalized = /^[A-Z]/.test(a.group);
      const bCapitalized = /^[A-Z]/.test(b.group);
      return Number(bCapitalized) - Number(aCapitalized);
    });
    const canonical = variants[0].group;

    for (const variant of variants.slice(1)) {
      if (variant.group === canonical) continue;

      const txResult = await db.runAsync(
        `UPDATE transactions SET "group" = ? WHERE "group" = ?`,
        canonical,
        variant.group
      );
      transactionsUpdated += txResult.changes ?? 0;

      const budgetResult = await db.runAsync(
        `UPDATE budgets SET "group" = ? WHERE "group" = ?`,
        canonical,
        variant.group
      );
      budgetsUpdated += budgetResult.changes ?? 0;

      const rulesResult = await db.runAsync(
        `UPDATE rules SET target_group = ? WHERE target_group = ?`,
        canonical,
        variant.group
      );
      rulesUpdated += rulesResult.changes ?? 0;

      merged.push({ from: variant.group, into: canonical });
    }
  }

  return { transactionsUpdated, budgetsUpdated, rulesUpdated, merged };
}
