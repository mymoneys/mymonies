**Demo video (internet off):** https://youtu.be/jJhCe_lXYGc
**Code:** https://github.com/mymoneys/mymonies/tree/ai-yako-hackathon

## The problem
Most Kenyans are paid through M-Pesa, and "pay yourself first" rarely happens. By the time you've thought about saving, the money has gone on bills and daily spending. Budgeting apps ask you to type everything in by hand, and cloud AI tools mean sending your financial SMS to someone else's server.

## What Akiba Agent does
*Akiba* is Swahili for savings. When an M-Pesa income SMS arrives:

1. **It classifies the income (rules first, offline AI for unclear cases).** It decides whether the money is salary, a client payment, a gift, a refund, a reversal or a **loan** (Fuliza, M-Shwari, Tala and similar). Clear cases are settled by rules; the on-device model is asked only when they're unsure. Loans and reversals are never swept, because saving borrowed money is the classic mistake.
2. **It works out a safe ceiling (code, not AI).** The ceiling is your M-Pesa balance, minus bills due before payday, minus projected daily spending, minus a buffer.
3. **It proposes an amount (offline AI).** The model picks a strategy (skip, conservative or standard) and the main reason, choosing only from reasons that are true for your numbers (grammar-constrained output). The app writes the reason in English or Kiswahili, and code turns the strategy into a shilling amount, so the model never produces a number.
4. **You approve with your fingerprint** after reviewing the amount and its USDt equivalent on screen.
5. **The money moves (online, WDK).** The USDt equivalent goes from your spending account (#0) to your savings account (#1), both in a self-custodial WDK wallet on Sepolia. If you approve while offline, the sweep is queued and sent automatically when you're back online.

## Key features
- Reads M-Pesa SMS automatically: inbox backfill plus live capture from notifications
- On-device AI income classifier and savings proposal, with no cloud AI calls
- Bilingual explanations (English / Kiswahili); the language is switchable app-wide from Profile
- A "Why this amount?" breakdown showing every number behind the proposal
- Safety rules override the AI: loan, refund and reversal income are always skipped; in "Survival Mode" (low runway) the proposal is capped at conservative
- Fallback to a labelled rule-based proposal if the model's output is invalid, so the flow never stalls
- Offline approval queue that sends when the network returns
- ERC-4337 smart accounts with the Candide paymaster, so gas is paid in test USDt and no Sepolia ETH is needed
- Dashboard, budgets, Needs/Wants/Savings split and CSV export from the existing MyMonies app

## Offline vs. online
| Feature | Needs internet? |
|---|---|
| SMS capture, parsing, dashboards | No |
| AI income classification and savings proposal | **No (QVAC on the device)** |
| KES → USDt conversion preview | No (cached rate) |
| Fingerprint approval and queuing | No |
| One-time model download | Yes |
| Exchange-rate refresh | Optional |
| Wallet balances and sending the sweep (Sepolia RPC, Candide bundler/paymaster) | Yes |

## Tech stack
- **Offline AI:** QVAC SDK 0.22.0 running **Qwen3 0.6B (Q4)** on the CPU, with grammar-constrained JSON-schema output
- **Wallet:** Tether WDK 1.0.0-beta.16 (`wdk-react-native-core`, `wdk-wallet-evm-erc-4337`) on Sepolia
- **App:** React Native / Expo SDK 54, SQLite, Kotlin native modules for SMS, `expo-local-authentication`
- **Tested on:** Xiaomi Redmi 10, Android 13, arm64, 3.6 GB RAM

## Why AI here, and how it's kept safe
The AI makes the two calls rules handle badly: what an ambiguous incoming payment really is, and how cautious to be this month. Everything else is kept out of its hands:
- All arithmetic runs in code.
- The destination address is hard-coded to your own savings account.
- Only messages from the `MPESA` sender trigger the agent.
- The model only fills fixed schemas, which limits prompt injection through SMS.

## Honest disclosures
- **Built on an existing app.** The SMS ingestion, parser, dashboards and budgets existed before the event (git tag `pre-ai-yako`). Everything after that tag (`src/akiba/`, `src/ai/`, `src/wallet/`, `src/plan/`, `src/demo/`, `scripts/eval/`, i18n) is new. The repo README and `docs/README.md` (section 4) list the exact split, and `docs/DEMO.md` has the demo steps.
- **Simulated on-ramp.** KES → USDt uses a stored demo rate, and the spending account is pre-funded with test USDt from a faucet. The only real on-chain action is the testnet transfer from #0 to #1.
- **Wallet signer stopgap.** Inside the same app as QVAC, the WDK worklet currently fails to start (`ADDON_NOT_FOUND: bare-thread`). In the demo build, the AI decision and fingerprint approval run on the phone, and the approved sweep is signed by `scripts/wallet/cli.ts` using the same WDK ERC-4337 module and accounts. The next step is on-device signing after a WDK / Expo SDK 55 upgrade.
- **Eval results.** On a synthetic 21-message inbox, the hybrid classifier (rules first, AI only when the rules are unsure) scores 81%, the same as rules alone. On the savings decision, all 8 test cases now produce valid output that passes validation (`scripts/eval/sweep.ts`). The model still leans cautious, so outside Survival Mode the safety rules raise a "skip" to "save a little", and the card says so ("kept within your safety limit"). Eval scripts are included (`npm run eval:income`).

## Third-party credits
QVAC SDK, Tether WDK, Qwen3 (Alibaba), Candide bundler/paymaster and faucet, Pimlico faucet.
