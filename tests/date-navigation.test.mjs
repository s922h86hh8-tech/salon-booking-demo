// node --test tests/date-navigation.test.mjs
// Fictional in-memory calendar navigation; no real booking or network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.47-date-navigation.html'),'utf8');
const moduleText=readFileSync(resolve(root,'preview/modules/v0.47-date-navigation-body.js'),'utf8');
assert.ok(html.includes(moduleText),'Live controller must include exact date source');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,2);
const win={};
runInNewContext(scripts[0][1],{window:win});
const Core=win.DemoCore;
const denoms=[10000,5000,2000,1000,500,100,50,10,5,1];
function fixture(){
 const ids=['demoDatePicker','demoDateLabel','demoPrevDay','demoNextDay','demoBaseDay',
  'demoDayHint','customerDemoDay','checkoutDemoDay','registerDemoDay','checkoutBooking',
  ...denoms.map(d=>'reg_'+d)];
 const ui=Object.fromEntries(ids.map(id=>[id,{value:'0',textContent:'',disabled:false,replaceChildren(){this.options=[]}}]));
 const moves=[],errors=[];
 const sandbox={Core,REG_DENOMS:denoms,initialRegister:()=>({phase:'NEW',checks:[]}),
  $:id=>{assert.ok(ui[id],id);return ui[id]},resetCheckoutForm:()=>{},hidePrepFeedback:()=>{},
  go:page=>moves.push(page),info:(message,bad)=>errors.push({message,bad})};
 const code="let model=Core.initial(),demoReceipts=[],register={phase:'NEW',checks:[]},checkoutNextNumber=1;"+
  "let chosenCustomer=null,selectedUnassigned=null,undoPrep=null,pendingTimeChange=null,quickDraft=null,quickConfirming=false,quickMenuId=null,checkoutBookingId=null;"+
  moduleText+
  "\n({validDemoDay,advanceDemoDay,displayDemoDay,changeDemoDay,renderDemoDaySelector,resetDemoDayContexts,get:()=>({date:selectedDemoDay,model,receipts:demoReceipts,register,saved:demoDayContexts.size}),record:r=>demoReceipts.push(r),setRegister:r=>{register=r}})";
 const api=runInNewContext(code,sandbox);
 return {api,ui,moves,errors};
}
test('previous, next, direct-date and baseline controls are present',()=>{
 for(const id of ['demoPrevDay','demoNextDay','demoDatePicker','demoBaseDay'])assert.match(html,new RegExp('id="'+id+'"'));
 const {api,ui}=fixture();
 api.renderDemoDaySelector();
 assert.match(ui.demoDateLabel.textContent,/2026年10月26日/);
 assert.equal(ui.demoBaseDay.disabled,true);
 assert.equal(api.advanceDemoDay('2026-10-26',-1),'2026-10-25');
 assert.equal(api.advanceDemoDay('2026-10-26',1),'2026-10-27');
 assert.equal(api.displayDemoDay('2026-10-26'),'2026年10月26日（月）');
});
test('appointments, receipts and cash drawer return to the correct date',()=>{
 const {api,moves}=fixture();
 assert.equal(api.get().model.bookings.length,3);
 api.changeDemoDay('2026-10-27');
 assert.equal(api.get().model.bookings.length,0);
 api.get().model.bookings.push({id:88,status:'CONFIRMED'});
 api.record({bookingId:88,amounts:{cash:5000}});
 api.setRegister({phase:'OPEN',checks:[{amount:10000}]});
 api.changeDemoDay('2026-10-26');
 assert.equal(api.get().model.bookings.length,3);
 assert.equal(api.get().receipts.length,0);
 assert.equal(api.get().register.phase,'NEW');
 api.changeDemoDay('2026-10-27');
 assert.equal(api.get().model.bookings.length,1);
 assert.equal(api.get().receipts.length,1);
 assert.equal(api.get().register.phase,'OPEN');
 assert.deepEqual(moves,['booking','booking','booking']);
});
test('invalid dates are refused without touching the selected day',()=>{
 const {api,errors}=fixture();
 assert.equal(api.validDemoDay('2024-02-29'),true);
 assert.equal(api.validDemoDay('2026-02-30'),false);
 assert.equal(api.validDemoDay('1999-12-31'),false);
 assert.equal(api.changeDemoDay('2026-02-30'),false);
 assert.equal(api.get().date,'2026-10-26');
 assert.equal(errors[0].bad,true);
 api.changeDemoDay('2026-10-27');
 api.resetDemoDayContexts();
 assert.equal(api.get().date,'2026-10-26');
 assert.equal(api.get().saved,0);
});
test('daily navigation remains local and does not change the original reservation engine',()=>{
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b/);
 assert.match(html,/架空データ専用/);
});
