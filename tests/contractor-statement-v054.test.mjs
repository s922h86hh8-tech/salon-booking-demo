// Test isolated v0.54 fictional staff statement and annual CSV preview.
// This is not tax advice, proof of payment or authenticated staff access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.54-staff-statements.html'),'utf8');
const old=readFileSync(resolve(root,'preview/v0.53-monthly-settlement.html'),'utf8');
const module=readFileSync(resolve(root,'preview/modules/v0.54-statement-preview.js'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const original=[...old.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,2);
assert.equal(original.length,2);
assert.ok(scripts[1].includes(module));
const coreWindow={};runInNewContext(scripts[0],{window:coreWindow});
const Core=coreWindow.DemoCore;
const start=scripts[1].indexOf('const v52Completed=new Map();');
const end=scripts[1].indexOf('function masterContexts(){',start);
assert.ok(start>=0&&end>start);
const source=scripts[1].slice(start,end);
const payDate=new Date(Date.now()+86400000).toISOString().slice(0,10);

function element(tag='',cls='',text=''){
 return {tag,cls,textContent:text,value:'',disabled:false,children:[],
  replaceChildren(){this.children=[];},appendChild(c){this.children.push(c);}};
}
function fixture(){
 const model=Core.initial();
 model.bookings=model.bookings.filter(b=>b.id===1);
 model.events=[];
 const receipt={number:1,bookingId:1,full:5000,discounts:1000,due:4000,
  menuName:'もみほぐし60分',serviceStaff:'佐藤'};
 const fields=Object.fromEntries([
  'v54Year','v54Staff','v54Month','v54Closed','v54PaidClosing','v54Remaining',
  'v54PaidByDate','v54Provisional','v54Issues','v54Rows','v54Details','v54CsvPreview'
 ].map(id=>[id,element()]));
 fields.v54Year.value='2026';
 const events=[];
 const rules={s1:[{kind:'contract-store',basis:'net',rate:60,rounding:'floor',
  effective:'2026-10-26',version:2}]};
 const sandbox={
  Core,initial:model,receipts:[receipt],
  $:id=>{assert.ok(fields[id],'Missing fixture field '+id);return fields[id]},
  node:element,add:(parent,child)=>{parent.appendChild(child);return child},
  validDemoDay:x=>/^\d{4}-\d{2}-\d{2}$/.test(x),
  v51RuleForDate:(id,day)=>(rules[id]||[]).find(x=>x.effective<=day)||null,
  v51Calculate:(r,full,discount)=>({basis:full-discount,
   amount:Math.floor((full-discount)*r.rate/100)}),
  demoMasterOption:(select,items)=>{select.value=items.some(x=>x.id===select.value)?
   select.value:items[0]?.id||''},
  recordOperation:(kind,details,day)=>events.push({kind,details,day}),
  window:{confirm:()=>true},info:()=>{}
 };
 const program='let model=initial,selectedDemoDay="2026-10-26",demoReceipts=receipts,'+
  'demoDayContexts=new Map(),page="booking",stagedBookingMove=null;\n'+
  'let demoMaster={staff:Core.clone(model.staff)};\n'+source+
  '\n({complete:v52Complete,draft:v52Draft,close:v53Close,pay:v53Pay,'+
  'rows:v54Rows,summary:v54Summary,details:v54Details,csv:v54Csv,'+
  'csvValue:v54CsvValue,render:v54Render,closings:()=>v53Closings});';
 const api=runInNewContext(program,sandbox);
 return {api,fields,events};
}

test('v0.54 preserves the original booking engine and secure inline source hashes',()=>{
 assert.equal(scripts[0],original[0]);
 for(const match of html.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)){
  const digest=createHash('sha256').update(match[2],'utf8').digest('base64');
  assert.ok(html.includes("'sha256-"+digest+"'"),'CSP hash must match inline '+match[1]);
 }
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
 assert.match(html,/本人認証ではありません/);
 assert.match(html,/page-statements/);
});
test('unclosed draft and unresolved appointment remain separate from finalized annual income',()=>{
 const {api}=fixture();
 const before=api.summary('2026','s1');
 assert.equal(before.issues,1);
 assert.equal(before.closed,0);
 api.complete('2026-10-26',1);api.draft('2026-10-26',1);
 const after=api.summary('2026','s1');
 assert.equal(after.issues,0);
 assert.equal(after.provisional,2400);
 assert.equal(after.closed,0);
 assert.equal(after.paidOnYearClosings,0);
 assert.equal(api.details('2026-10','s1')[0].kind,'未締め（参考）');
});
test('monthly closing, partial payment and year-of-payment aggregation stay distinct',()=>{
 const {api}=fixture();
 api.complete('2026-10-26',1);api.draft('2026-10-26',1);
 const closing=api.close('2026-10','s1','2026-11-30');
 const closed=api.summary('2026','s1');
 assert.equal(closed.closed,2400);
 assert.equal(closed.provisional,0);
 assert.equal(closed.remaining,2400);
 assert.equal(closed.paidByDate,0);
 api.pay(closing.id,1000,payDate,'bank-demo');
 const view=api.summary('2026','s1');
 assert.equal(view.closed,2400);
 assert.equal(view.paidOnYearClosings,1000);
 assert.equal(view.remaining,1400);
 const byPayYear=api.summary(payDate.slice(0,4),'s1');
 assert.equal(byPayYear.paidByDate,1000);
 assert.equal(api.details('2026-10','s1')[0].contractVersion,2);
 assert.equal(api.rows('2026','s1').length,12);
});
test('CSV exports 12 months, a clearly separated payment-date total and formula-safe text',()=>{
 const {api}=fixture();
 api.complete('2026-10-26',1);api.draft('2026-10-26',1);
 api.close('2026-10','s1','2026-11-30');
 const csv=api.csv('2026','s1');
 assert.ok(csv.startsWith('\uFEFF'));
 assert.match(csv,/2026-10/);
 assert.match(csv,/未締め参考額/);
 assert.match(csv,/対象年の支払日で集計/);
 assert.match(csv,/申告額ではない/);
 assert.equal(api.csvValue('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
 assert.throws(()=>api.summary('2026','invalid'),/セラピスト/);
 assert.throws(()=>api.summary('2026x','s1'),/対象年/);
});
test('rendered statement is a demo-only, nonpersisted summary',()=>{
 const {api,fields}=fixture();
 api.render();
 assert.equal(fields.v54Rows.children.length,12);
 assert.equal(fields.v54Issues.textContent,'1');
 assert.ok(fields.v54Month.children.length===12);
 assert.equal(fields.v54Details.children.length,1);
 assert.match(html,/架空CSVを保存/);
});
