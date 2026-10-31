// node --test tests/booking-to-checkout.test.mjs
// Isolated fictional booking-to-checkout handoff. No network or actual payments.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const src=readFileSync(resolve(root,'preview/v0.45-cancel-and-sync-alerts.html'),'utf8');
const scripts=[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,2);
const ctrl=scripts[1][1];
const from=ctrl.indexOf('function checkoutFromSchedule(){'),to=ctrl.indexOf('function editableService(',from);
assert.ok(from>=0&&to>from,'Checkout handoff function missing');
const fnSource=ctrl.slice(from,to);
function fixture({recorded=false,status='CONFIRMED'}={}){
 const el={
  scheduleCustomerCheckout:{dataset:{bookingId:'1'}},
  scheduleCustomerDialog:{closes:0,close(){this.closes++}}
 };
 let logged=[],assigned=[],messages=[];
 const booking={id:1,status,customer:'架空のお客様A'};
 const payments=recorded?[{bookingId:1,amounts:{cash:5000}}]:[];
 const script=fnSource+'\n({handoff:checkoutFromSchedule,getSelected:()=>checkoutBookingId})';
 const obj=runInNewContext('let checkoutBookingId=null;\n'+script,{
  model:{bookings:[booking]},demoReceipts:payments,
  $:id=>{assert.ok(el[id]);return el[id]},
  resetCheckoutForm:()=>assigned.push('reset'),
  checkoutAssignFull:()=>assigned.push('assign'),
  go:page=>logged.push(page),
  info:(message,bad)=>messages.push({message,bad})
 });
 return {...obj,el,logged,assigned,messages};
}
test('an unpaid confirmed fictional booking opens checkout with the selected reservation',()=>{
 const f=fixture();
 f.handoff();
 assert.equal(f.getSelected(),'1');
 assert.deepEqual(f.assigned,['reset','assign']);
 assert.deepEqual(f.logged,['checkout']);
 assert.equal(f.el.scheduleCustomerDialog.closes,1);
});
test('already recorded and canceled bookings do not open a second checkout',()=>{
 for(const input of [{recorded:true},{status:'CANCELLED'}]){
  const f=fixture(input);f.handoff();
  assert.equal(f.logged.length,0);
  assert.equal(f.assigned.length,0);
  assert.equal(f.el.scheduleCustomerDialog.closes,1);
  assert.equal(f.messages[0].bad,true);
 }
});
test('the fictional demo remains disconnected from APIs and payments',()=>{
 assert.match(src,/架空データ専用/);
 assert.match(src,/connect-src 'none'/);
 assert.doesNotMatch(src,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
