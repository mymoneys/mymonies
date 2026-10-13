import { ParsedTransaction } from './parser';

export interface ClassifierEntry {
  pattern: RegExp;
  category: string;
  group: string;
}

/**
 * Generic, ships-with-the-app categorization for any Kenyan M-Pesa user —
 * no Excel import, no manual setup required. Matches against
 * counterpartyName, which M-Pesa's own confirmation SMS already puts the
 * real business/paybill name into (e.g. "KPLC PREPAID", "NAIVAS LIMITED").
 *
 * Order matters: earlier entries win. More specific patterns (e.g. a savings
 * SACCO) must come before generic ones (e.g. bare "SACCO") that would
 * otherwise shadow them. Groups reuse names already used elsewhere in the
 * app (Household, Foodstuff, Travel, Airtime, Education, Medical, Social,
 * Savings, Credits) wherever conceptually equivalent, so a fresh user's data
 * and an existing user's manually-categorized data land in the same
 * Dashboard buckets instead of fragmenting. Only Entertainment, Dining Out,
 * Shopping, and Giving are genuinely new groups (see src/lifeCategory.ts for
 * their Needs/Wants/Savings tier).
 */
const ENTRIES: ClassifierEntry[] = [
  // Savings/loan apps checked before the generic SACCO/credit patterns below,
  // since e.g. "SACCO" alone would otherwise match the Travel fare entry.
  { pattern: /M-?SHWARI|KCB\s*M-?PESA.*SAV|SACCO.*SAV|CHAMA/i, category: 'Savings', group: 'Savings' },
  { pattern: /FULIZA|BRANCH|TALA\b|ZENKA|OKASH|HUSTLER\s*FUND|LOAN/i, category: 'Loan Repayment', group: 'Credits' },

  { pattern: /KPLC|KENYA\s*POWER/i, category: 'Electricity', group: 'Household' },
  { pattern: /NAIROBI\s*WATER|NAWASCO|WATER\s*(COMPANY|CO)\b/i, category: 'Water', group: 'Household' },
  { pattern: /DSTV|GOTV|ZUKU|STARTIMES/i, category: 'TV Subscription', group: 'Household' },
  { pattern: /HARDWARE|FURNITURE|FURNISHING/i, category: 'Household Goods', group: 'Household' },

  {
    pattern: /NAIVAS|CARREFOUR|QUICKMART|CHANDARANA|TUSKYS|EASTMATT|CLEANSHELF|ZUCCHINI|SUPERMARKET/i,
    category: 'Groceries',
    group: 'Foodstuff',
  },

  { pattern: /UBER|BOLT\b|LITTLE\s*CAB/i, category: 'Ride-hailing', group: 'Travel' },
  { pattern: /SHELL|TOTAL\s*ENERGIES|RUBIS|OLA\s*ENERGY|PETROL/i, category: 'Fuel', group: 'Travel' },
  { pattern: /SACCO|SHUTTLE|MATATU/i, category: 'Fare', group: 'Travel' },

  { pattern: /SAFARICOM|AIRTEL|TELKOM/i, category: 'Airtime/Data', group: 'Airtime' },

  { pattern: /SCHOOL|ACADEMY|UNIVERSITY|COLLEGE/i, category: 'School Fees', group: 'Education' },

  { pattern: /HOSPITAL|CLINIC|PHARMACY|CHEMIST|MEDICAL/i, category: 'Healthcare', group: 'Medical' },

  { pattern: /NETFLIX|SHOWMAX|SPOTIFY/i, category: 'Streaming', group: 'Entertainment' },
  { pattern: /\bBAR\b|\bPUB\b|LOUNGE|LIQUOR|WINES\s*AND\s*SPIRITS|\bKEG\b/i, category: 'Alcohol', group: 'Social' },
  {
    pattern: /RESTAURANT|HOTEL|\bCAFE\b|EATERY|KFC|JAVA\s*HOUSE|PIZZA|GALITO|CHICKEN\s*INN/i,
    category: 'Dining Out',
    group: 'Dining Out',
  },
  { pattern: /BOUTIQUE|FASHION|CLOTHES|CLOTHING|\bSHOES?\b/i, category: 'Shopping', group: 'Shopping' },

  { pattern: /CHURCH|CHARITY|OFFERING|\bTITHE\b/i, category: 'Giving', group: 'Giving' },
];

export function classifyByKeyword(transaction: ParsedTransaction): { category: string; group: string } | null {
  const name = transaction.counterpartyName;
  if (!name) return null;

  for (const entry of ENTRIES) {
    if (entry.pattern.test(name)) {
      return { category: entry.category, group: entry.group };
    }
  }
  return null;
}
