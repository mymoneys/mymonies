// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Fred Gitonga

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageSignature, redactMessage } from './redact.ts';

// Fixed rng so amount scaling and date shifts are repeatable.
// 0.25 gives an amount factor of 0.75 and a date shift of -9 days.
const fixedRng = () => 0.25;
const redact = (text: string) => redactMessage(text, fixedRng);

function assertNoneLeak(out: string, secrets: string[]) {
  for (const secret of secrets) {
    assert.ok(!out.includes(secret), `"${secret}" leaked into: ${out}`);
  }
}

test('M-Pesa send: code, name, phone, amounts and date are hidden', () => {
  const out = redact(
    'SJK1ABC2DE Confirmed. Ksh1,250.00 sent to JOHN DOE KAMAU 0712345678 on 13/10/26 at 2:15 PM. New M-PESA balance is Ksh12,345.67. Transaction cost, Ksh13.00.'
  );
  assertNoneLeak(out, ['SJK1ABC2DE', 'JOHN', 'KAMAU', '0712345678', '1,250.00', '12,345.67', '13/10/26']);
  assert.match(out, /^TXNCODE Confirmed\. Ksh[\d,]+\.\d{2} sent to PERSON 07XXXXXXXX on /);
  assert.match(out, /New M-PESA balance is Ksh\d{1,3}(,\d{3})*\.\d{2}\./);
});

test('international phone formats are hidden', () => {
  for (const phone of ['254722334455', '+254722334455', '0112345678']) {
    assertNoneLeak(redact(`received Ksh100.00 from PERSON ${phone} on 1/1/26`), [phone]);
  }
});

test('greeting names, masked accounts and bank refs are hidden', () => {
  const out = redact(
    'Dear Peter, your KCB account XXXX4521 has been debited KES 3,400.00 on 10-10-2026. Ref FT24286ABCD. Avail bal KES 45,000.50'
  );
  assertNoneLeak(out, ['Peter', '4521', 'FT24286ABCD', '3,400.00', '45,000.50']);
  assert.match(out, /^Dear PERSON, your KCB account XXXX#### /);
});

test('links keep the domain only, emails are removed', () => {
  const out = redact('Pay at https://tala.co.ke/pay/abc123?u=99 or ask help@equitybank.co.ke');
  assert.ok(out.includes('https://tala.co.ke/LINK'), out);
  assertNoneLeak(out, ['abc123', 'help@equitybank.co.ke']);
});

test('withdrawal agent name and location are hidden', () => {
  const out = redact(
    'Withdraw Ksh3,000.00 from 123456 - Kamau Agencies Ruaka New M-PESA balance is Ksh1,000.00.'
  );
  assertNoneLeak(out, ['123456', 'Kamau', 'Agencies', 'Ruaka']);
  assert.match(out, /from ###### - PERSON New M-PESA balance/);
});

test('agent name at the end of a message is hidden', () => {
  const out = redact('Give Ksh500.00 cash to 654321 - wanjiru shop githurai.');
  assertNoneLeak(out, ['654321', 'wanjiru', 'githurai']);
  assert.ok(out.endsWith('to ###### - PERSON.'), out);
});

test('shifted dates keep two-digit day and month fields', () => {
  for (const date of ['13/10/26', '01/02/2026', '10-10-2026', '31/12/26']) {
    const out = redact(`due on ${date}.`);
    const shifted = out.match(/due on (\S+)\./)![1];
    assert.notEqual(shifted, date);
    const [d, m, y] = shifted.split(/[/-]/);
    assert.equal(d.length, 2, `day width changed: ${date} -> ${shifted}`);
    assert.equal(m.length, 2, `month width changed: ${date} -> ${shifted}`);
    assert.equal(y.length, date.split(/[/-]/)[2].length);
  }
});

test('single-digit month stays single-digit', () => {
  assert.equal(redact('on 25/3/26.'), 'on 16/3/26.');
});

test('known keywords are not mistaken for names', () => {
  const out = redact('Fuliza M-PESA amount is Ksh 150.00. Total Fuliza M-PESA outstanding is Ksh151.50.');
  assert.ok(out.includes('Fuliza M-PESA amount is Ksh '), out);
  assert.ok(!out.includes('PERSON'), out);
});

test('same template collapses to one signature regardless of random scaling', () => {
  const a = 'SJK1ABC2DE Confirmed. Ksh1,250.00 sent to JOHN DOE 0712345678 on 13/10/26 at 2:15 PM.';
  const b = 'SJK9ZZZ9ZZ Confirmed. Ksh80.00 sent to MARY ATIENO 0798765432 on 02/01/26 at 9:05 PM.';
  assert.equal(messageSignature(redactMessage(a)), messageSignature(redactMessage(b)));
});

test('different templates get different signatures', () => {
  const sent = redact('SJK1ABC2DE Confirmed. Ksh100.00 sent to JOHN DOE on 1/1/26.');
  const paid = redact('SJK1ABC2DE Confirmed. Ksh100.00 paid to JOHN DOE on 1/1/26.');
  assert.notEqual(messageSignature(sent), messageSignature(paid));
});
