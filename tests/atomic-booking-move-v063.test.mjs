// v0.63 isolated, fictional atomic booking relocation tests (no real client data).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Worker} from 'node:worker_threads';
import {openLocalBookingPrototype} from '../server-design/v0.63-local-booking-store.mjs';

const source=readFileSync(new URL('../experiments/marketing-booking-mvp-a/core-v057.js',import.meta.url),'utf8');
const window={};runInNewContext(source,{window});
const Core=window.DemoCore;
const sessions={
 alice:{authenticated:true,kind:'customer',subjectId:'alice'},
 bob:{authenticated:true,kind:'customer',subjectId:'bob'},
 staffA:{authenticated:true,kind:'staff',subjectId:'managerA'},
 staffB:{authenticated:true,kind:'staff',subjectId:'managerB'}
};
const open=path=>openLocalBookingPrototype({
 path:path||':memory:',
 resolveSession:handle=>Object.hasOwn(sessions,handle)?sessions[handle]:null,
 clock:()=>new Date('2026-11-09T12:30:00.000Z')
});
const initialStore=app=>{
 const db=app.unsafeDbForTests,initial=Core.initial();
 const config=JSON.stringify({
  staff:initial.staff,menus:initial.menus,
  beds:initial.beds,rooms:initial.rooms,breaks:initial.breaks
 });
 for(const id of ['A','B'])
  db.prepare('INSERT INTO stores(store_id) VALUES(?)').run(id);
 for(const [store,id,role] of [
  ['A','managerA','manager'],['B','managerB','owner']
 ])db.prepare('INSERT INTO staff_memberships(store_id,subject_id,role,active) VALUES(?,?,?,1)')
  .run(store,id,role);
 for(const store of ['A','B'])
  for(const day of ['2026-10-26','2026-10-27'])
   db.prepare('INSERT INTO day_configurations(store_id,service_date,config_json) VALUES(?,?,?)')
    .run(store,day,config);
};
function fixture(path){
 const app=open(path);initialStore(app);
 const reserve=(o={})=>app.reserve({
  sessionHandle:'alice',storeId:'A',serviceDate:'2026-10-26',menuId:'m60',
  staffId:'s2',bedId:'b3',startMinute:540,idempotencyKey:'new-booking-001',
  source:'hpb',discovery:'google',...o
 });
 const move=(bookingId,o={})=>app.move({
  sessionHandle:'alice',storeId:'A',bookingId,serviceDate:'2026-10-26',
  menuId:'m60',staffId:'s2',bedId:'b3',startMinute:630,
  idempotencyKey:'move-booking-001',...o
 });
 const rows=(date='2026-10-26',handle='staffA')=>app.list({
  sessionHandle:handle,storeId:'A',serviceDate:date
 });
 const count=t=>app.unsafeDbForTests.prepare(
  'SELECT COUNT(*) n FROM '+t
 ).get().n;
 return {app,reserve,move,rows,count,db:app.unsafeDbForTests};
}
test('same-day move atomically preserves old record and links new record',()=>{
 const f=fixture(),old=f.reserve({source:'hpb'}),result=f.move(old.bookingId);
 assert.equal(result.status,'MOVED');assert.equal(result.replayed,false);
 assert.notEqual(result.bookingId,old.bookingId);
 assert.equal(f.count('booking_records'),2);
 assert.equal(f.count('booking_cancellations'),1);
 assert.equal(f.count('booking_moves'),1);
 const rows=f.rows();
 const from=rows.find(x=>x.booking_id===old.bookingId);
 const to=rows.find(x=>x.booking_id===result.bookingId);
 assert.equal(from.canceled,1);assert.equal(from.cancellation_reason,'MOVE');
 assert.equal(from.moved_to_booking_id,result.bookingId);
 assert.equal(to.canceled,0);assert.equal(to.start_minute,630);
 assert.equal(to.owner_subject_id,from.owner_subject_id);
 assert.equal(to.source,from.source);
 assert.equal(to.discovery,from.discovery);
 assert.equal(f.count('booking_commands'),2);
 const audit=f.app.audit({sessionHandle:'staffA',storeId:'A'});
 assert.deepEqual(audit.map(x=>x.action),[
  'BOOKING_CONFIRMED','BOOKING_MOVED_FROM','BOOKING_MOVED_TO'
 ]);
 assert.ok(audit[0].event_seq<audit[1].event_seq);
 assert.ok(audit[1].event_seq<audit[2].event_seq);
 f.app.close();
});
test('cross-day move releases old day and books new day without duplication',()=>{
 const f=fixture(),old=f.reserve();
 const result=f.move(old.bookingId,{serviceDate:'2026-10-27'});
 assert.equal(result.serviceDate,'2026-10-27');
 assert.equal(f.rows('2026-10-26').filter(x=>!x.canceled).length,0);
 assert.equal(f.rows('2026-10-27').filter(x=>!x.canceled).length,1);
 assert.equal(f.app.available({sessionHandle:'bob',storeId:'A',serviceDate:'2026-10-26',
  menuId:'m60',staffId:'s2',bedId:'b3',startMinute:540}).ok,true);
 f.app.close();
});
test('occupied target refuses move and old reservation remains active',()=>{
 const f=fixture(),old=f.reserve();
 f.reserve({sessionHandle:'bob',staffId:'s1',bedId:'b1',startMinute:630,
  idempotencyKey:'new-bob-001'});
 assert.throws(()=>f.move(old.bookingId,{
  staffId:'s1',bedId:'b1'
 }),{code:'SLOT_UNAVAILABLE'});
 const source=f.rows().find(x=>x.booking_id===old.bookingId);
 assert.equal(source.canceled,0);assert.equal(f.count('booking_moves'),0);
 assert.equal(f.count('booking_cancellations'),0);
 assert.equal(f.count('booking_audit_events'),2);
 f.app.close();
});
test('unknown target date refuses relocation without canceling old booking',()=>{
 const f=fixture(),old=f.reserve();
 assert.throws(()=>f.move(old.bookingId,{
  serviceDate:'2026-10-28'
 }),{code:'DATE_NOT_CONFIGURED'});
 assert.equal(f.rows()[0].canceled,0);
 assert.equal(f.count('booking_cancellations'),0);
 f.app.close();
});
test('customer cannot change another customer reservation, while own-store staff can',()=>{
 const f=fixture(),old=f.reserve();
 assert.throws(()=>f.move(old.bookingId,{
  sessionHandle:'bob'
 }),{code:'NOT_BOOKING_OWNER'});
 assert.throws(()=>f.move(old.bookingId,{
  sessionHandle:'staffB'
 }),{code:'STORE_ACCESS_DENIED'});
 const moved=f.move(old.bookingId,{
  sessionHandle:'staffA'
 });
 assert.equal(moved.status,'MOVED');
 assert.equal(f.rows()[1].owner_subject_id,'alice');
 f.app.close();
});
test('move retry preserves ID and rejects the same key used for altered content',()=>{
 const f=fixture(),old=f.reserve(),first=f.move(old.bookingId);
 const again=f.move(old.bookingId);
 assert.equal(again.replayed,true);
 assert.equal(again.bookingId,first.bookingId);
 assert.equal(f.count('booking_moves'),1);
 assert.throws(()=>f.move(old.bookingId,{startMinute:645}),{
  code:'IDEMPOTENCY_CONFLICT'
 });
 assert.equal(f.count('booking_records'),2);
 f.app.close();
});
test('stale moved, canceled, or unchanged source cannot be moved again',()=>{
 const f=fixture(),old=f.reserve();
 assert.throws(()=>f.move(old.bookingId,{startMinute:540}),{
  code:'MOVE_TARGET_UNCHANGED'
 });
 const first=f.move(old.bookingId);
 assert.throws(()=>f.move(old.bookingId,{
  idempotencyKey:'new-move-key-002'
 }),{code:'ALREADY_CANCELLED'});
 assert.equal(f.app.cancel({sessionHandle:'alice',storeId:'A',
  bookingId:first.bookingId,idempotencyKey:'cancel-moved-001'}).status,'CANCELLED');
 assert.throws(()=>f.move(first.bookingId,{
  idempotencyKey:'move-canceled-003'
 }),{code:'ALREADY_CANCELLED'});
 f.app.close();
});
test('a chain of reschedules retains both immutable predecessor links',()=>{
 const f=fixture(),old=f.reserve(),first=f.move(old.bookingId);
 const second=f.move(first.bookingId,{
  serviceDate:'2026-10-27',startMinute:600,
  idempotencyKey:'next-move-key-002'
 });
 assert.equal(second.status,'MOVED');
 assert.equal(f.count('booking_moves'),2);
 assert.equal(f.count('booking_cancellations'),2);
 assert.equal(f.rows('2026-10-27').filter(x=>!x.canceled).length,1);
 const hist=f.app.audit({sessionHandle:'staffA',storeId:'A'});
 assert.equal(hist.length,5);
 f.app.close();
});
test('audit insertion failure rolls back cancellation/new booking/move/command',()=>{
 const f=fixture(),old=f.reserve(),db=f.db;
 db.exec("CREATE TRIGGER simulated_audit_failure BEFORE INSERT ON booking_audit_events WHEN NEW.action='BOOKING_MOVED_TO' BEGIN SELECT RAISE(ABORT,'mock move audit error'); END;");
 assert.throws(()=>f.move(old.bookingId),/mock move audit error/);
 assert.equal(f.count('booking_cancellations'),0);
 assert.equal(f.count('booking_moves'),0);
 assert.equal(f.count('booking_records'),1);
 assert.equal(f.count('booking_commands'),1);
 assert.equal(f.count('booking_audit_events'),1);
 assert.equal(f.rows()[0].canceled,0);
 db.exec('DROP TRIGGER simulated_audit_failure');
 assert.equal(f.move(old.bookingId).status,'MOVED');
 f.app.close();
});
test('SQL guards prevent changing or deleting move lineage',()=>{
 const f=fixture(),old=f.reserve();f.move(old.bookingId);
 assert.throws(()=>f.db.exec("DELETE FROM booking_moves WHERE store_id='A'"),/immutable/);
 assert.throws(()=>f.db.exec("UPDATE booking_moves SET moved_by_subject_id='bob'"),/immutable/);
 f.app.close();
});
test('move and links persist across database close and open',()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-v063-'));
 try{
  const path=join(dir,'appointments.sqlite'),f=fixture(path);
  const old=f.reserve(),moved=f.move(old.bookingId,{serviceDate:'2026-10-27'});
  f.app.close();
  const reopened=open(path);
  const row=reopened.list({sessionHandle:'staffA',storeId:'A',serviceDate:'2026-10-27'});
  assert.equal(row[0].booking_id,moved.bookingId);
  const history=reopened.list({sessionHandle:'staffA',storeId:'A',serviceDate:'2026-10-26'});
  assert.equal(history[0].moved_to_booking_id,moved.bookingId);
  reopened.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('v0.63 rejects older v0.61 SQLite schema without a migration',async()=>{
 const {openLocalBookingPrototype:oldOpen}=await import(
  '../server-design/v0.61-local-booking-store.mjs'
 );
 const dir=mkdtempSync(join(tmpdir(),'salon-v063-old-'));
 try{
  const path=join(dir,'old.sqlite');
  const old=oldOpen({path,resolveSession:()=>null});old.close();
  assert.throws(()=>open(path),{code:'SCHEMA_MISMATCH_V063'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('two independent worker threads moving different bookings to one target succeed exactly once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-v063-race-'));
 const path=join(dir,'move.sqlite');
 const workers=[];
 try{
  const f=fixture(path);
  const fromA=f.reserve();
  const fromB=f.reserve({
   sessionHandle:'bob',staffId:'s1',bedId:'b1',startMinute:540,
   idempotencyKey:'book-bob-for-move-1'
  });
  f.app.close();
  const file=new URL('./helpers/booking-move-race-worker-v063.cjs',import.meta.url);
  const moduleUrl=new URL('../server-design/v0.63-local-booking-store.mjs',import.meta.url).href;
  for(const [index,bookingId] of [fromA.bookingId,fromB.bookingId].entries()){
   workers.push(new Worker(file,{workerData:{
    path,moduleUrl,bookingId,key:'simultaneous-move-key-'+index
   }}));
  }
  const ready=workers.map(w=>new Promise((resolve,reject)=>{
   const listener=msg=>{
    if(msg.type==='ready'){w.off('message',listener);resolve();}
    if(msg.type==='done'){w.off('message',listener);reject(new Error(msg.outcome));}
   };
   w.on('message',listener);
   w.once('error',reject);
  }));
  await Promise.all(ready);
  const done=workers.map(w=>new Promise((resolve,reject)=>{
   const listener=msg=>{
    if(msg.type==='done'){w.off('message',listener);resolve(msg);}
   };
   w.on('message',listener);w.once('error',reject);
  }));
  workers.forEach(w=>w.postMessage('go'));
  const outcomes=await Promise.all(done);
  assert.deepEqual(outcomes.map(x=>x.outcome).sort(),['SLOT_UNAVAILABLE','moved']);
  const reopened=open(path);
  const rows=reopened.list({
   sessionHandle:'staffA',storeId:'A',serviceDate:'2026-10-26'
  });
  assert.equal(rows.length,3);
  assert.equal(rows.filter(x=>x.canceled===1).length,1);
  assert.equal(rows.filter(x=>x.canceled===0).length,2);
  assert.equal(rows.filter(x=>x.start_minute===630&&x.canceled===0).length,1);
  const d=reopened.unsafeDbForTests;
  assert.equal(d.prepare('SELECT COUNT(*) n FROM booking_moves').get().n,1);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM booking_audit_events').get().n,4);
  reopened.close();
 }finally{
  await Promise.all(workers.map(w=>w.terminate()));
  rmSync(dir,{recursive:true,force:true});
 }
});
