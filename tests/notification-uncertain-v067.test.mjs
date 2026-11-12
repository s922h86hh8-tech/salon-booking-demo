// v0.67: Unknown outcome barrier on the local-only delivery queue, durable leases and mock failure recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {openLocalBookingPrototype} from '../server-design/v0.63-local-booking-store.mjs';
import {openFictionalNotificationAddon} from '../server-design/v0.65-notification-addon.mjs';
import {openFictionalNotificationQueue} from '../server-design/v0.67-notification-queue.mjs';

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
const fromUnknown=(f,info,finding,retryApproved)=>{
 return f.queue.resolveUncertain({
  sessionHandle:'ownerA',storeId:'A',draftId:info.draftId,
  handoffId:info.handoffId,finding,...(retryApproved===undefined?{}:{retryApproved})
 });
};
const begin=(f,id,lease,workerId='worker-A')=>f.queue.beginUncertainHandoff({
 sessionHandle:'ownerA',storeId:'A',draftId:id,
 workerId,leaseToken:lease.leaseToken
});
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


test('v0.67 explicitly requires fictional mode and adds outcome-specific storage',()=>{
 const f=fixture();
 rejected(()=>openFictionalNotificationQueue({
  bookingStore:f.bookingStore,resolveSession
 }),'FICTIONAL_TEST_MODE_REQUIRED');
 const columns=f.db.prepare("PRAGMA table_info(notification_queue_jobs)").all().map(x=>x.name);
 assert.ok(columns.includes('last_handoff_id'));
 assert.ok(columns.includes('last_handoff_outcome'));
 assert.equal(typeof f.queue.send,'undefined');
 assert.equal(typeof f.queue.connectLINE,'undefined');
 f.bookingStore.close();
});
test('v0.67 refuses to silently migrate a v0.66 notification queue schema',async()=>{
 const {openFictionalNotificationQueue:oldQueue}=await import(
  '../server-design/v0.66-notification-queue.mjs'
 );
 const ref=nowRef();
 const bookingStore=openLocalBookingPrototype({
  resolveSession,clock:clock(ref)
 });
 const db=bookingStore.unsafeDbForTests;seed(db);
 openFictionalNotificationAddon({
  bookingStore,resolveSession,clock:clock(ref),fictionalTestOnly:true
 });
 oldQueue({bookingStore,resolveSession,clock:clock(ref),fictionalTestOnly:true});
 rejected(()=>openFictionalNotificationQueue({
  bookingStore,resolveSession,clock:clock(ref),fictionalTestOnly:true
 }),'REQUIRES_V067_QUEUE_SCHEMA');
 bookingStore.close();
});
test('a claimed job must persist OUTCOME_UNKNOWN before any simulated handoff',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 rejected(()=>complete(f,d.draftId,lease),'USE_EXPLICIT_HANDOFF_RESOLUTION');
 const out=begin(f,d.draftId,lease);
 assert.equal(out.status,'OUTCOME_UNKNOWN');
 assert.equal(out.realMessagesSent,0);
 assert.equal(list(f)[0].state,'OUTCOME_UNKNOWN');
 assert.equal(list(f)[0].last_handoff_id,out.handoffId);
 assert.equal(count(f,'notification_events'),2);
 assert.equal(history(f).filter(x=>x.action==='HANDOFF_UNCERTAIN').length,1);
 assert.equal(claim(f),null);
 assert.equal(f.queue.reconcile({sessionHandle:'ownerA',storeId:'A'}).changed,0);
 f.bookingStore.close();
});
test('an unknown result cannot be completed through the prior lease',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 begin(f,d.draftId,lease);
 rejected(()=>complete(f,d.draftId,lease),'NOT_CLAIMED');
 assert.equal(count(f,'notification_events'),2);
 f.bookingStore.close();
});
test('the unknown state remains blocked even after lease and job expiry',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 const uncertain=begin(f,d.draftId,lease);
 changeTime(f,2*3600000);
 assert.equal(claim(f),null);
 assert.equal(f.queue.reconcile({sessionHandle:'ownerA',storeId:'A'}).changed,0);
 assert.equal(list(f)[0].state,'OUTCOME_UNKNOWN');
 assert.equal(list(f)[0].last_handoff_id,uncertain.handoffId);
 f.bookingStore.close();
});
test('explicit mock acceptance records one simulated event, never a real delivery',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const uncertain=begin(f,d.draftId,claim(f));
 const result=fromUnknown(f,uncertain,'MOCK_ACCEPTED');
 assert.equal(result.status,'SIMULATED');
 assert.equal(result.realMessagesSent,0);
 assert.equal(list(f)[0].last_handoff_outcome,'MOCK_ACCEPTED');
 assert.equal(count(f,'notification_events'),3);
 assert.equal(history(f).filter(x=>x.action==='MOCK_ACCEPTED').length,1);
 const again=fromUnknown(f,uncertain,'MOCK_ACCEPTED');
 assert.equal(again.replayed,true);
 assert.equal(count(f,'notification_events'),3);
 assert.equal(history(f).filter(x=>x.action==='MOCK_ACCEPTED').length,1);
 f.bookingStore.close();
});
test('explicit mock non-acceptance without manual retry approval ends the job safely',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const uncertain=begin(f,d.draftId,claim(f));
 const ended=fromUnknown(f,uncertain,'MOCK_NOT_ACCEPTED');
 assert.equal(ended.status,'DEAD');
 assert.equal(list(f)[0].last_handoff_outcome,'MOCK_NOT_ACCEPTED');
 assert.equal(count(f,'notification_events'),2);
 assert.equal(claim(f),null);
 assert.equal(history(f).filter(x=>x.action==='MOCK_NOT_ACCEPTED').length,1);
 f.bookingStore.close();
});
test('only explicit owner-approved retry after mock non-acceptance permits a new claim',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const one=begin(f,d.draftId,claim(f));
 const decision=fromUnknown(f,one,'MOCK_NOT_ACCEPTED',true);
 assert.equal(decision.status,'RETRY');
 assert.equal(claim(f),null);
 changeTime(f,60000);
 const lease=claim(f,'worker-B');
 assert.equal(lease.attempt,2);
 const two=begin(f,d.draftId,lease,'worker-B');
 assert.notEqual(two.handoffId,one.handoffId);
 rejected(()=>fromUnknown(f,one,'MOCK_ACCEPTED'),'STALE_HANDOFF');
 const final=fromUnknown(f,two,'MOCK_ACCEPTED');
 assert.equal(final.status,'SIMULATED');
 assert.equal(count(f,'notification_events'),3);
 assert.equal(history(f).filter(x=>x.action==='HANDOFF_UNCERTAIN').length,2);
 f.bookingStore.close();
});
test('no retry after negative mock finding when consent was withdrawn',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const out=begin(f,d.draftId,claim(f));
 f.addon.consent({sessionHandle:'alice',storeId:'A',purpose:'reminder',allowed:false});
 const result=fromUnknown(f,out,'MOCK_NOT_ACCEPTED',true);
 assert.equal(result.status,'DEAD');
 assert.equal(count(f,'notification_events'),3);
 assert.equal(claim(f),null);
 f.bookingStore.close();
});
test('no explicit retry can exceed maximum attempts',()=>{
 const f=fixture({maxAttempts:1}),d=prepReminder(f);
 enqueue(f,d.draftId);
 const out=begin(f,d.draftId,claim(f));
 assert.equal(fromUnknown(f,out,'MOCK_NOT_ACCEPTED',true).status,'DEAD');
 assert.equal(count(f,'notification_events'),2);
 f.bookingStore.close();
});
test('unknown finding is not available to unrelated staff, customers or other stores',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const out=begin(f,d.draftId,claim(f));
 for(const sessionHandle of ['deskA','managerB','alice']){
  const code=sessionHandle==='alice'?'STAFF_SESSION_REQUIRED':'OWNER_PERMISSION_REQUIRED';
  rejected(()=>f.queue.resolveUncertain({
   sessionHandle,storeId:'A',draftId:out.draftId,
   handoffId:out.handoffId,finding:'MOCK_ACCEPTED'
  }),code);
 }
 assert.equal(list(f)[0].state,'OUTCOME_UNKNOWN');
 f.bookingStore.close();
});
test('conflicting or fabricated handoff decision is rejected without mutation',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const out=begin(f,d.draftId,claim(f));
 rejected(()=>fromUnknown(f,{...out,handoffId:'fake-handoff-id'},'MOCK_ACCEPTED'),'STALE_HANDOFF');
 rejected(()=>fromUnknown(f,out,'UNVERIFIED'),'INVALID_FINDING');
 fromUnknown(f,out,'MOCK_ACCEPTED');
 rejected(()=>fromUnknown(f,out,'MOCK_NOT_ACCEPTED'),'FINDING_CONFLICT');
 assert.equal(count(f,'notification_events'),3);
 f.bookingStore.close();
});
test('a later opt-out does not rewrite the historical simulated accepted finding',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const out=begin(f,d.draftId,claim(f));
 f.addon.consent({sessionHandle:'alice',storeId:'A',purpose:'reminder',allowed:false});
 // It could already have been accepted before consent was withdrawn;
 // a verified historical event is recorded, not delivered again.
 assert.equal(fromUnknown(f,out,'MOCK_ACCEPTED').status,'SIMULATED');
 assert.equal(count(f,'notification_events'),3);
 assert.equal(claim(f),null);
 f.bookingStore.close();
});
test('opt-out before handoff suppresses the claimed job and creates no unknown attempt',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 f.addon.consent({sessionHandle:'alice',storeId:'A',purpose:'reminder',allowed:false});
 assert.equal(begin(f,d.draftId,lease).status,'SUPPRESSED');
 assert.equal(list(f)[0].state,'SUPPRESSED');
 assert.equal(history(f).filter(x=>x.action==='HANDOFF_UNCERTAIN').length,0);
 f.bookingStore.close();
});
test('conservative daily budget counts unresolved handoffs to stop overrun',()=>{
 const f=fixture({limit:1});
 const a=prepReminder(f,'alice');
 const b=prepReminder(f,'bob',{start:540,bookingOptions:{
  staffId:'s1',bedId:'b1',idempotencyKey:'second-room-booking-v67'
 }});
 enqueue(f,a.draftId);enqueue(f,b.draftId);
 const first=claim(f);
 begin(f,first.draftId,first);
 const second=claim(f,'worker-B');
 const stop=begin(f,second.draftId,second,'worker-B');
 assert.equal(stop.status,'DEAD');
 assert.equal(stop.reason,'FICTIONAL_DAILY_LIMIT');
 assert.equal(count(f,'notification_events'),4);
 assert.equal(history(f).filter(x=>x.action==='HANDOFF_UNCERTAIN').length,1);
 f.bookingStore.close();
});
test('failure to log unknown handoff rolls back claimed-to-unknown transition',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 f.db.exec("CREATE TRIGGER reject_unknown BEFORE INSERT ON notification_queue_events WHEN NEW.action='HANDOFF_UNCERTAIN' BEGIN SELECT RAISE(ABORT,'mock handoff audit down'); END;");
 assert.throws(()=>begin(f,d.draftId,lease),/mock handoff audit down/);
 assert.equal(list(f)[0].state,'CLAIMED');
 assert.equal(count(f,'notification_events'),2);
 f.db.exec('DROP TRIGGER reject_unknown');
 assert.equal(begin(f,d.draftId,lease).status,'OUTCOME_UNKNOWN');
 f.bookingStore.close();
});
test('failure during accepted-resolution audit rolls back every partial write',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const out=begin(f,d.draftId,claim(f));
 f.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON notification_queue_events WHEN NEW.action='MOCK_ACCEPTED' BEGIN SELECT RAISE(ABORT,'receipt audit unavailable'); END;");
 assert.throws(()=>fromUnknown(f,out,'MOCK_ACCEPTED'),/receipt audit unavailable/);
 assert.equal(list(f)[0].state,'OUTCOME_UNKNOWN');
 assert.equal(list(f)[0].last_handoff_outcome,null);
 assert.equal(count(f,'notification_events'),2);
 f.db.exec('DROP TRIGGER reject_receipt');
 assert.equal(fromUnknown(f,out,'MOCK_ACCEPTED').status,'SIMULATED');
 assert.equal(count(f,'notification_events'),3);
 f.bookingStore.close();
});
test('unknown handoff survives close/reopen and cannot be reclaimed after restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-v067-unknown-'));
 try{
  const path=join(dir,'queue.sqlite');
  const f=fixture({path}),d=prepReminder(f);
  enqueue(f,d.draftId);
  const out=begin(f,d.draftId,claim(f));
  f.bookingStore.close();
  const ref={iso:'2026-10-26T11:00:00.000Z'};
  const reopened=open(path,ref);
  assert.equal(reopened.queue.list({sessionHandle:'ownerA',storeId:'A'})[0].state,
   'OUTCOME_UNKNOWN');
  assert.equal(claim(reopened),null);
  assert.equal(reopened.queue.reconcile({sessionHandle:'ownerA',storeId:'A'}).changed,0);
  assert.equal(fromUnknown(reopened,out,'MOCK_NOT_ACCEPTED').status,'DEAD');
  reopened.bookingStore.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('v0.66 successful completion path is intentionally forbidden in v0.67',()=>{
 const f=fixture(),d=prepReminder(f);
 enqueue(f,d.draftId);
 const lease=claim(f);
 rejected(()=>complete(f,d.draftId,lease),'USE_EXPLICIT_HANDOFF_RESOLUTION');
 assert.equal(list(f)[0].state,'CLAIMED');
 assert.equal(count(f,'notification_events'),2);
 f.bookingStore.close();
});
