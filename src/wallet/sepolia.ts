/**
 * Sepolia ERC-4337 settings shared by the app (src/wallet/config.ts) and the
 * laptop signer (scripts/wallet/cli.ts), so the two can never drift apart.
 * No React Native imports: this file also runs under Node.
 */

export const SEPOLIA_CHAIN_ID = 11155111;
export const SPENDING_ACCOUNT = 0;
export const SAVINGS_ACCOUNT = 1;
export const DEFAULT_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

const CANDIDE_SEPOLIA = `https://api.candide.dev/public/v3/${SEPOLIA_CHAIN_ID}`;
// From Candide's pm_supportedERC20Tokens on Sepolia (checked 2026-10-23).
export const CANDIDE_PAYMASTER = '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba';

export function erc4337Config(tokenAddress: string, rpc?: string) {
  return {
    chainId: SEPOLIA_CHAIN_ID,
    provider: rpc || DEFAULT_SEPOLIA_RPC,
    bundlerUrl: CANDIDE_SEPOLIA,
    paymasterUrl: CANDIDE_SEPOLIA,
    paymasterAddress: CANDIDE_PAYMASTER,
    safeModulesVersion: '0.3.0',
    transferMaxFee: 5_000_000,
    paymasterToken: { address: tokenAddress },
  };
}

/**
 * WDK's ERC-4337 transfer() returns the UserOperation hash, not a transaction
 * hash, so an Etherscan /tx/ link built from it shows nothing. The bundler
 * maps one to the other once the operation is mined. Returns null if it
 * isn't mined within the timeout (the caller can show the UserOp hash).
 */
export async function resolveUserOpTxHash(userOpHash: string, timeoutMs = 60_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(CANDIDE_SEPOLIA, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getUserOperationReceipt', params: [userOpHash] }),
      });
      const json = (await res.json()) as { result?: { receipt?: { transactionHash?: string } } | null };
      const tx = json.result?.receipt?.transactionHash;
      if (tx) return tx;
    } catch {
      // Network hiccup: retry until the deadline.
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}
