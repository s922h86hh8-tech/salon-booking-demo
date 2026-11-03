// v0.59 fictional local SQLite transaction tests. No external API or real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalPrototype} from '../server-design/v0.59-local-transaction-store.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function fixture(dbPath=':memory:'){
 const sessions=Object.freeze({
  maker:{userId:'alice',authenticated:true},
  checker:{userId:'bob',authenticated:true},
  therapist:{userId:'t1',authenticated:true},
  therapist2:{userId:'t2',authenticated:true},
  desk:{userId:'desk',authenticated:true},
  otherStore:{userId:'other',authenticated:true},
  disabled:{userId:'disabled',authenticated:true}
 });
 let counter=0;
 const app=openLocalPrototype({
  path:dbPath,
  resolveSession:(handle)=>Object.hasOwn(sessions,handle)?sessions[handle]:null,
  clock:()=>new Date(Date.UTC(2026,10,3,5,1,counter++%59))
 });
 const db=app.unsafeDbForTests;
 for(const [storeId,name] of [['A','架空A'],['B','架空B']]){
  db.prepare('INSERT INTO stores VALUES(?,?)').run(storeId,name);
 }
 for(const who of ['alice','bob','t1','t2','desk','other','disabled']){
  db.prepare('INSERT INTO users(user_id,active) VALUES(?,?)')
    .run(who,who==='disabled'?0:1);
 }
 for(const [storeId,userId,role,staffId,active] of [
  ['A','alice','manager',null,1],
  ['A','bob','owner',null,1],
  ['A','t1','therapist','staff-1',1],
  ['A','t2','therapist','staff-2',1],
  ['A','desk','receptionist',null,1],
  ['A','disabled','manager',null,1],
  ['B','other','owner',null,1]
 ]){
  db.prepare('INSERT INTO store_memberships(store_id,user_id,role,staff_id,active) VALUES(?,?,?,?,?)')
   .run(storeId,userId,role,staffId,active);
 }
 for(const [storeId,closingId,sourceId,staffId] of [
  ['A','same-close','same-source','staff-1'],
  ['A','second-close','other-source','staff-2'],
  ['B','same-close','same-source','staff-1']
 ]){
  db.prepare('INSERT INTO monthly_closings(store_id,closing_id,staff_id,month,original_total) VALUES(?,?,?,?,?)')
   .run(storeId,closingId,staffId,'2026-10',2400);
  db.prepare('INSERT INTO closing_projections(store_id,closing_id,version,net_total) VALUES(?,?,0,2400)')
   .run(storeId,closingId);
  db.prepare('INSERT INTO earnings_source_lines(store_id,closing_id,source_id,original_amount,contract_version) VALUES(?,?,?,2400,2)')
   .run(storeId,closingId,sourceId);
 }
 const base={
  sessionHandle:'maker',storeId:'A',closingId:'same-close',
  sourceId:'same-source',kind:'refund',delta:-400,
  reason:'架空のお客様返金に伴う報酬調整',idempotencyKey:'key-correction-001'
 };
 const req=(x={})=>app.requestCorrection({...base,...x});
 const review=(requestId,decision='APPROVE',x={})=>app.reviewCorrection({
  sessionHandle:'checker',storeId:'A',requestId,decision,...x
 });
 const count=(table,storeId='A')=>db.prepare('SELECT COUNT(*) as n FROM '+table+' WHERE store_id=?').get(storeId).n;
 const proj=(storeId='A',closingId='same-close')=>db.prepare(
  'SELECT * FROM closing_projections WHERE store_id=? AND closing_id=?'
 ).get(storeId,closingId);
 return {app,db,req,review,count,proj,base};
}

test('construction rejects missing trusted resolver and creates FK-enabled database',()=>{
 assert.throws(()=>openLocalPrototype(),{code:'TRUSTED_SESSION_RESOLVER_REQUIRED'});
 const {app,db}=fixture();
 assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 app.close();
});
test('request is append-only, audit-stamped and does not change pending money',()=>{
 const {app,req,db,count,proj}=fixture();
 const initial=app.statement({sessionHandle:'therapist',storeId:'A',staffId:'staff-1'});
 const r=req();
 assert.equal(r.status,'PENDING');
 assert.equal(r.replayed,false);
 assert.equal(r.requestedByUserId,'alice');
 assert.equal(r.sourceBefore,2400);
 assert.equal(r.monthProposed,2000);
 assert.match(r.requestedAt,/^2026-11-03T05:01:\d{2}\.000Z$/);
 assert.equal(proj().net_total,2400);
 assert.equal(initial[0].effectiveTotal,2400);
 assert.equal(count('correction_requests'),1);
 assert.equal(count('correction_adjustments'),0);
 assert.equal(count('audit_events'),1);
 assert.equal(db.prepare('SELECT actor_user_id FROM audit_events').get().actor_user_id,'alice');
 app.close();
});
test('same idempotency key returns initial request without duplicate ledger writes',()=>{
 const {app,req,count}=fixture();
 const first=req(),second=req();
 assert.equal(first.requestId,second.requestId);
 assert.equal(second.replayed,true);
 assert.equal(count('correction_requests'),1);
 assert.equal(count('audit_events'),1);
 assert.throws(()=>req({delta:-200}),{code:'IDEMPOTENCY_CONFLICT'});
 assert.equal(count('correction_requests'),1);
 app.close();
});
test('store and staff views cannot cross tenant or impersonate another staff',()=>{
 const {app}=fixture();
 assert.equal(app.statement({sessionHandle:'therapist',storeId:'A',staffId:'staff-1'}).length,1);
 assert.throws(()=>app.statement({
  sessionHandle:'therapist',storeId:'A',staffId:'staff-2'
 }),{code:'NOT_OWN_STATEMENT'});
 assert.throws(()=>app.statement({
  sessionHandle:'therapist',storeId:'B',staffId:'staff-1'
 }),{code:'INACTIVE_MEMBERSHIP'});
 assert.throws(()=>app.statement({
  sessionHandle:'otherStore',storeId:'A',staffId:'staff-1'
 }),{code:'INACTIVE_MEMBERSHIP'});
 assert.throws(()=>app.statement({
  sessionHandle:'missing',storeId:'A',staffId:'staff-1'
 }),{code:'UNAUTHENTICATED'});
 assert.throws(()=>app.statement({
  sessionHandle:'disabled',storeId:'A',staffId:'staff-1'
 }),{code:'UNAUTHENTICATED'});
 assert.equal(app.statement({sessionHandle:'otherStore',storeId:'B',staffId:'staff-1'}).length,1);
 app.close();
});
test('staff and front desk cannot submit or approve financial corrections',()=>{
 const {app,req}=fixture();
 assert.throws(()=>req({sessionHandle:'desk'}),{code:'ROLE_FORBIDDEN'});
 assert.throws(()=>req({sessionHandle:'therapist'}),{code:'ROLE_FORBIDDEN'});
 const r=req();
 for(const person of ['desk','therapist','otherStore']){
  assert.throws(()=>app.reviewCorrection({
   sessionHandle:person,storeId:'A',requestId:r.requestId,decision:'APPROVE'
  }));
 }
 assert.equal(app.unsafeDbForTests.prepare(
  'SELECT COUNT(*) AS n FROM correction_decisions'
 ).get().n,0);
 app.close();
});
test('requester cannot approve own correction; checker approves atomically',()=>{
 const {app,req,review,db,count,proj}=fixture();
 const r=req();
 assert.throws(()=>app.reviewCorrection({
  sessionHandle:'maker',storeId:'A',requestId:r.requestId,decision:'APPROVE'
 }),{code:'SELF_APPROVAL_FORBIDDEN'});
 const result=review(r.requestId);
 assert.equal(result.status,'APPROVED');
 assert.equal(result.applied,true);
 assert.equal(result.reviewedByUserId,'bob');
 assert.equal(result.monthBefore,2400);
 assert.equal(result.monthAfter,2000);
 assert.equal(proj().net_total,2000);
 assert.equal(proj().version,1);
 assert.equal(count('correction_decisions'),1);
 assert.equal(count('correction_adjustments'),1);
 assert.equal(count('audit_events'),2);
 assert.equal(db.prepare(
  'SELECT reviewed_by_user_id FROM correction_decisions'
 ).get().reviewed_by_user_id,'bob');
 const s=app.statement({sessionHandle:'therapist',storeId:'A',staffId:'staff-1'});
 assert.equal(s[0].effectiveTotal,2000);
 assert.equal(s[0].originalTotal,2400);
 assert.throws(()=>review(r.requestId),{code:'ALREADY_REVIEWED'});
 app.close();
});
test('rejection requires reason and does not create adjustment',()=>{
 const {app,req,review,proj,count}=fixture();
 const r=req();
 assert.throws(()=>review(r.requestId,'REJECT',{reason:'短'}),{
  code:'REJECTION_REASON_REQUIRED'
 });
 assert.equal(count('correction_decisions'),0);
 const outcome=review(r.requestId,'REJECT',{reason:'架空の原票照合ができません'});
 assert.equal(outcome.status,'REJECTED');
 assert.equal(outcome.applied,false);
 assert.equal(proj().net_total,2400);
 assert.equal(count('correction_decisions'),1);
 assert.equal(count('correction_adjustments'),0);
 assert.equal(count('audit_events'),2);
 app.close();
});
test('payment after proposal makes approval stale without adjustment',()=>{
 const {app,req,review,db,proj,count}=fixture();
 const r=req();
 db.prepare('INSERT INTO payment_records(store_id,closing_id,payment_id,amount,recorded_at) VALUES(?,?,?,?,?)')
  .run('A','same-close','payment-1',1000,'2026-11-03T03:00:00.000Z');
 const result=review(r.requestId);
 assert.equal(result.status,'STALE');
 assert.equal(result.applied,false);
 assert.equal(proj().net_total,2400);
 assert.equal(count('correction_adjustments'),0);
 assert.equal(count('correction_decisions'),1);
 app.close();
});
test('earlier approval causes later proposal with same version to become stale',()=>{
 const {app,req,review,proj,count}=fixture();
 const a=req();
 const b=req({delta:-300,idempotencyKey:'another-key-001',reason:'架空の別件の調整予定'});
 assert.equal(proj().version,0);
 assert.equal(review(a.requestId).status,'APPROVED');
 assert.equal(review(b.requestId).status,'STALE');
 assert.equal(proj().net_total,2000);
 assert.equal(proj().version,1);
 assert.equal(count('correction_adjustments'),1);
 app.close();
});
test('audit persistence failure rolls back decision, adjustment and projection',()=>{
 const {app,req,review,db,count,proj}=fixture();
 const r=req();
 db.exec("CREATE TRIGGER test_force_audit_fail BEFORE INSERT ON audit_events WHEN NEW.action='correction.approved' BEGIN SELECT RAISE(ABORT,'mock audit persistence failure'); END;");
 assert.throws(()=>review(r.requestId),/mock audit persistence failure/);
 assert.equal(count('correction_decisions'),0);
 assert.equal(count('correction_adjustments'),0);
 assert.equal(count('audit_events'),1);
 assert.equal(proj().net_total,2400);
 assert.equal(proj().version,0);
 db.exec('DROP TRIGGER test_force_audit_fail');
 assert.equal(review(r.requestId).status,'APPROVED');
 assert.equal(count('correction_adjustments'),1);
 app.close();
});
test('database disallows changing financial originals and append-only records',()=>{
 const {app,req,review,db}=fixture();
 const r=req();
 review(r.requestId);
 for(const statement of [
  "UPDATE monthly_closings SET original_total=999 WHERE store_id='A'",
  "UPDATE earnings_source_lines SET original_amount=999 WHERE store_id='A'",
  "UPDATE correction_requests SET delta=-100 WHERE store_id='A'",
  "UPDATE correction_decisions SET status='REJECTED' WHERE store_id='A'",
  "DELETE FROM correction_adjustments WHERE store_id='A'",
  "DELETE FROM audit_events WHERE store_id='A'"
 ]){
  assert.throws(()=>db.exec(statement),/immutable/);
 }
 app.close();
});
test('database composite foreign keys prevent cross-store reference linking',()=>{
 const {app,db}=fixture();
 assert.throws(()=>db.prepare(
  'INSERT INTO earnings_source_lines(store_id,closing_id,source_id,original_amount,contract_version) VALUES(?,?,?,?,?)'
 ).run('B','second-close','other-source',2400,2),/FOREIGN KEY/);
 assert.throws(()=>db.prepare(
  'INSERT INTO correction_requests(store_id,request_id,closing_id,source_id,kind,delta,reason,requested_by_user_id,idempotency_key,requested_at,expected_version,source_before,month_before,paid_before) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
 ).run('B','cross-request','second-close','other-source','refund',-1,
   '架空の差分を作る申請','other','cross-store-req-key','2026-11-03T00:00:00.000Z',0,2400,2400,0),
  /FOREIGN KEY/);
 app.close();
});
test('fake and inactive sessions are denied for changes and audit reading',()=>{
 const {app,req}=fixture();
 assert.throws(()=>req({sessionHandle:'missing'}),{code:'UNAUTHENTICATED'});
 assert.throws(()=>req({sessionHandle:'disabled'}),{code:'UNAUTHENTICATED'});
 assert.throws(()=>app.audit({sessionHandle:'desk',storeId:'A'}),{code:'ROLE_FORBIDDEN'});
 assert.throws(()=>app.audit({sessionHandle:'checker',storeId:'B'}),{
  code:'INACTIVE_MEMBERSHIP'
 });
 const r=req();
 const events=app.audit({sessionHandle:'checker',storeId:'A',requestId:r.requestId});
 assert.equal(events.length,1);
 assert.equal(events[0].actor_user_id,'alice');
 app.close();
});
test('invalid adjustment and source never create request or audit',()=>{
 const {app,req,count}=fixture();
 for(const overrides of [
  {delta:-2401},
  {delta:0},
  {delta:100},
  {delta:-1000001},
  {reason:'短'},
  {sourceId:'missing-source'},
  {idempotencyKey:'short'}
 ]){
  assert.throws(()=>req(overrides));
 }
 assert.equal(count('correction_requests'),0);
 assert.equal(count('audit_events'),0);
 app.close();
});

test('fictional on-disk SQLite adjustments survive close/reopen without duplicate writes',()=>{
 const folder=mkdtempSync(join(tmpdir(),'salon-v059-'));
 const dbPath=join(folder,'prototype.sqlite');
 try{
  const {app,req,review}=fixture(dbPath);
  const item=req();
  const reviewed=review(item.requestId);
  assert.equal(reviewed.status,'APPROVED');
  app.close();
  const persistent=openLocalPrototype({
   path:dbPath,
   resolveSession:handle=>({
    maker:{userId:'alice',authenticated:true},
    checker:{userId:'bob',authenticated:true},
    therapist:{userId:'t1',authenticated:true}
   })[handle]||null
  });
  const stored=persistent.statement({sessionHandle:'therapist',storeId:'A',staffId:'staff-1'});
  assert.equal(stored.length,1);
  assert.equal(stored[0].originalTotal,2400);
  assert.equal(stored[0].effectiveTotal,2000);
  assert.equal(stored[0].version,1);
  const history=persistent.audit({sessionHandle:'checker',storeId:'A'});
  assert.equal(history.length,2);
  assert.equal(history.find(x=>x.action==='correction.approved').actor_user_id,'bob');
  assert.throws(()=>persistent.reviewCorrection({
   sessionHandle:'checker',storeId:'A',requestId:item.requestId,decision:'APPROVE'
  }),{code:'ALREADY_REVIEWED'});
  persistent.close();
 }finally{
  rmSync(folder,{recursive:true,force:true});
 }
});
test('SQL-level trigger prohibits self-review even when database accessed directly',()=>{
 const {app,req,db,count}=fixture();
 const item=req();
 assert.throws(()=>db.prepare(
  'INSERT INTO correction_decisions(store_id,request_id,status,reviewed_by_user_id,reviewed_at,reason) VALUES(?,?,?,?,?,?)'
 ).run('A',item.requestId,'APPROVED','alice','2026-11-03T05:05:00.000Z',
  '架空の不正な自己承認'),/self-approval is forbidden/);
 assert.equal(count('correction_decisions'),0);
 assert.throws(()=>db.prepare(
  'INSERT INTO correction_adjustments(store_id,adjustment_id,request_id,closing_id,source_id,delta,source_before,source_after,month_before,month_after,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
 ).run('A','unapproved-adjustment',item.requestId,'same-close','same-source',-400,
  2400,2000,2400,2000,'2026-11-03T05:05:00.000Z'),
 /adjustment requires approved decision/);
 assert.equal(count('correction_adjustments'),0);
 app.close();
});
