import { getProposals, getSendable, transition } from '../akiba/store.ts';
import { DEFAULT_SEPOLIA_RPC } from './sepolia';

/**
 * Laptop-signer mode: the phone never signs, so it learns that an approved
 * sweep went out by reading the chain. It looks for the test token's ERC-20
 * Transfer event from the spending (#0) to the savings (#1) address with the
 * exact approved amount, then records that real transaction hash. Read-only:
 * no keys, nothing sent.
 */

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// ~1 day of Sepolia blocks; public RPCs cap eth_getLogs ranges.
const LOOKBACK_BLOCKS = 7_200;

type Log = { transactionHash: string; data: string };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(process.env.EXPO_PUBLIC_SEPOLIA_RPC || DEFAULT_SEPOLIA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error || json.result === undefined) throw new Error(json.error?.message ?? `${method} failed`);
  return json.result;
}

// Exact, or up to 0.01 USDt less: a sweep signed from a 2-decimal display
// amount (80.07 for 80.077369) still counts. Never more than approved.
const ROUNDING_TOLERANCE = 10_000n;
function amountMatches(sent: bigint, approved: bigint): boolean {
  return sent <= approved && approved - sent < ROUNDING_TOLERANCE;
}

const topicFor = (address: string) => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;

/** Returns how many approved sweeps were matched to an on-chain transfer. */
export async function syncLaptopSweeps(): Promise<number> {
  const token = process.env.EXPO_PUBLIC_SEPOLIA_TEST_TOKEN_ADDRESS;
  const from = process.env.EXPO_PUBLIC_SPENDING_ADDRESS;
  const to = process.env.EXPO_PUBLIC_SAVINGS_ADDRESS;
  if (!token || !from || !to) return 0;

  const waiting = (await getSendable()).filter((s) => s.status === 'approved' && s.amount_usdt_base);
  if (!waiting.length) return 0;

  const latest = parseInt(await rpc<string>('eth_blockNumber', []), 16);
  const logs = await rpc<Log[]>('eth_getLogs', [
    {
      address: token,
      fromBlock: `0x${Math.max(0, latest - LOOKBACK_BLOCKS).toString(16)}`,
      toBlock: 'latest',
      topics: [TRANSFER_TOPIC, topicFor(from), topicFor(to)],
    },
  ]);

  // Each on-chain transfer settles at most one sweep (oldest first), so two
  // approvals of the same amount need two transfers.
  const used = new Set((await getProposals(500)).map((s) => s.tx_hash).filter((h): h is string => !!h));
  let matched = 0;
  for (const sweep of waiting) {
    const hit = logs.find((l) => !used.has(l.transactionHash) && amountMatches(BigInt(l.data), BigInt(sweep.amount_usdt_base!)));
    if (!hit) continue;
    used.add(hit.transactionHash);
    await transition(sweep.id, 'send');
    await transition(sweep.id, 'ok', { txHash: hit.transactionHash });
    matched++;
  }
  return matched;
}
