import type { ReactNode } from 'react';
import { WdkAppProvider } from '@tetherto/wdk-react-native-core';
import { bundle } from '../../.wdk';
import { buildWdkConfigs, testTokenAddress } from './config';

/**
 * "laptop": sweeps are signed by scripts/wallet/cli.ts instead of the in-app
 * worklet. A stopgap: the WDK worklet currently aborts on start next to QVAC
 * (ADDON_NOT_FOUND for bare-thread), see docs/README.md.
 */
export const WALLET_SIGNER: 'device' | 'laptop' =
  process.env.EXPO_PUBLIC_WALLET_SIGNER === 'laptop' ? 'laptop' : 'device';

/**
 * Starts the WDK worklet only when a test token is configured. Without one
 * (no .env), the app runs exactly as before and the Akiba tab explains the
 * setup — the agent and its proposals still work, sends just can't happen.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const token = testTokenAddress();
  if (!token || WALLET_SIGNER === 'laptop') return <>{children}</>;
  return (
    <WdkAppProvider bundle={{ bundle }} wdkConfigs={buildWdkConfigs(token)} clearSensitiveDataOnBackground>
      {children}
    </WdkAppProvider>
  );
}

export function walletConfigured(): boolean {
  return testTokenAddress() != null && WALLET_SIGNER === 'device';
}
