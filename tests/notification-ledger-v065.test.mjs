// v0.65 local SQLite notification add-on tests. All data is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalBookingPrototype} from '../server-design/v0.63-local-booking-store.mjs';
import {openFictionalNotificationAddon} from '../server-design/v0.65-notification-addon.mjs';

const members={
 alice:{authenticated:true,kind:'customer',subjectId:'alice'},
 bob:{authenticated:true,kind:'customer',subjectId:'bob'},
 carol:{authenticated:true,kind:'customer',subjectId:'carol'},
 staffA:{authenticated:true,kind:'staff',subjectId:'ownerA'},
 staffB:{authenticated:true,kind:'staff',subjectId:'ownerB'},
 deskA:{authenticated:true,kind:'staff',subjectId:'deskA'}
};
const resolveSession=handle=>Object.hasOwn(members,handle)?members[handle]:null;
const clockFactory=ref=>()=>new Date(ref.iso);
const BASE='2026-10-25T08:00:00.000Z';
function create(path=':memory:',clockRef={iso:BASE},quota=3){
 const bookingStore=openLocalBookingPrototype({
  path,resolveSession,clock:clockFactory(clockRef)
 });
 const db=bookingStore.unsafeDbForTests;
 return {bookingStore,db,clockRef,quota};
}
function seed(db){
 const config={
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
  for(const date of ['2026-10-26','2026-10-27'])
   db.prepare('INSERT INTO day_configurations(store_id,service_date,config_json) VALUES(?,?,?)')
    .run(store,date,JSON.stringify(config));
 }
 for(const [store,id,role] of [['A','ownerA','owner'],['A','deskA','receptionist'],
  ['B','ownerB','manager']]){
  db.prepare('INSERT INTO staff_memberships(store_id,subject_id,role,active) VALUES(?,?,?,1)')
   .run(store,id,role);
 }
}
function fixture(path=':memory:',quota=3){
 const base=create(path,{iso:BASE},quota);
 seed(base.db);
 return {...base,addon:openFictionalNotificationAddon({
  bookingStore:base.bookingStore,resolveSession,
  clock:clockFactory(base.clockRef),fictionalTestOnly:true,
  maxSimulatedPerStoreDay:quota
 })};
}
function reserve(f,person='alice',start=540,opts={}){
 return f.bookingStore.reserve({
  sessionHandle:person,storeId:'A',serviceDate:'2026-10-26',
  menuId:'m60',staffId:'s2',bedId:'b3',startMinute:start,
  idempotencyKey:'booking-'+person+'-'+start+'-001',discovery:'unknown',...opts
 });
}
function opt(f,person,purpose,allowed=true,store='A'){
 return f.addon.consent({sessionHandle:person,storeId:store,purpose,allowed});
}
function draft(f,person,purpose,bookingId=null,key='notify-draft-001',store='A'){
 return f.addon.createDraft({
  sessionHandle:'staffA',storeId:store,customerId:person,purpose,
  ...(bookingId?{bookingId}:{}),idempotencyKey:key
 });
}
const count=(f,table)=>f.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
function check(r,code){assert.throws(r,{code});}
function visits(f,customer='alice'){
 for(const date of ['2026-07-27','2026-08-24','2026-09-21']){
  f.addon.addVisit({sessionHandle:'staffA',storeId:'A',customerId:customer,
   visitedDate:date});
 }
}

test('local notification ledger is a separate add-on and preserves original bookings',()=>{
 const f=fixture();
 const before=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='booking_records'").get();
 assert.ok(before);
 for(const table of ['notification_consent_events','notification_mock_visits',
  'notification_waitlist_preferences','notification_drafts','notification_events'])
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
 assert.equal(count(f,'booking_records'),0);
 const b=reserve(f);
 assert.equal(b.status,'CONFIRMED');
 assert.equal(f.bookingStore.list({
  sessionHandle:'staffA',storeId:'A',serviceDate:'2026-10-26'
 }).length,1);
 f.bookingStore.close();
});
test('test-only mode and actual v0.63 schema required; no live messaging API',()=>{
 const f=fixture();
 check(()=>openFictionalNotificationAddon({bookingStore:f.bookingStore,resolveSession}),
  'FICTIONAL_TEST_MODE_REQUIRED');
 assert.equal(typeof f.addon.send,'undefined');
 assert.equal(typeof f.addon.connectLINE,'undefined');
 assert.equal(typeof f.addon.simulateDispatch,'function');
 f.bookingStore.close();
});
test('only fictional customer self-service records consent, staff cannot forge it',()=>{
 const f=fixture();
 const c=opt(f,'alice','return',true);
 assert.equal(c.recordKind,'FICTIONAL_ONLY');
 assert.equal(count(f,'notification_consent_events'),1);
 check(()=>opt(f,'staffA','return',true),'CUSTOMER_SELF_CONSENT_REQUIRED');
 check(()=>f.addon.consent({
  sessionHandle:'alice',storeId:'A',purpose:'return',allowed:true,
  customerId:'bob'
 }),'INVALID_FIELDS');
 assert.equal(count(f,'notification_consent_events'),1);
 f.bookingStore.close();
});
test('independent reminder, return and waitlist purposes can be revoked separately',()=>{
 const f=fixture();
 opt(f,'alice','return');opt(f,'alice','reminder');opt(f,'alice','waitlist');
 opt(f,'alice','return',false);
 assert.equal(count(f,'notification_consent_events'),4);
 const c=f.db.prepare(
  "SELECT purpose,allowed FROM notification_consent_events WHERE store_id='A' AND customer_subject_id='alice' ORDER BY seq"
 ).all();
 assert.deepEqual(c.map(x=>x.allowed),[1,1,1,0]);
 f.bookingStore.close();
});
test('reminder draft needs owned next-day active booking and explicit consent',()=>{
 const f=fixture();
 const b=reserve(f);
 check(()=>draft(f,'alice','reminder',b.bookingId),'NO_CONSENT');
 opt(f,'alice','reminder');
 const d=draft(f,'alice','reminder',b.bookingId);
 assert.equal(d.status,'DRAFT');
 check(()=>draft(f,'bob','reminder',b.bookingId,'notify-bob-001'),'NO_CONSENT');
 opt(f,'bob','reminder');
 check(()=>draft(f,'bob','reminder',b.bookingId,'notify-bob-002'),
  'REMINDER_BOOKING_INVALID');
 assert.equal(count(f,'notification_drafts'),1);
 f.bookingStore.close();
});
test('same draft key is replay-safe; period duplication or changed retry rejected',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'alice','reminder');
 const d=draft(f,'alice','reminder',b.bookingId);
 assert.equal(draft(f,'alice','reminder',b.bookingId).draftId,d.draftId);
 assert.equal(draft(f,'alice','reminder',b.bookingId).replayed,true);
 check(()=>draft(f,'alice','return',null),'IDEMPOTENCY_CONFLICT');
 check(()=>draft(f,'alice','reminder',b.bookingId,'different-key-009'),
  'DUPLICATE_PERIOD');
 assert.equal(count(f,'notification_drafts'),1);
 f.bookingStore.close();
});
test('staff owner approval required before simulated dispatch, audit is append-only',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'alice','reminder');
 const d=draft(f,'alice','reminder',b.bookingId);
 check(()=>f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:d.draftId
 }),'NOT_APPROVED');
 check(()=>f.addon.approve({
  sessionHandle:'deskA',storeId:'A',draftId:d.draftId
 }),'OWNER_APPROVAL_REQUIRED');
 assert.equal(f.addon.approve({
  sessionHandle:'staffA',storeId:'A',draftId:d.draftId
 }).status,'APPROVED_FICTIONAL');
 const sent=f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:d.draftId
 });
 assert.equal(sent.realMessagesSent,0);
 assert.equal(sent.status,'SIMULATED_ONLY');
 const replay=f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:d.draftId
 });
 assert.equal(replay.replayed,true);
 assert.equal(count(f,'notification_events'),3);
 f.bookingStore.close();
});
test('opt out after approval blocks dispatch and leaves no simulated delivery event',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'alice','reminder');
 const d=draft(f,'alice','reminder',b.bookingId);
 f.addon.approve({sessionHandle:'staffA',storeId:'A',draftId:d.draftId});
 opt(f,'alice','reminder',false);
 check(()=>f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:d.draftId
 }),'NO_CONSENT');
 assert.equal(f.addon.list({sessionHandle:'staffA',storeId:'A'})[0].status,
  'SUPPRESSED');
 assert.equal(count(f,'notification_events'),3);
 f.bookingStore.close();
});
test('canceled booking prevents approved reminder from being dispatched',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'alice','reminder');
 const d=draft(f,'alice','reminder',b.bookingId);
 f.addon.approve({sessionHandle:'staffA',storeId:'A',draftId:d.draftId});
 f.bookingStore.cancel({
  sessionHandle:'alice',storeId:'A',bookingId:b.bookingId,
  idempotencyKey:'cancel-reminder-booking-001'
 });
 check(()=>f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:d.draftId
 }),'REMINDER_BOOKING_INVALID');
 assert.equal(count(f,'notification_events'),2);
 f.bookingStore.close();
});
test('moved booking invalidates reminder for original and requires new draft for new booking',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'alice','reminder');
 const d=draft(f,'alice','reminder',b.bookingId);
 f.addon.approve({sessionHandle:'staffA',storeId:'A',draftId:d.draftId});
 const moved=f.bookingStore.move({
  sessionHandle:'alice',storeId:'A',bookingId:b.bookingId,
  serviceDate:'2026-10-26',menuId:'m60',staffId:'s2',bedId:'b3',
  startMinute:960,idempotencyKey:'move-reminder-booking-01'
 });
 check(()=>f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:d.draftId
 }),'REMINDER_BOOKING_INVALID');
 const other=draft(f,'alice','reminder',moved.bookingId,'reminder-for-moved-001');
 assert.notEqual(other.draftId,d.draftId);
 f.bookingStore.close();
});
test('fictitious visits produce a 28-day recurrence but insufficient history fails',()=>{
 const f=fixture();
 opt(f,'alice','return');
 check(()=>draft(f,'alice','return'),'INSUFFICIENT_HISTORY');
 visits(f);
 const stats=f.addon.cycleFor('A','alice');
 assert.equal(stats.intervalDays,28);
 assert.equal(stats.samples,2);
 assert.equal(stats.expectedDate,'2026-10-19');
 assert.equal(draft(f,'alice','return').status,'DRAFT');
 f.bookingStore.close();
});
test('already-booked customer does not receive a marketing return prompt',()=>{
 const f=fixture();
 opt(f,'alice','return');visits(f);
 reserve(f);
 check(()=>draft(f,'alice','return'),'ALREADY_BOOKED');
 assert.equal(count(f,'notification_drafts'),0);
 f.bookingStore.close();
});
test('consenting waiter can receive a mock draft only for a canceled compatible slot',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'bob','waitlist');
 f.addon.waitlistPreference({
  sessionHandle:'bob',storeId:'A',serviceDate:'2026-10-26',menuId:'m60',
  staffId:'s2',earliestMinute:540,latestMinute:630
 });
 check(()=>draft(f,'bob','waitlist',b.bookingId),'WAITLIST_RELEASE_INVALID');
 f.bookingStore.cancel({
  sessionHandle:'alice',storeId:'A',bookingId:b.bookingId,
  idempotencyKey:'release-cancel-001'
 });
 const d=draft(f,'bob','waitlist',b.bookingId);
 assert.equal(d.status,'DRAFT');
 assert.equal(count(f,'notification_drafts'),1);
 f.bookingStore.close();
});
test('waitlist release with no preference or revoked consent is rejected',()=>{
 const f=fixture(),b=reserve(f);
 f.bookingStore.cancel({
  sessionHandle:'alice',storeId:'A',bookingId:b.bookingId,
  idempotencyKey:'cancel-preference-001'
 });
 opt(f,'bob','waitlist');
 check(()=>draft(f,'bob','waitlist',b.bookingId),'WAITLIST_PREFERENCE_MISSING');
 f.addon.waitlistPreference({
  sessionHandle:'bob',storeId:'A',serviceDate:'2026-10-26',menuId:'m60',
  earliestMinute:570,latestMinute:600
 });
 check(()=>draft(f,'bob','waitlist',b.bookingId),'WAITLIST_PREFERENCE_MISSING');
 opt(f,'bob','waitlist',false);
 check(()=>draft(f,'bob','waitlist',b.bookingId),'NO_CONSENT');
 f.bookingStore.close();
});
test('a moved-from reservation is not a real cancellation slot',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'bob','waitlist');
 f.addon.waitlistPreference({
  sessionHandle:'bob',storeId:'A',serviceDate:'2026-10-26',menuId:'m60',
  staffId:'s2',earliestMinute:540,latestMinute:540
 });
 f.bookingStore.move({
  sessionHandle:'alice',storeId:'A',bookingId:b.bookingId,
  serviceDate:'2026-10-26',menuId:'m60',staffId:'s2',bedId:'b3',
  startMinute:960,idempotencyKey:'move-not-waitlist-001'
 });
 check(()=>draft(f,'bob','waitlist',b.bookingId),'WAITLIST_RELEASE_INVALID');
 f.bookingStore.close();
});
test('a cancellation slot that was taken before draft/dispatch is rejected',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'bob','waitlist');
 f.addon.waitlistPreference({
  sessionHandle:'bob',storeId:'A',serviceDate:'2026-10-26',menuId:'m60',
  staffId:'s2',earliestMinute:540,latestMinute:540
 });
 f.bookingStore.cancel({
  sessionHandle:'alice',storeId:'A',bookingId:b.bookingId,
  idempotencyKey:'cancel-for-recovery-001'
 });
 const d=draft(f,'bob','waitlist',b.bookingId);
 f.addon.approve({sessionHandle:'staffA',storeId:'A',draftId:d.draftId});
 reserve(f,'carol',540,{idempotencyKey:'rebook-by-carol-001'});
 check(()=>f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:d.draftId
 }),'SLOT_UNAVAILABLE');
 assert.equal(count(f,'notification_events'),2);
 f.bookingStore.close();
});
test('store-wide simulation cap rejects another draft but replay does not consume quota',()=>{
 const f=fixture(':memory:',1);
 opt(f,'alice','reminder');opt(f,'bob','reminder');
 const first=reserve(f);
 const second=reserve(f,'bob',540,{staffId:'s1',bedId:'b1',
  idempotencyKey:'another-day-booking-001'});
 const a=draft(f,'alice','reminder',first.bookingId);
 const b=draft(f,'bob','reminder',second.bookingId,'notify-second-001');
 for(const d of [a,b])
  f.addon.approve({sessionHandle:'staffA',storeId:'A',draftId:d.draftId});
 assert.equal(f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:a.draftId
 }).status,'SIMULATED_ONLY');
 assert.equal(f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:a.draftId
 }).replayed,true);
 check(()=>f.addon.simulateDispatch({
  sessionHandle:'staffA',storeId:'A',draftId:b.draftId
 }),'FICTIONAL_DAILY_LIMIT');
 assert.equal(count(f,'notification_events'),5);
 f.bookingStore.close();
});
test('customer only lists own drafts and store staff cannot view foreign-store ledger',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'alice','reminder');
 draft(f,'alice','reminder',b.bookingId);
 assert.equal(f.addon.list({sessionHandle:'alice',storeId:'A'}).length,1);
 assert.equal(f.addon.list({sessionHandle:'bob',storeId:'A'}).length,0);
 check(()=>f.addon.list({sessionHandle:'staffB',storeId:'A'}),
  'STORE_ACCESS_DENIED');
 const summary=f.addon.summary({sessionHandle:'staffA',storeId:'A'});
 assert.equal(summary.storedDrafts,1);
 assert.equal(summary.realMessagesSent,0);
 assert.equal(summary.actualRevenue,null);
 check(()=>f.addon.summary({sessionHandle:'alice',storeId:'A'}),
  'OWNER_APPROVAL_REQUIRED');
 f.bookingStore.close();
});
test('notification event insertion failure rolls back draft creation as one unit',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'alice','reminder');
 f.db.exec("CREATE TRIGGER notify_audit_fail BEFORE INSERT ON notification_events BEGIN SELECT RAISE(ABORT,'mock audit failure'); END");
 assert.throws(()=>draft(f,'alice','reminder',b.bookingId),/mock audit failure/);
 assert.equal(count(f,'notification_drafts'),0);
 assert.equal(count(f,'notification_events'),0);
 f.db.exec('DROP TRIGGER notify_audit_fail');
 assert.equal(draft(f,'alice','reminder',b.bookingId).status,'DRAFT');
 f.bookingStore.close();
});
test('notification tables retain data across reopening the same SQLite file',()=>{
 const folder=mkdtempSync(join(tmpdir(),'salon-v065-'));
 try{
  const path=join(folder,'local.sqlite');
  const first=fixture(path),b=reserve(first);
  opt(first,'alice','reminder');
  const d=draft(first,'alice','reminder',b.bookingId);
  first.bookingStore.close();
  const second=create(path,{iso:BASE});
  const addon=openFictionalNotificationAddon({
   bookingStore:second.bookingStore,resolveSession,
   clock:clockFactory(second.clockRef),fictionalTestOnly:true
  });
  const records=addon.list({sessionHandle:'staffA',storeId:'A'});
  assert.equal(records.length,1);
  assert.equal(records[0].draft_id,d.draftId);
  assert.equal(records[0].status,'DRAFT_CREATED');
  second.bookingStore.close();
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('immutable consent/notification event/history records cannot be rewritten',()=>{
 const f=fixture(),b=reserve(f);
 opt(f,'alice','reminder');
 draft(f,'alice','reminder',b.bookingId);
 for(const sql of [
  'DELETE FROM notification_consent_events',
  "UPDATE notification_consent_events SET allowed=0",
  "DELETE FROM notification_drafts",
  "UPDATE notification_events SET action='SUPPRESSED'",
  "DELETE FROM notification_events"
 ])assert.throws(()=>f.db.exec(sql),/immutable/);
 f.bookingStore.close();
});
test('invalid identities, dates, purposes and injected fields fail without writes',()=>{
 const f=fixture();
 check(()=>f.addon.consent({sessionHandle:'none',storeId:'A',purpose:'return',allowed:true}),
  'UNAUTHENTICATED');
 check(()=>f.addon.consent({sessionHandle:'alice',storeId:'A',
  purpose:'other',allowed:true}),'CUSTOMER_SELF_CONSENT_REQUIRED');
 check(()=>f.addon.addVisit({sessionHandle:'staffA',storeId:'A',
  customerId:'alice',visitedDate:'2026-02-30'}),'INVALID_DATE');
 check(()=>f.addon.addVisit({sessionHandle:'staffA',storeId:'A',
  customerId:'alice',visitedDate:'2026-10-27'}),'FUTURE_VISIT_NOT_ALLOWED');
 check(()=>f.addon.waitlistPreference({sessionHandle:'alice',storeId:'A',
  serviceDate:'2026-10-26',menuId:'m60',earliestMinute:680,latestMinute:640}),
  'INVALID_PREFERENCE');
 check(()=>f.addon.createDraft({sessionHandle:'staffA',storeId:'A',
  customerId:'alice',purpose:'return',idempotencyKey:'short'}),
  'INVALID_DRAFT');
 check(()=>f.addon.createDraft({sessionHandle:'staffA',storeId:'A',
  customerId:'alice',purpose:'return',idempotencyKey:'draft-something-001',
  impersonate:'bob'}),'INVALID_FIELDS');
 assert.equal(count(f,'notification_drafts'),0);
 f.bookingStore.close();
});


test('consent revocation suppresses both draft and owner-approved notifications',()=>{
 const f=fixture();
 const a=reserve(f,'alice',540);
 const b=reserve(f,'alice',960,{idempotencyKey:'second-reminder-booking-01'});
 opt(f,'alice','reminder');
 const first=draft(f,'alice','reminder',a.bookingId,'first-reminder-001');
 const second=draft(f,'alice','reminder',b.bookingId,'second-reminder-001');
 f.addon.approve({sessionHandle:'staffA',storeId:'A',draftId:first.draftId});
 opt(f,'alice','reminder',false);
 const rows=f.addon.list({sessionHandle:'staffA',storeId:'A'});
 assert.equal(rows.length,2);
 assert.ok(rows.every(x=>x.status==='SUPPRESSED'));
 assert.equal(count(f,'notification_consent_events'),2);
 assert.equal(count(f,'notification_events'),5);
 opt(f,'alice','reminder',true);
 assert.equal(f.addon.list({sessionHandle:'staffA',storeId:'A'}).every(x=>x.status==='SUPPRESSED'),true);
 f.bookingStore.close();
});
