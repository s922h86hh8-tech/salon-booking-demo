// v0.57 regression: append-only fictional after-closing remuneration changes.
// No customer refunds, bank transfers, personal data, tax calculation or legal settlement.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.57-two-person-approval.html'),'utf8');
const prior=readFileSync(resolve(root,'preview/v0.56-correction-audit.html'),'utf8');
const module=readFileSync(resolve(root,'preview/modules/v0.57-two-person-approval.js'),'utf8');
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
  replaceChildren(){this.children=[];},appendChild(c){this.children.push(c);},addEventListener(){}};
}
function fixture(){
 const model=Core.initial();model.bookings=model.bookings.filter(b=>b.id===1);model.events=[];
 const receipt={number:1,bookingId:1,full:5000,discounts:1000,due:4000,
  menuName:'もみほぐし60分',serviceStaff:'佐藤'};
 const fields=Object.fromEntries([
  'v55Closing','v55Source','v55Kind','v55Direction','v55Amount','v55Reason',
  'v55Confirm','v55Summary','v55History','v56Operator','v56LastRecorded','v57Mode','v57CurrentActor','v57RequestList','v57RejectReason','v54Year','v54Staff','v54Month',
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
  'render:v57Render,renderAnnual:v54Render,resetAdjustments:v55Reset,actor:v57Actor,formatJst:v56Jst,
  request:v57Request,review:v57Review,switchRole:v57SelectRole,
  status:v57RequestStatus,requests:()=>v57Requests,reviewRecords:()=>v57ReviewRecords,
  resetApproval:v57Reset});';
 const api=runInNewContext(program,sandbox);
 const close=()=>{
  api.complete('2026-10-26',1);const line=api.draft('2026-10-26',1);
  const closing=api.close('2026-10','s1','2026-11-30');
  return {closing,line};
 };
 return {api,fields,logs,close};
}

test('v0.57 preserves original booking engine and no-network CSP while documenting demo-only roles',()=>{
 assert.equal(scripts[0],previous[0]);
 assert.match(html,/本人認証はありません/);
 assert.match(html,/承認前は金額を変えません/);
 assert.match(html,/id="v57Mode"/);
 assert.match(html,/id="v57RequestList"/);
 for(const match of html.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)){
  const hash=createHash('sha256').update(match[2],'utf8').digest('base64');
  assert.ok(html.includes("'sha256-"+hash+"'"),'Inline CSP mismatch');
 }
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
test('submission captures mock requester, timing, before-after preview without changing money',()=>{
 const {api,close,logs}=fixture(),{closing,line}=close();
 const old=JSON.stringify(closing);
 const start=Date.now(),req=api.request(closing.id,line.id,'refund',-400,'架空返金に関する報酬変更'),end=Date.now();
 assert.equal(req.requestedById,'demo-manager-01');
 assert.equal(req.requesterAuthenticated,false);
 assert.ok(Date.parse(req.requestedAt)>=start&&Date.parse(req.requestedAt)<=end);
 assert.equal(req.sourceBefore,2400);assert.equal(req.sourceAfter,2000);
 assert.equal(req.monthBefore,2400);assert.equal(req.monthAfter,2000);
 assert.equal(req.paidBefore,0);
 assert.ok(Object.isFrozen(req));
 assert.equal(api.status(req),'PENDING');
 assert.equal(api.adjustments().length,0);
 assert.equal(api.state(closing).effective,2400);
 assert.equal(JSON.stringify(closing),old);
 assert.equal(logs.at(-1).type,'訂正申請（模擬）');
});
test('approval requires separate approver role and direct adjustment cannot bypass approval',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 const req=api.request(closing.id,line.id,'refund',-400,'架空返金の申請確認テスト');
 assert.throws(()=>api.adjust(closing.id,line.id,'refund',-400,req.reason),/承認されていない/);
 assert.throws(()=>api.review(req.id,'APPROVE'),/承認担当者の役割/);
 assert.throws(()=>api.switchRole('admin'),/模擬役割/);
 api.switchRole('approver');
 assert.throws(()=>api.request(closing.id,line.id,'refund',-200,'承認者は申請できない'),/申請担当者/);
 const {record,adjustment}=api.review(req.id,'APPROVE');
 assert.equal(record.status,'APPROVED');
 assert.equal(record.reviewedById,'demo-owner-01');
 assert.equal(record.reviewerAuthenticated,false);
 assert.equal(record.adjustmentId,adjustment.id);
 assert.equal(adjustment.requestedById,'demo-manager-01');
 assert.equal(adjustment.approvedById,'demo-owner-01');
 assert.equal(adjustment.recordedById,'demo-owner-01');
 assert.equal(adjustment.sourceBefore,2400);
 assert.equal(adjustment.sourceAfter,2000);
 assert.equal(api.state(closing).effective,2000);
 assert.equal(closing.total,2400);
 assert.equal(api.adjustments().length,1);
 assert.ok(Object.isFrozen(record));
 assert.ok(Object.isFrozen(adjustment));
 assert.throws(()=>api.review(req.id,'APPROVE'),/判断済み/);
});
test('rejection requires a reason, leaves financial values unchanged and cannot be reviewed again',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 const req=api.request(closing.id,line.id,'correction',250,'架空の金額の訂正申請');
 api.switchRole('approver');
 assert.throws(()=>api.review(req.id,'REJECT','短'),/差戻し理由/);
 assert.equal(api.status(req),'PENDING');
 const {record,adjustment}=api.review(req.id,'REJECT','根拠の会計記録が確認できません');
 assert.equal(record.status,'REJECTED');assert.equal(adjustment,null);
 assert.equal(record.reason,'根拠の会計記録が確認できません');
 assert.equal(api.adjustments().length,0);
 assert.equal(api.state(closing).effective,2400);
 assert.throws(()=>api.review(req.id,'APPROVE'),/判断済み/);
});
test('proposal becomes stale if payment total changed after request, with no adjustment applied',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 const req=api.request(closing.id,line.id,'refund',-300,'架空の締め後の報酬減額');
 api.pay(closing.id,600,testPayDate,'bank-demo');
 api.switchRole('approver');
 const outcome=api.review(req.id,'APPROVE');
 assert.equal(outcome.record.status,'STALE');
 assert.equal(outcome.adjustment,null);
 assert.equal(api.state(closing).effective,2400);
 assert.equal(api.adjustments().length,0);
});
test('duplicate pending proposal is blocked, and post-approval outdated concurrent proposals do not double apply',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 const req=api.request(closing.id,line.id,'refund',-300,'架空の同内容変更申請');
 assert.throws(()=>api.request(closing.id,line.id,'refund',-300,'架空の同内容変更申請'),/承認待ち/);
 const different=api.request(closing.id,line.id,'correction',120,'別の金額の増額申請です');
 api.switchRole('approver');
 const result=api.review(req.id,'APPROVE');
 assert.equal(result.record.status,'APPROVED');
 const stale=api.review(different.id,'APPROVE');
 assert.equal(stale.record.status,'STALE');
 assert.equal(api.adjustments().length,1);
 assert.equal(api.state(closing).effective,2100);
});
test('approval workflow UI shows request status, actor, Japanese timing and disabled controls by role',()=>{
 const {api,fields,close}=fixture(),{closing,line}=close();
 api.render();
 assert.match(fields.v57CurrentActor.textContent,/デモ申請担当/);
 assert.match(fields.v56Operator.value,/デモ申請担当/);
 assert.equal(fields.v55Confirm.disabled,false);
 const req=api.request(closing.id,line.id,'refund',-300,'架空の申請を画面へ反映');
 api.render();
 assert.equal(fields.v57RequestList.children.length,1);
 const card=fields.v57RequestList.children[0];
 assert.match(card.children[0].textContent,/承認待ち/);
 api.switchRole('approver');api.render();
 assert.equal(fields.v55Confirm.disabled,true);
 assert.match(fields.v56Operator.value,/デモ承認担当/);
 assert.equal(card.children.length>0,true);
 api.review(req.id,'APPROVE');api.render();
 assert.match(fields.v57RequestList.children[0].children[0].textContent,/承認済み/);
 assert.equal(fields.v55History.children.length,1);
 const audit=fields.v55History.children[0].children.map(x=>x.textContent).join(' ');
 assert.match(audit,/操作担当：デモ承認担当（架空）/);
});
test('reset clears the demo approval queue without mutating earlier closing',()=>{
 const {api,close}=fixture(),{closing,line}=close();
 const req=api.request(closing.id,line.id,'refund',-200,'架空の返金による減額');
 api.switchRole('approver');api.review(req.id,'APPROVE');
 api.resetApproval();api.resetAdjustments();
 assert.equal(api.requests().length,0);
 assert.equal(api.reviewRecords().size,0);
 assert.equal(api.adjustments().length,0);
 assert.equal(api.actor().role,'requester');
 assert.equal(closing.total,2400);
});
