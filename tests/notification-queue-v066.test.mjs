// v0.66: Local-only delivery queue, durable leases and mock failure recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {openLocalBookingPrototype} from '../server-design/v0.63-local-booking-store.mjs';
import {openFictionalNotificationAddon} from '../server-design/v0.65-notification-addon.mjs';
import {openFictionalNotificationQueue} from '../server-design/v0.66-notification-queue.mjs';

const people={
 alice:{authenticated:true,kind:'customer',subjectId:'alice'},
 bob:{authenticated:true,kind:'customer',subjectId:'bob'},
 carol:{authenticated:true,kind:'customer',subjectId:'carol'},
 ownerA:{authenticated:true,kind:'staff',subjectId:'ownerA'},
 managerB:{authenticated:true,kind:'staff',subjectId:'managerB'},
 deskA:{authenticated:true,kind:'staff',subjectId:'deskA'}
};
const resolveSession=x=>Object.hasOwn(people,x)?people[x]:null;
const BASE='2026-10-25T08:00:00.000Z';
const nowRef=()=>({iso:BASE});
const clock=ref=>()=>new Date(ref.iso);
const iso=(ref,offset=0)=>new Date(Date.parse(ref.iso)+offset).toISOString();
function seed(db){
 const cfg={
  staff:[{id:'s1',name:'架空スタッフ1',prep:15,menus:['m60','m90']},
   {id:'s2',name:'架空スタッフ2',prep:30,menus:['m60']}],
  menus:[{id:'m60',duration:60,name:'架空60分',private:false,price:5000},
   {id:'m90',duration:90,name:'架空90分',private:true,price:9000}],
  rooms:[{id:'open',private:false},{id:'pr1',private:true}],
  beds:[{id:'b1',room:'open',clean:15},{id:'b2',room:'open',clean:15},
   {id:'b3',room:'pr1',clean:20}],
  breaks:{s1:{start:720,duration:60},s2:{start:750,duration:60}}
 };
 for(const store of ['A','B']){
  db.prepare('INSERT INTO stores(store_id) VALUES(?)').run(store);
  for(const day of ['2026-10-26','2026-10-27'])
   db.prepare('INSERT INTO day_configurations(store_id,service_date,config_json) VALUES(?,?,?)')
    .run(store,day,JSON.stringify(cfg));
 }
 for(const [store,actor,role] of [
  ['A','ownerA','owner'],['B','managerB','manager'],['A','deskA','receptionist']
 ])db.prepare('INSERT INTO staff_memberships(store_id,subject_id,role,active) VALUES(?,?,?,1)')
   .run(store,actor,role);
}
function open(path=':memory:',ref=nowRef(),limit=3,maxAttempts=3,leaseMillis=30000){
 const bookingStore=openLocalBookingPrototype({path,resolveSession,clock:clock(ref)});
 const db=bookingStore.unsafeDbForTests;
 const addon=openFictionalNotificationAddon({
  bookingStore,resolveSession,clock:clock(ref),fictionalTestOnly:true
 });
 const queue=openFictionalNotificationQueue({
  bookingStore,resolveSession,clock:clock(ref),fictionalTestOnly:true,
  maxSimulatedPerStoreDay:limit,maxAttempts,leaseMillis
 });
 return {bookingStore,db,addon,queue,ref};
}
function fixture(opts={}){
 const ref=opts.ref||nowRef();
 const bookingStore=openLocalBookingPrototype({
  path:opts.path||':memory:',resolveSession,clock:clock(ref)
 });
 const db=bookingStore.unsafeDbForTests;
 seed(db);
 const addon=openFictionalNotificationAddon({
  bookingStore,resolveSession,clock:clock(ref),fictionalTestOnly:true
 });
 const queue=openFictionalNotificationQueue({
  bookingStore,resolveSession,clock:clock(ref),fictionalTestOnly:true,
  maxSimulatedPerStoreDay:opts.limit||3,
  maxAttempts:opts.maxAttempts||3,
  leaseMillis:opts.leaseMillis||30000
 });
 return {bookingStore,db,addon,queue,ref};
}
const count=(f,t)=>f.db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n;
const rejected=(fn,code)=>assert.throws(fn,{code});
function reserve(f,person='alice',start=540,rest={}){
 return f.bookingStore.reserve({
  sessionHandle:person,storeId:'A',serviceDate:'2026-10-26',
  menuId:'m60',staffId:'s2',bedId:'b3',startMinute:start,
  idempotencyKey:'booking-'+person+'-'+start+'-v66',discovery:'unknown',...rest
 });
}
function prepReminder(f,person='alice',rest={}){
 const booking=reserve(f,person,rest.start||540,rest.bookingOptions||{});
 f.addon.consent({sessionHandle:person,storeId:'A',purpose:'reminder',allowed:true});
 const d=f.addon.createDraft({
  sessionHandle:'ownerA',storeId:'A',customerId:person,
  purpose:'reminder',bookingId:booking.bookingId,
  idempotencyKey:'draft-'+person+'-reminder-'+(rest.start||540)+'-v66'
 });
 f.addon.approve({sessionHandle:'ownerA',storeId:'A',draftId:d.draftId});
 return {booking,draftId:d.draftId};
}
function enqueue(f,id,options={}){
 return f.queue.enqueue({
  sessionHandle:'ownerA',storeId:'A',draftId:id,
  runAt:iso(f.ref),expiresAt:iso(f.ref,3600000),...options
 });
}
function claim(f,worker='worker-A'){return f.queue.claim({
 sessionHandle:'ownerA',storeId:'A',workerId:worker
});}
function complete(f,id,lease,worker='worker-A',outcome='SIMULATE_SUCCESS'){
 return f.queue.complete({
  sessionHandle:'ownerA',storeId:'A',draftId:id,
  workerId:worker,leaseToken:lease.leaseToken,outcome
 });
}
function changeTime(f,ms){f.ref.iso=iso(f.ref,ms);}
function history(f){return f.queue.audit({sessionHandle:'ownerA',storeId:'A'});}
function list(f){return f.queue.list({sessionHandle:'ownerA',storeId:'A'});}

test('v0.66 requires explicit offline-only mode and existing v0.65 tables',()=>{
 const f=fixture();
 rejected(()=>openFictionalNotificationQueue({bookingStore:f.bookingStore,resolveSession}),
  'FICTIONAL_TEST_MODE_REQUIRED');
 assert.equal(typeof f.queue.send,'undefined');
 assert.equal(typeof f.queue.connectLINE,'undefined');
 assert.equal(typeof f.queue.http,'undefined');
 assert.equal(count(f,'notification_queue_jobs'),0);
 f.bookingStore.close();
});
test('approved notification can enqueue, claim and mark a single mock event',()=>{
 const f=fixture(),d=prepReminder(f);
 assert.equal(enqueue(f,d.draftId).status,'WAITING');
 assert.equal(claim(f,'worker-A').attempt,1);
 const lease=list(f)[0];
 assert.equal(lease.state,'CLAIMED');
 const token=history(f).find(x=>x.action==='CLAIMED');
 assert.ok(token);
 const claimData=claim(f,'worker-B');
 assert.equal(claimData,null);
 const row=f.db.prepare('SELECT lease_token FROM notification_queue_jobs').get();
 const done=f.queue.complete({
  sessionHandle:'ownerA',storeId:'A',draftId:d.draftId,workerId:'worker-A',
  leaseToken:row.lease_token,outcome:'SIMULATE_SUCCESS'
 });
 assert.equal(done.status,'SIMULATED');
 assert.equal(done.realMessagesSent,0);
 assert.equal(list(f)[0].state,'SIMULATED');
 assert.equal(count(f,'notification_events'),3);
 assert.equal(count(f,'notification_queue_events'),3);
 f.bookingStore.close();
});
test('repeated enqueue is idempotent only for unchanged scheduled interval',()=>{
 const f=fixture(),d=prepReminder(f);
 const one=enqueue(f,d.draftId);
 const again=enqueue(f,d.draftId);
 assert.equal(one.replayed,false);assert.equal(again.replayed,true);
 rejected(()=>enqueue(f,d.draftId,{expiresAt:iso(f.ref,7200000)}),'QUEUE_CONFLICT');
 assert.equal(count(f,'notification_queue_jobs'),1);
 f.bookingStore.close();
});
test('cannot enqueue until fictional owner has approved draft',()=>{
 const f=fixture();
 const b=reserve(f);
 f.addon.consent({sessionHandle:'alice',storeId:'A',purpose:'reminder',allowed:true});
 const d=f.addon.createDraft({
  sessionHandle:'ownerA',storeId:'A',customerId:'alice',
  purpose:'reminder',bookingId:b.bookingId,idempotencyKey:'draft-not-approved-v66'
 });
 rejected(()=>enqueue(f,d.draftId),'NOT_APPROVED');
 assert.equal(count(f,'notification_queue_jobs'),0);
 f.bookingStore.close();
});
test('claim waits until runAt and respects job expiry',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId,{runAt:iso(f.ref,600000),expiresAt:iso(f.ref,1200000)});
 assert.equal(claim(f),null);
 changeTime(f,600000);
 assert.ok(claim(f));
 f.bookingStore.close();
});
test('completed mock dispatch cannot be retried as an actual second delivery',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 const a=complete(f,d.draftId,lease);
 assert.equal(a.status,'SIMULATED');
 const b=complete(f,d.draftId,lease);
 assert.equal(b.replayed,true);
 assert.equal(count(f,'notification_events'),3);
 assert.equal(count(f,'notification_queue_events'),3);
 f.bookingStore.close();
});
test('mock failure retries with backoff and a later successful simulated-only completion',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f,'worker-A');
 const failed=complete(f,d.draftId,lease,'worker-A','SIMULATE_FAILURE');
 assert.equal(failed.status,'RETRY');
 assert.equal(failed.runAt,iso(f.ref,60000));
 assert.equal(claim(f),null);
 changeTime(f,60000);
 const retry=claim(f,'worker-B');
 assert.equal(retry.attempt,2);
 assert.equal(complete(f,d.draftId,retry,'worker-B').status,'SIMULATED');
 assert.equal(count(f,'notification_events'),3);
 assert.equal(history(f).filter(x=>x.action==='CLAIMED').length,2);
 f.bookingStore.close();
});
test('repeated mock failures end in DEAD at max attempts without a simulated send',()=>{
 const f=fixture({maxAttempts:2}),d=prepReminder(f);
 enqueue(f,d.draftId);
 const a=claim(f);
 assert.equal(complete(f,d.draftId,a,'worker-A','SIMULATE_FAILURE').status,'RETRY');
 changeTime(f,60000);
 const b=claim(f);
 assert.equal(complete(f,d.draftId,b,'worker-A','SIMULATE_FAILURE').status,'DEAD');
 assert.equal(list(f)[0].state,'DEAD');
 assert.equal(claim(f),null);
 assert.equal(count(f,'notification_events'),2);
 assert.equal(count(f,'notification_queue_events'),5);
 f.bookingStore.close();
});
test('expired lease can be reclaimed after restart; stale worker token is rejected',()=>{
 const f=fixture({leaseMillis:5000}),d=prepReminder(f);
 enqueue(f,d.draftId);
 const old=claim(f,'old-worker');
 changeTime(f,5000);
 const recovered=claim(f,'new-worker');
 assert.equal(recovered.attempt,2);
 rejected(()=>complete(f,d.draftId,old,'old-worker'),'STALE_LEASE');
 assert.equal(complete(f,d.draftId,recovered,'new-worker').status,'SIMULATED');
 assert.equal(count(f,'notification_events'),3);
 f.bookingStore.close();
});
test('current worker cannot complete after lease expiry without reclaiming',()=>{
 const f=fixture({leaseMillis:1000}),d=prepReminder(f);
 enqueue(f,d.draftId);
 const old=claim(f);
 changeTime(f,1000);
 rejected(()=>complete(f,d.draftId,old),'LEASE_EXPIRED');
 assert.equal(list(f)[0].state,'CLAIMED');
 f.bookingStore.close();
});
test('consent withdrawal after queueing suppresses job; no simulated delivery',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 f.addon.consent({
  sessionHandle:'alice',storeId:'A',purpose:'reminder',allowed:false
 });
 const response=f.queue.reconcile({sessionHandle:'ownerA',storeId:'A'});
 assert.equal(response.changed,1);
 assert.equal(list(f)[0].state,'SUPPRESSED');
 assert.equal(count(f,'notification_events'),3);
 assert.equal(f.queue.claim({sessionHandle:'ownerA',storeId:'A',workerId:'a'}),null);
 f.bookingStore.close();
});
test('if customer revokes consent after claim but before complete, job is suppressed',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 f.addon.consent({
  sessionHandle:'alice',storeId:'A',purpose:'reminder',allowed:false
 });
 const result=complete(f,d.draftId,lease);
 assert.equal(result.status,'SUPPRESSED');
 assert.equal(list(f)[0].state,'SUPPRESSED');
 assert.equal(count(f,'notification_events'),3);
 f.bookingStore.close();
});
test('booking cancellation invalidates queued reminder on reconciliation',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 f.bookingStore.cancel({
  sessionHandle:'alice',storeId:'A',bookingId:d.booking.bookingId,
  idempotencyKey:'cancel-after-queue-v66'
 });
 assert.equal(f.queue.reconcile({sessionHandle:'ownerA',storeId:'A'}).changed,1);
 assert.equal(list(f)[0].state,'SUPPRESSED');
 assert.equal(count(f,'notification_events'),2);
 f.bookingStore.close();
});
test('booking move invalidates old reminder even if its queue lease was claimed',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 f.bookingStore.move({
  sessionHandle:'alice',storeId:'A',bookingId:d.booking.bookingId,
  serviceDate:'2026-10-26',menuId:'m60',staffId:'s2',bedId:'b3',
  startMinute:960,idempotencyKey:'move-old-reminder-v66'
 });
 assert.equal(complete(f,d.draftId,lease).status,'SUPPRESSED');
 assert.equal(list(f)[0].state,'SUPPRESSED');
 f.bookingStore.close();
});
test('daily mock quota rejects subsequent simulated notification with a DEAD reason',()=>{
 const f=fixture({limit:1});
 const a=prepReminder(f,'alice');
 const b=prepReminder(f,'bob',{start:540,bookingOptions:{
  staffId:'s1',bedId:'b1',idempotencyKey:'bob-second-resource-v66'
 }});
 enqueue(f,a.draftId);enqueue(f,b.draftId);
 const first=claim(f);
 const result=complete(f,first.draftId,first);
 assert.equal(result.status,'SIMULATED');
 const second=claim(f,'worker-B');
 const out=complete(f,second.draftId,second,'worker-B');
 assert.equal(out.status,'DEAD');
 assert.equal(out.reason,'FICTIONAL_DAILY_LIMIT');
 assert.equal(count(f,'notification_events'),5);
 f.bookingStore.close();
});
test('reconcile marks an overdue job DEAD and never produces an external message',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId,{runAt:iso(f.ref),expiresAt:iso(f.ref,10000)});
 changeTime(f,10001);
 assert.equal(f.queue.reconcile({sessionHandle:'ownerA',storeId:'A'}).changed,1);
 assert.equal(list(f)[0].state,'DEAD');
 assert.equal(count(f,'notification_events'),2);
 f.bookingStore.close();
});
test('owner and manager allowed in own store, foreign staff and receptionist forbidden',()=>{
 const f=fixture(),d=prepReminder(f);
 rejected(()=>f.queue.enqueue({
  sessionHandle:'deskA',storeId:'A',draftId:d.draftId,
  runAt:iso(f.ref),expiresAt:iso(f.ref,3600000)
 }),'OWNER_PERMISSION_REQUIRED');
 rejected(()=>f.queue.list({sessionHandle:'managerB',storeId:'A'}),
  'OWNER_PERMISSION_REQUIRED');
 rejected(()=>f.queue.claim({
  sessionHandle:'alice',storeId:'A',workerId:'evil'
 }),'STAFF_SESSION_REQUIRED');
 enqueue(f,d.draftId);
 assert.equal(f.queue.list({sessionHandle:'managerB',storeId:'B'}).length,0);
 f.bookingStore.close();
});
test('atomic queue rollback on audit insertion failure leaves no enqueued jobs',()=>{
 const f=fixture(),d=prepReminder(f);
 f.db.exec("CREATE TRIGGER test_queue_event_failure BEFORE INSERT ON notification_queue_events BEGIN SELECT RAISE(ABORT,'fake queue audit down'); END;");
 assert.throws(()=>enqueue(f,d.draftId),/fake queue audit down/);
 assert.equal(count(f,'notification_queue_jobs'),0);
 f.db.exec('DROP TRIGGER test_queue_event_failure');
 assert.equal(enqueue(f,d.draftId).status,'WAITING');
 f.bookingStore.close();
});
test('failed success-audit insertion rolls back simulated delivery and preserves the lease',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);const lease=claim(f);
 f.db.exec("CREATE TRIGGER test_complete_audit_failure BEFORE INSERT ON notification_queue_events WHEN NEW.action='SIMULATED_ONLY' BEGIN SELECT RAISE(ABORT,'fake completion audit failure'); END;");
 assert.throws(()=>complete(f,d.draftId,lease),/fake completion audit failure/);
 assert.equal(list(f)[0].state,'CLAIMED');
 assert.equal(count(f,'notification_events'),2);
 f.db.exec('DROP TRIGGER test_complete_audit_failure');
 assert.equal(complete(f,d.draftId,lease).status,'SIMULATED');
 assert.equal(count(f,'notification_events'),3);
 f.bookingStore.close();
});
test('job state and events survive reopening a shared SQLite DB file',()=>{
 const folder=mkdtempSync(join(tmpdir(),'salon-v066-'));
 try{
  const path=join(folder,'queue.sqlite'),first=fixture({path});
  const d=prepReminder(first);
  enqueue(first,d.draftId);
  first.bookingStore.close();
  const second=open(path,nowRef());
  assert.equal(second.queue.list({sessionHandle:'ownerA',storeId:'A'})[0].state,'WAITING');
  const lease=claim(second);
  assert.equal(complete(second,d.draftId,lease).status,'SIMULATED');
  second.bookingStore.close();
  const third=open(path,nowRef());
  assert.equal(third.queue.list({sessionHandle:'ownerA',storeId:'A'})[0].state,'SIMULATED');
  assert.equal(third.db.prepare("SELECT COUNT(*) AS n FROM notification_events WHERE action='SIMULATED_ONLY'").get().n,1);
  third.bookingStore.close();
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('queue event history cannot be silently edited or deleted',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 assert.throws(()=>f.db.exec('DELETE FROM notification_queue_events'),/queue event immutable/);
 assert.throws(()=>f.db.exec("UPDATE notification_queue_events SET action='DEAD'"),/queue event immutable/);
 f.bookingStore.close();
});
test('invalid schedule, worker token and input fields reject without writes',()=>{
 const f=fixture(),d=prepReminder(f);
 rejected(()=>enqueue(f,d.draftId,{expiresAt:iso(f.ref,-1000)}),'INVALID_SCHEDULE');
 rejected(()=>enqueue(f,d.draftId,{runAt:'2026-99-99T08:00:00.000Z'}),'INVALID_TIMESTAMP');
 rejected(()=>f.queue.enqueue({
  sessionHandle:'ownerA',storeId:'A',draftId:d.draftId,
  runAt:iso(f.ref),expiresAt:iso(f.ref,3600000),ownerSubjectId:'alice'
 }),'INVALID_FIELDS');
 rejected(()=>f.queue.claim({
  sessionHandle:'ownerA',storeId:'A',workerId:'?'
 }),'INVALID_WORKER');
 assert.equal(count(f,'notification_queue_jobs'),0);
 f.bookingStore.close();
});

test('two independent SQLite worker connections cannot claim the same queue job',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'salon-v066-race-'));
 const workers=[];
 try{
  const path=join(folder,'queue.sqlite');
  const f=fixture({path});
  const d=prepReminder(f);enqueue(f,d.draftId);
  f.bookingStore.close();
  const url=new URL('./helpers/notification-queue-race-worker-v066.cjs',import.meta.url);
  const bookingUrl=new URL('../server-design/v0.63-local-booking-store.mjs',import.meta.url).href;
  const addonUrl=new URL('../server-design/v0.65-notification-addon.mjs',import.meta.url).href;
  const queueUrl=new URL('../server-design/v0.66-notification-queue.mjs',import.meta.url).href;
  for(const name of ['queue-worker-A','queue-worker-B'])
   workers.push(new Worker(url,{workerData:{
    dbPath:path,bookingUrl,addonUrl,queueUrl,workerId:name
   }}));
  await Promise.all(workers.map(w=>new Promise((resolve,reject)=>{
   const onMsg=msg=>{
    if(msg.type==='ready'){w.off('message',onMsg);resolve();}
    if(msg.type==='done'){w.off('message',onMsg);reject(new Error(msg.code||msg.status));}
   };
   w.on('message',onMsg);w.once('error',reject);
  })));
  const outcomes=workers.map(w=>new Promise((resolve,reject)=>{
   const onMsg=msg=>{
    if(msg.type==='done'){w.off('message',onMsg);resolve(msg);}
   };
   w.on('message',onMsg);w.once('error',reject);
  }));
  workers.forEach(w=>w.postMessage('go'));
  const res=await Promise.all(outcomes);
  assert.deepEqual(res.map(x=>x.status).sort(),['CLAIMED','NONE']);
  assert.ok(res.find(x=>x.status==='CLAIMED').draftId===d.draftId);
  const reopened=open(path);
  assert.equal(reopened.queue.list({sessionHandle:'ownerA',storeId:'A'})[0].state,'CLAIMED');
  assert.equal(reopened.queue.audit({sessionHandle:'ownerA',storeId:'A'}).filter(x=>x.action==='CLAIMED').length,1);
  reopened.bookingStore.close();
 }finally{
  await Promise.all(workers.map(w=>w.terminate()));
  rmSync(folder,{recursive:true,force:true});
 }
});
test('lease claimed before process crash can be reclaimed after file reopen and timeout',()=>{
 const folder=mkdtempSync(join(tmpdir(),'salon-v066-restart-'));
 try{
  const path=join(folder,'queue.sqlite');
  const f=fixture({path,leaseMillis:1000});
  const d=prepReminder(f);enqueue(f,d.draftId);
  const old=claim(f,'crashed-worker');
  assert.equal(old.attempt,1);
  f.bookingStore.close();
  const ref={iso:'2026-10-25T08:00:01.000Z'};
  const reopened=open(path,ref,3,3,1000);
  const retry=claim(reopened,'recovered-worker');
  assert.equal(retry.attempt,2);
  rejected(()=>complete(reopened,d.draftId,old,'crashed-worker'),'STALE_LEASE');
  assert.equal(complete(reopened,d.draftId,retry,'recovered-worker').status,'SIMULATED');
  assert.equal(count(reopened,'notification_events'),3);
  assert.equal(reopened.queue.audit({sessionHandle:'ownerA',storeId:'A'}).filter(x=>x.action==='CLAIMED').length,2);
  reopened.bookingStore.close();
 }finally{rmSync(folder,{recursive:true,force:true});}
});
