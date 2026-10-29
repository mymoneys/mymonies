import { SEPOLIA_CHAIN_ID } from './config';

/**
 * Online check that doubles as the testnet guard: it asks the configured RPC
 * for its chain ID and only reports "online" when that is Sepolia. Any other
 * chain (a misconfigured mainnet RPC, say) counts as unusable, so a sweep can
 * never go out on real money.
 */
export async function sepoliaReachable(timeoutMs = 5000): Promise<boolean> {
  const rpc = process.env.EXPO_PUBLIC_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { result?: string };
    return json.result != null && parseInt(json.result, 16) === SEPOLIA_CHAIN_ID;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
