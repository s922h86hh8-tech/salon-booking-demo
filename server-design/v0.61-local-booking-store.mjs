/**
 * v0.61 — fictional, local SQLite booking transaction prototype.
 * Not an internet-facing reservation backend, identity provider or live service.
 *
 * An in-process test-only resolver represents independently authenticated
 * customers/staff; it MUST be replaced with a trusted real authentication
 * boundary. Never put real customer, phone, email or store data in this demo.
 *
 * The unmodified v0.57 DemoCore.canBook is re-run inside BEGIN IMMEDIATE
 * against the latest ACTIVE SQLite bookings before the commit.
 */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const coreSource=readFileSync(
 new URL('../experiments/marketing-booking-mvp-a/core-v057.js',import.meta.url),'utf8'
);
function loadCore(){
 const global={};
 runInNewContext(coreSource,{window:global});
 if(!global.DemoCore||typeof global.DemoCore.canBook!=='function')
  throw new Error('Booking rules unavailable');
 return global.DemoCore;
}
const Core=loadCore();
const allowedSources=new Set(['website','phone','instore','hpb','line','google','other','unknown']);
const allowedDiscovery=new Set(['google','sns','referral','hpb','line','storefront','other','unknown']);
const roles=new Set(['owner','manager','receptionist']);

function issue(code,message=code){const error=new Error(message);error.code=code;return error;}
function identifier(value,max=128){
 return typeof value==='string'&&value.length>0&&value.length<=max&&/^[A-Za-z0-9_-]+$/.test(value);
}
function dayValid(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const [y,m,d]=s.split('-').map(Number);
 const dt=new Date(Date.UTC(y,m-1,d));
 return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}
function exactFields(args,allowed){
 if(!args||typeof args!=='object'||Array.isArray(args)||
  Object.keys(args).some(x=>!allowed.includes(x)))throw issue('INVALID_FIELDS');
}
function utc(clock){
 const d=new Date(clock());
 if(!Number.isFinite(d.getTime()))throw issue('INVALID_CLOCK');
 return d.toISOString();
}
function fingerprint(payload){
 return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function transactional(db,callback){
 db.exec('BEGIN IMMEDIATE');
 try{
  const result=callback();
  db.exec('COMMIT');
  return result;
 }catch(error){
  try{db.exec('ROLLBACK');}catch{}
  throw error;
 }
}
function assertConfigShape(conf){
 if(!conf||typeof conf!=='object'||
   !Array.isArray(conf.staff)||!Array.isArray(conf.menus)||
   !Array.isArray(conf.beds)||!Array.isArray(conf.rooms)||
   typeof conf.breaks!=='object'||conf.breaks===null)
  throw issue('INVALID_CONFIGURATION');
 if(conf.staff.length===0||conf.menus.length===0||conf.beds.length===0)
  throw issue('INVALID_CONFIGURATION');
 for(const s of conf.staff){
  if(!identifier(s.id)||!Array.isArray(s.menus)||
    !Number.isSafeInteger(s.prep)||s.prep<0||s.prep>180)
   throw issue('INVALID_CONFIGURATION');
 }
 for(const m of conf.menus){
  if(!identifier(m.id)||!Number.isSafeInteger(m.duration)||
    m.duration<15||m.duration>180||m.duration%15!==0||
    typeof m.private!=='boolean')
   throw issue('INVALID_CONFIGURATION');
 }
 for(const b of conf.beds){
  if(!identifier(b.id)||!identifier(b.room)||!Number.isSafeInteger(b.clean)||
     b.clean<0||b.clean>180)throw issue('INVALID_CONFIGURATION');
 }
}
function toModel(config,rows){
 const model=Core.initial();
 model.staff=Core.clone(config.staff);
 model.menus=Core.clone(config.menus);
 model.beds=Core.clone(config.beds);
 model.rooms=Core.clone(config.rooms);
 model.breaks=Core.clone(config.breaks);
 model.bookings=rows.map(r=>({
  id:r.booking_id,menu:r.menu_id,staff:r.staff_id,bed:r.bed_id,
  start:r.start_minute,status:'CONFIRMED',prepMinutes:r.prep_minutes
 }));
 return model;
}
export function openLocalBookingPrototype({
 path=':memory:',resolveSession,clock=()=>new Date()
}={}){
 if(typeof resolveSession!=='function')throw issue('TRUSTED_TEST_SESSION_REQUIRED');
 if(typeof clock!=='function')throw issue('CLOCK_REQUIRED');
 const db=new DatabaseSync(path);
 try{
  db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=3000;');
  const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='booking_records'").get();
  if(!existing){
   // Refuse to blend v0.61 booking tables into an unknown prior database.
   const anything=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
   if(anything)throw issue('UNSUPPORTED_DATABASE');
   db.exec(readFileSync(new URL('./v0.61-booking-schema.sql',import.meta.url),'utf8'));
  }else{
   const required=['booking_cancellations','booking_commands','booking_audit_events','day_configurations'];
   for(const name of required){
    if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))
     throw issue('SCHEMA_MISMATCH_V061');
   }
  }
 }catch(e){db.close();throw e;}
 function actor(handle,storeId){
  if(!identifier(storeId))throw issue('INVALID_STORE');
  const session=resolveSession(handle);
  if(!session||session.authenticated!==true||!identifier(session.subjectId)||
     !['customer','staff'].includes(session.kind))throw issue('UNAUTHENTICATED');
  if(session.kind==='staff'){
   const member=db.prepare(
    'SELECT role,active FROM staff_memberships WHERE store_id=? AND subject_id=?'
   ).get(storeId,session.subjectId);
   if(!member||member.active!==1||!roles.has(member.role))
    throw issue('STORE_ACCESS_DENIED');
  }
  return {subjectId:session.subjectId,kind:session.kind};
 }
 function configAt(storeId,serviceDate){
  const record=db.prepare(
   'SELECT config_json FROM day_configurations WHERE store_id=? AND service_date=?'
  ).get(storeId,serviceDate);
  if(!record)throw issue('DATE_NOT_CONFIGURED');
  const config=JSON.parse(record.config_json);assertConfigShape(config);
  return config;
 }
 function activeRows(storeId,serviceDate){
  return db.prepare(
   'SELECT b.* FROM booking_records b LEFT JOIN booking_cancellations c ON c.store_id=b.store_id AND c.booking_id=b.booking_id WHERE b.store_id=? AND b.service_date=? AND c.booking_id IS NULL'
  ).all(storeId,serviceDate);
 }
 function validateCommand({storeId,serviceDate,menuId,staffId,bedId,startMinute,idempotencyKey,source,discovery}){
  if(!identifier(storeId)||!dayValid(serviceDate)||
   !identifier(menuId)||!identifier(staffId)||!identifier(bedId)||
   !Number.isSafeInteger(startMinute)||startMinute%15!==0||
   startMinute<540||startMinute>1080||
   !identifier(idempotencyKey)||idempotencyKey.length<8||
   !allowedSources.has(source)||!allowedDiscovery.has(discovery))
   throw issue('INVALID_BOOKING_INPUT');
 }
 function existingCommand(storeId,subjectId,operation,key,digest){
  const prior=db.prepare(
   'SELECT * FROM booking_commands WHERE store_id=? AND actor_subject_id=? AND operation=? AND idempotency_key=?'
  ).get(storeId,subjectId,operation,key);
  if(!prior)return null;
  if(prior.fingerprint!==digest)throw issue('IDEMPOTENCY_CONFLICT');
  return prior;
 }
 function reserve(input={}){
  exactFields(input,['sessionHandle','storeId','serviceDate','menuId','staffId',
   'bedId','startMinute','idempotencyKey','source','discovery']);
  const {sessionHandle,storeId,serviceDate,menuId,staffId,bedId,
   startMinute,idempotencyKey}=input;
  return transactional(db,()=>{
   const principal=actor(sessionHandle,storeId);
   const source=principal.kind==='customer'?'website':input.source||'phone';
   const discovery=allowedDiscovery.has(input.discovery)?input.discovery:
    input.discovery===undefined?'unknown':input.discovery;
   validateCommand({storeId,serviceDate,menuId,staffId,bedId,
    startMinute,idempotencyKey,source,discovery});
   const digest=fingerprint({storeId,serviceDate,menuId,staffId,bedId,
    startMinute,source,discovery});
   const prior=existingCommand(storeId,principal.subjectId,'RESERVE',idempotencyKey,digest);
   if(prior){
    return Object.freeze({bookingId:prior.booking_id,serviceDate,
     status:'ALREADY_PROCESSED',replayed:true});
   }
   const config=configAt(storeId,serviceDate);
   const model=toModel(config,activeRows(storeId,serviceDate));
   const request={menu:menuId,staff:staffId,bed:bedId,start:startMinute};
   const check=Core.canBook(model,request);
   if(!check.ok)throw issue('SLOT_UNAVAILABLE');
   const staff=config.staff.find(s=>s.id===staffId);
   const bookingId=randomUUID(),at=utc(clock);
   db.prepare(
    'INSERT INTO booking_records(store_id,service_date,booking_id,owner_subject_id,menu_id,staff_id,bed_id,start_minute,prep_minutes,source,discovery,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
   ).run(storeId,serviceDate,bookingId,principal.subjectId,menuId,staffId,
    bedId,startMinute,staff.prep,source,discovery,at);
   db.prepare(
    'INSERT INTO booking_commands(store_id,actor_subject_id,operation,idempotency_key,fingerprint,booking_id,created_at) VALUES(?,?,?,?,?,?,?)'
   ).run(storeId,principal.subjectId,'RESERVE',idempotencyKey,digest,bookingId,at);
   db.prepare(
    'INSERT INTO booking_audit_events(store_id,booking_id,action,actor_subject_id,actor_kind,occurred_at) VALUES(?,?,?,?,?,?)'
   ).run(storeId,bookingId,'BOOKING_CONFIRMED',principal.subjectId,principal.kind,at);
   return Object.freeze({bookingId,serviceDate,status:'CONFIRMED',replayed:false});
  });
 }
 function cancel(input={}){
  exactFields(input,['sessionHandle','storeId','bookingId','idempotencyKey']);
  const {sessionHandle,storeId,bookingId,idempotencyKey}=input;
  return transactional(db,()=>{
   const principal=actor(sessionHandle,storeId);
   if(!identifier(bookingId)||!identifier(idempotencyKey)||idempotencyKey.length<8)
    throw issue('INVALID_BOOKING_INPUT');
   const digest=fingerprint({storeId,bookingId});
   const prior=existingCommand(storeId,principal.subjectId,'CANCEL',idempotencyKey,digest);
   if(prior)return Object.freeze({bookingId,status:'CANCELLED',replayed:true});
   const booking=db.prepare(
    'SELECT * FROM booking_records WHERE store_id=? AND booking_id=?'
   ).get(storeId,bookingId);
   if(!booking)throw issue('BOOKING_NOT_FOUND');
   if(principal.kind==='customer'&&booking.owner_subject_id!==principal.subjectId)
    throw issue('NOT_BOOKING_OWNER');
   const prev=db.prepare(
    'SELECT booking_id FROM booking_cancellations WHERE store_id=? AND booking_id=?'
   ).get(storeId,bookingId);
   if(prev)throw issue('ALREADY_CANCELLED');
   const at=utc(clock);
   db.prepare(
    'INSERT INTO booking_cancellations(store_id,booking_id,canceled_by_subject_id,canceled_at) VALUES(?,?,?,?)'
   ).run(storeId,bookingId,principal.subjectId,at);
   db.prepare(
    'INSERT INTO booking_commands(store_id,actor_subject_id,operation,idempotency_key,fingerprint,booking_id,created_at) VALUES(?,?,?,?,?,?,?)'
   ).run(storeId,principal.subjectId,'CANCEL',idempotencyKey,digest,bookingId,at);
   db.prepare(
    'INSERT INTO booking_audit_events(store_id,booking_id,action,actor_subject_id,actor_kind,occurred_at) VALUES(?,?,?,?,?,?)'
   ).run(storeId,bookingId,'BOOKING_CANCELLED',principal.subjectId,principal.kind,at);
   return Object.freeze({bookingId,status:'CANCELLED',replayed:false});
  });
 }
 function list(input={}){
  exactFields(input,['sessionHandle','storeId','serviceDate']);
  const {sessionHandle,storeId,serviceDate}=input;
  if(!dayValid(serviceDate))throw issue('INVALID_DATE');
  const principal=actor(sessionHandle,storeId);
  const query=
   'SELECT b.*,CASE WHEN c.booking_id IS NULL THEN 0 ELSE 1 END AS canceled FROM booking_records b LEFT JOIN booking_cancellations c ON c.store_id=b.store_id AND c.booking_id=b.booking_id WHERE b.store_id=? AND b.service_date=?'+
   (principal.kind==='customer'?' AND b.owner_subject_id=?':'')+
   ' ORDER BY b.start_minute,b.booking_id';
  const args=principal.kind==='customer'?[storeId,serviceDate,principal.subjectId]:[storeId,serviceDate];
  return db.prepare(query).all(...args).map(row=>Object.freeze({...row}));
 }
 function available(input={}){
  exactFields(input,['sessionHandle','storeId','serviceDate','menuId','staffId','bedId','startMinute']);
  const {sessionHandle,storeId,serviceDate,menuId,staffId,bedId,startMinute}=input;
  actor(sessionHandle,storeId);
  if(!dayValid(serviceDate))throw issue('INVALID_DATE');
  const model=toModel(configAt(storeId,serviceDate),activeRows(storeId,serviceDate));
  return Core.canBook(model,{menu:menuId,staff:staffId,bed:bedId,start:startMinute});
 }
 function audit(input={}){
  exactFields(input,['sessionHandle','storeId','bookingId']);
  const {sessionHandle,storeId,bookingId}=input;
  const principal=actor(sessionHandle,storeId);
  if(principal.kind!=='staff')throw issue('ROLE_FORBIDDEN');
  const params=[storeId];let query='SELECT * FROM booking_audit_events WHERE store_id=?';
  if(bookingId!==undefined){
   if(!identifier(bookingId))throw issue('INVALID_BOOKING_INPUT');
   query+=' AND booking_id=?';params.push(bookingId);
  }
  return db.prepare(query+' ORDER BY event_seq').all(...params).map(row=>Object.freeze({...row}));
 }
 return Object.freeze({
  reserve,cancel,list,available,audit,close:()=>db.close(),
  // Only used to create fictional test data and simulate audit failures.
  unsafeDbForTests:db
 });
}