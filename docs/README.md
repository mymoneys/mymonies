# MyMonies × AI Yako — "Akiba Agent" build plan

As of 2026-10-22 · Branch `ai-yako-hackathon` · Track: **Agentic finance with WDK** (and eligible for the overall prize)

**Decisions made:**

- Concept C, built solo.
- Designed for **your phone**: Redmi 10, Android 13, arm64, 3.6 GB RAM.
- Testnet: Sepolia.
- The sweep moves money from a spending account to a savings account. A simulated KES → USDt conversion is part of the demo.
- Scope is a single flow: income arrives → "safe to save" amount with reasons → approve with fingerprint → testnet transfer.
- Pre-existing code is eligible, and the repo will clearly separate what existed before from what was built during the event.

---

## Build log and findings (updated 2026-10-23)

**Timing disclosure:** Akiba feature work started on 22 Oct 2026, before the 24 Oct kickoff. The pre-event baseline is tag `pre-ai-yako` (`c6202e7`). Everything after it is listed in section 4.

**History disclosure:** On 2 Nov 2026 the Git history was rewritten to remove personal data committed by mistake: a budget file and a private phone number. Commit hashes changed, including the ones cited here, and any older links to commits no longer match this history. Commit dates, authors and messages were kept, and the only other change to the files is the phone number replaced with a placeholder.

| What | Status | Notes |
| --- | --- | --- |
| QVAC SDK 0.22.0 in the app | ✅ builds | `qvac.config.mjs` limits the bundle to the LLM engine (42 native files instead of 91) |
| WDK RN core 1.0.0-beta.16 on Expo SDK 54 | ✅ builds | beta.16 depends on `expo-crypto@56`; `package.json` `overrides` pin `expo-crypto` 15.0.9 and `expo-local-authentication` 17.0.9 (SDK 54) |
| `expo prebuild` safety | ✅ | Plain prebuild (never `--clean`) keeps the Kotlin SMS modules. It overwrites the manifest and launcher icons, so restore them from git after each prebuild (see section 6). |
| Structured output | ✅ | `responseFormat: json_schema` (grammar-constrained) instead of tool calls. Enums are enforced, **numeric min/max are not** (the model returned `confidence: 200`), so confidence is an enum. |
| Model choice | **Qwen3 0.6B** | On the demo eval, 1.7B scored the same (64%) and was about 2.7× slower (median 16.5 s vs 6.1 s on a laptop) |
| Desktop eval (`npm run eval:income`) | see below | Same prompts and model as the phone, run through QVAC on Linux |

**Income classifier, synthetic demo inbox (21 income messages):**

| Setup | Accuracy |
| --- | --- |
| AI on everything, first prompt | AI 29% on ambiguous cases (labelled almost everything `business_income`) |
| + few-shot examples | AI 64%; hybrid 76% vs rules-only 81% |
| **Rules first, AI only when rules are unsure (current)** | AI 78% on the 9 cases it gets; hybrid **81%** = rules-only 81% |

On synthetic data the AI does not beat the rules yet. That's expected, since the same person wrote the rules and the data generator. **The real test is labelled real messages**: run `npm run eval:income -- data/records/labelled.json`, with the file kept in gitignored `data/`. The AI's clear contribution today is choosing the sweep strategy and writing the bilingual reasons. Don't claim classifier gains until the real-data eval shows them.

**Wallet signer (stopgap, disclose in the submission):**
- **What fails:** next to QVAC, the in-app WDK worklet (RN core beta.16, `react-native-bare-kit` 0.16) aborts on start with `ADDON_NOT_FOUND` for `bare-thread`.
- **What was fixed on the way:** two missing native addons. `scripts/link-wdk-addons.sh` links them.
- **What happens instead:** in this build, `EXPO_PUBLIC_WALLET_SIGNER=laptop`.
    - The AI decision, the fingerprint approval and the offline queue all run on the phone.
    - Approved sweeps show the exact `npm run wallet -- sweep <amount>` command.
    - `scripts/wallet/cli.ts` signs it with the same WDK ERC-4337 module, Sepolia config and accounts.
- **Seed:** `data/wallet/seed.txt`, gitignored and mode 600. Acceptable only because it holds testnet funds.
- **Next:** a clean build with on-device signing, by upgrading WDK or moving to Expo SDK 55.

**Demo build:** `EXPO_PUBLIC_DEMO_MODE=1` uses `mpesa-demo.db` and never reads the SMS inbox. The Akiba tab then offers "Load 4 months" plus loan, salary and reversal SMS buttons for the video.

---

## 1. Summary

**Akiba Agent** ("akiba" is Swahili for savings). When an M-Pesa income SMS arrives, an AI on your phone works out:

- what kind of money it is (salary, client payment, or a loan you'll have to repay)
- how much you can safely set aside before payday, given your budgets and upcoming bills

It proposes that amount with a short reason in English or Swahili. You approve with your fingerprint, and the agent moves the USDt equivalent from your spending account to your savings account. Both accounts are in a self-custodial WDK wallet on Sepolia.

**What runs offline vs. online:**

- **Offline:** everything up to and including your approval.
- **Online:** only the blockchain transfer and the exchange-rate refresh. If you approve while offline, the sweep is queued and sent automatically once you're back online.

**Why it should score:**

- **Real user value:** "pay yourself first" savings, built from the SMS you already get.
- **Meaningful QVAC use:** the AI makes the two judgement calls the app can't make with rules.
- **Working WDK integration:** self-custody with two accounts.
- **Clear offline/online split:** the rules ask for exactly this separation.
- **Strong base:** about 5,600 lines of pre-existing, working M-Pesa ingestion.

---

## 2. Your phone, and what it allows

Checked over USB with `adb`:

| Property | Value | Consequence |
| --- | --- | --- |
| Model | Xiaomi Redmi 10 (`21061119AG`, "selene", MediaTek Helio G88) | GPU is Mali. QVAC's Android GPU support targets Vulkan, and OpenCL on Adreno 700+, so **plan for CPU inference**. |
| Android | 13 | ✔ QVAC needs 12+, WDK needs API 29+ |
| ABI | arm64-v8a | ✔ |
| RAM | 3.6 GB total | QVAC keeps up to 1 GB free for the system on mobile. **Use `QWEN3_600M_INST_Q4` (about 0.4 GB, approximate).** Never keep the LLM loaded while the wallet is sending. |
| Free storage | 24 GB | ✔ for models |

**Design rules that follow from this:**

1. **One small model, `QWEN3_600M_INST_Q4`, with a short context** (`ctx_size` 1024–2048). Check it on Day 0 with `assessModelFit()`.
2. **Load the model only while the agent runs, then unload it** before unlocking the wallet. The QVAC and WDK engines each run in their own background runtime (a Bare worklet), and only one should be busy at a time.
3. **Keep every prompt short and single-shot.** Each decision is one tool call with `tool_choice: "required"`, not a multi-step agent loop. A 0.6B model handles one constrained call far more reliably than a loop.
4. **All arithmetic stays in code.** The model chooses from options and writes the explanation. The deterministic planner sets hard limits it can't exceed.
5. **Fallback:** if the model's output fails validation, the proposal falls back to a rule-based one and is labelled as such. The demo never stalls.

---

## 3. Hackathon requirements (official, from the DoraHacks page)

| Item | Requirement |
| --- | --- |
| Dates (EAT) | Kickoff **Sat 24 Oct 09:00** · mid-week offline check **Wed 28 Oct** · **deadline Fri 30 Oct 17:00** · demo day **Sat 31 Oct** |
| Prizes | Overall 1,500 · Cloud to Pocket 900 · Offline AI 700 · **Agentic finance with WDK 400** (USDt) |
| Core rule | QVAC must be used meaningfully, and the core AI feature must work offline. A cloud AI API for that feature means no prize. |
| Finance track | WDK is required. Network actions must be declared separately and **cannot replace the offline AI demo**. Payments are demonstrated with test data in a test environment. |
| Submit | • repo with setup steps and dependencies, **a note on what was built during the event, and disclosure of existing and third-party code** <br>• demo video with the internet off <br>• QVAC versions, model, setup steps and files; WDK integration explained <br>• device, OS, memory, licences <br>• network-feature list <br>• no secrets, seed phrases or private data |
| Judging | User value · meaningful QVAC use · working implementation · usability · clarity and reproducibility of the offline demo |

Organiser confirmed (per you): pre-existing projects are eligible, provided the before/after split is clear.

---

## 4. Pre-existing vs. built during AI Yako

Judges must be able to see the split at a glance. The repo makes it unambiguous in four ways:

1. **Git tag `pre-ai-yako`** on the last commit before kickoff. Commit or stash your current uncommitted icon and `app.json` changes first, so they count as pre-existing. Every event commit is prefixed `[ai-yako]`.
2. **New code lives in new folders:** `src/akiba/`, `src/ai/`, `src/wallet/` and `scripts/eval/`. Changes to pre-existing files are kept small and listed below.
3. **The README's "Built during AI Yako" section** is generated at submission with `git diff --stat pre-ai-yako..HEAD`.
4. **Third-party work** is credited by name: QVAC SDK, WDK, Qwen3 model, Candide paymaster/bundler, Pimlico/Candide faucets.

### Pre-existing (before 24 Oct 2026, commits `435f99b`…`6b8db3b`)

| Capability | Files |
| --- | --- |
| SMS inbox backfill and incremental sync (Kotlin native module) | `android/.../SmsReaderModule.kt`, `src/backfill.ts`, `src/smsInbox.ts` |
| Live capture through the notification listener | `NotificationCaptureListenerService.kt`, `TransactionDb.kt` |
| Regex M-Pesa parser (received, sent, paid, withdrawn, airtime, M-Shwari, failed) | `src/parser.ts` |
| SQLite store, dedupe, rules engine, keyword classifier, groups, Needs/Wants/Savings | `src/db.ts`, `src/rules.ts`, `src/builtinClassifier.ts`, `src/groupMapping.ts`, `src/lifeCategory.ts` |
| Dashboard, transactions, rules, profile (payday and budgets), CSV export | `src/*Screen.tsx`, `src/analytics.ts`, `src/export.ts` |
| Opt-in redacted parser-sample sharing | `src/contributions.ts`, `src/redact.ts` (+ 11 tests) |

### Built during AI Yako (planned)

| Capability | Files |
| --- | --- |
| QVAC integration, model manager, fit check | `src/ai/qvac.ts`, `src/ai/AiStatusCard.tsx` |
| AI income classifier | `src/ai/classifyIncome.ts` |
| Safe-to-save planner (deterministic) + AI proposal | `src/akiba/planner.ts`, `src/ai/proposeSweep.ts`, `src/akiba/validate.ts` |
| WDK wallet: create/unlock, spending (#0) and savings (#1) accounts, balances, send | `src/wallet/*`, `.wdk/` bundle, `wdk.config.js` |
| Simulated KES → USDt conversion and rate cache | `src/akiba/conversion.ts` |
| Sweep queue (approved offline → sent when online) | `src/akiba/queue.ts` |
| Akiba tab: proposal card, approval, history | `src/akiba/AkibaScreen.tsx` |
| Synthetic demo inbox, labelled fixtures, eval script | `src/demo/`, `scripts/eval/` |
| P1: Financial round-up (runway, lean burn, Survival Mode) + 5-question AI interview | `src/plan/metrics.ts`, `src/plan/interview.ts`, `src/plan/RoundupScreen.tsx` |
| Docs: README rewrite, `docs/QVAC.md`, `docs/WDK.md` | `README.md`, `docs/` |

**Small changes to pre-existing files:**

- `app.json`: plugins and `minSdkVersion` 29
- `App.tsx`: providers and a new tab
- `db.ts`: new tables via `ensureColumn` / `CREATE TABLE IF NOT EXISTS`
- `backgroundSync.ts`: trigger the agent on new income

---

## 5. Product design

### The one flow

1. **Income detected.** The existing parser stores a `RECEIVED` M-Pesa transaction (from the live notification, or a demo inbox SMS).
2. **AI income classifier (offline, QVAC).** One tool call, `classify_income`, labels it as `salary`, `business_income`, `personal_gift`, `loan_disbursement`, `refund` or `reversal`, with a confidence. Loan money (Fuliza, M-Shwari, Tala and similar) and reversals are **never** swept, because sweeping borrowed money is the classic mistake.
3. **Deterministic planner (offline, code).** Works out `max_safe_kes` as: current M-Pesa balance (from the SMS), minus unpaid budget items due before the next payday (Profile budgets), minus projected daily spending until payday (from history), minus a buffer.
4. **AI proposal (offline, QVAC).** One tool call, `propose_sweep`. The model picks a strategy (`skip` / `conservative` = 25% of the ceiling / `standard` = 50%) and writes `reason_en` and `reason_sw`. **Code turns the strategy into the amount**, rounded down to Ksh 50 with a Ksh 100 minimum, so the model never produces a number. Safety rules override the model: loan, refund or reversal income always means skip, and Survival Mode caps the strategy at conservative. If the output is invalid, a rule-based proposal (labelled) is used. Implemented in `src/akiba/agent.ts`.
5. **Conversion preview (offline).** KES amount → USDt using the cached rate, clearly labelled **"Simulated on-ramp — demo rate from <date>"**.
6. **Approval.** You approve with your fingerprint (`expo-local-authentication`). WDK beta doesn't enforce biometrics itself, so the app does.
7. **Send (online, WDK).** `useAccount({network:'ethereum', accountIndex:0}).send({ to: savingsAddress, asset: USDt, amount })`, from spending account #0 to savings account #1. ERC-4337 with the Candide paymaster means **gas is paid in test USDt, so no Sepolia ETH is needed**. If you're offline, the approved sweep waits in the queue with status `queued_offline` and is sent automatically once the network returns. Signing happens only at send time.
8. **Result.** The Akiba tab shows the transaction hash (with a Sepolia explorer link), both account balances, and the running total saved.

### How the conversion demo works (honest version)

- **No real money changes hands.** Before the demo, the spending account (#0) is pre-funded with test USDt from the [Pimlico](https://dashboard.pimlico.io/test-erc20-faucet) or [Candide](https://dashboard.candide.dev/faucet) faucet. In the story, this stands in for "M-Pesa converted to USDt".
- **The rate is a stored snapshot.** It's refreshed when online (a declared network feature) or entered by hand, and the UI shows its date. The demo video says out loud that this is a simulated on-ramp.
- **The only real on-chain action is the testnet transfer from account #0 to #1,** sized by the AI's proposal.
- **Production would replace the simulated step** with a licensed on-ramp. WDK documents fiat on/off-ramp modules; that's out of scope here, and Kenyan virtual-asset licensing would apply.

### Offline vs. network (for the submission's required list)

| Feature | Network? |
| --- | --- |
| SMS capture, parsing, dashboards | No (SMS needs cellular signal, not internet) |
| AI income classification and sweep proposal | **No** (QVAC on the device) |
| Conversion preview | No (uses the cached rate) |
| Approval and queuing | No |
| Model download (one-time) | Yes |
| Exchange-rate refresh | Yes (optional; a manual rate also works) |
| Wallet balance refresh, sending the sweep (Sepolia RPC, Candide bundler/paymaster) | Yes |
| Contribute sharing, CSV share (pre-existing) | Yes |

### Safety

- **Prompt injection via SMS:**
    - The model only fills two fixed schemas, with enums and a numeric maximum set by code.
    - It can't choose a recipient: the destination is always your own account #1, hard-coded.
    - Only `MPESA` sender messages trigger the agent.
- **No transfer without your fingerprint and an on-screen review** of amount, recipient, asset and fee, as WDK's docs require.
- **Seed protection:**
    - WDK stores it in the keychain (`react-native-keychain`).
    - It's never logged, never in the repo, and never shown in the video.
    - The `.env` holding the test token address is gitignored; only `.env.example` is committed.
- **Testnet guard:** the network config is pinned to chain ID 11155111, and the app refuses to start the wallet on any other chain.

---

## 6. Architecture

```
 MPESA SMS ─► Kotlin capture (existing) ─► SQLite transactions (existing)
                                               │ new RECEIVED row
                                               ▼
                           src/akiba/trigger (in backgroundSync, existing loop)
                                               │
          ┌──────────────── OFFLINE ───────────┼────────────────────────────────┐
          │                                    ▼                                │
          │   QVAC worklet: load QWEN3_600M ─► classify_income (tool, enum)     │
          │                                    │  loan / reversal → stop        │
          │   planner.ts (code): balance, budgets till payday, velocity, buffer │
          │                                    ▼  max_safe_kes                  │
          │   QVAC: propose_sweep (tool, 0..max) ─► validate.ts ─► unload model │
          │                                    ▼                                │
          │   conversion.ts (cached rate) ─► Akiba card ─► fingerprint approve  │
          │                                    ▼                                │
          │                         sweep_queue (status: approved)              │
          └────────────────────────────────────┼────────────────────────────────┘
                                               ▼  online?
          ┌──────────────── NETWORK ───────────┼────────────────────────────────┐
          │   WDK worklet: unlock ─► account #0.send(USDt → account #1)         │
          │   ERC-4337 · Candide bundler/paymaster · Sepolia 11155111           │
          │   ─► tx hash → sweep_queue (sent) → balances refresh                │
          └─────────────────────────────────────────────────────────────────────┘
```

### New data (in the existing `mpesa.db`)

| Table | Columns |
| --- | --- |
| `income_labels` | `transaction_id`, `label`, `confidence`, `source` (`ai` \| `rule`), `model`, `created_at` |
| `sweep_proposals` | `id`, `transaction_id`, `max_safe_kes`, `amount_kes`, `strategy`, `reason_en`, `reason_sw`, `source`, `rate`, `rate_date`, `amount_usdt_base`, `status` (`proposed`/`approved`/`queued_offline`/`sent`/`failed`/`declined`), `tx_hash`, `created_at`, `updated_at` |
| `ai_runs` | `id`, `task`, `latency_ms`, `tokens_per_s`, `ok`, `error` (feeds the AI Status card and the evidence for judges) |

### Dependencies (to be verified on Day 0)

| Package | Version | Why |
| --- | --- | --- |
| `@qvac/sdk` | 0.22.0 (npm `latest`) | Local LLM. Peer deps: `react-native-bare-kit >=0.16.0`, `expo-file-system >=19`, `expo-device`, `expo-build-properties`. |
| `@tetherto/wdk-react-native-core` | **1.0.0-beta.16** | Last beta **without** the `expo-crypto >=55` peer requirement. beta.18–22 need Expo SDK 55+, but MyMonies is on 54. Plan B: upgrade to Expo SDK 55. |
| `@tetherto/wdk`, `@tetherto/wdk-wallet-evm-erc-4337` | versions matching beta.16 | Sepolia via ERC-4337 |
| `@tetherto/wdk-worklet-bundler` | CLI | Generates `.wdk/` |
| `react-native-bare-kit` | 0.16.x | Shared by both SDKs (QVAC ≥0.16, WDK ≥0.14.5) |
| `react-native-keychain` | ^10 | Seed storage |
| `expo-local-authentication` | SDK 54 version | Fingerprint approval |

### Native build warning

- **Both SDKs' guides say to run `npx expo prebuild`, and WDK's says `--clean`. Never use `--clean` in this repo.** It deletes `android/`, including the hand-written `SmsReaderModule.kt`, `NotificationCaptureListenerService.kt` and `TransactionDb.kt`.
- Run plain `npx expo prebuild` on this branch, then `git diff android/`, and restore anything a plugin overwrote. `MainApplication.kt` must still register `SmsReaderPackage`.
- Back up first: `git stash` / commit before every prebuild.

---

## 7. Day-by-day plan (solo)

You have 6.5 build days, solo, so scope is cut hard. **P0 = must ship. P1 = only if Wednesday's check passes.**

| Day | Goal | Done when |
| --- | --- | --- |
| **Thu 22 – Fri 23** (setup only) | • Commit or stash current changes, tag `pre-ai-yako`. <br>• **Spike A:** QVAC Expo tutorial app on the Redmi; `assessModelFit` + tokens/s for `QWEN3_600M_INST_Q4`, **and `QWEN3_1_7B_INST_Q4` loaded alone** (decides whether the round-up can use the larger model); one `tool_choice:"required"` call. <br>• **Spike B:** WDK beta.16 in the same throwaway app: create wallet, show addresses #0/#1, receive faucet USDt, send 0.1 USDt #0→#1 on Sepolia. <br>• Fund account #0 from the faucet. | Both spikes run on the phone; you have numbers for RAM and speed |
| **Sat 24** (kickoff) | P0: add QVAC + WDK + bare-kit to MyMonies; `app.json` plugins; plain prebuild; repair `android/` | App runs; SMS backfill and notification capture still work; model loads; wallet worklet starts |
| **Sun 25** | P0: `classifyIncome` + `planner` + `proposeSweep` + `validate` (+ unit tests); demo inbox of about 40 synthetic SMS | In airplane mode, a salary SMS produces a valid proposal; a Fuliza SMS is skipped |
| **Mon 26** | P0: wallet module (create/unlock, #0/#1, balances, send) + fingerprint approval + conversion preview | Approve → testnet tx hash shown |
| **Tue 27** | P0: sweep queue (offline approval → sends when online); Akiba screen; AI Status card | Approve in airplane mode → reconnect → sends automatically |
| **Wed 28** (mid-week check) | Full offline rehearsal; fix issues; eval script on about 40 labelled income SMS (Node + QVAC on the laptop) | Accuracy and latency numbers recorded |
| **Thu 29** | Docs (README, `QVAC.md`, `WDK.md`, network list, before/after section); P1 if green; first video take | A fresh clone builds by following the README |
| **Fri 30, by 12:00** | Final video, submit, check links in an incognito window | Submitted 5 h before the deadline |
| **Sat 31** | Demo day: phone charged, model on the device, wallet funded, demo inbox loaded | — |

**P1, only if Wednesday's check passes, in this order:**

1. **Financial round-up v0** (section 10): code-computed metrics, Survival Mode, and the sweep strategy following Survival Mode. About 0.75 days.
2. **5-question AI interview** that fills the plan fields. About 0.75 days.

Smaller P1 items:

- Swahili polish
- A rate refresh from a public FX endpoint
- Savings goal progress bar
- A "why not more?" breakdown

**Out of scope:** Uliza chat, AI SMS parser for banks, Pears, mainnet, real on-ramps.

### Testing

- **Unit tests** (existing `node --test`): planner arithmetic, validator bounds, enum handling, queue state machine, USDt base-unit conversion (6 decimals).
- **Eval:** `scripts/eval/income.mjs` runs the exact prompts with `@qvac/sdk` on Linux (Node v22.22 is installed). It reports classification accuracy, tool-call validity and the fallback rate on the labelled fixtures. Spot-check 10 on the phone.
- **Device checks:**
    - Model load/unload loop with no out-of-memory crash (10 cycles)
    - Wallet unlock after the model unloads
    - Phone killed mid-queue → resumes
    - Approval while offline → sends on reconnect
    - Wrong chain ID → refuses to run

---

## 8. Demo (3 min, video with the internet off)

1. **0:00, the problem.** People get paid on M-Pesa and spend it the same week. Saving needs a nudge at the moment money arrives, from something that reads your money without uploading it.
2. **0:20, go offline.** Turn on airplane mode, Wi-Fi off. Show the AI Status card: Qwen3 0.6B, on the device, offline ✓.
3. **0:30, a loan.** Inject a Fuliza disbursement SMS from the demo inbox. The agent says (in Swahili and English) that this is borrowed money, so no sweep.
4. **0:55, a salary.** Inject a salary SMS. The agent shows a safe-to-save amount, the reasons (rent due on the 5th, 9 days to payday, buffer kept) and the conversion preview labelled "simulated". Approve with your fingerprint → **queued (offline)**.
5. **1:50, reconnect.** Turn on Wi-Fi. The queue sends automatically, the tx hash appears, and the Sepolia explorer shows #0 → #1 with gas paid in USDt.
6. **2:30, evidence.** Show the classification accuracy on the labelled set, the median latency on a Redmi 10 with 3.6 GB RAM, the offline vs. network table, and `git diff --stat pre-ai-yako..HEAD`.

### Likely judge questions

| Question | Answer |
| --- | --- |
| What's AI here and what's rules? | The AI labels the income and chooses the strategy, with reasons, inside bounds. Code does all the arithmetic and sets the limit. Every proposal records which one produced it. |
| Why a 0.6B model? | It's what fits on a 3.6 GB phone next to a wallet engine. Single constrained tool calls make it reliable enough; the fallback covers the rest. Accuracy: [measured]. |
| Is the conversion real? | No. It's a simulated on-ramp with a dated rate. The transfer is real on Sepolia testnet. A real version would use a licensed on-ramp. |
| Can an SMS trick it into sending money elsewhere? | No. The destination is always your own savings account, the amount has a code-set maximum, and every send needs your fingerprint. |
| What existed before? | Everything in the "pre-existing" table. The tag and diff show the event work. |

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Out-of-memory with LLM + wallet on 3.6 GB | Medium | High | 0.6B model, short context, unload before unlocking the wallet; checked in Spike A |
| WDK beta.16 API differs from current docs (wallet ID handling changed in beta.17) | Medium | Medium | Spike B uses beta.16's own README; plan B: upgrade to Expo SDK 55 and WDK beta.22 |
| Two bare-kit worklets conflict | Low–Medium | High | Spike A+B in the same throwaway app before touching MyMonies |
| `expo prebuild` damages the Kotlin modules | Medium | High | Never `--clean`; commit first; diff and restore |
| Candide public paymaster/bundler unavailable on demo day | Low–Medium | Medium | Pre-record the online step; Pimlico as a second option; the offline AI demo doesn't depend on it |
| Faucet limits | Low | Low | Fund account #0 on Day 0 with enough for 20 demo sweeps |
| 0.6B mislabels income | Medium | Medium | Enum + few-shot examples; regex hints (Fuliza/M-Shwari keywords) passed in as facts; fallback + "rule-based" label |
| Solo time overrun | High | High | P0 list is fixed; P1 only after Wednesday; submit Friday noon |
| Round-up scope creep (the long game is tempting) | High | Medium | Hackathon gets round-up v0 + interview only; everything else stays in section 10's later phases |
| Plan reads as financial advice | Medium | Medium | "Your plan, your rules" wording; disclaimer; no asset buy/sell suggestions |

### Still open

- **Rate source for the simulated conversion:** manual entry is simplest. Do you want a live fetch when online?
- **Demo phone and payday:** set a payday and 2–3 budget items in Profile for a believable proposal. The demo data will be synthetic.
- **Public repo:** `src/contributions.ts` contains your contact email and WhatsApp number. Keep them or remove them before you publish?

---

## 10. The long game: AI financial strategist

**Goal:** the app writes and maintains a personal financial strategy, like a living "survival, liquidity and compounding" plan. It works from your whole SMS history plus a short interview, and **that plan becomes the rulebook the Akiba agent follows.** The sweep agent is the hands; the strategy is the brain.

### What the plan contains, and where each part comes from

| Plan section | Source | Computed by |
| --- | --- | --- |
| Lean survival budget (monthly) | 3–6 months of SMS: average spending on essentials ("Needs" groups from `lifeCategory.ts`) | Code |
| Income pattern | Salary amount, day of month and regularity, from `RECEIVED` rows labelled `salary` / `business_income` | Code + AI income labels |
| Loan dependence | Fuliza, M-Shwari and app-loan frequency and amounts | Code |
| Asset position | WDK balances (#0 spending, #1 savings) + assets you report (other savings, crypto, money owed to you) | Wallet + interview |
| Runway | Liquid funds ÷ lean burn = months | Code |
| Health trigger | Runway < 2 months → **Survival Mode** (threshold editable) | Code |
| Goals and targets | Emergency fund target (default 6 × lean burn), named goals with amounts and dates | Interview |
| Allocation model | Split when income is stable (default 40 living / 25 stable / 20 growth / 10 opportunity / 5 skills, editable) | Interview |
| Worst-case scenarios | Zero income for 3 months; a delayed expected inflow | Code |
| Narrative and next steps | Short explanation per section, in English or Swahili | AI, one short call per section, numbers inserted from code |

### How the plan drives the agent

| Plan state | Sweep behaviour |
| --- | --- |
| Survival Mode (runway < 2 months) | Sweep only into the emergency fund, conservative strategy, or skip. The reason says "Survival Mode: 1.6 months of runway". |
| Building the emergency fund | Sweeps go to savings (#1) until the target is reached |
| Stable (emergency fund full) | Proposal follows the allocation model's stable % (later: a split across several goal accounts) |
| Loan income | Never swept (unchanged) |

### How it runs on a 3.6 GB phone

1. **No model ever reads the whole history.** Code reduces it to about 20 metrics, the "financial profile".
2. **Interview, 5–8 questions.**
    - The model picks the next question from a **fixed question bank**, whichever fills the most important empty field.
    - It turns your free-text answer into structured fields through one tool call (`record_answer`, with a schema).
    - You can always edit the resulting fields directly.
3. **Report writing.**
    - One short model call per section, with the numbers inserted from code.
    - It isn't time-critical, so it can use `QWEN3_1_7B_INST_Q4` loaded alone (wallet engine off) if Day 0 shows it fits. Otherwise it uses 0.6B.
    - It runs while charging, or when you tap "Refresh my plan".
4. **Stored on the device:** tables `financial_profile`, `plan_answers` and `plan_versions` (a history of the plan, so progress can be shown month to month).

### Phasing

| Phase | Contents |
| --- | --- |
| **Hackathon P1** (if Wednesday's check passes) | Round-up screen (runway, lean burn, income pattern, loan dependence, Survival Mode), 5-question interview, agent following Survival Mode. Demo line: "Sweep skipped: Survival Mode, 1.6 months of runway." |
| After the hackathon, v1 | Full multi-section plan document; Swahili narrative; worst-case scenarios; editable allocation model; monthly re-run with a "what changed" summary |
| v2 | Goal accounts (several WDK account indexes: emergency, travel, opportunity); progress tracking against 1-, 3- and 5-year phases; export the plan as Markdown or PDF |

### Guardrails

- **Framed as your plan,** built from your own answers, targets and rules. Every screen notes "not financial advice". The app never recommends buying or selling specific assets.
- **All figures come from code or your answers.** The model writes only wording and chooses among fixed options.
- **The demo uses a synthetic persona.** No real strategy document, real balances or real SMS go into the repo, the video or the slides.

---

## Sources

- AI Yako DoraHacks page (text pasted by the user): https://dorahacks.io/hackathon/ai-yako/detail
- QVAC docs (full text export): https://docs.qvac.tether.io/llms-full.txt (System requirements, Text generation, Assess model fit, Expo tutorial)
- WDK docs (full text export): https://docs.wdk.tether.io/llms-full.txt (React Native quickstart, React Native Core, Secure Storage)
- npm registry: `@qvac/sdk@0.22.0` peer deps; `@tetherto/wdk-react-native-core` beta.16 vs. beta.18–22 peer deps (checked 2026-10-22)
- Test USDt faucets: https://dashboard.pimlico.io/test-erc20-faucet, https://dashboard.candide.dev/faucet
- Device facts: `adb shell getprop` / `/proc/meminfo` on the connected Redmi 10
