// v0.61 fictional shared SQLite booking prototype regression tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {runInNewContext} from 'node:vm';
import {openLocalBookingPrototype} from '../server-design/v0.61-local-booking-store.mjs';

const source=readFileSync(new URL('../experiments/marketing-booking-mvp-a/core-v057.js',import.meta.url),'utf8');
const context={};
runInNewContext(source,{window:context});
const Core=context.DemoCore;
const config=()=>{
 const m=Core.initial();
 return {staff:m.staff,menus:m.menus,beds:m.beds,rooms:m.rooms,breaks:m.breaks};
};
const sessions={
 alice:{authenticated:true,kind:'customer',subjectId:'alice'},
 bob:{authenticated:true,kind:'customer',subjectId:'bob'},
 carol:{authenticated:true,kind:'customer',subjectId:'carol'},
 staffA:{authenticated:true,kind:'staff',subjectId:'managerA'},
 staffB:{authenticated:true,kind:'staff',subjectId:'managerB'},
 inactive:{authenticated:true,kind:'staff',subjectId:'inactiveA'}
};
function open(path=':memory:'){
 return openLocalBookingPrototype({
  path,resolveSession:name=>Object.hasOwn(sessions,name)?sessions[name]:null,
  clock:()=>new Date('2026-11-08T01:02:03.000Z')
 });
}
function seed(db){
 const insertStore=db.prepare('INSERT INTO stores(store_id) VALUES(?)');
 insertStore.run('A');insertStore.run('B');
 const addMember=db.prepare(
  'INSERT INTO staff_memberships(store_id,subject_id,role,active) VALUES(?,?,?,?)'
 );
 addMember.run('A','managerA','manager',1);
 addMember.run('B','managerB','owner',1);
 addMember.run('A','inactiveA','receptionist',0);
 const addDay=db.prepare(
  'INSERT INTO day_configurations(store_id,service_date,config_json) VALUES(?,?,?)'
 );
 const stored=JSON.stringify(config());
 addDay.run('A','2026-10-26',stored);
 addDay.run('B','2026-10-26',stored);
 addDay.run('A','2026-10-27',stored);
}
function fixture(path=':memory:'){
 const app=open(path);
 seed(app.unsafeDbForTests);
 const reserve=(options={})=>app.reserve({
  sessionHandle:'alice',storeId:'A',serviceDate:'2026-10-26',
  menuId:'m60',staffId:'s2',bedId:'b3',startMinute:540,
  idempotencyKey:'booking-key-001',discovery:'google',...options
 });
 const count=table=>app.unsafeDbForTests.prepare(
  'SELECT COUNT(*) AS n FROM '+table
 ).get().n;
 return {app,reserve,count};
}
function list(app,as='staffA',store='A',date='2026-10-26'){
 return app.list({sessionHandle:as,storeId:store,serviceDate:date});
}
function available(app,options={}){
 return app.available({sessionHandle:'alice',storeId:'A',
  serviceDate:'2026-10-26',menuId:'m60',staffId:'s2',
  bedId:'b3',startMinute:540,...options});
}

test('the original v0.57 booking rules are reused and foreign keys enabled',()=>{
 const {app,reserve}=fixture();
 assert.equal(Core.canBook(Core.initial(),{
  menu:'m60',staff:'s2',bed:'b3',start:540
 }).ok,true);
 assert.equal(app.unsafeDbForTests.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 assert.equal(reserve().status,'CONFIRMED');
 app.close();
});
test('idempotent retries return original booking without another row or audit',()=>{
 const {app,reserve,count}=fixture();
 const a=reserve(),b=reserve();
 assert.equal(a.bookingId,b.bookingId);
 assert.equal(b.replayed,true);
 assert.equal(count('booking_records'),1);
 assert.equal(count('booking_commands'),1);
 assert.equal(count('booking_audit_events'),1);
 assert.throws(()=>reserve({startMinute:555}),{code:'IDEMPOTENCY_CONFLICT'});
 app.close();
});
test('another customer trying identical resource/time is rejected',()=>{
 const {app,reserve,count}=fixture();
 reserve();
 assert.throws(()=>reserve({
  sessionHandle:'bob',idempotencyKey:'booking-key-002'
 }),{code:'SLOT_UNAVAILABLE'});
 assert.equal(count('booking_records'),1);
 app.close();
});
test('staff preparation, bed cleaning, private room and breaks block conflicts',()=>{
 const {app,reserve}=fixture();
 reserve(); // staff s2, private bed b3, 09:00 to 10:00 + prep 30, cleaning 20.
 assert.equal(available(app,{staffId:'s2',bedId:'b2',startMinute:600}).ok,false);
 assert.equal(available(app,{menuId:'m90',staffId:'s1',bedId:'b3',startMinute:600}).ok,false);
 assert.equal(available(app,{staffId:'s1',bedId:'b1',startMinute:660}).ok,false);
 assert.equal(available(app,{staffId:'s1',bedId:'b1',startMinute:540}).ok,true);
 app.close();
});
test('reservation availability is separated by date and by store',()=>{
 const {app,reserve}=fixture();
 reserve();
 assert.equal(reserve({
  sessionHandle:'bob',serviceDate:'2026-10-27',
  idempotencyKey:'booking-nextdate-001'
 }).status,'CONFIRMED');
 assert.equal(reserve({
  sessionHandle:'bob',storeId:'B',
  idempotencyKey:'booking-store-b-001'
 }).status,'CONFIRMED');
 assert.equal(list(app).length,1);
 assert.equal(list(app,'staffB','B').length,1);
 assert.equal(list(app,'staffA','A','2026-10-27').length,1);
 app.close();
});
test('customer sees only own rows and cannot cancel another customer reservation',()=>{
 const {app,reserve,count}=fixture();
 const first=reserve();
 const second=reserve({
  sessionHandle:'bob',staffId:'s1',bedId:'b1',startMinute:540,
  idempotencyKey:'booking-for-bob-001'
 });
 assert.equal(list(app,'alice').length,1);
 assert.equal(list(app,'bob').length,1);
 assert.equal(list(app).length,2);
 assert.throws(()=>app.cancel({
  sessionHandle:'alice',storeId:'A',bookingId:second.bookingId,
  idempotencyKey:'cancel-other-001'
 }),{code:'NOT_BOOKING_OWNER'});
 assert.equal(first.status,'CONFIRMED');
 assert.equal(count('booking_cancellations'),0);
 app.close();
});
test('staff access is scoped to own active membership, audit unavailable to customers',()=>{
 const {app,reserve}=fixture();
 const r=reserve();
 assert.throws(()=>list(app,'staffB','A'),{code:'STORE_ACCESS_DENIED'});
 assert.throws(()=>list(app,'inactive'),{code:'STORE_ACCESS_DENIED'});
 assert.throws(()=>list(app,'nobody'),{code:'UNAUTHENTICATED'});
 assert.throws(()=>app.audit({sessionHandle:'alice',storeId:'A'}),{code:'ROLE_FORBIDDEN'});
 assert.throws(()=>app.cancel({
  sessionHandle:'staffB',storeId:'A',bookingId:r.bookingId,
  idempotencyKey:'cancel-wrong-store-001'
 }),{code:'STORE_ACCESS_DENIED'});
 app.close();
});
test('cancel is append-only, idempotent, and frees a slot for another booking',()=>{
 const {app,reserve,count}=fixture();
 const original=reserve();
 const params={sessionHandle:'alice',storeId:'A',bookingId:original.bookingId,
  idempotencyKey:'cancel-booking-001'};
 assert.equal(app.cancel(params).status,'CANCELLED');
 assert.equal(app.cancel(params).replayed,true);
 assert.equal(count('booking_records'),1);
 assert.equal(count('booking_cancellations'),1);
 assert.equal(count('booking_audit_events'),2);
 assert.throws(()=>app.cancel({
  ...params,idempotencyKey:'cancel-different-001'
 }),{code:'ALREADY_CANCELLED'});
 assert.equal(reserve({
  sessionHandle:'bob',idempotencyKey:'booking-aftercancel-001'
 }).status,'CONFIRMED');
 assert.equal(count('booking_records'),2);
 assert.equal(list(app).filter(x=>x.canceled===1).length,1);
 app.close();
});
test('staff manual reservation records channel but customer cannot forge own source',()=>{
 const {app,reserve}=fixture();
 const customer=reserve({source:'hpb'});
 assert.equal(list(app).find(x=>x.booking_id===customer.bookingId).source,'website');
 const staff=reserve({sessionHandle:'staffA',staffId:'s1',bedId:'b1',
  startMinute:540,source:'phone',idempotencyKey:'booking-staff-001'});
 assert.equal(list(app).find(x=>x.booking_id===staff.bookingId).source,'phone');
 app.close();
});
test('invalid date, fields and resource IDs reject without persistent changes',()=>{
 const {app,reserve,count}=fixture();
 const cases=[
  {serviceDate:'2026-02-30'},
  {serviceDate:'2026-10-28'},
  {startMinute:541},
  {menuId:'missing'},
  {staffId:'missing'},
  {bedId:'missing'},
  {idempotencyKey:'short'},
  {discovery:'made-up'},
  {ownerSubjectId:'forged'},
  {sessionHandle:'missing'}
 ];
 for(const part of cases)assert.throws(()=>reserve(part));
 assert.equal(count('booking_records'),0);
 assert.equal(count('booking_audit_events'),0);
 app.close();
});
test('audit failure rolls back both a new booking and a cancellation',()=>{
 const {app,reserve,count}=fixture();
 const db=app.unsafeDbForTests;
 db.exec("CREATE TRIGGER booking_audit_down BEFORE INSERT ON booking_audit_events WHEN NEW.action='BOOKING_CONFIRMED' BEGIN SELECT RAISE(ABORT,'test audit down'); END;");
 assert.throws(()=>reserve(),/test audit down/);
 assert.equal(count('booking_records'),0);
 assert.equal(count('booking_commands'),0);
 db.exec('DROP TRIGGER booking_audit_down');
 const initial=reserve();
 db.exec("CREATE TRIGGER cancel_audit_down BEFORE INSERT ON booking_audit_events WHEN NEW.action='BOOKING_CANCELLED' BEGIN SELECT RAISE(ABORT,'test cancel audit down'); END;");
 const c={sessionHandle:'alice',storeId:'A',bookingId:initial.bookingId,
  idempotencyKey:'cancel-failure-001'};
 assert.throws(()=>app.cancel(c),/test cancel audit down/);
 assert.equal(count('booking_cancellations'),0);
 db.exec('DROP TRIGGER cancel_audit_down');
 assert.equal(app.cancel(c).status,'CANCELLED');
 app.close();
});
test('SQLite mutation guards preserve originals, cancellation events and audits',()=>{
 const {app,reserve}=fixture();
 const r=reserve(),db=app.unsafeDbForTests;
 app.cancel({sessionHandle:'alice',storeId:'A',bookingId:r.bookingId,
  idempotencyKey:'cancel-immutable-001'});
 const sql=[
  "UPDATE booking_records SET start_minute=600 WHERE store_id='A'",
  "DELETE FROM booking_records WHERE store_id='A'",
  "UPDATE booking_cancellations SET canceled_by_subject_id='bob' WHERE store_id='A'",
  "DELETE FROM booking_cancellations WHERE store_id='A'",
  "DELETE FROM booking_commands WHERE store_id='A'",
  "UPDATE booking_audit_events SET actor_subject_id='bob' WHERE store_id='A'"
 ];
 for(const statement of sql)assert.throws(()=>db.exec(statement),/immutable/);
 app.close();
});
test('a file-backed booking remains stored when the database is closed and reopened',()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-v061-save-'));
 try{
  const path=join(dir,'booking.sqlite');
  const a=open(path);seed(a.unsafeDbForTests);
  const booked=a.reserve({
   sessionHandle:'alice',storeId:'A',serviceDate:'2026-10-26',
   menuId:'m60',staffId:'s2',bedId:'b3',startMinute:540,
   idempotencyKey:'persist-booking-001',discovery:'unknown'
  });
  a.close();
  const b=open(path);
  assert.equal(list(b)[0].booking_id,booked.bookingId);
  assert.throws(()=>b.reserve({
   sessionHandle:'bob',storeId:'A',serviceDate:'2026-10-26',
   menuId:'m60',staffId:'s2',bedId:'b3',startMinute:540,
   idempotencyKey:'persist-booking-002',discovery:'unknown'
  }),{code:'SLOT_UNAVAILABLE'});
  b.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('two truly separate worker threads contending for one slot commit exactly one',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-v061-race-'));
 const path=join(dir,'booking.sqlite');
 try{
  const a=open(path);seed(a.unsafeDbForTests);a.close();
  const workerUrl=new URL('./helpers/booking-race-worker-v061.cjs',import.meta.url);
  const moduleUrl=new URL('../server-design/v0.61-local-booking-store.mjs',import.meta.url).href;
  const workers=['customer-a','customer-b'].map((subjectId,i)=>new Worker(workerUrl,{
   workerData:{subjectId,path,moduleUrl,key:'race-request-'+i}
  }));
  const ready=workers.map(w=>new Promise((resolve,reject)=>{
   const receive=msg=>{
    if(msg.type==='ready'){w.off('message',receive);resolve();}
    if(msg.type==='done'){w.off('message',receive);reject(new Error(msg.outcome));}
   };
   w.on('message',receive);w.once('error',reject);
  }));
  await Promise.all(ready);
  const completion=workers.map(w=>new Promise((resolve,reject)=>{
   const receive=msg=>{if(msg.type==='done'){w.off('message',receive);resolve(msg);}};
   w.on('message',receive);w.once('error',reject);
  }));
  workers.forEach(w=>w.postMessage('go'));
  const results=await Promise.all(completion);
  assert.deepEqual(results.map(x=>x.outcome).sort(),['SLOT_UNAVAILABLE','confirmed']);
  await Promise.all(workers.map(w=>w.terminate()));
  const verifier=open(path);
  assert.equal(list(verifier).length,1);
  assert.equal(verifier.audit({sessionHandle:'staffA',storeId:'A'}).length,1);
  verifier.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
