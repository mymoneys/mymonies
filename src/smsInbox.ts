import { NativeModules } from 'react-native';

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

export function isSmsReaderAvailable(): boolean {
  return !!SmsReaderModule?.getInboxMessages;
}

/** Newest first. `senders` match the SMS address case-insensitively. */
export function readInboxMessages(sinceMs: number, senders: string[]): Promise<RawSms[]> {
  return SmsReaderModule.getInboxMessages(sinceMs, senders);
}

/**
 * Business sender IDs (letters only — never personal phone numbers) found in
 * the inbox, most frequent first. Backs the "add a sender" suggestions.
 */
export async function getInboxSenders(limit = 30): Promise<InboxSender[]> {
  if (!SmsReaderModule?.getInboxSenders) return [];
  return SmsReaderModule.getInboxSenders(limit);
}

export async function getInboxMessageCount(): Promise<number | null> {
  if (!SmsReaderModule?.getInboxMessageCount) return null;
  return SmsReaderModule.getInboxMessageCount();
}
