// Laptop signer for the Akiba testnet wallet — a stopgap while the in-app WDK
// worklet fails to start next to QVAC (see docs/README.md, "Wallet signer").
// Same seed derivation, Sepolia config and accounts as the app would use.
//
//   npm run wallet -- create     new seed in data/wallet/seed.txt (never printed)
//   npm run wallet -- addresses  spending (#0) and savings (#1) addresses
//   npm run wallet -- balance    test-USDt balances of both
//   npm run wallet -- sweep 2.50 [--quote]   move USDt from #0 to #1
//   npm run wallet -- refill 50   move USDt back from #1 to #0 (resets the demo)
//
// TESTNET ONLY. The seed lives in plain text on this laptop, which is fine for
// Sepolia test tokens and wrong for anything real.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import WalletManagerEvmErc4337 from '@tetherto/wdk-wallet-evm-erc-4337';
import { SAVINGS_ACCOUNT, SPENDING_ACCOUNT, erc4337Config, resolveUserOpTxHash } from '../../src/wallet/sepolia.ts';
import { formatUsdt, USDT_DECIMALS } from '../../src/akiba/conversion.ts';

const SEED_DIR = 'data/wallet';
const SEED_FILE = `${SEED_DIR}/seed.txt`;

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

function token(): string {
  const t = env('EXPO_PUBLIC_SEPOLIA_TEST_TOKEN_ADDRESS');
  if (!t || !/^0x[0-9a-fA-F]{40}$/.test(t)) throw new Error('Set EXPO_PUBLIC_SEPOLIA_TEST_TOKEN_ADDRESS in .env');
  return t;
}

function openWallet(): WalletManagerEvmErc4337 {
  if (!existsSync(SEED_FILE)) throw new Error(`No wallet yet — run: npm run wallet -- create`);
  const seed = readFileSync(SEED_FILE, 'utf8').trim();
  return new WalletManagerEvmErc4337(seed, erc4337Config(token(), env('EXPO_PUBLIC_SEPOLIA_RPC')));
}

/** "2.50" -> 2500000n, without float rounding. */
function parseUsdt(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!m) throw new Error(`Not a USDt amount: ${text}`);
  return BigInt(m[1]) * 10n ** BigInt(USDT_DECIMALS) + BigInt((m[2] ?? '').padEnd(USDT_DECIMALS, '0'));
}

async function main() {
  const [cmd, arg, flag] = process.argv.slice(2);

  if (cmd === 'create') {
    if (existsSync(SEED_FILE)) throw new Error(`${SEED_FILE} already exists — refusing to overwrite a wallet`);
    mkdirSync(SEED_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(SEED_FILE, WalletManagerEvmErc4337.getRandomSeedPhrase(12) + '\n', { mode: 0o600 });
    chmodSync(SEED_FILE, 0o600);
    console.log(`Seed phrase saved to ${SEED_FILE} (owner-only; gitignored). It is not printed.`);
  }

  const wallet = openWallet();
  try {
    const spending = await wallet.getAccount(SPENDING_ACCOUNT);
    const savings = await wallet.getAccount(SAVINGS_ACCOUNT);
    const [from, to] = [await spending.getAddress(), await savings.getAddress()];

    if (cmd === 'create' || cmd === 'addresses') {
      console.log(`#0 spending: ${from}   <- fund this one at the Candide faucet`);
      console.log(`#1 savings:  ${to}`);
    } else if (cmd === 'balance') {
      const t = token();
      console.log(`#0 spending: ${formatUsdt(String(await spending.getTokenBalance(t)))} USDt`);
      console.log(`#1 savings:  ${formatUsdt(String(await savings.getTokenBalance(t)))} USDt`);
    } else if (cmd === 'sweep') {
      // Destination is always our own savings account, as in the app.
      const options = { token: token(), recipient: to, amount: parseUsdt(arg ?? '') };
      if (flag === '--quote') {
        const q = await spending.quoteTransfer(options);
        console.log(`Fee: ${formatUsdt(String(q.fee))} USDt (paid in USDt via Candide paymaster)`);
      } else {
        const r = await spending.transfer(options);
        console.log(`Sent ${arg} USDt #0 -> #1. Fee ${formatUsdt(String(r.fee))} USDt`);
        console.log(`UserOperation: ${r.hash}`);
        const tx = await resolveUserOpTxHash(r.hash);
        console.log(tx ? `https://sepolia.etherscan.io/tx/${tx}` : 'Not mined yet — check the UserOperation hash on a 4337 explorer.');
      }
    } else if (cmd === 'refill') {
      // Demo reset only: tops spending back up from our own savings account.
      const r = await savings.transfer({ token: token(), recipient: from, amount: parseUsdt(arg ?? '') });
      console.log(`Sent ${arg} USDt #1 -> #0. Fee ${formatUsdt(String(r.fee))} USDt`);
      const tx = await resolveUserOpTxHash(r.hash);
      console.log(tx ? `https://sepolia.etherscan.io/tx/${tx}` : `UserOperation: ${r.hash}`);
    } else if (cmd !== 'create') {
      console.log('Commands: create | addresses | balance | sweep <amount> [--quote] | refill <amount>');
    }
  } finally {
    wallet.dispose();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
