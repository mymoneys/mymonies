import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate } from './strings.ts';

test('translate fills placeholders and falls back to English', () => {
  assert.equal(translate('en', 'card.save', { amount: '10,350' }), 'Save Ksh 10,350');
  assert.equal(translate('sw', 'card.save', { amount: '10,350' }), 'Weka akiba Ksh 10,350');
  // No Swahili entry yet -> English, not a blank or a raw key.
  assert.equal(translate('sw', 'akiba.noWallet.hint').startsWith('Add EXPO_PUBLIC'), true);
});
