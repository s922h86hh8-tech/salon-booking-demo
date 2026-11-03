/**
 * v0.60 — LOCAL SQLITE PROTOTYPE WITH AUTHORIZED ACTOR NAME SNAPSHOTS. NOT A PRODUCTION HTTP SERVER OR AUTH SERVICE.
 * All data must be fictional. The session resolver is injected by tests and must
 * NOT be exposed to browsers or accepted from client-provided JSON in production.
 * No ports, real payments, personal records, external APIs or deployable sessions.
 *
 * node:sqlite in Node.js 22 is experimental. Production storage/identity architecture
 * must be selected and security-reviewed separately.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { assertAllowed, evaluateCorrectionDecision, makeAuditPayload }
 from './v0.58-authorization-contract.mjs';

function error(code, message=code){
 const err=new Error(message);err.code=code;return err;
}
const id=(x)=>typeof x==='string'&&x.length>0&&x.length<=128;
const asPlain=(row)=>row?{...row}:null;
function instant(clock){
 const date=new Date(clock());
 if(!Number.isFinite(date.getTime()))throw error('INVALID_CLOCK');
 return date.toISOString();
}
function transaction(db,action){
 db.exec('BEGIN IMMEDIATE');
 try{
  const value=action();
  db.exec('COMMIT');
  return value;
 }catch(err){
  try{db.exec('ROLLBACK')}catch{}
  throw err;
 }
}
export function openLocalPrototype({
 path=':memory:',resolveSession,clock=()=>new Date()
}={}){
 if(typeof resolveSession!=='function')throw error('TRUSTED_SESSION_RESOLVER_REQUIRED');
 if(typeof clock!=='function')throw error('CLOCK_REQUIRED');
 const db=new DatabaseSync(path);
 try{
  db.exec(readFileSync(new URL('./v0.60-local-sqlite-schema.sql',import.meta.url),'utf8'));
 }catch(e){db.close();throw e;}
 function authorize(handle,storeId,action,extras={}){
  if(!id(storeId))throw error('INVALID_STORE_ID');
  // resolveSession is a TRUSTED backend-only injection, not a login endpoint.
  const session=resolveSession(handle);
  const userId=session?.authenticated===true&&id(session.userId)?session.userId:null;
  const user=userId?db.prepare('SELECT user_id,active FROM users WHERE user_id=?').get(userId):null;
  const row=userId?db.prepare(
   'SELECT user_id,store_id,role,staff_id,active FROM store_memberships WHERE store_id=? AND user_id=?'
  ).get(storeId,userId):null;
  const principal=userId?{userId,authenticated:session.authenticated===true,
   accountActive:user?.active===1}:null;
  const membership=row?{userId:row.user_id,storeId:row.store_id,role:row.role,
   staffId:row.staff_id,active:row.active===1}:null;
  assertAllowed({principal,membership,action,resource:{storeId,...extras.resource},
   request:extras.request});
  return {principal,membership};
 }
 function closingAt(storeId,closingId){
  const row=db.prepare('SELECT * FROM monthly_closings WHERE store_id=? AND closing_id=?')
   .get(storeId,closingId);
  if(!row)throw error('CLOSING_NOT_FOUND');return row;
 }
 function sourceAt(storeId,closingId,sourceId){
  const row=db.prepare(
   'SELECT * FROM earnings_source_lines WHERE store_id=? AND closing_id=? AND source_id=?'
  ).get(storeId,closingId,sourceId);
  if(!row)throw error('SOURCE_NOT_FOUND');return row;
 }
 function paidAt(storeId,closingId){
  return db.prepare(
   'SELECT COALESCE(SUM(amount),0) AS total FROM payment_records WHERE store_id=? AND closing_id=?'
  ).get(storeId,closingId).total;
 }
 function netSource(storeId,closingId,sourceId){
  const origin=sourceAt(storeId,closingId,sourceId).original_amount;
  const total=db.prepare(
   'SELECT COALESCE(SUM(delta),0) AS total FROM correction_adjustments WHERE store_id=? AND closing_id=? AND source_id=?'
  ).get(storeId,closingId,sourceId).total;
  return origin+total;
 }
 function projectionAt(storeId,closingId){
  const result=db.prepare(
   'SELECT * FROM closing_projections WHERE store_id=? AND closing_id=?'
  ).get(storeId,closingId);
  if(!result)throw error('PROJECTION_NOT_FOUND');
  return result;
 }
 function appendAudit({
  storeId,requestId,actorUserId,action,closingId,before,after,reason,at
 }){
  const payload=makeAuditPayload({
   eventId:randomUUID(),storeId,principal:{userId:actorUserId},action,
   subjectId:closingId,requestId,occurredAt:at,before,after,reason
  });
  // Resolve the display name from the backend user table, never request JSON.
  const operator=db.prepare('SELECT display_name FROM users WHERE user_id=? AND active=1')
   .get(actorUserId);
  if(!operator||!operator.display_name)throw error('UNVERIFIED_AUDIT_ACTOR');
  db.prepare(
   'INSERT INTO audit_events(event_id,store_id,request_id,action,actor_user_id,actor_name_snapshot,subject_id,occurred_at,before_amount,after_amount,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  ).run(payload.eventId,storeId,requestId,action,actorUserId,operator.display_name,
   closingId,at,before,after,reason);
  return Object.freeze({...payload,actorNameSnapshot:operator.display_name});
 }
 function requestCorrection({
  sessionHandle,storeId,closingId,sourceId,kind,delta,reason,idempotencyKey
 }={}){
  if(!id(storeId)||!id(closingId)||!id(sourceId))throw error('INVALID_TARGET');
  if(!id(idempotencyKey)||idempotencyKey.length<8)throw error('INVALID_IDEMPOTENCY_KEY');
  if(!['refund','correction'].includes(kind)||!Number.isSafeInteger(delta)||
    delta===0||Math.abs(delta)>1000000||(kind==='refund'&&delta>=0))
   throw error('INVALID_ADJUSTMENT');
  if(typeof reason!=='string'||reason.trim().length<5||reason.trim().length>200)
   throw error('INVALID_REASON');
  const normalized=reason.trim();
  return transaction(db,()=>{
   const {principal}=authorize(sessionHandle,storeId,'correction.request');
   // Same retry key returns the original outcome; changed request body is rejected.
   const previous=db.prepare(
    'SELECT * FROM correction_requests WHERE store_id=? AND requested_by_user_id=? AND idempotency_key=?'
   ).get(storeId,principal.userId,idempotencyKey);
   if(previous){
    if(previous.closing_id!==closingId||previous.source_id!==sourceId||
      previous.kind!==kind||previous.delta!==delta||previous.reason!==normalized)
     throw error('IDEMPOTENCY_CONFLICT');
    return {requestId:previous.request_id,replayed:true,status:'PENDING_OR_REVIEWED'};
   }
   closingAt(storeId,closingId);
   sourceAt(storeId,closingId,sourceId);
   const before=netSource(storeId,closingId,sourceId);
   const current=projectionAt(storeId,closingId);
   if(!Number.isSafeInteger(before+delta)||before+delta<0||
      !Number.isSafeInteger(current.net_total+delta)||current.net_total+delta<0)
    throw error('NEGATIVE_ADJUSTED_AMOUNT');
   const paid=paidAt(storeId,closingId),at=instant(clock),requestId=randomUUID();
   db.prepare(
    'INSERT INTO correction_requests(store_id,request_id,closing_id,source_id,kind,delta,reason,requested_by_user_id,idempotency_key,requested_at,expected_version,source_before,month_before,paid_before) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
   ).run(storeId,requestId,closingId,sourceId,kind,delta,normalized,
    principal.userId,idempotencyKey,at,current.version,before,current.net_total,paid);
   appendAudit({storeId,requestId,actorUserId:principal.userId,
    action:'correction.requested',closingId,before:current.net_total,
    after:current.net_total,reason:normalized,at});
   return {requestId,replayed:false,status:'PENDING',
    requestedByUserId:principal.userId,requestedAt:at,
    sourceBefore:before,sourceProposed:before+delta,
    monthBefore:current.net_total,monthProposed:current.net_total+delta};
  });
 }
 function reviewCorrection({
  sessionHandle,storeId,requestId,decision,reason=''
 }={}){
  if(!id(storeId)||!id(requestId))throw error('INVALID_TARGET');
  return transaction(db,()=>{
   // Authorize store membership before exposing a request's existence.
   const {principal,membership}=authorize(sessionHandle,storeId,'correction.request');
   // The request capability here is checked separately below; receptionist/therapist
   // must never be able to review. Owner and manager hold both capabilities.
   if(!['owner','manager'].includes(membership.role))throw error('REVIEW_FORBIDDEN');
   const row=db.prepare(
    'SELECT * FROM correction_requests WHERE store_id=? AND request_id=?'
   ).get(storeId,requestId);
   if(!row)throw error('REQUEST_NOT_FOUND');
   const already=db.prepare(
    'SELECT * FROM correction_decisions WHERE store_id=? AND request_id=?'
   ).get(storeId,requestId);
   if(already)throw error('ALREADY_REVIEWED');
   const req={
    id:row.request_id,storeId:row.store_id,status:'PENDING',
    requestedByUserId:row.requested_by_user_id,closingId:row.closing_id,
    sourceId:row.source_id,delta:row.delta,expectedVersion:row.expected_version,
    sourceBefore:row.source_before,monthBefore:row.month_before,paidBefore:row.paid_before
   };
   assertAllowed({principal,membership,action:'correction.review',
    resource:{storeId},request:req});
   const proj=projectionAt(storeId,row.closing_id);
   const current={storeId,closingId:row.closing_id,sourceId:row.source_id,
    sourceNet:netSource(storeId,row.closing_id,row.source_id),monthNet:proj.net_total,
    paidTotal:paidAt(storeId,row.closing_id),version:proj.version};
   const verdict=evaluateCorrectionDecision({
    principal,membership,resource:{storeId},request:req,current,decision,reason
   });
   const at=instant(clock);
   const explanation=verdict.status==='REJECTED'?verdict.reason:
    verdict.status==='STALE'?'申請後に金額・支払額または版番号が変更されたため再申請が必要です':
    '申請内容と金額の整合を確認して承認しました';
   db.prepare(
    'INSERT INTO correction_decisions(store_id,request_id,status,reviewed_by_user_id,reviewed_at,reason) VALUES(?,?,?,?,?,?)'
   ).run(storeId,requestId,verdict.status,principal.userId,at,explanation);
   if(verdict.apply){
    db.prepare(
     'INSERT INTO correction_adjustments(store_id,adjustment_id,request_id,closing_id,source_id,delta,source_before,source_after,month_before,month_after,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    ).run(storeId,randomUUID(),requestId,row.closing_id,row.source_id,row.delta,
     verdict.sourceBefore,verdict.sourceAfter,verdict.monthBefore,verdict.monthAfter,at);
    const changed=db.prepare(
     'UPDATE closing_projections SET net_total=?, version=? WHERE store_id=? AND closing_id=? AND version=?'
    ).run(verdict.monthAfter,verdict.nextVersion,storeId,row.closing_id,proj.version);
    if(changed.changes!==1)throw error('CONCURRENT_VERSION_CHANGE');
   }
   appendAudit({storeId,requestId,actorUserId:principal.userId,
    action:'correction.'+verdict.status.toLowerCase(),closingId:row.closing_id,
    before:current.monthNet,after:verdict.apply?verdict.monthAfter:current.monthNet,
    reason:explanation,at});
   return {requestId,status:verdict.status,applied:verdict.apply,
    reviewedByUserId:principal.userId,reviewedAt:at,
    monthBefore:current.monthNet,monthAfter:verdict.apply?verdict.monthAfter:current.monthNet};
  });
 }
 function statement({sessionHandle,storeId,staffId}={}){
  if(!id(storeId)||!id(staffId))throw error('INVALID_TARGET');
  authorize(sessionHandle,storeId,'statement.read',{resource:{staffId}});
  const data=db.prepare(
   'SELECT c.closing_id AS closingId,c.staff_id AS staffId,c.month,c.original_total AS originalTotal,p.net_total AS effectiveTotal,p.version FROM monthly_closings c JOIN closing_projections p ON p.store_id=c.store_id AND p.closing_id=c.closing_id WHERE c.store_id=? AND c.staff_id=? ORDER BY c.month,c.closing_id'
  ).all(storeId,staffId);
  return data.map(r=>Object.freeze({...asPlain(r),paid:paidAt(storeId,r.closingId)}));
 }
 function audit({sessionHandle,storeId,requestId=null}={}){
  authorize(sessionHandle,storeId,'audit.read');
  const sql=requestId?
   'SELECT * FROM audit_events WHERE store_id=? AND request_id=? ORDER BY event_seq':
   'SELECT * FROM audit_events WHERE store_id=? ORDER BY event_seq';
  return db.prepare(sql).all(...(requestId?[storeId,requestId]:[storeId])).map(asPlain);
 }
 return Object.freeze({
  requestCorrection,reviewCorrection,statement,audit,close:()=>db.close(),
  // Exposed ONLY for local test seeding/injected failures: never bind to HTTP.
  unsafeDbForTests:db
 });
}
