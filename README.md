# MyMonies

A private, on-device money tracker for Kenyan M-Pesa users. MyMonies reads your
M-Pesa confirmation SMS, turns each one into a transaction, categorizes it
automatically and shows where your money goes each month — with no account,
no server and no internet connection required.

> **Android only.** iOS does not let apps read SMS, so the core feature can't
> work there.

## Features

- **Automatic capture.** Reads your M-Pesa SMS history once, then picks up new
  messages in the background through Android's notification listener. A
  *Sync health* card on the Profile tab shows what share of the M-Pesa
  messages in your inbox have been captured (target: 99%).
- **Built-in categorization.** Recognizes common Kenyan payees out of the box
  — KPLC, Naivas, Uber, Safaricom, M-Shwari, Fuliza and more — using the
  business name M-Pesa puts in each message. No spreadsheet import or setup.
- **Dashboard.** Total in, total out and net savings for the month; spending by
  group (top 6 plus "Other"); a Needs vs Wants vs Savings split; an income and
  expense trend chart; and **Export to CSV** for the selected month.
- **Transactions.** Every parsed transaction, searchable by counterparty. Tap
  one to change its category with a searchable picker.
- **Rules.** Optional custom rules that override the automatic category — for
  example, "counterparty contains `0700000000` → Rent / Household". Rules run
  in priority order (lower number first).
- **Profile.** Your payday, a monthly budget with fixed costs and loan
  repayments, notification access, sync health, and the opt-in
  *Help improve MyMonies* card.
- **Crash isolation.** Each tab has its own error boundary, so a problem on
  one screen leaves the others usable.

## Privacy

- All data stays on the phone, in a local SQLite database. There is no
  backend and no analytics.
- **Help improve MyMonies** is off by default. When you turn it on, messages
  the app couldn't parse (and, if you choose, messages from extra senders such
  as your bank) are collected so the parser can be improved:
  1. Each message is **redacted on the phone**: names, phone numbers,
     transaction codes, account and ID numbers, agent names, emails and links
     are replaced, and amounts and dates are scrambled while keeping their
     format.
  2. You **review and can edit** every redacted message before anything is
     sent. Redaction is automatic and can miss things (for example a name
     written in lowercase), so this review step matters.
  3. Nothing leaves the phone until you tap **Email**, **WhatsApp** or
     **Other app**, which hands the text to that app for you to send.
  4. Turning the feature off deletes everything collected but not yet sent.
     Sent and dismissed messages have their original text cleared.

## Permissions

| Permission | Why |
| --- | --- |
| Read SMS | Import your M-Pesa message history. |
| Notification access | Capture new M-Pesa messages as they arrive. Granted in system settings from the Profile tab. |
| Internet | Required by React Native; the app sends no data of its own. |
| Vibrate | Haptic feedback. |

The app deliberately does **not** request receive-SMS, storage or
draw-over-other-apps permissions.

## Install

1. Download the latest `MyMonies-*.apk` from the
   [Releases](../../releases) page on your Android phone.
2. Open it and allow installing from that source if asked.
3. If Play Protect warns about an unknown app, tap **More details →
   Install anyway**. This happens because the app reads SMS and isn't
   installed from the Play Store.
4. Open MyMonies, allow SMS access, then grant notification access from the
   Profile tab.

The release build is for 64-bit ARM phones (`arm64-v8a`), which covers almost
all Android phones from the last several years.

## Development

Requirements: Node 22+, the Android SDK, and a phone with USB debugging (or
an emulator).

```bash
npm install
npm run android      # build and install a debug build on the connected device
npm test             # unit tests (Node's built-in test runner)
npx tsc --noEmit     # type check
```

The `android/` folder is checked in and contains hand-written native code
(SMS reader module, notification listener, shared database access), so don't
delete it or regenerate it with `expo prebuild --clean`.

### Release builds

Release builds are signed with the MyMonies upload key, which is **not** in
the repo. Gradle reads its location and passwords from
`~/.gradle/gradle.properties`:

```properties
MYMONIES_UPLOAD_STORE_FILE=/absolute/path/to/mymonies-upload.jks
MYMONIES_UPLOAD_KEY_ALIAS=mymonies
MYMONIES_UPLOAD_STORE_PASSWORD=...
MYMONIES_UPLOAD_KEY_PASSWORD=...
```

```bash
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# -> android/app/build/outputs/apk/release/app-release.apk
```

Without those properties the build still works but is signed with the debug
key and Gradle prints a warning. Never publish such a build: phones that
installed a properly signed version can't update to it.

If a build fails with `package com.anonymous.tracker does not exist` (or any
other stale package name), delete `android/build/generated/autolinking` and
build again.

## How it works

```
SMS inbox ──(READ_SMS, on demand)──┐
                                    ├─> transactions table ─> parser ─> rules ─> screens
Notifications ─(listener service)──┘        (SQLite, on device)
```

- **Ingestion.** `SmsReaderModule.kt` reads the inbox (a full backfill once,
  then incremental syncs with a 24-hour overlap). `NotificationCaptureListenerService.kt`
  writes new M-Pesa messages straight to the database, even when the app is
  closed. Both use the same id hash, so a message seen twice is stored once.
- **Parsing.** `src/parser.ts` extracts type, amount, counterparty, balance and
  cost from each message. Background upkeep (`src/backgroundSync.ts`) parses
  new rows, applies rules and syncs, whichever tab is open.
- **Categorization.** `src/builtinClassifier.ts` gives each transaction a
  category, `src/rules.ts` applies your custom rules on top, and
  `src/groupMapping.ts` and `src/lifeCategory.ts` roll categories up into
  groups and Needs / Wants / Savings.
- **Sharing samples.** `src/contributions.ts` collects and dedupes samples,
  and `src/redact.ts` does the redaction (covered by `src/redact.test.ts`).

### Project layout

```
App.tsx                     tab navigator + background upkeep
src/
  *Screen.tsx               Dashboard, Transactions, Rules, Profile
  parser.ts                 M-Pesa SMS -> transaction
  builtinClassifier.ts      default categories
  rules.ts                  custom rules engine
  db.ts                     SQLite schema and queries
  backfill.ts, smsInbox.ts  SMS sync
  contributions.ts          opt-in sample collection and sending
  redact.ts                 on-device redaction
  export.ts                 CSV export
android/app/src/main/java/com/mymonies/app/
  SmsReaderModule.kt        native SMS inbox access
  NotificationCaptureListenerService.kt
  TransactionDb.kt          native writes to the shared database
```

## Known limitations

- Android only.
- Only M-Pesa messages are parsed into transactions. Bank and loan-app
  messages are collected only as samples for the opt-in sharing feature.
- Cash withdrawals are not counted as spending.
- Not yet on the Google Play Store. Publishing there requires Google's
  approval to use the SMS permission.

## Licence

The app is licensed under the [GNU AGPL v3.0 or later](LICENSE). The M-Pesa
parser and redaction code is under Apache-2.0, and the documentation is under
CC BY 4.0. See [LICENSING.md](LICENSING.md) for which files each licence covers.
