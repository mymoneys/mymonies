/**
 * Demo builds (EXPO_PUBLIC_DEMO_MODE=1) use their own database file and never
 * read the SMS inbox, so a demo video or judge's device can only ever show
 * the synthetic "Amani" data from src/demo/demoInbox.ts — never a real
 * person's messages, even on a phone that has them.
 */
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === '1';
