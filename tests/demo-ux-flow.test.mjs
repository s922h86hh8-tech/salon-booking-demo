// Run from repository root: node --test tests/demo-ux-flow.test.mjs
// Tests the v0.43 navigation and fictional counters without a browser or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'preview/v0.44-booking-to-checkout.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 2, 'Existing booking core and UI controller must be kept');
const controller = scripts[1][1];

test('daily navigation still exposes all seven working pages', () => {
  for (const page of ['booking','checkout','register','waitlist','setup','connect','home']) {
    assert.match(html, new RegExp('data-page="' + page + '"'), page + ' is missing from manager nav');
    assert.match(html, new RegExp('id="page-' + page + '"'), page + ' is missing its section');
  }
  assert.match(html, /<summary>その他の機能<\/summary>/);
  assert.match(html, /data-go="checkout"/);
  assert.match(html, /data-go="register"/);
  assert.match(controller, /querySelectorAll\('\[data-go\]'\)/, 'Workflow buttons must be wired');
});
test('fictional status cards display the live confirmed, unassigned and unpaid counts', () => {
  const a = controller.indexOf('function summary(){');
  const b = controller.indexOf('function render(){', a);
  assert.ok(a >= 0 && b > a, 'Missing summary function');
  const summarySource = controller.slice(a,b);
  const fields = {};
  for (const id of ['kpiBookings','kpiWaiting','kpiRecovered','flowBooked','flowUnassigned','flowUnpaid']) fields[id] = {textContent:'?'};
  const bookings = [
    {id:1,status:'CONFIRMED'},
    {id:2,status:'CONFIRMED'},
    {id:3,status:'CANCELLED'}
  ];
  const model = { bookings, unassigned:[{id:100}], };
  const receipts = [{bookingId:1}];
  const summary = runInNewContext(summarySource + '\nsummary;', {
    model, demoReceipts:receipts,
    Core: {quote: () => ({total:2,waiting:0,recovered:0})},
    $: id => {
      assert.ok(fields[id], 'Unexpected UI field ' + id);
      return fields[id];
    }
  });
  summary();
  assert.equal(fields.flowBooked.textContent,2);
  assert.equal(fields.flowUnassigned.textContent,1);
  assert.equal(fields.flowUnpaid.textContent,1);
  receipts.push({bookingId:2});
  summary();
  assert.equal(fields.flowUnpaid.textContent,0);
});
test('daily reservation table remains the first visible page', () => {
  assert.match(html, /<section id="page-booking" class="page">/);
  assert.match(html, /<section id="page-customer" class="page hidden"/);
  assert.match(html, /id="staffSchedule"/);
  assert.match(html, /schedule-lane/);
  assert.match(html, /15分/);
});
test('safety boundaries remain explicit', () => {
  assert.match(html, /架空データ専用/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
