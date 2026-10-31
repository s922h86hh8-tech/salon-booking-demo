// node --test tests/booking-move-tray.test.mjs
// Fictional booking date moves: no network, no real customer data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.48-booking-move-tray.html'),'utf8');
const scripts=Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g),m=>m[1]);
assert.equal(scripts.length,2);
const bookingWindow={};
runInNewContext(scripts[0],{window:bookingWindow});
const Core=bookingWindow.DemoCore;
const dayFunctions=readFileSync(resolve(root,'preview/modules/v0.47-date-navigation-body.js'),'utf8');
const moveFunctions=readFileSync(resolve(root,'preview/modules/v0.48-booking-move-body.js'),'utf8');
assert.ok(scripts[1].includes(dayFunctions));
assert.ok(scripts[1].includes(moveFunctions));
const denoms=[10000,5000,2000,1000,500,100,50,10,5,1];
function mock(){
 return {value:'0',textContent:'',hidden:false,disabled:false,attrs:{},
  classList:{flags:{},toggle(k,v){this.flags[k]=v}},
  replaceChildren(){this.options=[]},setAttribute(k,v){this.attrs[k]=v},
  addEventListener(){},getBoundingClientRect(){return {left:0,right:0,top:0,bottom:0}}};
}
function fixture({confirm=true}={}){
 const ids=['bookingMoveTray','bookingMoveCard','bookingMoveLabel','bookingMoveCancel',
  'demoDatePicker','demoDateLabel','demoPrevDay','demoNextDay','demoBaseDay','demoDayHint',
  'customerDemoDay','checkoutDemoDay','registerDemoDay','checkoutBooking',
  ...denoms.map(d=>'reg_'+d)];
 const fields=Object.fromEntries(ids.map(id=>[id,mock()]));
 const events=[];
 const sandbox={
  Core,REG_DENOMS:denoms,initialRegister:()=>({phase:'NEW',checks:[]}),
  $:id=>{assert.ok(fields[id],id);return fields[id]},
  renderStaffSchedule:()=>{},resetCheckoutForm:()=>{},hidePrepFeedback:()=>{},
  go:page=>events.push(page),info:(message,bad)=>events.push({message,bad}),
  window:{confirm:()=>confirm,setTimeout:()=>{}},
  shortScheduleCustomer:input=>input,quickDropFromPoint:()=>null,
  node:()=>mock(),add:(parent,child)=>child
 };
 const script=[
  "let model=Core.initial(),demoReceipts=[],register=initialRegister(),checkoutNextNumber=1,page='booking';",
  "let chosenCustomer=null,selectedUnassigned=null,undoPrep=null,pendingTimeChange=null,quickDraft=null,quickConfirming=false,quickMenuId=null,checkoutBookingId=null;",
  dayFunctions,moveFunctions,
  "({get:()=>({date:selectedDemoDay,model,receipts:demoReceipts,register,staged:stagedBookingMove,contexts:demoDayContexts}),stageBookingMove,cancelStagedBookingMove,movePlanFor,confirmBookingMove,changeDemoDay,pay:id=>demoReceipts.push({bookingId:id,amounts:{cash:5000}})});"
 ].join('\n');
 const api=runInNewContext(script,sandbox);
 return {api,fields,events};
}
test('moving across days keeps the source until confirmed and creates no canceled-waitlist release',()=>{
 const {api}=fixture();
 assert.equal(api.get().date,'2026-10-26');
 assert.equal(api.stageBookingMove(1),true);
 assert.equal(api.get().model.bookings.find(b=>b.id===1).status,'CONFIRMED');
 assert.equal(api.changeDemoDay('2026-10-27'),true);
 assert.equal(api.get().model.bookings.length,0);
 assert.equal(api.movePlanFor('s1',600).ok,true);
 assert.equal(api.get().model.bookings.length,0,'Planning cannot mutate the target');
 assert.equal(api.confirmBookingMove('s1',600),true);
 assert.equal(api.get().model.bookings[0].customer,'架空のお客様A');
 assert.equal(api.get().staged,null);
 api.changeDemoDay('2026-10-26');
 const old=api.get().model.bookings.find(b=>b.id===1);
 assert.equal(old.status,'CANCELLED');
 assert.equal(old.movedTo,'2026-10-27');
 assert.equal(api.get().model.releases.length,0);
});
test('schedule conflicts, break overlap and no-op are rejected',()=>{
 const {api}=fixture();
 api.stageBookingMove(1);
 assert.equal(api.movePlanFor('s2',630).ok,false);
 assert.equal(api.movePlanFor('s1',720).ok,false);
 assert.equal(api.movePlanFor('s1',600).ok,false);
 assert.equal(api.get().model.bookings.find(b=>b.id===1).status,'CONFIRMED');
});
test('declining the confirmation or clearing the tray leaves the source intact',()=>{
 const {api}=fixture({confirm:false});
 api.stageBookingMove(1);
 api.changeDemoDay('2026-10-27');
 assert.equal(api.confirmBookingMove('s1',600),false);
 assert.equal(api.get().model.bookings.length,0);
 api.cancelStagedBookingMove();
 assert.equal(api.get().staged,null);
 api.changeDemoDay('2026-10-26');
 assert.equal(api.get().model.bookings.find(b=>b.id===1).status,'CONFIRMED');
});
test('recorded payments prohibit a move',()=>{
 const {api}=fixture();
 api.pay(1);
 assert.equal(api.stageBookingMove(1),false);
 assert.equal(api.get().staged,null);
});
test('same-day rescheduling leaves a moved ghost and one replacement',()=>{
 const {api}=fixture();
 api.stageBookingMove(1);
 const plan=api.movePlanFor('s1',960);
 assert.equal(plan.ok,true,plan.reason);
 assert.equal(api.confirmBookingMove('s1',960),true);
 const records=api.get().model.bookings;
 assert.equal(records.filter(b=>b.status==='CONFIRMED').length,3);
 assert.equal(records.find(b=>b.id===1).status,'CANCELLED');
 assert.equal(records.find(b=>b.id===1).movedTo,'2026-10-26');
 assert.ok(records.some(b=>b.status==='CONFIRMED'&&b.start===960&&b.customer==='架空のお客様A'));
});
test('fictional-only source and original schedule behavior are preserved',()=>{
 assert.match(html,/id="bookingMoveTray"/);
 assert.match(html,/id="bookingMoveCard"/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/架空データ専用/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
