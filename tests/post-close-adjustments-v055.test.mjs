// v0.55 regression: append-only fictional after-closing remuneration changes.
// No customer refunds, bank transfers, personal data, tax calculation or legal settlement.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.55-post-close-adjustments.html'),'utf8');
const prior=readFileSync(resolve(root,'preview/v0.54-staff-statements.html'),'utf8');
const module=readFileSync(resolve(root,'preview/modules/v0.55-post-close-adjustments.js'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
const previous=[...prior.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
assert.equal(scripts.length,2);
assert.equal(previous.length,2);
assert.ok(scripts[1].includes(module));
const browserWindow={};
runInNewContext(scripts[0],{window:browserWindow});
const Core=browserWindow.DemoCore;
const start=scripts[1].indexOf('const v52Completed=new Map();');
const end=scripts[1].indexOf('function masterContexts(){',start);
assert.ok(start>=0&&end>start);
const source=scripts[1].slice(start,end);
const testPayDate=new Date(Date.now()+86400000).toISOString().slice(0,10);
function element(tag='',cls='',text=''){
 return {tag,cls,textContent:text,value:'',disabled:false,children:[],
  replaceChildren(){this.children=[];},appendChild(c){this.children.push(c);}};
}
function fixture(){
 const model=Core.initial();model.bookings=model.bookings.filter(b=>b.id===1);model.events=[];
 const receipt={number:1,bookingId:1,full:5000,discounts:1000,due:4000,
  menuName:'もみほぐし60分',serviceStaff:'佐藤'};
 const fields=Object.fromEntries([
  'v55Closing','v55Source','v55Kind','v55Direction','v55Amount','v55Reason',
  'v55Confirm','v55Summary','v55History','v54Year','v54Staff','v54Month',
  'v54Closed','v55AnnualAdjustment','v55AnnualEffective','v55AnnualExcess',
  'v54PaidClosing','v54Remaining','v54PaidByDate','v54Provisional',
  'v54Issues','v54Rows','v54Details','v54CsvPreview'
 ].map(id=>[id,element()]));
 fields.v54Year.value='2026';fields.v55Kind.value='refund';
 fields.v55Direction.value='minus';
 const logs=[];
 const rules={s1:[{kind:'contract-store',basis:'net',rate:60,rounding:'floor',
  effective:'2026-10-26',version:2}]};
 const sandbox={
  Core,initial:model,receipts:[receipt],
  $:id=>{assert.ok(fields[id],'Missing fixture '+id);return fields[id]},
  node:element,add:(p,c)=>{p.appendChild(c);return c},
  validDemoDay:day=>/^\d{4}-\d{2}-\d{2}$/.test(day),
  v51RuleForDate:(id,day)=>(rules[id]||[]).find(x=>x.effective<=day)||null,
  v51Calculate:(r,full,discount)=>({basis:full-discount,
   amount:Math.floor((full-discount)*r.rate/100)}),
  demoMasterOption:(select,items)=>{select.value=items.some(x=>x.id===select.value)?
   select.value:items[0]?.id||''},
  recordOperation:(type,details,day)=>logs.push({type,details,day}),
  window:{confirm:()=>true},info:()=>{}
 };
 const program='let model=initial,selectedDemoDay="2026-10-26",demoReceipts=receipts,'+
  'demoDayContexts=new Map(),page="booking",stagedBookingMove=null;\n'+
  'let demoMaster={staff:Core.clone(model.staff)};\n'+source+
  '\n({complete:v52Complete,draft:v52Draft,close:v53Close,pay:v53Pay,'+
  'oldState:v53State,state:v55State,adjust:v55Adjust,sourceNet:v55SourceNet,'+
  'entries:v55Entries,adjustments:()=>v55Adjustments,closings:()=>v53Closings,'+
  'paymentRecords:()=>v53Payments,rows:v54Rows,summary:v54Summary,csv:v54Csv,'+
  'render:v55Render,renderAnnual:v54Render,resetAdjustments:v55Reset});';
 const api=runInNewContext(program,sandbox);
 const close=()=>{
  api.complete('2026-10-26',1);const line=api.draft('2026-10-26',1);
  const closing=api.close('2026-10','s1','2026-11-30');
  return {closing,line};
 };
 return {api,fields,logs,close};
}

test('original booking engine, CSP and isolated old preview remain unchanged',()=>{
 assert.equal(scripts[0],previous[0]);
 assert.match(html,/connect-src 'none'/);
 for(const [_,tag,sourceText] of html.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)){
  const expected=createHash('sha256').update(sourceText,'utf8').digest('base64');
  assert.ok(html.includes("'sha256-"+expected+"'"),'CSP mismatch: '+tag);
 }
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
 assert.match(html,/顧客への返金処理そのものではありません/);
 assert.match(html,/id="page-adjustments"/);
 assert.match(html,/v55Reset\(\)/);
});
test('closing snapshot is frozen and never rewritten by later refund-related reduction',()=>{
 const {api,close,logs}=fixture(),{closing,line}=close();
 const before=JSON.stringify(closing);
 const adjustment=api.adjust(closing.id,line.id,'refund',-600,
  '架空の部分返金に伴う報酬減額');
 assert.ok(Object.isFrozen(adjustment));
 assert.equal(adjustment.delta,-600);
 assert.equal(api.state(closing).effective,1800);
 assert.equal(api.state(closing).remaining,1800);
 assert.equal(api.sourceNet(closing,line.id),1800);
 assert.equal(closing.total,2400);
 assert.equal(JSON.stringify(closing),before);
 assert.equal(api.closings().get(closing.id),closing);
 assert.equal(logs.at(-1).type,'月次報酬の調整');
 assert.equal(api.entries(closing.id).length,1);
});
test('already recorded fictional payments can create an overpayment review, never an automatic reversal',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 api.pay(closing.id,2400,testPayDate,'bank-demo');
 assert.equal(api.paymentRecords().length,1);
 api.adjust(closing.id,line.id,'refund',-900,'架空返金による取り分減額');
 const s=api.state(closing);
 assert.equal(s.original,2400);
 assert.equal(s.delta,-900);
 assert.equal(s.effective,1500);
 assert.equal(s.paid,2400);
 assert.equal(s.remaining,0);
 assert.equal(s.excess,900);
 assert.match(s.label,/過払/);
 assert.equal(api.paymentRecords().length,1);
 assert.throws(()=>api.pay(closing.id,1,testPayDate,'cash-demo'),/未払い額を超え/);
});
test('additional payments cannot exceed reduced balance, and increases can reopen a positive balance',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 api.pay(closing.id,1000,testPayDate,'bank-demo');
 api.adjust(closing.id,line.id,'refund',-800,'架空の返金調整テスト');
 assert.equal(api.state(closing).remaining,600);
 assert.throws(()=>api.pay(closing.id,601,testPayDate,'bank-demo'),/未払い額を超え/);
 api.pay(closing.id,600,testPayDate,'cash-demo');
 assert.equal(api.state(closing).remaining,0);
 api.adjust(closing.id,line.id,'correction',200,'架空の加算訂正テスト');
 assert.equal(api.state(closing).effective,1800);
 assert.equal(api.state(closing).remaining,200);
});
test('malformed, duplicate, non-associated or excessive adjustments are rejected without mutation',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 const base='架空の返金調整内容';
 assert.throws(()=>api.adjust(closing.id,'missing','refund',-100,base),/属する原票/);
 assert.throws(()=>api.adjust('missing',line.id,'refund',-100,base),/締め済み/);
 assert.throws(()=>api.adjust(closing.id,line.id,'refund',100,base),/マイナス/);
 assert.throws(()=>api.adjust(closing.id,line.id,'refund',-2500,base),/マイナス/);
 assert.throws(()=>api.adjust(closing.id,line.id,'refund',0,base),/1円以上/);
 assert.throws(()=>api.adjust(closing.id,line.id,'correction',1000001,base),/100万円以下/);
 assert.throws(()=>api.adjust(closing.id,line.id,'correction',50,'短'),/5〜200文字/);
 assert.equal(api.entries(closing.id).length,0);
 api.adjust(closing.id,line.id,'refund',-100,base);
 assert.throws(()=>api.adjust(closing.id,line.id,'refund',-100,base),/二重計上/);
 assert.equal(api.entries(closing.id).length,1);
});
test('yearly statement and CSV preserve original closing while separately showing adjustment and excess',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 api.pay(closing.id,2000,testPayDate,'bank-demo');
 api.adjust(closing.id,line.id,'refund',-700,'架空返金に伴う月次再調整');
 const year=api.summary('2026','s1');
 assert.equal(year.closed,2400);
 assert.equal(year.adjustment,-700);
 assert.equal(year.effective,1700);
 assert.equal(year.paidOnYearClosings,2000);
 assert.equal(year.remaining,0);
 assert.equal(year.excess,300);
 const month=year.rows.find(r=>r.month==='2026-10');
 assert.equal(month.closed,2400);
 assert.equal(month.effective,1700);
 assert.equal(month.excess,300);
 const csv=api.csv('2026','s1');
 assert.ok(csv.startsWith('\uFEFF'));
 assert.match(csv,/調整後/);
 assert.match(csv,/過払の要確認/);
 assert.match(csv,/"2026-10","1","2400","-700","1700","300"/);
});
test('mock correction page displays source ledger and year totals without changing source amounts',()=>{
 const {api,fields,close}=fixture(),{closing,line}=close();
 api.adjust(closing.id,line.id,'refund',-200,'架空の返金に伴う調整');
 api.render();
 assert.ok(fields.v55Closing.children.length>0);
 assert.ok(fields.v55Source.children.length>0);
 assert.match(fields.v55Summary.textContent,/調整後 2,200円/);
 assert.equal(fields.v55History.children.length,1);
 api.renderAnnual();
 assert.equal(fields.v55AnnualAdjustment.textContent,'-200円');
 assert.equal(fields.v55AnnualEffective.textContent,'2,200円');
 assert.equal(fields.v54Remaining.textContent,'2,200円');
});
test('resetting adjustment records preserves the original closing and does not trigger bank activity',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 api.adjust(closing.id,line.id,'refund',-400,'架空の取消関連調整');
 assert.equal(api.entries(closing.id).length,1);
 api.resetAdjustments();
 assert.equal(api.adjustments().length,0);
 assert.equal(closing.total,2400);
 assert.equal(api.state(closing).effective,2400);
 assert.equal(api.closings().size,1);
});
