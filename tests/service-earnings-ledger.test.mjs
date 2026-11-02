// Run: node --test tests/service-earnings-ledger.test.mjs
// Fictional completed-service ledger only. No tax, payout or network activities.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(dir,'preview/v0.52-service-earnings-ledger.html'),'utf8');
const moduleCode=readFileSync(resolve(dir,'preview/modules/v0.52-service-earnings-ledger.js'),'utf8');
const priorRuleCode=readFileSync(resolve(dir,'preview/modules/v0.51-contractor-versioned-rate.js'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(script.length,2);
assert.ok(script[1].includes(moduleCode));
const window={};
runInNewContext(script[0],{window});
const Core=window.DemoCore;
const {v51Calculate}=runInNewContext(priorRuleCode+
 '\n({v51Calculate});',{demoMaster:{contractRules:{}}});
function element(tag='',cls='',str=''){
 return {tag,cls,textContent:str,disabled:false,children:[],
  replaceChildren(){this.children=[]},appendChild(c){this.children.push(c)},
  addEventListener(){}};
}
function fixture({kind='contract-store',withPayment=true}={}){
 const date='2026-10-26',later='2026-10-27';
 const second=Core.initial();second.bookings=second.bookings.filter(b=>b.id===1);
 const receipt=(discount,number=1)=>({number,bookingId:1,full:5000,discounts:discount,due:5000-discount,
  serviceStaff:'佐藤',menuName:'もみほぐし60分'});
 const secondReceipts=[receipt(0)];
 const contexts=new Map([[later,{model:second,receipts:secondReceipts}]]);
 const firstReceipts=withPayment?[receipt(1000)]:[];
 const fields=Object.fromEntries(['v52CurrentDay','v52DayBookings','v52DraftList',
  'v52DraftCount','v52DraftAmount'].map(id=>[id,element()]));
 const rules={s1:[{kind,basis:'net',rate:60,rounding:'floor',effective:date,version:2}],s2:[]};
 const operations=[];
 const init=[
  "let model=Core.initial(),selectedDemoDay='2026-10-26',",
  'demoReceipts=startingReceipts,stagedBookingMove=null,page="booking";',
  moduleCode,
  '({complete:v52Complete,draft:v52Draft,render:v52Render,status:v52Status,',
  'ledger:()=>v52Ledger,completions:()=>v52Completed,reset:v52Reset,',
  'switchDay:(next,dayModel,rs)=>{selectedDemoDay=next;model=dayModel;demoReceipts=rs;},model:()=>model});'
 ].join('\n');
 const api=runInNewContext(init,{Core,startingReceipts:firstReceipts,demoDayContexts:contexts,
  validDemoDay:x=>/^\d{4}-\d{2}-\d{2}$/.test(x),
  $:id=>{assert.ok(fields[id],'Missing '+id);return fields[id]},
  node:element,add:(p,c)=>{p.appendChild(c);return c},
  displayDemoDay:s=>s,
  v51RuleForDate:(id,day)=>(rules[id]||[]).filter(x=>x.effective<=day).at(-1)||null,
  v51Calculate,recordOperation:(cat,msg,day)=>operations.push({cat,msg,day}),info:()=>{}});
 return {api,fields,rules,operations,contexts,receipt,firstReceipts};
}
test('booking by itself does not earn contractor pay; both completion and checkout are required',()=>{
 const {api}=fixture({withPayment:false});
 assert.throws(()=>api.draft('2026-10-26',1),/施術完了/);
 api.complete('2026-10-26',1);
 assert.throws(()=>api.complete('2026-10-26',1),/すでに/);
 assert.throws(()=>api.draft('2026-10-26',1),/会計記録がありません/);
});
test('same booking ID on distinct days yields distinct service and receipt identifiers',()=>{
 const {api}=fixture();
 api.complete('2026-10-26',1);
 const first=api.draft('2026-10-26',1);
 api.complete('2026-10-27',1);
 const second=api.draft('2026-10-27',1);
 assert.notEqual(first.id,second.id);
 assert.notEqual(first.receiptKey,second.receiptKey);
 assert.equal(first.amount,2400);
 assert.equal(second.amount,3000);
 assert.equal(api.ledger().size,2);
 assert.throws(()=>api.draft('2026-10-26',1),/二重計上/);
});
test('contract snapshot in the provisional ledger does not change with a later rule',()=>{
 const {api,rules}=fixture();
 api.complete('2026-10-26',1);
 const draft=api.draft('2026-10-26',1);
 rules.s1.push({kind:'contract-store',basis:'net',rate:80,rounding:'floor',effective:'2026-10-27',version:3});
 assert.equal(draft.amount,2400);
 assert.equal(draft.contract.rate,60);
 assert.equal(draft.contract.version,2);
 assert.ok(Object.isFrozen(draft));
 assert.ok(Object.isFrozen(draft.contract));
});
test('invalid receipts and canceled bookings never produce a valid provisional record',()=>{
 const {api,contexts}=fixture();
 api.complete('2026-10-26',1);
 contexts.get('2026-10-27').receipts.push({...contexts.get('2026-10-27').receipts[0],number:2});
 api.complete('2026-10-27',1);
 assert.throws(()=>api.draft('2026-10-27',1),/複数の会計/);
 const {api:secondApi}=fixture();
 secondApi.complete('2026-10-26',1);
 secondApi.model().bookings.find(x=>x.id===1).status='CANCELLED';
 assert.throws(()=>secondApi.draft('2026-10-26',1),/取消・変更/);
});
test('a personal-sales contractor quote does not add to store payable total',()=>{
 const {api,fields}=fixture({kind:'contract-personal'});
 api.complete('2026-10-26',1);
 const draft=api.draft('2026-10-26',1);
 assert.equal(draft.kind,'PERSONAL_SALE_REFERENCE');
 api.render();
 assert.equal(fields.v52DraftAmount.textContent,'0円');
 assert.equal(fields.v52DraftCount.textContent,'1');
});
test('no actual payments, external transmission or persisted customer data',()=>{
 assert.match(html,/id="page-earnings"/);
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
