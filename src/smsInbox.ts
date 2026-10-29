import { NativeModules } from 'react-native';
import { DEMO_MODE } from './demo/mode';

export type RawSms = {
  address: string;
  body: string;
  date: number;
};

export type InboxSender = {
  address: string;
  count: number;
};

const { SmsReaderModule } = NativeModules;

// Every inbox read in the app goes through this file, so demo builds are
// blocked here: they must never see a real message (src/demo/mode.ts).
export function isSmsReaderAvailable(): boolean {
  return !DEMO_MODE && !!SmsReaderModule?.getInboxMessages;
}

/** Newest first. `senders` match the SMS address case-insensitively. */
export function readInboxMessages(sinceMs: number, senders: string[]): Promise<RawSms[]> {
  if (DEMO_MODE) return Promise.resolve([]);
  return SmsReaderModule.getInboxMessages(sinceMs, senders);
}

/**
 * Business sender IDs (letters only — never personal phone numbers) found in
 * the inbox, most frequent first. Backs the "add a sender" suggestions.
 */
export async function getInboxSenders(limit = 30): Promise<InboxSender[]> {
  if (DEMO_MODE || !SmsReaderModule?.getInboxSenders) return [];
  return SmsReaderModule.getInboxSenders(limit);
}

export async function getInboxMessageCount(): Promise<number | null> {
  if (DEMO_MODE || !SmsReaderModule?.getInboxMessageCount) return null;
  return SmsReaderModule.getInboxMessageCount();
}
