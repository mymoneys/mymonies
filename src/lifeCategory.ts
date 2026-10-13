import { getDb } from './db';

export type LifeCategory = 'Needs' | 'Wants' | 'Savings' | 'Unclassified';

const EXPENSE_TYPES = ['SENT', 'PAID', 'EXPENSE'];

/**
 * Maps each super-group to the classic needs/wants/savings budgeting split
 * (housing/utilities/groceries/transport vs. lifestyle spending vs. money
 * set aside). Confirmed explicitly for the genuinely ambiguous, high-amount
 * groups (Electronics -> Want despite being a large appliance; Family
 * support, Work costs, and Church/Business -> Need); everything else here
 * is a reasonable default, not a confirmed choice, and can be corrected the
 * same way this map itself was built.
 */
export const LIFE_CATEGORY_GROUPS: Record<string, LifeCategory> = {
  // Needs — essential living costs.
  Household: 'Needs',
  Foodstuff: 'Needs',
  Meals: 'Needs',
  Travel: 'Needs',
  Education: 'Needs',
  Medical: 'Needs',
  'Medical Insurance': 'Needs',
  Medicine: 'Needs',
  Credits: 'Needs',
  'Debt-Friends': 'Needs',
  'Paid _Debt-Friends': 'Needs',
  Airtime: 'Needs',
  Family: 'Needs',
  Tamara: 'Needs',
  "Shiru - Ma' Francis": 'Needs',
  Work: 'Needs',
  'Church Contribution': 'Needs',
  Business: 'Needs',
  Job: 'Needs',
  'Moving to Nairobi': 'Needs',

  // Wants — non-essential lifestyle spending.
  Electronics: 'Wants',
  Social: 'Wants',
  Friends: 'Wants',
  'Snacks/Drinks': 'Wants',
  Clothes: 'Wants',
  Shoes: 'Wants',
  Events: 'Wants',
  Community: 'Wants',
  Pleasure: 'Wants',
  Personal: 'Wants',
  Other: 'Wants',

  // Savings — money set aside or invested, not spent.
  Savings: 'Savings',
  Stocks: 'Savings',
  'Binance - Savings': 'Savings',
  Onramp: 'Savings',
  'From-Mshwari-Savings': 'Savings',
};

export interface LifeCategoryTotal {
  lifeCategory: LifeCategory;
  total: number;
}

/**
 * Buckets this month's expense-type transactions into Needs/Wants/Savings
 * (plus Unclassified for any group not yet in the map, e.g. "Uncategorized"
 * — surfaced rather than silently dropped, so a growing Unclassified slice
 * is a visible prompt to extend the map, not a quietly wrong total).
 */
export async function getLifeCategoryBreakdown(month: number, year: number): Promise<LifeCategoryTotal[]> {
  const db = await getDb();
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, month, 1, 0, 0, 0, 0).getTime();

  const rows = await db.getAllAsync<{ group: string; amount: number }>(
    `SELECT "group" as "group", amount FROM transactions
     WHERE transaction_type IN (${EXPENSE_TYPES.map((t) => `'${t}'`).join(', ')})
       AND timestamp >= ? AND timestamp < ?`,
    start,
    end
  );

  const totals: Record<LifeCategory, number> = { Needs: 0, Wants: 0, Savings: 0, Unclassified: 0 };
  for (const row of rows) {
    const lifeCategory = LIFE_CATEGORY_GROUPS[row.group] ?? 'Unclassified';
    totals[lifeCategory] += row.amount;
  }

  return (['Needs', 'Wants', 'Savings', 'Unclassified'] as LifeCategory[])
    .map((lifeCategory) => ({ lifeCategory, total: totals[lifeCategory] }))
    .filter((t) => t.total > 0);
}
