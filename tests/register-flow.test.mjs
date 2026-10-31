// Run locally after cloning: node --test tests/register-flow.test.mjs
// Simulated browser controls and fictional sales only. No network or real payments.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'preview/v0.43-full-redesign.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 2, 'Expected original booking engine and controller only');
const controller = scripts[1][1];
const first = controller.indexOf('function registerSales(){');
const last = controller.indexOf('function renderWaitlist(){', first);
assert.ok(first >= 0 && last > first, 'Register functions must be present');
const registerFunctions = controller.slice(first, last);
const denoms = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];

function makeElement() {
  return {
    value: '', textContent: '', disabled: false, children: [], classList: {
      flags: {},
      toggle(name, enabled) { this.flags[name] = enabled; }
    },
    appendChild(item) { this.children.push(item); },
    replaceChildren() { this.children = []; }
  };
}
function fixture(confirm = () => true) {
  const els = {};
  for (const id of ['regStatus','regLate','regCount','regOpen','regMid','regRecount',
    'regClose','regMove','regHistory','regStaff','regKind','regAmount','regReason',
    'regPhaseLabel','regExpectedPrimary','regLastCount','regLastDiff','regNextAction']) {
    els[id] = makeElement();
  }
  for (const d of denoms) {
    els['reg_' + d] = makeElement();
    els['reg_' + d].value = '0';
  }
  els.regStaff.value = 's1';
  els.regKind.value = 'in';
  els.regAmount.value = '1000';
  const register = { phase: 'NEW', opening: null, start: 0, end: null,
    events: [], checks: [], moves: [] };
  const receipts = [], messages = [];
  const sandbox = {
    register, demoReceipts: receipts, REG_DENOMS: denoms,
    CHECKOUT_METHODS: {cash:'現金',credit:'カード',qr:'QR',emoney:'電子マネー',voucher:'商品券',other:'その他'},
    $: id => { assert.ok(els[id], 'Missing mock element ' + id); return els[id]; },
    window: { confirm },
    model: { staff: [{ id:'s1', name:'佐藤' }] },
    fmtYen: v => '¥' + Number(v).toLocaleString('ja-JP'),
    node: (tag, css, label) => Object.assign(makeElement(),
      { tag, className: css, textContent: label || '' }),
    add: (parent, child) => { parent.appendChild(child); return child; },
    info: text => messages.push(text)
  };
  const api = runInNewContext(registerFunctions +
    '\n({registerSales,registerNet,registerExpected,registerCount,registerReconcile,registerMove,renderRegister})', sandbox);
  return { els, register, receipts, messages, api };
}

test('opening + cash receipt + cash addition + mid-count + recount + closing', () => {
  const f = fixture(), { els, register: r, receipts, api } = f;
  els.reg_10000.value = '1';
  api.registerReconcile('開店');
  assert.equal(r.phase, 'OPEN');
  assert.equal(r.opening.amount, 10000);
  assert.equal(r.checks.length, 1);
  api.registerMove();
  receipts.push({ amounts: { cash: 5000, credit: 0 } }, { amounts: { cash: 0, credit: 2500 } });
  assert.equal(api.registerSales(), 5000, 'Non-cash must never enter the drawer');
  assert.equal(api.registerExpected(), 16000);
  els.reg_5000.value = '1';
  els.reg_1000.value = '1';
  api.registerReconcile('中締め');
  assert.equal(r.checks.at(-1).diff, 0);
  assert.equal(els.regExpectedPrimary.textContent, '¥16,000');
  assert.equal(els.regLastCount.textContent, '¥16,000');
  assert.equal(els.regLastDiff.textContent, '¥0');
  assert.equal(r.checks.at(-1).period.receipts, 2);
  assert.equal(r.checks.at(-1).period.methods.cash, 5000);
  assert.equal(r.checks.at(-1).period.methods.credit, 2500);
  assert.equal(r.checks.at(-1).period.movements, 1000);
  els.reg_1000.value = '0';
  api.registerReconcile('再計数');
  assert.equal(r.checks.at(-1).diff, -1000);
  assert.equal(els.regLastDiff.textContent, '−¥1,000');
  assert.equal(els.regLastDiff.classList.flags['reg-diff'], true);
  assert.equal(r.checks.at(-1).period.receipts, 0);
  assert.equal(r.checks.at(-1).period.movements, 0);
  assert.equal(r.events.length, 4);
  api.registerReconcile('閉店');
  assert.equal(r.phase, 'CLOSED');
  assert.equal(api.registerExpected(), 16000);
  receipts.push({ amounts: { cash: 3000 } });
  api.renderRegister();
  assert.equal(api.registerExpected(), 16000, 'Closing seals included receipts');
  assert.equal(els.regLate.classList.flags.hidden, false);
  assert.match(els.regLate.textContent, /3,000/);
  assert.throws(() => api.registerMove(), /開店中/);
});

test('invalid denomination counts or movement amounts are rejected', () => {
  const f = fixture(), { els, api } = f;
  els.reg_10000.value = '-1';
  assert.throws(() => api.registerReconcile('開店'), /整数/);
  els.reg_10000.value = '1.2';
  assert.throws(() => api.registerReconcile('開店'), /整数/);
  els.reg_10000.value = '1';
  api.registerReconcile('開店');
  els.regAmount.value = '-10';
  assert.throws(() => api.registerMove(), /確認/);
  els.regAmount.value = '900000000';
  assert.throws(() => api.registerMove(), /確認/);
  els.regAmount.value = '15000';
  els.regKind.value = 'out';
  assert.throws(() => api.registerMove(), /マイナス/);
});

test('canceling a confirmation does not open or mutate the drawer', () => {
  const f = fixture(() => false);
  f.els.reg_5000.value = '2';
  f.api.registerReconcile('開店');
  assert.equal(f.register.phase, 'NEW');
  assert.equal(f.register.checks.length, 0);
  assert.equal(f.register.events.length, 0);
});

test('a second opening and recount before first mid-count are refused', () => {
  const f = fixture();
  f.els.reg_10000.value = '1';
  f.api.registerReconcile('開店');
  assert.throws(() => f.api.registerReconcile('開店'), /登録済み/);
  assert.equal(f.els.regRecount.disabled, true);
});
