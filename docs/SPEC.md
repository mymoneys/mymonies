# MyMonies Open Money Spec

**Version 0.1 (draft), 5 Nov 2026.** Text: CC BY 4.0. Schemas and test vectors: Apache-2.0. Reference data (section 7): CC0.

This spec defines how mobile-money transactions are described, how much of them can be shared with an AI or a dataset, and how people contribute. It starts with M-Pesa and is designed to take Airtel Money, MTN MoMo and bank SMS later.

The words MUST, SHOULD and MAY are used as in RFC 2119. Each rule is followed by **Why**, because the reasons are what let people apply the spec to cases it doesn't cover.

---

## 1. Principles

1. **The phone is the default place for analysis.** Parsing, categorising and AI analysis all work offline on the device.
   **Why:** M-Pesa history shows income, debts, family support and health spending. The safest copy is the one that never leaves the phone, and offline also works with poor or expensive data.

2. **The owner decides what leaves, per connection, and sees it first.** Nothing is sent without a preview.
   **Why:** A one-time consent screen is forgotten. Seeing the actual data before it's sent is the only consent people can really judge.

3. **Share the least that still answers the question.** Every tool and prompt states the lowest sharing level it needs.
   **Why:** Most useful questions, like "where does my money go?", need totals, not transactions. If the default is low, privacy doesn't depend on people changing settings.

4. **Categories travel, identities don't.** Phone numbers, transaction codes and personal names never leave the device at any level.
   **Why:** They identify people and add almost nothing to analysis. "Sent 6,000 to Family" is as useful as "Sent 6,000 to JANE WANJIKU 07…".

5. **Shared data is unlinked.** Rows in the shared dataset can't be joined into one person's history.
   **Why:** A sequence of amounts and dates works like a fingerprint. A salary on the 28th, rent on the 1st and a regular send of 6,000 is enough for someone who knows you. See section 6.

6. **Promise only what can be kept.** The spec never claims data can be recalled after release.
   **Why:** Downloaded copies can't be taken back. An honest limit builds more trust than a promise that later turns out false.

---

## 2. Transaction record

This is the full record an implementation keeps **on the device**. Sections 4 and 6 define what may leave it.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique on this device. Never shared. |
| `provider` | enum | `mpesa` for now. Later `airtel_money`, `mtn_momo`, `bank:<code>`. |
| `source` | enum | `sms`, `notification`, `statement_pdf`, `statement_csv`, `manual`. |
| `kind` | enum | `received`, `sent`, `paid`, `withdrawn`, `airtime`, `transfer_in`, `transfer_out`, `failed`, `info`. |
| `direction` | enum | `in`, `out`, `none`. Derived from `kind`. |
| `amount_minor` | integer | Amount in cents, so KES 1,250.50 is `125050`. |
| `currency` | string | ISO 4217, e.g. `KES`. |
| `fee_minor` | integer \| null | Transaction cost in cents. |
| `balance_minor` | integer \| null | Balance after the transaction. |
| `occurred_at` | string | ISO 8601 with offset, e.g. `2026-10-13T14:15:00+03:00`. |
| `counterparty.name` | string | As written in the message. |
| `counterparty.number` | string \| null | Phone, paybill or till number. |
| `counterparty.account` | string \| null | Account number given with a paybill. |
| `counterparty.type` | enum | `person`, `business`, `agent`, `bank`, `own_account`, `unknown`. |
| `category.personal` | string | The owner's own label, any text. Never shared. |
| `category.group` | taxonomy id | From the shared list in section 3. |
| `category.tier` | enum | `needs`, `wants`, `savings`, `unclassified`. Spending only. |
| `income_label` | enum \| null | `salary`, `business_income`, `personal_gift`, `loan_disbursement`, `refund`, `reversal`. Money in only. |
| `parsed` | boolean | False when the message was kept but not understood. |
| `raw_text` | string | The original message. Never shared, except as a redacted sample (section 8). |

**Why integer cents:** floating-point totals drift. In JavaScript, 0.1 + 0.2 isn't 0.3, and a finance app can't be off by a cent.

**Why an offset on every timestamp:** a transaction at 23:30 in Nairobi is on a different day in UTC. Day and week rollups would land in the wrong bucket.

**Why `counterparty.type`:** it decides what can be shared. A business name like "NAIVAS LIMITED" can go into the business directory (section 7). A person's name never can.

**Why a separate personal category:** people should keep their own labels, like "Moving to Nairobi", which the current app supports. Free-text labels can identify someone, so they stay on the device and are mapped to a shared group for anything that leaves.

---

## 3. Shared taxonomy

Anything that leaves the device uses only these ids. Display names are translated in the app. The ids never change.

| Id | Default tier | Examples |
|---|---|---|
| `household` | needs | Rent, electricity, water, TV subscription, household goods |
| `food` | needs | Groceries, market food |
| `dining_out` | wants | Restaurants, takeaway |
| `snacks_drinks` | wants | Soda, sweets, snacks |
| `transport` | needs | Fare, matatu, ride-hailing, fuel |
| `airtime_data` | needs | Airtime, bundles |
| `education` | needs | School fees, books |
| `health` | needs | Clinic, pharmacy, insurance |
| `family` | needs | Support to relatives |
| `loan_repayment` | needs | Fuliza, Tala, Branch, bank loans |
| `savings` | savings | M-Shwari, SACCO, chama, investments |
| `giving` | needs | Church, charity, contributions |
| `social` | wants | Friends, events |
| `entertainment` | wants | Betting, streaming, outings |
| `shopping` | wants | Clothes, shoes, general retail |
| `electronics` | wants | Phones, appliances |
| `business` | needs | Stock, business costs |
| `fees` | needs | Transaction charges |
| `other` | unclassified | Anything else |

- An owner MAY change the tier of a group on their device, for example treating `social` as a need. The shared output carries the owner's tier.
- A personal category with no group maps to `other`.

**Why a fixed list:** analyses and datasets can only be compared if everyone uses the same buckets. The current app's groups grew from one person's spreadsheet, which works on a phone but not as a shared standard.

**Why ids are never reused or removed:** old datasets and prompts would silently change meaning. A group can be deprecated and pointed at a replacement, but its id stays.

**Why about 20 groups:** with too few, the analysis is useless. With too many, rare groups become identifying (section 6), and a 0.6B on-device model picks less accurately from long lists.

---

## 4. Sharing levels

Each connection to an AI, whether through MCP or an export, has one sharing level. The default is **0**.

| Field | 0 Offline | 1 Totals | 2 Rounded | 3 Detailed | 4 Full |
|---|---|---|---|---|---|
| Group totals per period | – | ✓ | ✓ | ✓ | ✓ |
| Individual transactions | – | – | ✓ | ✓ | ✓ |
| `kind`, `direction`, group, tier, income label | – | – | ✓ | ✓ | ✓ |
| Amount | – | totals only | band (4.2) | exact | exact |
| Fee | – | total only | band | exact | exact |
| Time | – | month or week | day | minute | minute |
| Balance | – | – | – | band | exact |
| Counterparty | – | – | – | stand-in (4.3) | name |
| Business names | – | – | – | ✓ | ✓ |
| Personal category | – | – | – | – | ✓ |
| Phone numbers, codes, accounts, raw text | never | never | never | never | never |

**Why fixed levels instead of a toggle per field:** five choices can be explained in one sentence each and tested properly. Thirty toggles lead to combinations nobody understood or checked.

**Why level 1 is enough for most questions:** "Where did my money go?", "Am I spending more on transport?" and "How much went to loans?" can all be answered from totals.

**Why phone numbers and codes are excluded even at level 4:** they're direct identifiers for the owner and the people they pay. No analysis needs them, and level 3 stand-ins keep the patterns.

### 4.1 Rules for every level
- The level MUST be enforced by the code that produces the data, not by asking the AI to ignore fields. **Why:** a model given data can repeat it. The only safe data is data it never received.
- Every response MUST say its level and what was withheld, e.g. `"level": 2, "withheld": ["counterparty", "exact_amount"]`. **Why:** the AI can then say "I can't see who this was" instead of guessing.
- Before the first send in a session, and whenever the level goes up, the app MUST show a preview of the real data. **Why:** see principle 2.
- The app MUST keep a log on the device of what was sent, when and at which level. **Why:** owners can check afterwards, and it shows where a leak came from.
- A level MUST NOT persist forever. It resets to 0 after a set time, by default 30 days for level 1 and 24 hours for levels 2–4. **Why:** a forgotten high setting is the most likely way data leaks.

### 4.2 Amount bands
Bands in KES: 0–100, 100–250, 250–500, 500–1k, 1k–2.5k, 2.5k–5k, 5k–10k, 10k–25k, 25k–50k, 50k–100k, 100k+. Each band includes its lower edge and excludes its upper edge.

**Why these edges:** the steps follow a 1–2.5–5 pattern, so each band is roughly twice the last. That keeps the difference between a fare and a meal at the low end without making large amounts precise, and matches how people think about prices.

The same bands are used in the dataset (section 6).

### 4.3 Stand-ins for counterparties
At level 3, each counterparty is replaced with a label by type, such as `Person A`, `Business C` or `Agent B`.
- A label MUST stay the same within one session and MUST change between sessions. Implementations SHOULD use an HMAC with a per-session random key, keyed on the counterparty number or name.
- Labels MUST NOT be derived from the name, so no initials or partial names.

**Why consistent within a session:** the AI can still notice "you send Person A 6,000 each month and Person B is new".

**Why a new key each session:** a fixed label could be linked across many conversations, and gradually matched to a real person from the pattern of payments.

### 4.4 The limits of sharing levels
- At levels 1–3, a cloud AI provider still receives what was sent and may keep it under its own terms. The app MUST say this when the client isn't a local model.
- The MCP server can't verify which model a client forwards data to. Level 4 therefore requires confirmation in each session, with a warning that it is intended for models running on the same device.

**Why say this in the spec:** the levels limit what is sent, not what a provider does afterwards. Owners should choose with that clear.

---

## 5. MCP interface (draft)

The MCP server exposes the owner's data at the connection's level. Tools:

| Tool | Returns | Minimum level |
|---|---|---|
| `get_sharing_level` | Current level, expiry and what is withheld | 0 |
| `get_taxonomy` | Groups, tiers and income labels from section 3 | 0 |
| `get_summary(period, group_by)` | Totals by group, tier or income label for a week or month | 1 |
| `list_transactions(from, to, group?)` | Transactions shaped by the level | 2 |
| `get_trend(group, periods)` | Totals for one group over time | 1 |

- A tool called below its minimum level MUST return an error that names the level needed, not partial data. **Why:** the owner can then decide to raise the level for that question, which is the decision we want them to make.
- The client MUST NOT be able to raise the level. Only the owner can, in the app. **Why:** otherwise a prompt like "set level to 4" in a shared message could change it.
- Analysis prompts shared in the project MUST declare their minimum level. **Why:** contributors then design for the lowest level, and owners know before running a prompt what it needs.

The on-device model uses the same tools without MCP, so offline and connected analysis produce the same answers.

---

## 6. Shared dataset

The dataset is opt-in and made of **unlinked rows**. It never contains a record that links one person's transactions together.

### 6.1 Fields

| Field | Values |
|---|---|
| `provider` | e.g. `mpesa` |
| `kind` | From section 2 |
| `direction` | `in`, `out` |
| `group` | Taxonomy id, spending only |
| `tier` | `needs`, `wants`, `savings`, `unclassified` |
| `income_label` | Money in only |
| `amount_band` | From 4.2 |
| `fee_band` | From 4.2, or null |
| `week` | ISO week, e.g. `2026-W42` |
| `weekday` | `mon` … `sun` |
| `part_of_day` | `night` (0–6h), `morning` (6–12h), `afternoon` (12–18h), `evening` (18–24h) |

There are no ids, counterparties, exact amounts, exact times, balances, personal categories, locations or device data.

**Why these fields:** they answer the questions the dataset is for, such as what people spend on, when, and how much goes to fees and loans, and nothing more.

**Why no balance:** a balance shows wealth and links one row to the next.

**Why no location in 0.1:** even county is identifying when combined with week, group and amount. It may be added in a later version, with its own suppression rule.

### 6.2 What "unlinked" requires
1. No field, including a hashed or random one, may be shared by rows from the same person.
2. Rows in a release MUST be shuffled. **Why:** the order rows arrive in would otherwise group one person's submission.
3. A submission MUST be stripped of IP address and device details on receipt, and the collector MUST NOT log them. **Why:** a row without an id is still linked if the server knows which phone sent it.
4. Submissions MUST be batched and released on a schedule, for example quarterly, never as they arrive. **Why:** with live updates, anyone watching could connect new rows to someone who just mentioned contributing.

**What is lost:** the dataset can't show one person's habits over time, such as how a salary gets spent across a month.
**Why accept that:** that kind of analysis is exactly what makes a dataset identifying, and it's still available to each owner on their own device.

### 6.3 Suppression
Before release, any row whose combination of `group` or `income_label`, `amount_band` and `week` appears fewer than **10** times in the release MUST be removed.

**Why:** a rare combination, like the only `education` payment over 100k in a week, can point to a person even without an id. A threshold of 10 is a common starting point. It may be raised as the dataset grows.

### 6.4 Summaries
Published summary tables, such as the median spending band by group and month, SHOULD be the main output. A later version will add calibrated noise (differential privacy) to them.

**Why:** most users of the dataset, like researchers and NGOs, need summaries. Summaries with noise protect people much better than rows.

### 6.5 Contributing and withdrawing
- The phone builds the rows, applies 6.1, and shows the owner exactly what will be sent before they submit.
- Each submission comes with a random **receipt** kept only on the phone. Until the next release, the owner can use it to withdraw that submission. After release, their rows are excluded from **future** releases only if they still hold the receipt, and copies already downloaded remain.
- The consent text MUST say this plainly.

**Why a receipt:** rows are unlinked, so without it even the project couldn't find someone's rows to remove. The receipt stays on the phone, so it doesn't link rows for anyone else.

### 6.6 Licence
The dataset licence is still open. See section 11.

---

## 7. Public reference data

Some of what the project produces contains no one's transactions: the business directory, the shared category list and the catalogue of message formats. Like an open list of place names, this data is facts anyone can use, fix and package, so it is fully public.

**Why separate it from section 6:** the dataset holds personal data and has to be cautious. Reference data doesn't, so it can be open, searchable and edited by anyone. Keeping the two apart means nobody assumes "open dataset" covers people's spending.

### 7.1 Business directory
A list of businesses that receive M-Pesa payments, with the shared group each one belongs to.

| Field | Type | Notes |
|---|---|---|
| `number` | string | Paybill or till number |
| `number_type` | enum | `paybill`, `till` |
| `name` | string | As shown in M-Pesa confirmations, e.g. `KPLC PREPAID` |
| `aliases` | string[] | Other spellings seen in messages |
| `group` | taxonomy id | From section 3 |
| `status` | enum | `suggested`, `reviewed`, `verified` |
| `suggestions` | integer | How many suggestions agreed with this group |
| `updated` | date | Last change |
| `replaced_by` | string \| null | For a number that moved to a new owner |

- `reviewed` means a maintainer checked the entry. `verified` means it was checked against a public source, such as the business's own website or a published paybill list.
- A business can have several numbers, so one name can appear in several entries.

**Why the name as M-Pesa shows it:** that's the text a parser sees, so a parser can match it directly.

**Why `replaced_by`:** paybill and till numbers are sometimes reassigned. An entry that silently changed owner would put another business's payments in the wrong group.

### 7.2 What may enter the directory
- Only paybills, and tills registered to a business name, MAY be listed.
- Pochi la Biashara numbers, agent numbers and personal phone numbers MUST NOT be listed.
- Any entry whose name looks like a person's name MUST be rejected, even if it is a real till. Reviewers check this, and the build checks it automatically against a list of common names.

**Why:** many small tills are registered in the owner's own name, like a kiosk listed as "JANE WANJIKU". Listing it would publish a private person's name and payment number. Pochi la Biashara uses a personal phone number, and agent names are often personal names, so both are excluded.

### 7.3 How entries are added
- **From the app:** when an owner gives a business a group, the app MAY offer to suggest it to the directory. Only the number, the name and the group are sent: no amounts, times, other transactions or details about the owner.
- Suggestions MUST be batched and stripped of IP and device details, following the same rules as 6.2. **Why:** a suggestion still shows that someone pays that business. Batching and stripping stop the project from knowing who.
- **From developers:** pull requests to the data files.
- An entry becomes `reviewed` only after a maintainer checks it. Agreeing suggestions help reviewers but never approve an entry on their own. **Why:** anonymous suggestions can be gamed. A lender could label itself `savings` many times to look better in people's budgets.
- Disputes go through a GitHub issue on the entry.

### 7.4 Message format catalogue
One file per message type, per provider, containing the format's fields, the `kind` it maps to, and made-up example messages. The examples are also the parser tests.

**Why:** M-Pesa changes its wording without notice. One shared catalogue means a format change gets fixed once for every app, instead of separately in each.

### 7.5 Package layout
The reference data, schemas and parsers live in their own repository, separate from the MyMonies app:

```
open-money-ke/
  SPEC.md                  this spec
  data/
    taxonomy.json          section 3, with translations
    businesses.json        section 7.1
    formats/mpesa/*.json   section 7.4
  schemas/                 JSON Schemas for every format in this spec
  test-vectors/            section 10
  packages/
    js/                    npm
    kotlin/                Maven
    dart/                  pub.dev
    python/                PyPI
  mcp-server/              section 5
  site/                    search site
```

- Data is versioned and released with a date. Each package bundles a copy of the data, so it works offline.
- The search site lets anyone look up a paybill or till number, see its name and group, and suggest a fix. It MUST NOT use analytics or log searches.

**Why a separate repository:** other apps can use the data and parsers under open licences without taking on the app's AGPL licence. The licence boundaries are also clear: reference data under CC0, code under Apache-2.0.

**Why CC0 for reference data:** a business directory and a category list are public facts. With no conditions at all, any app, company or government system can use them without legal review, which is how a reference list becomes the standard.

**Why bundle the data:** offline is the target. An app shouldn't need the internet to know that `888880` is KPLC.

**Why no analytics on the site:** searching for a paybill can show what someone is about to pay.

### 7.6 First release
1. `taxonomy.json` with English and Swahili names.
2. `businesses.json` with the businesses the app already recognises in `src/builtinClassifier.ts`, each checked and given its paybill or till number.
3. The JavaScript package, with the existing parser moved into it.

**Why start here:** the directory is useful on day one, contains no personal data, and gives both users and developers an easy first contribution.

---

## 8. Contributions

| Who | Contribution | How it's checked |
|---|---|---|
| Users | **Category fixes** for businesses, e.g. a paybill that is rent, not utilities | Shared only when `counterparty.type` is `business`. Follows section 7.3. |
| Users | **Redacted message samples** for messages the app couldn't read | Redacted on the phone, then reviewed and edited by the owner before sending, as the app does now. A maintainer checks them before they become tests. |
| Users | **Dataset rows** | Section 6. |
| Developers | **Message readers** for new formats or providers | Every rule needs sample messages as tests, made up or redacted. |
| Developers | **Analysis prompts** | Must declare their minimum level and include an example output. |
| Developers | **Translations, MCP server, on-device model work** | Normal code review. |
| Anyone | **Spec changes** | Section 9. |

**Why category fixes are limited to businesses:** a business name like "KPLC PREPAID" is public and helps everyone. A person's name would expose who the owner pays.

**Why readers need sample messages:** M-Pesa wording changes without notice. A test for each format shows exactly what broke and stops one fix from breaking another.

**Why one contributor list:** users sharing a sample or a category fix make the parsers work for everyone, as much as the developers who write the code. They are credited together.

Code contributions use a Developer Certificate of Origin sign-off on each commit. **Why:** it records that contributors have the right to submit their work, without the overhead of signing a legal agreement.

---

## 9. Versioning and changes

- The spec, the taxonomy and the JSON Schemas use semantic versioning. Removing or renaming anything is a major version. Adding an optional field or a new group is a minor version.
- Changes are proposed as a GitHub issue labelled `spec`. They stay open for at least 14 days, and anything that changes what can be shared also needs approval from a member of the savings group.

**Why version it:** other apps and prompts will depend on the format. They need to know when a change will break them.

**Why the savings group approves sharing changes:** the people whose data is involved should decide how it's shared, not only the developers.

---

## 10. Conformance

The project publishes test vectors: a set of made-up transactions and, for each sharing level and for the dataset, the exact expected output. An implementation conforms if it produces that output, including withholding fields, using bands and following the suppression rule.

**Why:** privacy rules that aren't tested drift. Test vectors let another app show it follows the spec, instead of just saying it does.

---

## 11. Open questions

1. **Dataset licence.** CC BY 4.0 is fully open, but it would let digital lenders use the data to tune credit scoring. A research-only licence prevents that but is less open. This needs a decision with the savings group.
2. **Who runs the collector**, where it's hosted, and how the "no IP logging" rule is checked.
3. **Location.** Whether to add county or a coarser region, and with what suppression rule.
4. **Differential privacy settings** for summaries.
5. **Other providers.** Airtel Money, MTN MoMo and bank SMS: which `kind` values they need.
6. **Governance.** How savings group members are chosen for spec approvals.
7. **Region data.** Location will use the open kenya-locations dataset, county level only, with a suppression rule like 6.3. Its licence still needs checking before it is bundled.

---

## 12. Changes needed in the current app

| Now | Spec |
|---|---|
| `amount` is a float | `amount_minor` integer in the shared format. Storage can change later. |
| `transactionType` in capitals, e.g. `SENT` | `kind` in lower case, with `airtime` and `transfer_out` added |
| Groups are open-ended and come partly from one person's spreadsheet (`src/groupMapping.ts`, `src/builtinClassifier.ts`) | Personal categories and groups map to the fixed ids in section 3 |
| No `counterparty.type` | Inferred from the message, e.g. paybill, till, agent or phone number |
| Redaction scales amounts by a random factor (`src/redact.ts`) | Kept for message samples. Datasets use amount bands instead, because a scaled amount still shows how large it is relative to others. |
| No sharing levels or MCP server | Sections 4 and 5 |
| Business patterns are regexes in the app | Moved to `businesses.json` in the shared repository (section 7.6) |
