# MyMonies — Akiba Agent

An M-Pesa money tracker for Android with **Akiba Agent** ("akiba" is Swahili for savings): when income lands on M-Pesa, an AI model running **offline on the phone** works out how much you can safely save before payday and explains why. You approve with your fingerprint, and the USDt equivalent moves from a spending account to a savings account in a self-custodial Tether WDK wallet (Sepolia testnet).

- **Demo video (internet off):** https://youtu.be/jJhCe_lXYGc
- **DoraHacks build:** https://dorahacks.io/build/50333 (AI Yako hackathon, Offline AI apps track)
- **Demo runbook:** [`docs/DEMO.md`](docs/DEMO.md) · **Build log and design:** [`docs/README.md`](docs/README.md)

## How it works

1. **Income SMS** is parsed on the device (`src/parser.ts`).
2. **Classification:** rules settle clear cases (salary from a regular employer, lenders, reversals); the on-device model is asked only when they're unsure. Loans and reversals are never saved.
3. **Safe ceiling (code):** M-Pesa balance − unpaid budget bills this cycle − usual spending until payday − emergency buffer.
4. **Decision (on-device AI):** Qwen3 0.6B picks a strategy (skip / conservative / standard) and the main reason. The JSON schema only offers reasons that are true for the user's numbers, and code turns the strategy into a shilling amount, so the model never produces a number. Safety rules can override it, and the card says so.
5. **Approval:** fingerprint, offline.
6. **Transfer (online):** test USDt from account #0 to #1 via WDK ERC-4337 with the Candide paymaster (gas paid in test USDt).

## Offline vs. online

| Feature | Internet? |
| --- | --- |
| SMS capture and parsing, dashboards, budgets | No |
| AI classification and savings decision (QVAC) | **No** |
| "Why this amount?" breakdown, KES → USDt preview (cached rate) | No |
| Fingerprint approval | No |
| One-time model download | Yes |
| Sending the transfer and the phone's on-chain confirmation (Sepolia RPC, Candide bundler/paymaster) | Yes |
| Real deployment only: live exchange rate, licensed on-ramp | Yes |

## Setup

Requirements: Node 22, Android SDK/NDK, an arm64 Android phone (Android 10+) with USB debugging.

```bash
npm install                 # also links the WDK native addons (scripts/link-wdk-addons.sh)
cp .env.example .env        # fill in the test token address; set EXPO_PUBLIC_DEMO_MODE=1
npx expo run:android        # or: cd android && ./gradlew assembleRelease
```

Never run `expo prebuild --clean`: it deletes the Kotlin SMS modules (see `docs/README.md`, section 6).

Wallet (laptop signer, testnet only):

```bash
npm run wallet -- create        # seed saved to data/wallet/seed.txt (gitignored, never printed)
npm run wallet -- addresses     # fund #0 at https://dashboard.candide.dev/faucet
npm run wallet -- balance
npm run wallet -- sweep <amount>   # the exact command is shown in the app after approval
npm run wallet -- refill <amount>  # move test USDt back from #1 to #0 between demo takes
```

Copy the two public addresses into `.env` (`EXPO_PUBLIC_SPENDING_ADDRESS`, `EXPO_PUBLIC_SAVINGS_ADDRESS`) so the phone can confirm transfers.

## Reproduce the AI offline

1. With internet on, open the **Akiba** tab once so the model downloads.
2. Turn on airplane mode (Wi-Fi off).
3. Akiba → **Reset demo** → **Load 4 months** (once) → **+ salary SMS**.
   "Akiba is thinking on this phone…" appears, then a proposal "suggested by the AI" with a "Why this amount?" breakdown.
4. **+ loan SMS** → "Save nothing".
5. Approve with your fingerprint. Then turn Wi-Fi on, run the command shown in the app, and the card becomes "Saved ✓".

Tests and evals:

```bash
npm test                        # unit tests (Node test runner)
npm run eval:income             # income classifier, same model and prompts as the phone
node --experimental-strip-types --no-warnings scripts/eval/sweep.ts   # savings decision
```

## QVAC and WDK

- **QVAC SDK 0.22.0** (`@qvac/sdk`, `@qvac/fabric-android-arm64`), model `QWEN3_600M_INST_Q4`, CPU only, `ctx_size` 1024, about 9 s per decision on the test phone. Code: `src/ai/qvac.ts`, `src/ai/schemas.ts`, `src/akiba/agent.ts`, `src/akiba/runner.ts`, `qvac.config.mjs`.
- **Tether WDK 1.0.0-beta.16** (`@tetherto/wdk`, `wdk-wallet-evm-erc-4337`, `wdk-react-native-core`) on Sepolia. Code: `src/wallet/`, `scripts/wallet/cli.ts`, `wdk.config.js`.
- **Tested on:** Xiaomi Redmi 10 (Helio G88), Android 13, arm64-v8a, 3.6 GB RAM.

## Built during AI Yako vs. reused

- **Reused** (everything up to git tag [`pre-ai-yako`](../../tree/pre-ai-yako)): the MyMonies tracker. SMS backfill and live capture (Kotlin), M-Pesa parser, SQLite store, rules, dashboards, budgets, CSV export, redacted sample sharing.
- **Built during the event** (`git diff --stat pre-ai-yako..HEAD`): `src/ai/`, `src/akiba/`, `src/wallet/`, `src/plan/`, `src/demo/`, `scripts/eval/`, `scripts/wallet/`, QVAC/WDK config, English/Kiswahili i18n (`src/i18n.tsx`, `src/strings.ts`), new app icon, and small hooks in `App.tsx`, `src/db.ts`, `src/backgroundSync.ts`, `src/ProfileScreen.tsx`, `app.json`.
- **Third-party:** QVAC SDK, Tether WDK, Qwen3 (Alibaba), Candide bundler/paymaster and faucet, Pimlico faucet.

## Disclosures

- **Simulated on-ramp:** KES → USDt uses a fixed, dated demo rate; no real money is converted. The spending account is pre-funded from a testnet faucet.
- **Testnet only:** all transfers are on Sepolia.
- **Laptop signer:** inside the same app as QVAC, the WDK worklet fails to start (`ADDON_NOT_FOUND: bare-thread`), so approved sweeps are signed by `scripts/wallet/cli.ts` with the same WDK module and accounts. The AI decision and the approval run on the phone.
- **Synthetic demo data:** demo builds use a separate database and never read real SMS.
