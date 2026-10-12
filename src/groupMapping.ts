import { getDb } from './db';

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
