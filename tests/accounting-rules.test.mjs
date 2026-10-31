// Run locally: node --test tests/accounting-rules.test.mjs
// Fictional amounts only. Payment services, card numbers, customers and networks are not used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'preview/v0.43-full-redesign.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 2);
const controller = scripts[1][1];
const first = controller.indexOf('function checkoutMath(){');
const last = controller.indexOf('function checkoutAssignFull(){', first);
assert.ok(first >= 0 && last > first);
const checkoutFunction = controller.slice(first, last);

function fixture({ coupon = false, line = false, allowStack = true, payments = {}, price = 5000 } = {}) {
  const input = {
    checkoutCoupon: { checked: coupon },
    checkoutLine: { checked: line },
    checkoutAllowStack: { checked: allowStack }
  };
  const methods = { cash:'現金', credit:'カード', qr:'QR', emoney:'電子', voucher:'商品券', other:'その他' };
  for (const key of Object.keys(methods)) input['pay_' + key] = { value: String(payments[key] ?? 0) };
  const sandbox = {
    model: { menus:[{ id:'m60', price }] },
    CHECKOUT_METHODS: methods,
    currentCheckout: () => ({ id:1, menu:'m60' }),
    $: id => { assert.ok(input[id], 'Missing checkout field ' + id); return input[id]; }
  };
  return { input, result: runInNewContext(checkoutFunction + '\ncheckoutMath();', sandbox) };
}

test('split cash and voucher payment matches billed amount after a discount', () => {
  const x = fixture({ coupon:true, payments:{ cash:2500, voucher:2000 } }).result;
  assert.equal(x.full, 5000);
  assert.equal(x.discounts, 500);
  assert.equal(x.due, 4500);
  assert.equal(x.sum, 4500);
  assert.equal(x.amounts.voucher, 2000, 'A regional voucher is a payment, not a discount');
  assert.equal(x.valid, true);
});

test('discount stacking rule flags prohibited combinations', () => {
  const blocked = fixture({ coupon:true, line:true, allowStack:false, payments:{cash:3500} }).result;
  assert.equal(blocked.discountConflict, true);
  const accepted = fixture({ coupon:true, line:true, allowStack:true, payments:{cash:3500} }).result;
  assert.equal(accepted.discountConflict, false);
  assert.equal(accepted.couponDiscount, 500);
  assert.equal(accepted.lineDiscount, 1000);
  assert.equal(accepted.due, 3500);
  assert.equal(accepted.sum, 3500);
});

test('invalid or excessive payment inputs remain invalid', () => {
  for (const bad of ['-1','1.5','1000001','NaN','']) {
    assert.equal(fixture({ payments:{cash:bad} }).result.valid, false, 'invalid cash input ' + bad);
  }
  const short = fixture({ payments:{cash:4500} }).result;
  assert.equal(short.valid, true);
  assert.notEqual(short.sum, short.due, 'Not enough payment must not be treated as settled');
});

test('cash and noncash categories remain distinct', () => {
  const x = fixture({ payments:{credit:1000,qr:1500,emoney:500,voucher:2000} }).result;
  assert.equal(x.sum, 5000);
  assert.equal(x.amounts.cash, 0);
  assert.equal(x.amounts.voucher, 2000);
});
