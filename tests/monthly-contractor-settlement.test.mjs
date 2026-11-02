// node --test tests/monthly-contractor-settlement.test.mjs
// No bank API, invoice issuing, personal information, or actual salary processing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.53-monthly-settlement.html'),'utf8');
const module=readFileSync(resolve(root,'preview/modules/v0.53-monthly-settlement.js'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
assert.equal(scripts.length,2);
assert.ok(scripts[1].includes(module));
const browserWindow={};
runInNewContext(scripts[0],{window:browserWindow});
const Core=browserWindow.DemoCore;
const start=scripts[1].indexOf('const v52Completed=new Map();');
const end=scripts[1].indexOf('function masterContexts(){',start);
assert.ok(start>=0&&end>start);
const source=scripts[1].slice(start,end);
function uiElement(tag='',cls='',text=''){
 return {tag,cls,textContent:text,value:'',children:[],disabled:false,
  replaceChildren(){this.children=[]},appendChild(c){this.children.push(c)},addEventListener(){}};
}
function fixture({kind='contract-store',rate=60,withReceipt=true}={}){
 const model=Core.initial();
 model.bookings=model.bookings.filter(b=>b.id===1);
 model.events=[];
 const fields=Object.fromEntries(['v53Month','v53Staff','v53DueDate','v53SourceCount','v53SourceAmount',
  'v53PendingCount','v53CloseStatus','v53CloseButton','v53PendingList','v53ClosingSelect',
  'v53ClosingDetail','v53PayButton','v53ClosingList','v53PaymentList','v53PayAmount',
  'v53PaidDate','v53PayMethod'].map(id=>[id,uiElement()]));
 fields.v53Month.value='2026-10';fields.v53Staff.value='s1';
 fields.v53DueDate.value='2026-11-30';fields.v53PaidDate.value='2026-11-30';
 fields.v53PayMethod.value='bank-demo';
 const events=[];
 const receipt={number:1,bookingId:1,full:5000,discounts:1000,due:4000,menuName:'もみほぐし60分',serviceStaff:'佐藤'};
 const receipts=withReceipt?[receipt]:[];
 const rules={s1:[{kind,basis:'net',rate,rounding:'floor',effective:'2026-10-26',version:2}],s2:[]};
 const params={Core,model,receipts};
 const code=[
  'let model=initial,selectedDemoDay="2026-10-26",demoReceipts=receipts,',
  'demoDayContexts=new Map(),page="booking",stagedBookingMove=null;',
  'let demoMaster={staff:Core.clone(model.staff)};',
  source,
  '({complete:v52Complete,draft:v52Draft,close:v53Close,pay:v53Pay,state:v53State,render:v53Render,',
  'unprocessed:v53Unprocessed,closedForService:v53ClosedForService,',
  'closings:()=>v53Closings,payments:()=>v53Payments,ledger:()=>v52Ledger,',
  'newBooking:b=>model.bookings.push(b),reset:v53Reset});'
 ].join('\n');
 const sandbox={
  Core,initial:model,receipts, $:id=>{assert.ok(fields[id],'No element '+id);return fields[id]},
  node:uiElement,add:(p,c)=>{p.appendChild(c);return c},
  validDemoDay:x=>/^\d{4}-\d{2}-\d{2}$/.test(x),
  demoMasterOption:(select,items)=>{const prior=select.value;select.value=items.some(x=>x.id===prior)?prior:items[0]?.id||''},
  v51RuleForDate:(id,day)=>(rules[id]||[]).find(x=>x.effective<=day)||null,
  v51Calculate:(r,full,discount)=>({basis:full-discount,amount:Math.floor((full-discount)*r.rate/100)}),
  recordOperation:(kind,details,day)=>events.push({kind,details,day}),displayDemoDay:s=>s,
  window:{confirm:()=>true},info:()=>{}
 };
 const api=runInNewContext(code,sandbox);
 return {api,fields,model,rules,events};
}
test('requires completion and a unique receipt before closing a month',()=>{
 const {api}=fixture();
 assert.equal(api.unprocessed('2026-10','s1').length,1);
 assert.throws(()=>api.close('2026-10','s1','2026-11-30'),/原票のない確定予約/);
 api.complete('2026-10-26',1);
 assert.throws(()=>api.close('2026-10','s1','2026-11-30'),/原票のない確定予約/);
 const line=api.draft('2026-10-26',1);
 assert.equal(line.amount,2400);
 const closed=api.close('2026-10','s1','2026-11-30');
 assert.equal(closed.total,2400);
 assert.equal(closed.sourceCount,1);
 assert.ok(Object.isFrozen(closed));
 assert.ok(Object.isFrozen(closed.lines));
 assert.throws(()=>api.close('2026-10','s1','2026-11-30'),/二重締め/);
 assert.throws(()=>api.draft('2026-10-26',1),/二重計上|締め済み/);
});
test('partial payments and outstanding totals never exceed a frozen monthly closing',()=>{
 const {api}=fixture();
 api.complete('2026-10-26',1);api.draft('2026-10-26',1);
 const closed=api.close('2026-10','s1','2026-11-30');
 const p=api.pay(closed.id,1000,'2026-11-30','bank-demo');
 assert.equal(p.amount,1000);
 assert.equal(api.state(closed).paid,1000);
 assert.equal(api.state(closed).remaining,1400);
 assert.match(api.state(closed).label,/一部支払/);
 assert.throws(()=>api.pay(closed.id,2000,'2026-11-30','bank-demo'),/未払い額を超え/);
 api.pay(closed.id,1400,'2026-11-30','cash-demo');
 assert.equal(api.state(closed).remaining,0);
 assert.match(api.state(closed).label,/支払済み/);
 assert.throws(()=>api.pay(closed.id,1,'2026-11-30','bank-demo'),/未払い額を超え/);
 assert.throws(()=>api.pay(closed.id,0,'2026-11-30','bank-demo'),/1円以上/);
});
test('after close, additional services cannot silently create new payable lines',()=>{
 const {api,fields}=fixture();
 api.complete('2026-10-26',1);api.draft('2026-10-26',1);
 const closed=api.close('2026-10','s1','2026-11-30');
 api.newBooking({id:5,staff:'s1',menu:'m60',bed:'b1',start:930,
  status:'CONFIRMED',customer:'架空のお客様E'});
 assert.throws(()=>api.complete('2026-10-26',5),/締め済み/);
 api.render();
 assert.match(fields.v53CloseStatus.textContent,/締め後に未処理/);
 assert.equal(api.closings().get(closed.id).total,2400);
});
test('personally owned sales are excluded from the store contractor payable total',()=>{
 const {api}=fixture({kind:'contract-personal'});
 api.complete('2026-10-26',1);
 const record=api.draft('2026-10-26',1);
 assert.equal(record.kind,'PERSONAL_SALE_REFERENCE');
 assert.throws(()=>api.close('2026-10','s1','2026-11-30'),/原票のない確定予約|報酬原票がありません/);
 assert.equal(api.closings().size,0);
});
test('closing rejects an invalid due date and missing supporting documents',()=>{
 const {api}=fixture({withReceipt:false});
 api.complete('2026-10-26',1);
 assert.throws(()=>api.draft('2026-10-26',1),/会計記録がありません/);
 assert.throws(()=>api.close('2026-10','s1','2026-10-01'),/支払予定日|原票のない確定予約/);
 assert.throws(()=>api.close('2026-13','s1','2026-11-30'),/対象月/);
});
test('monthly settlement is visibly a fictional non-persistent form',()=>{
 assert.match(html,/id="page-settlement"/);
 assert.match(html,/id="v53PayButton"/);
 assert.match(html,/振込.*模擬|架空データ・送金なし/);
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
