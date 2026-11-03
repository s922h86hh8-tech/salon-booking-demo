// v0.58 backend policy *contract* tests. No actual authentication/database here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decideAccess,assertAllowed,evaluateCorrectionDecision,makeAuditPayload,ROLES,ACTIONS}
 from '../server-design/v0.58-authorization-contract.mjs';

const principal=(userId='user-1',extra={})=>({
 userId,authenticated:true,accountActive:true,...extra
});
const membership=(userId='user-1',role='manager',storeId='store-A',extra={})=>({
 userId,role,storeId,active:true,...extra
});
const resource=(storeId='store-A',extra={})=>({storeId,...extra});
const request=(extra={})=>({
 id:'request-1',storeId:'store-A',status:'PENDING',
 requestedByUserId:'user-2',closingId:'close-1',sourceId:'source-1',
 expectedVersion:3,sourceBefore:2400,monthBefore:2400,paidBefore:1000,
 delta:-400,...extra
});
const snapshot=(extra={})=>({
 storeId:'store-A',closingId:'close-1',sourceId:'source-1',
 version:3,sourceNet:2400,monthNet:2400,paidTotal:1000,...extra
});
function check(role,action,extras={}){
 return decideAccess({
  principal:principal('user-1',extras.principal),
  membership:membership('user-1',role,'store-A',extras.membership),
  action,resource:resource('store-A',extras.resource),request:extras.request
 });
}
function decision(extras={}){
 return evaluateCorrectionDecision({
  principal:principal(),membership:membership(),resource:resource(),
  request:request(),current:snapshot(),decision:'APPROVE',...extras
 });
}

test('v0.58 known roles and actions are explicit, not wildcard based',()=>{
 assert.deepEqual(ROLES,['owner','manager','receptionist','therapist']);
 assert.equal(ACTIONS.includes('correction.review'),true);
 assert.equal(check('manager','admin.root').code,'UNKNOWN_ACTION_OR_ROLE');
 assert.equal(check('god','booking.read').code,'UNKNOWN_ACTION_OR_ROLE');
});
test('deny unauthenticated, inactive, mismatched or missing server membership',()=>{
 const options={membership:membership(),resource:resource(),action:'booking.read'};
 for(const p of [null,{},principal('user-1',{authenticated:false}),
   principal('user-1',{accountActive:false})]){
  assert.equal(decideAccess({...options,principal:p}).allowed,false);
 }
 assert.equal(decideAccess({...options,principal:principal(),
  membership:membership('user-1','manager','store-A',{active:false})}).code,'INACTIVE_MEMBERSHIP');
 assert.equal(decideAccess({...options,principal:principal(),
  membership:membership('user-2')}).code,'MEMBERSHIP_PRINCIPAL_MISMATCH');
 assert.equal(decideAccess({...options,principal:principal(),
  membership:null}).code,'INACTIVE_MEMBERSHIP');
});
test('tenant membership denies data access across stores regardless of role',()=>{
 for(const role of ROLES){
  assert.equal(check(role,'booking.read',{resource:{storeId:'store-B'}}).code,
   'CROSS_STORE_DENIED');
  assert.equal(check(role,'statement.read',{resource:{storeId:'store-B',staffId:'staff-1'},
   membership:{staffId:'staff-1'}}).code,'CROSS_STORE_DENIED');
 }
 assert.equal(check('owner','audit.read',{resource:{storeId:'store-B'}}).allowed,false);
});
test('role matrix preserves front-desk booking but not financial adjustment privilege',()=>{
 for(const role of ['owner','manager']){
  assert.equal(check(role,'booking.write').allowed,true);
  assert.equal(check(role,'correction.request').allowed,true);
  assert.equal(check(role,'audit.read').allowed,true);
 }
 assert.equal(check('receptionist','booking.write').allowed,true);
 assert.equal(check('receptionist','checkout.read').allowed,true);
 assert.equal(check('receptionist','correction.request').code,'ROLE_FORBIDDEN');
 assert.equal(check('receptionist','correction.review',{request:request()}).code,'ROLE_FORBIDDEN');
 assert.equal(check('therapist','booking.read').code,'ROLE_FORBIDDEN');
 assert.equal(check('therapist','audit.read').code,'ROLE_FORBIDDEN');
});
test('therapist sees only the matching own staff statement, not another member',()=>{
 assert.equal(check('therapist','statement.read',
  {membership:{staffId:'staff-1'},resource:{staffId:'staff-1'}}).allowed,true);
 assert.equal(check('therapist','statement.read',
  {membership:{staffId:'staff-1'},resource:{staffId:'staff-2'}}).code,'NOT_OWN_STATEMENT');
 assert.equal(check('therapist','statement.read',
  {membership:{staffId:'staff-1'},resource:{staffId:''}}).code,'NOT_OWN_STATEMENT');
 assert.equal(check('manager','statement.read',
  {resource:{staffId:'staff-2'}}).allowed,true);
});
test('approval requires a pending stored request in the same tenant and different user',()=>{
 assert.equal(check('manager','correction.review',{request:request()}).allowed,true);
 assert.equal(check('manager','correction.review',{request:request({requestedByUserId:'user-1'})}).code,
  'SELF_APPROVAL_FORBIDDEN');
 assert.equal(check('owner','correction.review',{request:request({status:'APPROVED'})}).code,
  'INVALID_APPROVAL_REQUEST');
 assert.equal(check('owner','correction.review',{request:request({storeId:'store-B'})}).code,
  'INVALID_APPROVAL_REQUEST');
 assert.equal(check('owner','correction.review',{request:null}).code,'INVALID_APPROVAL_REQUEST');
});
test('assertAllowed throws explicit stable code for denied actions',()=>{
 assert.throws(()=>assertAllowed({
  principal:principal(),membership:membership('user-1','receptionist'),
  resource:resource(),action:'correction.request'
 }),{code:'ROLE_FORBIDDEN'});
 assert.equal(assertAllowed({
  principal:principal(),membership:membership(),resource:resource(),action:'correction.request'
 }).allowed,true);
});
test('APPROVE produces a proposed snapshot decision but never mutates the input',()=>{
 const req=request(),cur=snapshot(),beforeReq=JSON.stringify(req),beforeSnap=JSON.stringify(cur);
 const result=decision({request:req,current:cur});
 assert.equal(result.status,'APPROVED');
 assert.equal(result.apply,true);
 assert.equal(result.sourceBefore,2400);
 assert.equal(result.sourceAfter,2000);
 assert.equal(result.monthBefore,2400);
 assert.equal(result.monthAfter,2000);
 assert.equal(result.nextVersion,4);
 assert.equal(JSON.stringify(req),beforeReq);
 assert.equal(JSON.stringify(cur),beforeSnap);
 assert.ok(Object.isFrozen(result));
});
test('stale version, altered amounts or paid total prevent financial mutation',()=>{
 const cases=[
  snapshot({version:4}),
  snapshot({sourceNet:2350}),
  snapshot({monthNet:2250}),
  snapshot({paidTotal:1200})
 ];
 for(const current of cases){
  const verdict=decision({current});
  assert.equal(verdict.status,'STALE');
  assert.equal(verdict.apply,false);
 }
});
test('untrusted mismatched snapshot and negative after-amount are rejected',()=>{
 assert.throws(()=>decision({current:snapshot({storeId:'store-B'})}),{code:'INVALID_SNAPSHOT'});
 assert.throws(()=>decision({current:snapshot({closingId:'different'})}),{code:'INVALID_SNAPSHOT'});
 assert.throws(()=>decision({current:snapshot({paidTotal:'1000'})}),{code:'INVALID_SNAPSHOT'});
 assert.throws(()=>decision({request:request({delta:-2500})}),{code:'INVALID_ADJUSTMENT'});
 assert.throws(()=>decision({request:request({delta:0})}),{code:'INVALID_SNAPSHOT'});
});
test('REJECT requires a reason and never authorizes posting',()=>{
 assert.throws(()=>decision({decision:'REJECT',reason:'no'}),{code:'REJECTION_REASON_REQUIRED'});
 const result=decision({decision:'REJECT',reason:'根拠となる売上明細を確認してください'});
 assert.equal(result.status,'REJECTED');
 assert.equal(result.apply,false);
 assert.equal(result.reason,'根拠となる売上明細を確認してください');
 assert.throws(()=>decision({decision:'BAD'}),{code:'INVALID_DECISION'});
});
test('self-approval is denied even when source, amounts and version match',()=>{
 assert.throws(()=>decision({request:request({requestedByUserId:'user-1'})}),
  {code:'SELF_APPROVAL_FORBIDDEN'});
 assert.throws(()=>decision({membership:membership('user-1','receptionist')}),
  {code:'ROLE_FORBIDDEN'});
});
test('audit payload includes server-selected actor, event ID and immutable values',()=>{
 const item=makeAuditPayload({
  eventId:'evt-100',storeId:'store-A',principal:principal('user-1'),
  action:'correction.approved',subjectId:'close-1',requestId:'request-1',
  occurredAt:'2026-11-03T04:30:00.000Z',before:2400,after:2000,
  reason:'返金の根拠を確認して承認した'
 });
 assert.equal(item.actorUserId,'user-1');
 assert.equal(item.occurredAt,'2026-11-03T04:30:00.000Z');
 assert.equal(item.before,2400);
 assert.equal(item.after,2000);
 assert.ok(Object.isFrozen(item));
});
test('audit payload refuses empty actor and malformed time and amounts',()=>{
 const base={
  eventId:'evt-1',storeId:'store-A',principal:principal(),action:'correction.approved',
  subjectId:'close-1',requestId:'req-1',occurredAt:'2026-11-03T04:30:00.000Z',
  before:2400,after:2000,reason:'返金の根拠を確認して承認'
 };
 for(const override of [
  {principal:null},{eventId:''},{occurredAt:'2026-11-03 13:30'},
  {occurredAt:'nonsense'},{before:2400.25},{after:Infinity},{reason:''}
 ]){
  assert.throws(()=>makeAuditPayload({...base,...override}),{code:'INVALID_AUDIT_PAYLOAD'});
 }
});
test('authorization module never imports browser, network, or storage providers',async()=>{
 const {readFileSync}=await import('node:fs');
 const code=readFileSync(new URL('../server-design/v0.58-authorization-contract.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\bfetch\s*\(|\blocalStorage\b|\bindexedDB\b|\bXMLHttpRequest\b/);
 assert.doesNotMatch(code,/\b(import\s|require\s*\()/);
});
