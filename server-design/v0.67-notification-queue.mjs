/**
 * v0.67 — an OFFLINE notification queue with durable leases & failure recovery.
 * NEVER contacts LINE, internet, email or SMS. Simulated-only queue for
 * fictional v0.63 booking + v0.65 notification SQLite data.
 *
 * Do not use this module for real delivery. A successful mock commit is NOT
 * evidence of LINE delivery, nor a guarantee of exactly-once external sends.
 */
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const APPROVERS=new Set(['owner','manager']);
const STATES=new Set(['WAITING','RETRY','CLAIMED']);
const EXPECTED=[
 'notification_consent_events','notification_mock_visits',
 'notification_waitlist_preferences','notification_drafts','notification_events'
];
function fail(code){const e=new Error(code);e.code=code;throw e;}
function fields(input,allowed){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(x=>!allowed.includes(x)))fail('INVALID_FIELDS');
}
function validId(x){return typeof x==='string'&&ID.test(x);}
function ms(iso){
 if(typeof iso!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(iso)||
    !Number.isFinite(Date.parse(iso))||new Date(iso).toISOString()!==iso)
  fail('INVALID_TIMESTAMP');
 return Date.parse(iso);
}
function time(clock){
 const d=new Date(clock());
 if(!Number.isFinite(d.getTime()))fail('INVALID_CLOCK');
 return d.toISOString();
}
function isoPlus(iso,millis){return new Date(ms(iso)+millis).toISOString();}
function date(iso){return iso.slice(0,10);}
function datePlus(today,n){return new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);}
function dateDiff(a,b){return Math.round((Date.parse(a+'T00:00:00.000Z')-Date.parse(b+'T00:00:00.000Z'))/86400000);}
function tx(db,fn){
 db.exec('BEGIN IMMEDIATE');
 try{const value=fn();db.exec('COMMIT');return value;}
 catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
export function openFictionalNotificationQueue({
 bookingStore,resolveSession,clock=()=>new Date(),fictionalTestOnly=false,
 maxAttempts=3,leaseMillis=30000,maxSimulatedPerStoreDay=3
}={}){
 if(fictionalTestOnly!==true||typeof resolveSession!=='function'||
    typeof clock!=='function'||!bookingStore||
    typeof bookingStore.available!=='function'||
    !Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>10||
    !Number.isSafeInteger(leaseMillis)||leaseMillis<1000||leaseMillis>300000||
    !Number.isSafeInteger(maxSimulatedPerStoreDay)||maxSimulatedPerStoreDay<1||
    maxSimulatedPerStoreDay>100)fail('FICTIONAL_TEST_MODE_REQUIRED');
 const db=bookingStore.unsafeDbForTests;
 if(!db||typeof db.prepare!=='function')fail('LOCAL_DB_REQUIRED');
 for(const name of EXPECTED){
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))
   fail('REQUIRES_V065_SCHEMA');
 }
 const queueTables=['notification_queue_jobs','notification_queue_events'];
 const existing=queueTables.filter(n=>db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(n));
 if(existing.length===1)fail('PARTIAL_QUEUE_SCHEMA');
 if(existing.length===0)
  db.exec(readFileSync(new URL('./v0.67-notification-queue-schema.sql',import.meta.url),'utf8'));
 else{
  // Do not silently treat a v0.66 queue as a v0.67 queue.
  // An explicit, separately reviewed migration would be necessary.
  const columns=db.prepare('PRAGMA table_info(notification_queue_jobs)').all()
   .map(row=>row.name);
  for(const required of ['last_handoff_id','last_handoff_at','last_handoff_outcome']){
   if(!columns.includes(required))fail('REQUIRES_V067_QUEUE_SCHEMA');
  }
 }

 function principal(handle,store){
  if(!validId(store))fail('INVALID_STORE');
  const s=resolveSession(handle);
  if(!s||s.authenticated!==true||!validId(s.subjectId)||s.kind!=='staff')
   fail('STAFF_SESSION_REQUIRED');
  const row=db.prepare(
   'SELECT role,active FROM staff_memberships WHERE store_id=? AND subject_id=?'
  ).get(store,s.subjectId);
  if(!row||row.active!==1||!APPROVERS.has(row.role))fail('OWNER_PERMISSION_REQUIRED');
  return s.subjectId;
 }
 function latestState(store,id){
  const d=db.prepare(
   'SELECT * FROM notification_drafts WHERE store_id=? AND draft_id=?'
  ).get(store,id);
  if(!d)fail('DRAFT_NOT_FOUND');
  const last=db.prepare(
   'SELECT action FROM notification_events WHERE store_id=? AND draft_id=? ORDER BY seq DESC LIMIT 1'
  ).get(store,id);
  return {...d,notificationState:last?.action||'DRAFT_CREATED'};
 }
 function queueJob(store,id){
  return db.prepare(
   'SELECT * FROM notification_queue_jobs WHERE store_id=? AND draft_id=?'
  ).get(store,id);
 }
 function event(store,id,action,attempt,actor,reason=null){
  db.prepare(
   'INSERT INTO notification_queue_events(store_id,draft_id,action,attempt,event_at,worker_id,reason_code) VALUES(?,?,?,?,?,?,?)'
  ).run(store,id,action,attempt,time(clock),actor,reason);
 }
 function consent(store,cid,purpose){
  const row=db.prepare(
   'SELECT allowed FROM notification_consent_events WHERE store_id=? AND customer_subject_id=? AND purpose=? ORDER BY seq DESC LIMIT 1'
  ).get(store,cid,purpose);
  if(!row||row.allowed!==1)fail('NO_CONSENT');
 }
 function booking(store,id){
  const row=db.prepare(
   'SELECT b.*,c.booking_id AS canceled,c.cancellation_reason FROM booking_records b LEFT JOIN booking_cancellations c ON c.store_id=b.store_id AND c.booking_id=b.booking_id WHERE b.store_id=? AND b.booking_id=?'
  ).get(store,id);
  if(!row)fail('BOOKING_NOT_FOUND');
  return row;
 }
 function anyActive(store,cid,today){
  return !!db.prepare(
   'SELECT b.booking_id FROM booking_records b LEFT JOIN booking_cancellations c ON c.store_id=b.store_id AND c.booking_id=b.booking_id WHERE b.store_id=? AND b.owner_subject_id=? AND b.service_date>=? AND c.booking_id IS NULL LIMIT 1'
  ).get(store,cid,today);
 }
 function eligible(d,store,handle){
  const today=date(time(clock));
  consent(store,d.customer_subject_id,d.purpose);
  if(d.purpose==='reminder'){
   const b=booking(store,d.subject_booking_id);
   if(b.canceled||b.owner_subject_id!==d.customer_subject_id||
      b.service_date!==datePlus(today,1))fail('REMINDER_INVALIDATED');
   return;
  }
  if(d.purpose==='return'){
   if(anyActive(store,d.customer_subject_id,today))fail('RETURN_ALREADY_BOOKED');
   const visits=db.prepare(
    'SELECT visited_date FROM notification_mock_visits WHERE store_id=? AND customer_subject_id=? ORDER BY visited_date'
   ).all(store,d.customer_subject_id).map(x=>x.visited_date);
   if(visits.length<2)fail('RETURN_CYCLE_INVALID');
   const gaps=[];
   for(let i=1;i<visits.length;i++){
    const gap=dateDiff(visits[i],visits[i-1]);
    if(gap<14||gap>120)fail('RETURN_CYCLE_INVALID');
    gaps.push(gap);
   }
   const cycle=Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length);
   const expected=datePlus(visits.at(-1),cycle);
   if(expected!==d.period_key)fail('RETURN_PERIOD_CHANGED');
   const distance=dateDiff(expected,today);
   if(distance>10||distance< -7)fail('RETURN_OUTSIDE_WINDOW');
   return;
  }
  if(d.purpose==='waitlist'){
   const b=booking(store,d.subject_booking_id);
   if(!b.canceled||b.cancellation_reason==='MOVE'||
      dateDiff(b.service_date,today)<0)fail('WAITLIST_NOT_RELEASED');
   if(anyActive(store,d.customer_subject_id,today))fail('WAITLIST_ALREADY_BOOKED');
   const pref=db.prepare(
    'SELECT * FROM notification_waitlist_preferences WHERE store_id=? AND customer_subject_id=? AND service_date=? AND menu_id=?'
   ).get(store,d.customer_subject_id,b.service_date,b.menu_id);
   if(!pref||pref.staff_id&&pref.staff_id!==b.staff_id||
      pref.earliest_minute>b.start_minute||pref.latest_minute<b.start_minute)
    fail('WAITLIST_PREFERENCE_CHANGED');
   const slot=bookingStore.available({
    sessionHandle:handle,storeId:store,serviceDate:b.service_date,
    menuId:b.menu_id,staffId:b.staff_id,bedId:b.bed_id,startMinute:b.start_minute
   });
   if(!slot.ok)fail('WAITLIST_SLOT_TAKEN');
   return;
  }
  fail('UNKNOWN_PURPOSE');
 }
 function enqueued(input={}){
  fields(input,['sessionHandle','storeId','draftId','runAt','expiresAt']);
  return tx(db,()=>{
   const who=principal(input.sessionHandle,input.storeId);
   if(!validId(input.draftId))fail('INVALID_DRAFT');
   const now=time(clock),start=ms(input.runAt),end=ms(input.expiresAt);
   if(start<ms(now)-1000||end<=start||end<=ms(now)||
      end-start>90*86400000)fail('INVALID_SCHEDULE');
   const d=latestState(input.storeId,input.draftId);
   if(d.notificationState!=='OWNER_APPROVED')fail('NOT_APPROVED');
   eligible(d,input.storeId,input.sessionHandle);
   const prior=queueJob(input.storeId,input.draftId);
   if(prior){
    if(prior.run_at===input.runAt&&prior.expires_at===input.expiresAt)
      return {status:prior.state,replayed:true};
    fail('QUEUE_CONFLICT');
   }
   db.prepare(
    "INSERT INTO notification_queue_jobs(store_id,draft_id,state,run_at,expires_at,created_at) VALUES(?,?,'WAITING',?,?,?)"
   ).run(input.storeId,input.draftId,input.runAt,input.expiresAt,now);
   event(input.storeId,input.draftId,'ENQUEUED',0,who);
   return {status:'WAITING',replayed:false};
  });
 }
 function settle(store,id,kind,actor,reason){
  const row=queueJob(store,id);
  if(!row)fail('QUEUE_NOT_FOUND');
  db.prepare(
   'UPDATE notification_queue_jobs SET state=?,lease_owner=NULL,lease_token=NULL,lease_until=NULL,finished_at=?,last_failure=? WHERE store_id=? AND draft_id=?'
  ).run(kind,time(clock),reason,store,id);
  event(store,id,kind,row.attempts,actor,reason);
 }
 function reconcile(input={}){
  fields(input,['sessionHandle','storeId']);
  return tx(db,()=>{
   const actor=principal(input.sessionHandle,input.storeId);
   const now=time(clock);let changed=0;
   const rows=db.prepare(
    "SELECT * FROM notification_queue_jobs WHERE store_id=? AND state IN ('WAITING','RETRY','CLAIMED') ORDER BY run_at,draft_id"
   ).all(input.storeId);
   for(const row of rows){
    if(ms(row.expires_at)<=ms(now)){
     settle(input.storeId,row.draft_id,'DEAD',actor,'EXPIRED');changed++;continue;
    }
    const d=latestState(input.storeId,row.draft_id);
    if(d.notificationState!=='OWNER_APPROVED'){
     settle(input.storeId,row.draft_id,'SUPPRESSED',actor,'DRAFT_STATE_CHANGED');changed++;
     continue;
    }
    try{eligible(d,input.storeId,input.sessionHandle);}
    catch(err){
     settle(input.storeId,row.draft_id,'SUPPRESSED',actor,err.code||'INELIGIBLE');
     changed++;
    }
   }
   return {changed,realMessagesSent:0};
  });
 }
 function claim(input={}){
  fields(input,['sessionHandle','storeId','workerId']);
  return tx(db,()=>{
   const actor=principal(input.sessionHandle,input.storeId);
   if(!validId(input.workerId))fail('INVALID_WORKER');
   const now=time(clock);
   const ready=db.prepare(
    "SELECT * FROM notification_queue_jobs WHERE store_id=? AND expires_at>? AND ((state IN ('WAITING','RETRY') AND run_at<=?) OR (state='CLAIMED' AND lease_until<=?)) ORDER BY run_at,draft_id"
   ).all(input.storeId,now,now,now);
   for(const row of ready){
    const d=latestState(input.storeId,row.draft_id);
    if(d.notificationState!=='OWNER_APPROVED'){
     settle(input.storeId,row.draft_id,'SUPPRESSED',actor,'DRAFT_STATE_CHANGED');continue;
    }
    try{eligible(d,input.storeId,input.sessionHandle);}
    catch(err){settle(input.storeId,row.draft_id,'SUPPRESSED',actor,err.code||'INELIGIBLE');continue;}
    if(row.attempts>=maxAttempts){
     settle(input.storeId,row.draft_id,'DEAD',actor,'ATTEMPTS_EXHAUSTED');continue;
    }
    const token=randomUUID(),until=isoPlus(now,leaseMillis);
    db.prepare(
     "UPDATE notification_queue_jobs SET state='CLAIMED',attempts=attempts+1,lease_owner=?,lease_token=?,lease_until=? WHERE store_id=? AND draft_id=?"
    ).run(input.workerId,token,until,input.storeId,row.draft_id);
    event(input.storeId,row.draft_id,'CLAIMED',row.attempts+1,input.workerId);
    return {draftId:row.draft_id,leaseToken:token,attempt:row.attempts+1,
     leaseUntil:until,realMessagesSent:0};
   }
   return null;
  });
 }
 function complete(input={}){
  fields(input,['sessionHandle','storeId','draftId','workerId','leaseToken','outcome']);
  return tx(db,()=>{
   const actor=principal(input.sessionHandle,input.storeId);
   const {storeId,draftId}=input;
   if(!validId(draftId)||!validId(input.workerId)||!validId(input.leaseToken)||
      !['SIMULATE_SUCCESS','SIMULATE_FAILURE'].includes(input.outcome))
    fail('INVALID_COMPLETION');
   const row=queueJob(storeId,draftId);
   if(!row)fail('QUEUE_NOT_FOUND');
   if(row.state==='SIMULATED')return {status:'SIMULATED',replayed:true,realMessagesSent:0};
   if(row.state!=='CLAIMED')fail('NOT_CLAIMED');
   if(row.lease_owner!==input.workerId||row.lease_token!==input.leaseToken)
    fail('STALE_LEASE');
   if(ms(row.lease_until)<=ms(time(clock)))fail('LEASE_EXPIRED');
   if(ms(row.expires_at)<=ms(time(clock))){
    settle(storeId,draftId,'DEAD',actor,'EXPIRED');
    return {status:'DEAD',realMessagesSent:0};
   }
   const d=latestState(storeId,draftId);
   if(d.notificationState!=='OWNER_APPROVED'){
    settle(storeId,draftId,'SUPPRESSED',actor,'DRAFT_STATE_CHANGED');
    return {status:'SUPPRESSED',realMessagesSent:0};
   }
   try{eligible(d,storeId,input.sessionHandle);}
   catch(err){
    settle(storeId,draftId,'SUPPRESSED',actor,err.code||'INELIGIBLE');
    return {status:'SUPPRESSED',reason:err.code,realMessagesSent:0};
   }
   if(input.outcome==='SIMULATE_SUCCESS')
    fail('USE_EXPLICIT_HANDOFF_RESOLUTION');
   if(input.outcome==='SIMULATE_FAILURE'){
    if(row.attempts>=maxAttempts){
     settle(storeId,draftId,'DEAD',input.workerId,'MAX_ATTEMPTS');
     return {status:'DEAD',attempt:row.attempts,realMessagesSent:0};
    }
    const backoff=60000*Math.pow(2,row.attempts-1);
    const when=isoPlus(time(clock),backoff);
    if(ms(when)>=ms(row.expires_at)){
     settle(storeId,draftId,'DEAD',input.workerId,'RETRY_AFTER_EXPIRY');
     return {status:'DEAD',realMessagesSent:0};
    }
    db.prepare(
     "UPDATE notification_queue_jobs SET state='RETRY',run_at=?,lease_owner=NULL,lease_token=NULL,lease_until=NULL,last_failure='FICTIONAL_FAILURE' WHERE store_id=? AND draft_id=?"
    ).run(when,storeId,draftId);
    event(storeId,draftId,'RETRY_SCHEDULED',row.attempts,input.workerId,'FICTIONAL_FAILURE');
    return {status:'RETRY',runAt:when,realMessagesSent:0};
   }
   const today=date(time(clock));
   const used=db.prepare(
    "SELECT COUNT(*) AS n FROM notification_events WHERE store_id=? AND action='SIMULATED_ONLY' AND substr(recorded_at,1,10)=?"
   ).get(storeId,today).n;
   if(used>=maxSimulatedPerStoreDay){
    settle(storeId,draftId,'DEAD',input.workerId,'FICTIONAL_DAILY_LIMIT');
    return {status:'DEAD',reason:'FICTIONAL_DAILY_LIMIT',realMessagesSent:0};
   }
   // This is the only "delivery". Nothing leaves this SQLite connection.
   db.prepare(
    "INSERT INTO notification_events(store_id,draft_id,action,actor_subject_id,recorded_at) VALUES(?,?,'SIMULATED_ONLY',?,?)"
   ).run(storeId,draftId,actor,time(clock));
   db.prepare(
    "UPDATE notification_queue_jobs SET state='SIMULATED',lease_owner=NULL,lease_token=NULL,lease_until=NULL,finished_at=? WHERE store_id=? AND draft_id=?"
   ).run(time(clock),storeId,draftId);
   event(storeId,draftId,'SIMULATED_ONLY',row.attempts,input.workerId);
   return {status:'SIMULATED',replayed:false,realMessagesSent:0};
  });
 }

 /**
  * Persist an OUTCOME_UNKNOWN boundary before any hypothetical provider call.
  * No network call follows: this is a simulated handoff marker only.
  * Once persisted, claim(), reconcile() and lease expiry never retry it.
  */
 function beginUncertainHandoff(input={}){
  fields(input,['sessionHandle','storeId','draftId','workerId','leaseToken']);
  return tx(db,()=>{
   const actor=principal(input.sessionHandle,input.storeId);
   const {storeId,draftId}=input;
   if(!validId(draftId)||!validId(input.workerId)||!validId(input.leaseToken))
    fail('INVALID_HANDOFF');
   const row=queueJob(storeId,draftId);
   if(!row)fail('QUEUE_NOT_FOUND');
   if(row.state!=='CLAIMED')fail('NOT_CLAIMED');
   if(row.lease_owner!==input.workerId||row.lease_token!==input.leaseToken)
    fail('STALE_LEASE');
   const now=time(clock);
   if(ms(row.lease_until)<=ms(now))fail('LEASE_EXPIRED');
   if(ms(row.expires_at)<=ms(now)){
    settle(storeId,draftId,'DEAD',actor,'EXPIRED');
    return {status:'DEAD',realMessagesSent:0};
   }
   const draft=latestState(storeId,draftId);
   if(draft.notificationState!=='OWNER_APPROVED'){
    settle(storeId,draftId,'SUPPRESSED',actor,'DRAFT_STATE_CHANGED');
    return {status:'SUPPRESSED',realMessagesSent:0};
   }
   try{eligible(draft,storeId,input.sessionHandle);}
   catch(err){
    settle(storeId,draftId,'SUPPRESSED',actor,err.code||'INELIGIBLE');
    return {status:'SUPPRESSED',reason:err.code,realMessagesSent:0};
   }
   // Conservatively count uncertain previous handoffs toward daily budget.
   const used=db.prepare(
    "SELECT COUNT(*) AS n FROM notification_queue_events WHERE store_id=? AND action IN ('HANDOFF_UNCERTAIN','SIMULATED_ONLY') AND substr(event_at,1,10)=?"
   ).get(storeId,date(now)).n;
   if(used>=maxSimulatedPerStoreDay){
    settle(storeId,draftId,'DEAD',actor,'FICTIONAL_DAILY_LIMIT');
    return {status:'DEAD',reason:'FICTIONAL_DAILY_LIMIT',realMessagesSent:0};
   }
   const handoffId=randomUUID();
   db.prepare(
    "UPDATE notification_queue_jobs SET state='OUTCOME_UNKNOWN',lease_owner=NULL,lease_token=NULL,lease_until=NULL,last_handoff_id=?,last_handoff_at=?,last_handoff_outcome=NULL WHERE store_id=? AND draft_id=?"
   ).run(handoffId,now,storeId,draftId);
   event(storeId,draftId,'HANDOFF_UNCERTAIN',row.attempts,input.workerId);
   return {draftId,handoffId,status:'OUTCOME_UNKNOWN',realMessagesSent:0};
  });
 }
 /**
  * An owner records ONLY a simulated investigation finding.
  * No provider access: MOCK_ACCEPTED/NOT_ACCEPTED are test fixtures.
  * Unknown stays blocked indefinitely until this explicit decision.
  * A retry after NOT_ACCEPTED requires an explicit owner approval flag.
  */
 function resolveUncertain(input={}){
  fields(input,['sessionHandle','storeId','draftId','handoffId','finding','retryApproved']);
  return tx(db,()=>{
   const owner=principal(input.sessionHandle,input.storeId);
   const {storeId,draftId,handoffId,finding}=input;
   if(!validId(draftId)||!validId(handoffId)||
     !['MOCK_ACCEPTED','MOCK_NOT_ACCEPTED'].includes(finding)||
     (input.retryApproved!==undefined&&typeof input.retryApproved!=='boolean'))
    fail('INVALID_FINDING');
   const row=queueJob(storeId,draftId);
   if(!row)fail('QUEUE_NOT_FOUND');
   if(row.last_handoff_id!==handoffId)fail('STALE_HANDOFF');
   if(row.last_handoff_outcome!==null){
    if(row.last_handoff_outcome!==finding)fail('FINDING_CONFLICT');
    return {status:row.state,replayed:true,realMessagesSent:0};
   }
   if(row.state!=='OUTCOME_UNKNOWN')fail('NOT_OUTCOME_UNKNOWN');
   const now=time(clock);
   if(finding==='MOCK_ACCEPTED'){
    // Historical receipt is recorded even if the booking or consent changed
    // AFTER the handoff. It never authorizes sending another message.
    db.prepare(
     "INSERT INTO notification_events(store_id,draft_id,action,actor_subject_id,recorded_at) VALUES(?,?,'SIMULATED_ONLY',?,?)"
    ).run(storeId,draftId,owner,now);
    db.prepare(
     "UPDATE notification_queue_jobs SET state='SIMULATED',last_handoff_outcome='MOCK_ACCEPTED',finished_at=? WHERE store_id=? AND draft_id=?"
    ).run(now,storeId,draftId);
    event(storeId,draftId,'MOCK_ACCEPTED',row.attempts,owner);
    return {status:'SIMULATED',replayed:false,realMessagesSent:0};
   }
   // Explicitly assessed as not accepted: NEVER silently retry. The owner
   // must opt in, and all current consent/booking conditions must still hold.
   let canRetry=input.retryApproved===true&&row.attempts<maxAttempts&&
      ms(row.expires_at)>ms(now)+60000;
   if(canRetry){
    const d=latestState(storeId,draftId);
    if(d.notificationState!=='OWNER_APPROVED')canRetry=false;
    else{
     try{eligible(d,storeId,input.sessionHandle);}
     catch{canRetry=false;}
    }
   }
   if(canRetry){
    db.prepare(
     "UPDATE notification_queue_jobs SET state='RETRY',run_at=?,last_handoff_outcome='MOCK_NOT_ACCEPTED',last_failure='VERIFIED_MOCK_NOT_ACCEPTED' WHERE store_id=? AND draft_id=?"
    ).run(isoPlus(now,60000),storeId,draftId);
    event(storeId,draftId,'MOCK_NOT_ACCEPTED',row.attempts,owner,'OWNER_APPROVED_RETRY');
    return {status:'RETRY',replayed:false,realMessagesSent:0};
   }
   db.prepare(
    "UPDATE notification_queue_jobs SET state='DEAD',last_handoff_outcome='MOCK_NOT_ACCEPTED',last_failure='VERIFIED_MOCK_NOT_ACCEPTED',finished_at=? WHERE store_id=? AND draft_id=?"
   ).run(now,storeId,draftId);
   event(storeId,draftId,'MOCK_NOT_ACCEPTED',row.attempts,owner,'STOPPED_NO_RETRY');
   return {status:'DEAD',replayed:false,realMessagesSent:0};
  });
 }

 function list(input={}){
  fields(input,['sessionHandle','storeId']);
  principal(input.sessionHandle,input.storeId);
  return db.prepare(
   'SELECT store_id,draft_id,state,run_at,expires_at,attempts,lease_until,last_failure,finished_at,last_handoff_id,last_handoff_at,last_handoff_outcome FROM notification_queue_jobs WHERE store_id=? ORDER BY created_at,draft_id'
  ).all(input.storeId);
 }
 function audit(input={}){
  fields(input,['sessionHandle','storeId']);
  principal(input.sessionHandle,input.storeId);
  return db.prepare(
   'SELECT draft_id,action,attempt,event_at,worker_id,reason_code FROM notification_queue_events WHERE store_id=? ORDER BY event_seq'
  ).all(input.storeId);
 }
 return Object.freeze({enqueue:enqueued,reconcile,claim,complete,beginUncertainHandoff,resolveUncertain,list,audit});
}
