import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDb } from './db';

type ExportRow = {
  timestamp: number;
  transaction_type: string;
  counterparty_name: string;
  amount: number;
  category: string;
  group: string;
  balance: number | null;
};

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Queries transactions in [startDate, endDate] (inclusive, epoch ms) and
 * writes them to a CSV file in the cache directory. FAILED messages are
 * excluded — same reasoning as the transactions list: they never moved money.
 * Returns the file path; call shareCsvExport() to open the share sheet.
 */
export async function exportTransactionsToCsv(startDate: number, endDate: number): Promise<string> {
  const db = await getDb();
  const rows = await db.getAllAsync<ExportRow>(
    `SELECT timestamp, transaction_type, counterparty_name, amount, category, "group", balance
     FROM transactions
     WHERE transaction_type != 'FAILED' AND timestamp >= ? AND timestamp <= ?
     ORDER BY timestamp ASC`,
    startDate,
    endDate
  );

  const header = ['Date', 'Type', 'Counterparty', 'Amount', 'Category', 'Group', 'Balance'];
  const lines = [header.join(',')];

  for (const row of rows) {
    lines.push(
      [
        formatDate(row.timestamp),
        row.transaction_type,
        csvEscape(row.counterparty_name),
        row.amount.toString(),
        csvEscape(row.category),
        csvEscape(row.group),
        row.balance != null ? row.balance.toString() : '',
      ].join(',')
    );
  }

  const csv = lines.join('\n');
  const path = `${FileSystem.cacheDirectory}mpesa-export-${Date.now()}.csv`;
  await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });

  return path;
}

export async function shareCsvExport(path: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(path, {
    mimeType: 'text/csv',
    dialogTitle: 'Export MPESA transactions',
    UTI: 'public.comma-separated-values-text',
  });
}
