import * as Device from 'expo-device';
import type { AkibaModelSize } from './qvac.ts';

/**
 * Which model this phone runs. 1.7B makes better sweep decisions than 0.6B
 * (5/8 vs 1/8 valid on scripts/eval/sweep.ts), but needs ~1.1 GB on top of
 * the app: on the 3.6 GB Redmi 10 Android's low-memory killer closed
 * MyMonies while loading it. Below the threshold, 0.6B (~0.4 GB); its weaker
 * picks are still bounded by src/akiba/validate.ts and the rule fallback.
 *
 * Kept out of qvac.ts so the Node eval scripts, which import qvac.ts, don't
 * pull in expo-device.
 */
const LARGE_MODEL_MIN_RAM_BYTES = 6 * 1024 ** 3;

export const AKIBA_MODEL_SIZE: AkibaModelSize =
  Device.totalMemory != null && Device.totalMemory >= LARGE_MODEL_MIN_RAM_BYTES ? 'large' : 'small';
