/**
 * v0.65 — TEST-ONLY notification ledger on an existing v0.63 booking SQLite DB.
 * Uses ONLY fictional identities and visits. No contacts, LINE connection,
 * network communication, real delivery, live API, money, or actual consent.
 * Requires the existing v0.63 test-only unsafeDbForTests hook.
 */
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';

const PURPOSES=new Set(['reminder','return','waitlist']);
const ROLE_OWNER=new Set(['owner','manager']);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const KEY=/^[A-Za-z0-9_-]{8,128}$/;
const YMD=/^\d{4}-\d{2}-\d{2}$/;
function fail(code){const e=new Error(code);e.code=code;throw e;}
function validId(x){return typeof x==='string'&&ID.test(x);}
function dateUTC(value){
 if(typeof value!=='string'||!YMD.test(value))fail('INVALID_DATE');
 const [y,m,d]=value.split('-').map(Number);
 const t=Date.UTC(y,m-1,d);
 if(new Date(t).toISOString().slice(0,10)!==value)fail('INVALID_DATE');
 return t;
}
function dayOffset(today,days){
 return new Date(dateUTC(today)+days*86400000).toISOString().slice(0,10);
}
function daysFrom(a,b){return Math.round((dateUTC(a)-dateUTC(b))/86400000);}
function hash(x){return createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function fields(x,allowed){
 if(!x||typeof x!=='object'||Array.isArray(x)||
  Object.keys(x).some(k=>!allowed.includes(k)))fail('INVALID_FIELDS');
}
function dateOf(clock){
 const d=new Date(clock());
 if(!Number.isFinite(d.getTime()))fail('INVALID_CLOCK');
 return d.toISOString().slice(0,10);
}
function instantOf(clock){
 const d=new Date(clock());
 if(!Number.isFinite(d.getTime()))fail('INVALID_CLOCK');
 return d.toISOString();
}
function transaction(db,handler){
 db.exec('BEGIN IMMEDIATE');
 try{const out=handler();db.exec('COMMIT');return out;}
 catch(err){try{db.exec('ROLLBACK');}catch{}throw err;}
}

export function openFictionalNotificationAddon({
 bookingStore,resolveSession,clock=()=>new Date(),
 maxSimulatedPerStoreDay=3,fictionalTestOnly=false
}={}){
 if(fictionalTestOnly!==true||!bookingStore||
  typeof bookingStore.available!=='function'||typeof resolveSession!=='function'||
  typeof clock!=='function'||!Number.isSafeInteger(maxSimulatedPerStoreDay)||
  maxSimulatedPerStoreDay<1||maxSimulatedPerStoreDay>100)
  fail('FICTIONAL_TEST_MODE_REQUIRED');
 const db=bookingStore.unsafeDbForTests;
 if(!db||typeof db.prepare!=='function')fail('LOCAL_SQLITE_REQUIRED');
 for(const name of ['booking_records','booking_moves','booking_cancellations',
  'day_configurations','stores','staff_memberships']){
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))
   fail('REQUIRES_V063_SCHEMA');
 }
 const tables=['notification_consent_events','notification_mock_visits',
  'notification_waitlist_preferences','notification_drafts','notification_events'];
 const found=tables.filter(name=>db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
 if(found.length>0&&found.length!==tables.length)fail('NOTIFICATION_SCHEMA_PARTIAL');
 if(!found.length){
  db.exec(readFileSync(new URL('./v0.65-notification-addon-schema.sql',import.meta.url),'utf8'));
 }
 function identity(sessionHandle,storeId){
  if(!validId(storeId))fail('INVALID_STORE');
  const s=resolveSession(sessionHandle);
  if(!s||s.authenticated!==true||!validId(s.subjectId)||
   !['staff','customer'].includes(s.kind))fail('UNAUTHENTICATED');
  if(!db.prepare('SELECT store_id FROM stores WHERE store_id=?').get(storeId))
   fail('STORE_NOT_FOUND');
  if(s.kind==='staff'){
   const membership=db.prepare(
    'SELECT role,active FROM staff_memberships WHERE store_id=? AND subject_id=?'
   ).get(storeId,s.subjectId);
   if(!membership||membership.active!==1)fail('STORE_ACCESS_DENIED');
   return {id:s.subjectId,kind:'staff',role:membership.role};
  }
  return {id:s.subjectId,kind:'customer',role:null};
 }
 function staffOnly(person){
  if(person.kind!=='staff'||!ROLE_OWNER.has(person.role))fail('OWNER_APPROVAL_REQUIRED');
 }
 function currentConsent(storeId,customerId,purpose){
  const c=db.prepare(
   'SELECT allowed FROM notification_consent_events WHERE store_id=? AND customer_subject_id=? AND purpose=? ORDER BY seq DESC LIMIT 1'
  ).get(storeId,customerId,purpose);
  return !!c&&c.allowed===1;
 }
 function requireConsent(storeId,cid,purpose){
  if(!currentConsent(storeId,cid,purpose))fail('NO_CONSENT');
 }
 function booking(storeId,bookingId){
  if(!validId(bookingId))fail('INVALID_BOOKING');
  const b=db.prepare(
   'SELECT b.*,c.booking_id AS canceled,c.cancellation_reason FROM booking_records b LEFT JOIN booking_cancellations c ON c.store_id=b.store_id AND c.booking_id=b.booking_id WHERE b.store_id=? AND b.booking_id=?'
  ).get(storeId,bookingId);
  if(!b)fail('BOOKING_NOT_FOUND');
  return b;
 }
 function hasActiveFuture(storeId,customerId,now){
  return !!db.prepare(
   'SELECT b.booking_id FROM booking_records b LEFT JOIN booking_cancellations c ON c.store_id=b.store_id AND c.booking_id=b.booking_id WHERE b.store_id=? AND b.owner_subject_id=? AND b.service_date>=? AND c.booking_id IS NULL LIMIT 1'
  ).get(storeId,customerId,now);
 }
 function cycleFor(storeId,customerId){
  const visits=db.prepare(
   'SELECT visited_date FROM notification_mock_visits WHERE store_id=? AND customer_subject_id=? ORDER BY visited_date ASC'
  ).all(storeId,customerId).map(x=>x.visited_date);
  if(visits.length<2)return null;
  const intervals=[];
  for(let i=1;i<visits.length;i++){
   const days=daysFrom(visits[i],visits[i-1]);
   if(days<14||days>120)return null;
   intervals.push(days);
  }
  const cycle=Math.round(intervals.reduce((a,b)=>a+b,0)/intervals.length);
  return {intervalDays:cycle,expectedDate:dayOffset(visits.at(-1),cycle),
   samples:intervals.length};
 }
 function pref(storeId,cid,b){
  const p=db.prepare(
   'SELECT * FROM notification_waitlist_preferences WHERE store_id=? AND customer_subject_id=? AND service_date=? AND menu_id=?'
  ).get(storeId,cid,b.service_date,b.menu_id);
  return !!p&&(!p.staff_id||p.staff_id===b.staff_id)&&
   p.earliest_minute<=b.start_minute&&p.latest_minute>=b.start_minute;
 }
 function eligible({storeId,customerId,purpose,bookingId,now,sessionHandle}){
  requireConsent(storeId,customerId,purpose);
  if(purpose==='reminder'){
   const b=booking(storeId,bookingId);
   if(b.canceled||b.owner_subject_id!==customerId||
    b.service_date!==dayOffset(now,1))fail('REMINDER_BOOKING_INVALID');
   return {periodKey:bookingId,bookingId};
  }
  if(purpose==='return'){
   if(hasActiveFuture(storeId,customerId,now))fail('ALREADY_BOOKED');
   const c=cycleFor(storeId,customerId);
   if(!c)fail('INSUFFICIENT_HISTORY');
   const delta=daysFrom(c.expectedDate,now);
   if(delta>10||delta< -7)fail('RETURN_NOT_DUE');
   return {periodKey:c.expectedDate,bookingId:null,cycle:c};
  }
  if(purpose==='waitlist'){
   const b=booking(storeId,bookingId);
   if(!b.canceled||b.cancellation_reason==='MOVE')fail('WAITLIST_RELEASE_INVALID');
   if(daysFrom(b.service_date,now)<0)fail('EXPIRED_WAITLIST_RELEASE');
   if(hasActiveFuture(storeId,customerId,now))fail('ALREADY_BOOKED');
   if(!pref(storeId,customerId,b))fail('WAITLIST_PREFERENCE_MISSING');
   // May be offered only if the exact resource/time is still available.
   const free=bookingStore.available({
    sessionHandle,storeId,serviceDate:b.service_date,
    menuId:b.menu_id,staffId:b.staff_id,bedId:b.bed_id,
    startMinute:b.start_minute
   });
   if(!free.ok)fail('SLOT_UNAVAILABLE');
   return {periodKey:bookingId,bookingId};
  }
  fail('INVALID_PURPOSE');
 }
 function draftDetails(storeId,id){
  const d=db.prepare('SELECT * FROM notification_drafts WHERE store_id=? AND draft_id=?')
   .get(storeId,id);
  if(!d)fail('DRAFT_NOT_FOUND');
  const events=db.prepare(
   'SELECT action,actor_subject_id,recorded_at FROM notification_events WHERE store_id=? AND draft_id=? ORDER BY seq'
  ).all(storeId,id);
  const status=events.at(-1)?.action||'DRAFT_CREATED';
  return {...d,status,events};
 }
 function addEvent(storeId,draftId,action,actor){
  db.prepare(
   'INSERT INTO notification_events(store_id,draft_id,action,actor_subject_id,recorded_at) VALUES(?,?,?,?,?)'
  ).run(storeId,draftId,action,actor,instantOf(clock));
 }
 function consent(input={}){
  fields(input,['sessionHandle','storeId','purpose','allowed']);
  return transaction(db,()=>{
   const a=identity(input.sessionHandle,input.storeId);
   if(a.kind!=='customer'||!PURPOSES.has(input.purpose)||
     typeof input.allowed!=='boolean')fail('CUSTOMER_SELF_CONSENT_REQUIRED');
   db.prepare(
    "INSERT INTO notification_consent_events(store_id,customer_subject_id,purpose,allowed,actor_subject_id,obtained_via,recorded_at) VALUES(?,?,?,?,?,'FICTIONAL_SELF_SERVICE',?)"
   ).run(input.storeId,a.id,input.purpose,input.allowed?1:0,a.id,instantOf(clock));
   if(!input.allowed){
    // Consent revocation suppresses all not-yet-dispatched records, including
    // already approved drafts. A sent marker is immutable, never "unsent".
    const pending=db.prepare(
     'SELECT draft_id FROM notification_drafts WHERE store_id=? AND customer_subject_id=? AND purpose=?'
    ).all(input.storeId,a.id,input.purpose);
    for(const row of pending){
     const d=draftDetails(input.storeId,row.draft_id);
     if(['DRAFT_CREATED','OWNER_APPROVED'].includes(d.status)){
      addEvent(input.storeId,row.draft_id,'SUPPRESSED',a.id);
     }
    }
   }
   return {customerId:a.id,purpose:input.purpose,allowed:input.allowed,
    recordKind:'FICTIONAL_ONLY'};
  });
 }
 function addVisit(input={}){
  fields(input,['sessionHandle','storeId','customerId','visitedDate']);
  return transaction(db,()=>{
   const a=identity(input.sessionHandle,input.storeId);staffOnly(a);
   if(!validId(input.customerId))fail('INVALID_CUSTOMER');
   const date=dayOffset(input.visitedDate,0);
   if(daysFrom(date,dateOf(clock))>0)fail('FUTURE_VISIT_NOT_ALLOWED');
   db.prepare(
    "INSERT INTO notification_mock_visits(store_id,customer_subject_id,visited_date,record_kind,recorded_by,created_at) VALUES(?,?,?,'FICTIONAL',?,?)"
   ).run(input.storeId,input.customerId,date,a.id,instantOf(clock));
   return {recordKind:'FICTIONAL_ONLY',visitedDate:date};
  });
 }
 function waitlistPreference(input={}){
  fields(input,['sessionHandle','storeId','serviceDate','menuId','staffId','earliestMinute','latestMinute']);
  return transaction(db,()=>{
   const a=identity(input.sessionHandle,input.storeId);
   if(a.kind!=='customer')fail('CUSTOMER_SELF_PREFERENCE_REQUIRED');
   const date=dayOffset(input.serviceDate,0);
   if(!validId(input.menuId)||(input.staffId!==undefined&&
     input.staffId!==null&&!validId(input.staffId))||
    !Number.isSafeInteger(input.earliestMinute)||
    !Number.isSafeInteger(input.latestMinute)||
    input.earliestMinute<540||input.latestMinute>1080||
    input.earliestMinute>input.latestMinute)fail('INVALID_PREFERENCE');
   db.prepare(
    'INSERT INTO notification_waitlist_preferences(store_id,customer_subject_id,service_date,menu_id,staff_id,earliest_minute,latest_minute,recorded_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(store_id,customer_subject_id,service_date,menu_id) DO UPDATE SET staff_id=excluded.staff_id,earliest_minute=excluded.earliest_minute,latest_minute=excluded.latest_minute,recorded_at=excluded.recorded_at'
   ).run(input.storeId,a.id,date,input.menuId,input.staffId||null,
    input.earliestMinute,input.latestMinute,instantOf(clock));
   return {recordKind:'FICTIONAL_ONLY',customerId:a.id};
  });
 }
 function createDraft(input={}){
  fields(input,['sessionHandle','storeId','customerId','purpose','bookingId','idempotencyKey']);
  return transaction(db,()=>{
   const a=identity(input.sessionHandle,input.storeId);staffOnly(a);
   const {storeId,customerId,purpose,idempotencyKey}=input;
   if(!validId(customerId)||!PURPOSES.has(purpose)||typeof idempotencyKey!=='string'||
    !KEY.test(idempotencyKey))fail('INVALID_DRAFT');
   const bid=input.bookingId===undefined?null:input.bookingId;
   if((purpose==='return'&&bid!==null)||
      (purpose!=='return'&&!validId(bid)))fail('INVALID_BOOKING');
   const digest=hash({customerId,purpose,bookingId:bid});
   const earlier=db.prepare(
    'SELECT draft_id,command_fingerprint FROM notification_drafts WHERE store_id=? AND idempotency_key=?'
   ).get(storeId,idempotencyKey);
   if(earlier){
    if(earlier.command_fingerprint!==digest)fail('IDEMPOTENCY_CONFLICT');
    return {draftId:earlier.draft_id,replayed:true,status:'ALREADY_PROCESSED'};
   }
   const elig=eligible({storeId,customerId,purpose,bookingId:bid,
    now:dateOf(clock),sessionHandle:input.sessionHandle});
   const prior=db.prepare(
    'SELECT draft_id FROM notification_drafts WHERE store_id=? AND customer_subject_id=? AND purpose=? AND period_key=?'
   ).get(storeId,customerId,purpose,elig.periodKey);
   if(prior)fail('DUPLICATE_PERIOD');
   const id=randomUUID();
   const template=purpose==='reminder'?'REMINDER_GENERIC':
    purpose==='return'?'RETURN_GENERIC':'WAITLIST_GENERIC';
   db.prepare(
    'INSERT INTO notification_drafts(store_id,draft_id,customer_subject_id,purpose,subject_booking_id,idempotency_key,command_fingerprint,period_key,template_code,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
   ).run(storeId,id,customerId,purpose,bid,idempotencyKey,digest,
    elig.periodKey,template,a.id,instantOf(clock));
   addEvent(storeId,id,'DRAFT_CREATED',a.id);
   return {draftId:id,status:'DRAFT',replayed:false};
  });
 }
 function approve(input={}){
  fields(input,['sessionHandle','storeId','draftId']);
  return transaction(db,()=>{
   const a=identity(input.sessionHandle,input.storeId);staffOnly(a);
   if(!validId(input.draftId))fail('INVALID_DRAFT');
   const d=draftDetails(input.storeId,input.draftId);
   if(d.status!=='DRAFT_CREATED')fail('INVALID_STATE');
   eligible({storeId:input.storeId,customerId:d.customer_subject_id,
    purpose:d.purpose,bookingId:d.subject_booking_id,
    now:dateOf(clock),sessionHandle:input.sessionHandle});
   addEvent(input.storeId,input.draftId,'OWNER_APPROVED',a.id);
   return {draftId:input.draftId,status:'APPROVED_FICTIONAL'};
  });
 }
 function simulateDispatch(input={}){
  fields(input,['sessionHandle','storeId','draftId']);
  return transaction(db,()=>{
   const a=identity(input.sessionHandle,input.storeId);staffOnly(a);
   if(!validId(input.draftId))fail('INVALID_DRAFT');
   const d=draftDetails(input.storeId,input.draftId);
   if(d.status==='SIMULATED_ONLY')return {
    draftId:d.draft_id,status:'SIMULATED_ONLY',replayed:true,realMessagesSent:0
   };
   if(d.status!=='OWNER_APPROVED')fail('NOT_APPROVED');
   const today=dateOf(clock);
   eligible({storeId:input.storeId,customerId:d.customer_subject_id,purpose:d.purpose,
    bookingId:d.subject_booking_id,now:today,sessionHandle:input.sessionHandle});
   const count=db.prepare(
    "SELECT COUNT(*) AS n FROM notification_events WHERE store_id=? AND action='SIMULATED_ONLY' AND substr(recorded_at,1,10)=?"
   ).get(input.storeId,today).n;
   if(count>=maxSimulatedPerStoreDay)fail('FICTIONAL_DAILY_LIMIT');
   // No external worker: we only append an immutable, explicitly fake marker.
   addEvent(input.storeId,input.draftId,'SIMULATED_ONLY',a.id);
   return {draftId:d.draft_id,status:'SIMULATED_ONLY',replayed:false,realMessagesSent:0};
  });
 }
 function suppress(input={}){
  fields(input,['sessionHandle','storeId','draftId']);
  return transaction(db,()=>{
   const a=identity(input.sessionHandle,input.storeId);staffOnly(a);
   const d=draftDetails(input.storeId,input.draftId);
   if(d.status==='SUPPRESSED')return {status:'SUPPRESSED',replayed:true};
   if(d.status==='SIMULATED_ONLY')fail('ALREADY_SIMULATED');
   addEvent(input.storeId,input.draftId,'SUPPRESSED',a.id);
   return {status:'SUPPRESSED',replayed:false};
  });
 }
 function list(input={}){
  fields(input,['sessionHandle','storeId']);
  const a=identity(input.sessionHandle,input.storeId);
  const rows=db.prepare(
   'SELECT draft_id,customer_subject_id FROM notification_drafts WHERE store_id=? ORDER BY created_at,draft_id'
  ).all(input.storeId);
  return rows.filter(x=>a.kind==='staff'||x.customer_subject_id===a.id)
   .map(x=>draftDetails(input.storeId,x.draft_id));
 }
 function summary(input={}){
  fields(input,['sessionHandle','storeId']);
  const a=identity(input.sessionHandle,input.storeId);staffOnly(a);
  const statuses=list(input).reduce((acc,d)=>{
   acc[d.status]=(acc[d.status]||0)+1;return acc;
  },{});
  return {storedDrafts:Object.values(statuses).reduce((a,b)=>a+b,0),
   byLatestState:statuses,
   realMessagesSent:0,actualVisits:null,actualRevenue:null,
   simulatedOnly:true};
 }
 return Object.freeze({consent,addVisit,waitlistPreference,createDraft,
  approve,simulateDispatch,suppress,list,summary,
  // Test-only queries, not a real booking or notification API.
  cycleFor:(s,c)=>cycleFor(s,c)
 });
}
