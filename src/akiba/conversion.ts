/**
 * KES -> USDt for the sweep preview. This is a SIMULATED on-ramp: the rate is
 * a dated snapshot (refreshed when online, or typed in by the user) and no
 * KES is actually converted — the wallet's spending account is pre-funded
 * with Sepolia test USDt. The UI must always show `rateDate` next to it.
 */

export const USDT_DECIMALS = 6;

export interface ConversionQuote {
  kes: number;
  kesPerUsdt: number;
  rateDate: string;
  /** Integer string in USDt base units (6 decimals), as WDK's send() expects. */
  baseUnits: string;
  /** Human-readable, truncated (never rounded up) to 2 decimals. */
  usdtDisplay: string;
}

// Scale both sides to integers before dividing so the result is exact —
// float maths like 1000 / 129.3 * 1e6 drifts in the last base unit.
const KES_SCALE = 100n; // cents
const RATE_SCALE = 10_000n;

export function quoteKesToUsdt(kes: number, kesPerUsdt: number, rateDate: string): ConversionQuote {
  if (!(kesPerUsdt > 0)) throw new Error('Exchange rate must be positive');
  if (!(kes >= 0)) throw new Error('Amount must be zero or more');

  const kesCents = BigInt(Math.round(kes * Number(KES_SCALE)));
  const rateScaled = BigInt(Math.round(kesPerUsdt * Number(RATE_SCALE)));
  const unitsPerUsdt = 10n ** BigInt(USDT_DECIMALS);
  const baseUnits = (kesCents * unitsPerUsdt * RATE_SCALE) / (rateScaled * KES_SCALE);

  return { kes, kesPerUsdt, rateDate, baseUnits: baseUnits.toString(), usdtDisplay: formatUsdt(baseUnits.toString()) };
}

export function formatUsdt(baseUnits: string): string {
  const units = BigInt(baseUnits);
  const whole = units / 10n ** BigInt(USDT_DECIMALS);
  const cents = (units % 10n ** BigInt(USDT_DECIMALS)) / 10n ** BigInt(USDT_DECIMALS - 2);
  return `${whole}.${cents.toString().padStart(2, '0')}`;
}

/** All 6 decimals, trailing zeros trimmed — for commands that must match exactly. */
export function formatUsdtExact(baseUnits: string): string {
  const units = BigInt(baseUnits);
  const scale = 10n ** BigInt(USDT_DECIMALS);
  const frac = (units % scale).toString().padStart(USDT_DECIMALS, '0').replace(/0+$/, '');
  return frac ? `${units / scale}.${frac}` : `${units / scale}`;
}
