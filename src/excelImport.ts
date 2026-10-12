import seedData from '../assets/excel-seed.json';
import { getDb, TransactionRow } from './db';
import { createRuleFromTransaction } from './rules';

type ExcelRow = {
  sheet: string;
  group: string | null;
  item: string | null;
  budgeted: number | null;
  date: string | null; // 'YYYY-MM-DD', local calendar day as entered in the spreadsheet
  moneyOut: number | null;
  transactionCharges: number | null;
  moneyIn: number | null;
  comments: string | null;
};

export type ExcelImportResult = {
  excelRowsConsidered: number;
  matched: number;
  rulesCreatedOrUpdated: number;
};

// Absorbs rounding between a manually-typed Excel figure and the exact
// SMS-parsed amount (e.g. you wrote 500, the SMS said 498.00 after a
// transaction-cost split some months recorded differently).
const AMOUNT_TOLERANCE = 2;

const INCOME_TYPES = new Set(['RECEIVED', 'TRANSFER_IN']);
const EXPENSE_TYPES = new Set(['SENT', 'PAID', 'WITHDRAWN', 'EXPENSE']);

function dayRangeMs(dateStr: string): { startMs: number; endMs: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * §2b: bootstraps the app's categorization from the manually-labeled Excel
 * budget tracker. For each Excel row with a date and an amount, finds the
 * same-day app transaction with a matching amount and the right direction
 * (money out → expense-type, money in → income-type), sets its category/group
 * directly from the Excel's Group/Item (ground truth, not a guess), and
 * derives a reusable rule from that transaction's counterparty so future
 * messages from the same sender categorize the same way without needing the
 * Excel again.
 *
 * Safe to re-run: the transaction UPDATE is idempotent (same values every
 * time), and createRuleFromTransaction (src/rules.ts) now updates an existing
 * matching rule in place instead of duplicating it.
 */
export async function importExcelCategorization(): Promise<ExcelImportResult> {
  const rows = (seedData as ExcelRow[]).filter(
    (r): r is ExcelRow & { date: string; group: string; item: string } =>
      r.date != null && r.group != null && r.item != null
  );
  const db = await getDb();

  let matched = 0;
  let rulesTouched = 0;
  const ruleKeysThisRun = new Set<string>();

  for (const row of rows) {
    const targetAmount = row.moneyOut ?? row.moneyIn;
    if (targetAmount == null || targetAmount <= 0) {
      continue;
    }

    const direction: 'IN' | 'OUT' = row.moneyOut != null ? 'OUT' : 'IN';
    const { startMs, endMs } = dayRangeMs(row.date);

    const candidates = await db.getAllAsync<TransactionRow>(
      `SELECT * FROM transactions
       WHERE timestamp >= ? AND timestamp < ?
         AND amount BETWEEN ? AND ?
       ORDER BY ABS(amount - ?) ASC`,
      startMs,
      endMs,
      targetAmount - AMOUNT_TOLERANCE,
      targetAmount + AMOUNT_TOLERANCE,
      targetAmount
    );

    const match = candidates.find((c) =>
      direction === 'IN' ? INCOME_TYPES.has(c.transaction_type) : EXPENSE_TYPES.has(c.transaction_type)
    );

    if (!match) {
      continue;
    }

    matched += 1;
    await db.runAsync(`UPDATE transactions SET category = ?, "group" = ? WHERE id = ?`, row.item, row.group, match.id);

    const ruleKey = `${match.counterparty_number ?? ''}|${match.counterparty_name}|${match.account_number ?? ''}`;
    if (!ruleKeysThisRun.has(ruleKey)) {
      ruleKeysThisRun.add(ruleKey);
      const rule = await createRuleFromTransaction(
        {
          counterpartyName: match.counterparty_name,
          counterpartyNumber: match.counterparty_number,
          accountNumber: match.account_number,
        },
        row.item,
        row.group
      );
      if (rule) {
        rulesTouched += 1;
      }
    }
  }

  return { excelRowsConsidered: rows.length, matched, rulesCreatedOrUpdated: rulesTouched };
}
