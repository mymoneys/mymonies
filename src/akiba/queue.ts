/**
 * Sweep proposal lifecycle. Pure transition table — persistence lives in
 * src/akiba/store.ts. The point of `queued_offline` is the offline story:
 * approval needs only the fingerprint, so it works in airplane mode; the
 * transfer itself needs Sepolia, so it waits here and is sent on reconnect.
 *
 *   proposed ──approve──► approved ──send──► sending ──ok──► sent
 *      │                     │                  └──error──► failed ──retry──► sending
 *      └──decline──► declined └──offline──► queued_offline ──online──► sending
 */

export type SweepStatus =
  | 'proposed'
  | 'declined'
  | 'approved'
  | 'queued_offline'
  | 'sending'
  | 'sent'
  | 'failed';

export type SweepEvent = 'approve' | 'decline' | 'offline' | 'online' | 'send' | 'ok' | 'error' | 'retry';

const TRANSITIONS: Record<SweepStatus, Partial<Record<SweepEvent, SweepStatus>>> = {
  proposed: { approve: 'approved', decline: 'declined' },
  approved: { send: 'sending', offline: 'queued_offline' },
  queued_offline: { online: 'sending' },
  sending: { ok: 'sent', error: 'failed' },
  failed: { retry: 'sending' },
  declined: {},
  sent: {},
};

export function nextStatus(current: SweepStatus, event: SweepEvent): SweepStatus {
  const next = TRANSITIONS[current][event];
  if (!next) throw new Error(`Sweep can't go from "${current}" on "${event}"`);
  return next;
}

/** Statuses the background loop should try to push to the network. */
export const SENDABLE: ReadonlySet<SweepStatus> = new Set(['approved', 'queued_offline']);
