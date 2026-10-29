import { BaseAsset, type WdkConfigs } from '@tetherto/wdk-react-native-core';
import { erc4337Config } from './sepolia';

export { SAVINGS_ACCOUNT, SEPOLIA_CHAIN_ID, SPENDING_ACCOUNT } from './sepolia';

/**
 * Sepolia-only wallet config. Two accounts from one seed:
 *   #0 "spending" — pre-funded from a test-USDt faucet (stands in for the
 *                   simulated M-Pesa -> USDt on-ramp)
 *   #1 "savings"  — where every Akiba sweep goes; the agent can't choose
 *                   any other destination.
 *
 * ERC-4337 smart accounts with Candide's public bundler/paymaster: gas is
 * paid in the test token, so no Sepolia ETH is needed.
 *
 * EXPO_PUBLIC_SEPOLIA_TEST_TOKEN_ADDRESS comes from .env (gitignored; see
 * .env.example). Use the 6-decimal test USDt the Candide faucet mints — WDK's
 * docs publish no fixed Sepolia address, it must match the paymaster.
 */

export const WALLET_ID = 'akiba-main';

export function testTokenAddress(): string | null {
  const address = process.env.EXPO_PUBLIC_SEPOLIA_TEST_TOKEN_ADDRESS ?? '';
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null;
}

export function buildWdkConfigs(tokenAddress: string): WdkConfigs {
  return {
    networks: {
      ethereum: {
        blockchain: 'ethereum',
        config: erc4337Config(tokenAddress, process.env.EXPO_PUBLIC_SEPOLIA_RPC),
      },
    },
  } as WdkConfigs;
}

export function testUsdt(tokenAddress: string): BaseAsset {
  return new BaseAsset({
    id: 'usdt-sepolia',
    network: 'ethereum',
    symbol: 'USDT',
    name: 'Test USDt (Sepolia)',
    decimals: 6,
    isNative: false,
    address: tokenAddress,
  });
}

export function explorerTxUrl(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}
