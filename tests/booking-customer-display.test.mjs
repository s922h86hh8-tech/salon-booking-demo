// Run after cloning: node --test tests/booking-customer-display.test.mjs
// Fictional records only; verifies labels and customer detail lookup without browser/network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'preview/v0.42-booking-customer.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 2, 'Booking engine and controller scripts only');
const controller = scripts[1][1];
const start = controller.indexOf('function shortScheduleCourse(');
const end = controller.indexOf('function chooseBreakDuration(', start);
assert.ok(start >= 0 && end > start, 'Customer card functions missing');
const controllerFunctions = controller.slice(start, end);

function element(tag = 'div', cls = '', text = '') {
  return {
    tag, cls, textContent: text, children: [], events: {}, attributes: {},
    style: {}, title: '',
    classList: {flags:{}, toggle(name, active) { this.flags[name] = active; }},
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    addEventListener(type, fn) { this.events[type] = fn; },
    setAttribute(key, value) { this.attributes[key] = value; }
  };
}
function fixture() {
  const els = {
    scheduleCustomerDetails: element(),
    scheduleCustomerDialog: Object.assign(element(), {
      opened: 0,
      showModal() { this.opened++; }
    })
  };
  const booking = { id: 1, status: 'CONFIRMED', customer: '架空のお客様A',
    menu: 'm60', staff: 's1', bed: 'b1', start: 600, source: 'hpb', discovery: 'google' };
  const model = {
    bookings: [booking],
    menus: [{id:'m60', name:'もみほぐし60分',duration:60,price:5000,private:false}],
    staff: [{id:'s1',name:'佐藤'}],
    beds: [{id:'b1',name:'オープン1'}]
  };
  const sandbox = {
    model,
    Core: {serviceFor: (m,b) => m.menus.find(menu=>menu.id===b.menu).duration,
      clock: n => String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0') },
    ORIGINS: {hpb: {label:'ホットペッパービューティー'}},
    DISCOVERIES: {google:'Google検索・マップ'},
    $: id => { assert.ok(els[id]); return els[id]; },
    node: element,
    add: (parent,child) => { parent.appendChild(child); return child; },
    sourceBadge: source => element('span','origin-badge',source),
    window: {setTimeout: () => {}},
    prepareTimeChange: () => {},
    chooseServiceDuration: () => {}
  };
  const api = runInNewContext(controllerFunctions +
    '\n({shortScheduleCourse,shortScheduleCustomer,openScheduleCustomer,editableService})', sandbox);
  return {api,els,booking,model};
}
test('course and fictional customer labels are concise but details keep full names', () => {
  const {api,els} = fixture();
  assert.equal(api.shortScheduleCourse({id:'m60',name:'もみほぐし60分'}),'ほぐし60分');
  assert.equal(api.shortScheduleCustomer('架空のお客様A'),'お客様A');
  assert.equal(api.shortScheduleCustomer('架空・電話受付10'),'受付10');
  api.openScheduleCustomer(1);
  assert.equal(els.scheduleCustomerDialog.opened,1);
  const entries=els.scheduleCustomerDetails.children;
  const values=entries.map(row=>row.children[1].textContent);
  assert.deepEqual([...values],[
    '架空のお客様A','もみほぐし60分','10:00〜11:00','佐藤',
    'オープン1','ホットペッパービューティー','Google検索・マップ'
  ]);
});
test('card shows course beside customer, and customer button opens details only', () => {
  const {api,els,booking,model}=fixture();
  const lane=element(), block=element('div','schedule-block');
  let positionArgs;
  const positioned=(...args) => {positionArgs=args;return block;};
  api.editableService(lane,booking,model.menus[0],positioned,42);
  assert.ok(positionArgs[1].includes('schedule-book resizable'));
  const duo=block.children.find(x=>x.cls==='schedule-book-duo');
  assert.ok(duo,'Expected horizontal course/customer row');
  assert.equal(duo.children[0].textContent,'ほぐし60分');
  const customer=duo.children[1];
  assert.equal(customer.textContent,'お客様A');
  assert.equal(customer.tag,'button');
  assert.ok(customer.events.click,'Customer button must have a click handler');
  const grip=block.children.find(x=>x.cls==='booking-grip');
  assert.ok(grip && grip.events.pointermove, 'Original duration grip remains');
  let stopped=false;
  customer.events.click({stopPropagation:()=>{stopped=true;}});
  assert.equal(stopped,true);
  assert.equal(els.scheduleCustomerDialog.opened,1);
});
test('missing or canceled bookings never open customer details', () => {
  const {api,els,booking}=fixture();
  api.openScheduleCustomer(9999);
  assert.equal(els.scheduleCustomerDialog.opened,0);
  booking.status='CANCELLED';
  api.openScheduleCustomer(1);
  assert.equal(els.scheduleCustomerDialog.opened,0);
});
test('card dialog contains no real personal information or additional stored fields', () => {
  assert.match(html, /お客様情報（架空）/);
  assert.match(html, /実際の氏名・電話番号は入力しないでください/);
  assert.doesNotMatch(html, /\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
