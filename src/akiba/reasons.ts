import type { SweepContext } from '../ai/schemas.ts';

/**
 * The deciding reason behind a sweep strategy, chosen by the model (or the
 * fallback) from this fixed list, then written out here in English and
 * Swahili with the real numbers.
 *
 * Why not let the model write the sentences: the 0.6B on-device model wrote
 * English cut off mid-word, and its "Swahili" came out as English, Arabic or a
 * repeated Persian word. A fixed list keeps the AI's real choice (which factor
 * decides) while the wording stays correct in both languages.
 */

export const REASON_CODES = [
  'survival_mode',
  'payday_far',
  'big_bills',
  'bills_covered',
  'low_headroom',
  'irregular_income',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

const ksh = (n: number) => `Ksh ${Math.round(n).toLocaleString('en-KE')}`;

/** Facts a reason claims must actually hold, or the model's answer is rejected. */
export function reasonFits(code: ReasonCode, ctx: SweepContext): boolean {
  switch (code) {
    case 'survival_mode':
      return ctx.survivalMode;
    case 'payday_far':
      return ctx.daysToPayday >= 15;
    case 'big_bills':
      return ctx.unpaidBudgetsKes > 0;
    case 'bills_covered':
      return ctx.unpaidBudgetsKes === 0 && !ctx.survivalMode;
    case 'low_headroom':
      return ctx.maxSafeKes < ctx.incomeKes * 0.25;
    case 'irregular_income':
      return ctx.incomeLabel === 'business_income' || ctx.incomeLabel === 'personal_gift';
  }
}

export function reasonText(code: ReasonCode, ctx: SweepContext): { en: string; sw: string } {
  switch (code) {
    case 'survival_mode': {
      const r = ctx.runwayMonths?.toFixed(1);
      return {
        en: `Survival Mode is on${r ? ` (${r} months of cash left)` : ''}, so only a small amount is saved.`,
        sw: `Hali ya dharura imewashwa${r ? ` (pesa ya miezi ${r} imebaki)` : ''}, kwa hivyo kiasi kidogo tu kinawekwa akiba.`,
      };
    }
    case 'payday_far':
      return {
        en: `Payday is ${ctx.daysToPayday} days away, so most of this money stays for spending.`,
        sw: `Siku ya mshahara ni baada ya siku ${ctx.daysToPayday}, kwa hivyo pesa nyingi zinabaki kwa matumizi.`,
      };
    case 'big_bills':
      return {
        en: `${ksh(ctx.unpaidBudgetsKes)} of bills are still unpaid this cycle, so savings stay small.`,
        sw: `Bili za ${ksh(ctx.unpaidBudgetsKes)} bado hazijalipwa, kwa hivyo akiba inabaki ndogo.`,
      };
    case 'bills_covered':
      return {
        en: 'Bills are covered until payday, so half the safe amount can be saved.',
        sw: 'Bili zimelipwa hadi siku ya mshahara, kwa hivyo nusu ya kiasi salama kinaweza kuwekwa akiba.',
      };
    case 'low_headroom':
      return {
        en: 'Little is left after bills and spending until payday.',
        sw: 'Kiasi kidogo tu kinabaki baada ya bili na matumizi hadi siku ya mshahara.',
      };
    case 'irregular_income':
      return {
        en: 'This kind of income varies, so a smaller share is saved to stay safe.',
        sw: 'Mapato ya aina hii hubadilika, kwa hivyo sehemu ndogo inawekwa akiba ili kuwa salama.',
      };
  }
}
