// v0.56 regression: append-only fictional after-closing remuneration changes.
// No customer refunds, bank transfers, personal data, tax calculation or legal settlement.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.56-correction-audit.html'),'utf8');
const prior=readFileSync(resolve(root,'preview/v0.55-post-close-adjustments.html'),'utf8');
const module=readFileSync(resolve(root,'preview/modules/v0.56-correction-audit.js'),'utf8');
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
  'v55Confirm','v55Summary','v55History','v56Operator','v56LastRecorded','v54Year','v54Staff','v54Month',
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
  'render:v55Render,renderAnnual:v54Render,resetAdjustments:v55Reset,actor:v56Actor,formatJst:v56Jst});';
 const api=runInNewContext(program,sandbox);
 const close=()=>{
  api.complete('2026-10-26',1);const line=api.draft('2026-10-26',1);
  const closing=api.close('2026-10','s1','2026-11-30');
  return {closing,line};
 };
 return {api,fields,logs,close};
}

test('v0.56 preserves v0.55 booking engine, no-network CSP and readonly auto fields',()=>{
 assert.equal(scripts[0],previous[0]);
 assert.match(html,/id="v56Operator"[^>]*readonly/);
 assert.match(html,/id="v56LastRecorded"[^>]*readonly/);
 assert.match(html,/本人認証はありません/);
 for(const [_,tag,src] of html.matchAll(/<(script|style)>([\\s\\S]*?)<\\/\\1>/g)){
  const hash=createHash('sha256').update(src,'utf8').digest('base64');
  assert.ok(html.includes("'sha256-"+hash+"'"),'CSP mismatch for '+tag);
 }
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\\bfetch\\s*\\(|\\bXMLHttpRequest\\b|\\blocalStorage\\b|\\bindexedDB\\b/);
});
test('financial correction auto-captures actor, UTC timestamp, target and before-after snapshots',()=>{
 const {api,close,logs}=fixture(),{closing,line}=close();
 const before=JSON.stringify(closing);
 const start=Date.now();
 const audit=api.adjust(closing.id,line.id,'refund',-400,'架空の返金額に伴う訂正');
 const end=Date.now();
 assert.equal(audit.recordedById,'demo-manager-01');
 assert.equal(audit.recordedByName,'デモ管理者（架空）');
 assert.equal(audit.recordedByRole,'店舗管理者（模擬）');
 assert.equal(audit.identityVerified,false);
 assert.equal(audit.targetStaffId,'s1');
 assert.equal(audit.targetStaffName,'佐藤');
 assert.equal(audit.sourceBefore,2400);
 assert.equal(audit.sourceAfter,2000);
 assert.equal(audit.monthBefore,2400);
 assert.equal(audit.monthAfter,2000);
 assert.ok(Date.parse(audit.createdAt)>=start&&Date.parse(audit.createdAt)<=end);
 assert.match(audit.createdAt,/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/);
 assert.ok(Object.isFrozen(audit));
 assert.equal(JSON.stringify(closing),before);
 assert.match(logs.at(-1).details,/訂正担当：デモ管理者/);
 assert.match(logs.at(-1).details,/自動記録時刻：/);
});
test('each consecutive correction freezes independent before-after figures and timestamp',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 const first=api.adjust(closing.id,line.id,'refund',-200,'架空の部分返金を想定した調整');
 const second=api.adjust(closing.id,line.id,'correction',100,'架空の再計算を想定した訂正');
 assert.equal(first.sourceBefore,2400);
 assert.equal(first.sourceAfter,2200);
 assert.equal(second.sourceBefore,2200);
 assert.equal(second.sourceAfter,2300);
 assert.equal(first.monthBefore,2400);
 assert.equal(first.monthAfter,2200);
 assert.equal(second.monthBefore,2200);
 assert.equal(second.monthAfter,2300);
 assert.equal(first.sourceAfter,2200);
 assert.equal(api.entries(closing.id).length,2);
});
test('read-only fields display fictional operator and last committed time; history shows name and amounts',()=>{
 const {api,close,fields}=fixture(),{closing,line}=close();
 api.render();
 assert.match(fields.v56Operator.value,/デモ管理者（架空） ／ 本人未確認/);
 assert.equal(fields.v56LastRecorded.value,'この締めには訂正履歴なし');
 const adjustment=api.adjust(closing.id,line.id,'refund',-300,'架空の返金調整テスト');
 api.render();
 assert.equal(fields.v56LastRecorded.value,api.formatJst(adjustment.createdAt));
 const entry=fields.v55History.children[0];
 const details=entry.children.map(x=>x.textContent).join(' | ');
 assert.match(details,/操作担当：デモ管理者（架空）/);
 assert.match(details,/本人認証なし/);
 assert.match(details,/訂正前（原票）：2,400円 → 訂正後：2,100円/);
 assert.match(details,/自動記録：/);
 assert.match(details,/日本時間/);
});
test('no actor input parameter can forge identity; demo is not a reliable production audit record',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 const actual=api.actor();
 assert.equal(actual.authenticated,false);
 assert.ok(Object.isFrozen(actual));
 assert.equal(api.formatJst('2026-11-03T01:23:45.000Z').includes('10:23:45'),true);
 const audit=api.adjust(closing.id,line.id,'refund',-1,'架空の担当記録確認',
  {id:'malicious',name:'偽の名前'});
 assert.equal(audit.recordedById,actual.id);
 assert.equal(audit.recordedByName,actual.name);
});
