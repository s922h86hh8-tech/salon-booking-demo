// v0.63 localhost atomic booking move HTTP end-to-end tests. All identities/records fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {openLocalBookingPrototype} from '../server-design/v0.63-local-booking-store.mjs';
import {createLocalBookingApi} from '../server-design/v0.63-loopback-booking-api.mjs';

const code=readFileSync(new URL('../experiments/marketing-booking-mvp-a/core-v057.js',import.meta.url),'utf8');
const sandbox={};runInNewContext(code,{window:sandbox});
const Core=sandbox.DemoCore;

async function fixture(t){
 const users={
  alice:{authenticated:true,kind:'customer',subjectId:'alice'},
  bob:{authenticated:true,kind:'customer',subjectId:'bob'},
  staffA:{authenticated:true,kind:'staff',subjectId:'managerA'},
  staffB:{authenticated:true,kind:'staff',subjectId:'managerB'},
  inactive:{authenticated:true,kind:'staff',subjectId:'inactiveA'}
 };
 const tokens=Object.fromEntries(Object.keys(users).map(k=>[k,randomBytes(28).toString('base64url')]));
 const index=new Map(Object.keys(tokens).map(k=>[tokens[k],k]));
 const store=openLocalBookingPrototype({
  resolveSession:handle=>Object.hasOwn(users,handle)?users[handle]:null,
  clock:()=>new Date('2026-11-08T03:04:05.000Z')
 });
 const db=store.unsafeDbForTests;
 const initial=Core.initial();
 const cfg=JSON.stringify({
  staff:initial.staff,menus:initial.menus,beds:initial.beds,
  rooms:initial.rooms,breaks:initial.breaks
 });
 const s=db.prepare('INSERT INTO stores(store_id) VALUES(?)');
 s.run('A');s.run('B');
 const member=db.prepare('INSERT INTO staff_memberships(store_id,subject_id,role,active) VALUES(?,?,?,?)');
 member.run('A','managerA','manager',1);
 member.run('B','managerB','owner',1);
 member.run('A','inactiveA','receptionist',0);
 const day=db.prepare('INSERT INTO day_configurations(store_id,service_date,config_json) VALUES(?,?,?)');
 day.run('A','2026-10-26',cfg);day.run('B','2026-10-26',cfg);
 day.run('A','2026-10-27',cfg);
 const api=createLocalBookingApi({
  fictionalTestOnly:true,bookingStore:store,
  resolveOpaqueToken:token=>index.get(token)||null
 });
 const base=await api.listen();
 t.after(async()=>{await api.close();store.close();});
 const booked={
  serviceDate:'2026-10-26',menuId:'m60',staffId:'s2',bedId:'b3',
  startMinute:540,idempotencyKey:'http-booking-key-001',discovery:'google'
 };
 async function send(method,path,actor='alice',body=null,customHeaders={}){
  const url=new URL(path,base);
  const raw=body===null?null:typeof body==='string'?body:JSON.stringify(body);
  const headers={
   ...(actor===null?{}:{Authorization:'Bearer '+(tokens[actor]||'not_a_real_valid_random_token_123')}),
   ...(raw===null?{}:{'Content-Type':'application/json'}),
   ...customHeaders
  };
  return await new Promise((resolve,reject)=>{
   const req=httpRequest(url,{method,headers},res=>{
    const chunks=[];res.on('data',part=>chunks.push(part));
    res.on('end',()=>{
     try{resolve({status:res.statusCode,headers:res.headers,
      json:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
     catch(error){reject(error);}
    });
   });
   req.once('error',reject);
   if(raw!==null)req.write(raw);
   req.end();
  });
 }
 const count=table=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
 return {api,base,store,db,booked,send,count};
}
const listing='/v0.63/stores/A/bookings?date=2026-10-26';
const bookingEndpoint='/v0.63/stores/A/bookings';
const availability='/v0.63/stores/A/availability?date=2026-10-26&menuId=m60&staffId=s2&bedId=b3&startMinute=540';

test('loopback server is explicit fictional-only and binds no public IP',async(t)=>{
 assert.throws(()=>createLocalBookingApi(),/LOCAL_FICTIONAL_TEST_MODE_REQUIRED/);
 const f=await fixture(t);
 assert.match(f.base,/^http:\/\/127\.0\.0\.1:\d+$/);
 assert.match(f.db.prepare('PRAGMA journal_mode').get().journal_mode,/memory|wal/);
});
test('two test clients share one booking ledger while customers see only own records',async(t)=>{
 const f=await fixture(t);
 assert.equal((await f.send('GET',availability,'alice')).json.data.ok,true);
 const first=await f.send('POST',bookingEndpoint,'alice',f.booked);
 assert.equal(first.status,201);
 assert.equal(first.json.data.status,'CONFIRMED');
 const customerView=await f.send('GET',listing,'alice');
 const anotherCustomer=await f.send('GET',listing,'bob');
 const desk=await f.send('GET',listing,'staffA');
 assert.equal(customerView.json.data.length,1);
 assert.equal(anotherCustomer.json.data.length,0);
 assert.equal(desk.json.data.length,1);
 assert.equal(desk.json.data[0].source,'website');
 assert.equal(desk.json.data[0].discovery,'google');
});
test('distinct clients making same-time requests receive one 201 and one 409',async(t)=>{
 const f=await fixture(t);
 const requests=await Promise.all([
  f.send('POST',bookingEndpoint,'alice',f.booked),
  f.send('POST',bookingEndpoint,'bob',{
   ...f.booked,idempotencyKey:'http-other-customer-001'
  })
 ]);
 assert.deepEqual(requests.map(x=>x.status).sort(),[201,409]);
 assert.equal(f.count('booking_records'),1);
 assert.equal(f.count('booking_audit_events'),1);
 assert.equal((await f.send('GET',availability,'bob')).json.data.ok,false);
});
test('booking retry returns same ID and modified retries never post a duplicate',async(t)=>{
 const f=await fixture(t);
 const initial=await f.send('POST',bookingEndpoint,'alice',f.booked);
 const replay=await f.send('POST',bookingEndpoint,'alice',f.booked);
 assert.equal(replay.status,200);
 assert.equal(replay.json.data.replayed,true);
 assert.equal(replay.json.data.bookingId,initial.json.data.bookingId);
 const invalid=await f.send('POST',bookingEndpoint,'alice',{
  ...f.booked,startMinute:555
 });
 assert.equal(invalid.status,409);
 assert.equal(invalid.json.error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal(f.count('booking_commands'),1);
});
test('only booking owner or authorized own-store staff can cancel; time becomes available again',async(t)=>{
 const f=await fixture(t);
 const booked=await f.send('POST',bookingEndpoint,'alice',f.booked);
 const id=booked.json.data.bookingId;
 const path=bookingEndpoint+'/'+id+'/cancel';
 assert.equal((await f.send('POST',path,'bob',{idempotencyKey:'cancel-by-bob-001'})).status,403);
 assert.equal((await f.send('POST',path,'staffB',{idempotencyKey:'cancel-foreign-001'})).status,403);
 const canceled=await f.send('POST',path,'alice',{idempotencyKey:'cancel-by-alice-001'});
 assert.equal(canceled.status,200);
 assert.equal(canceled.json.data.status,'CANCELLED');
 const again=await f.send('POST',path,'alice',{idempotencyKey:'cancel-by-alice-001'});
 assert.equal(again.json.data.replayed,true);
 assert.equal((await f.send('GET',availability,'bob')).json.data.ok,true);
 assert.equal((await f.send('POST',bookingEndpoint,'bob',{
  ...f.booked,idempotencyKey:'book-aftercancel-001'
 })).status,201);
 assert.equal(f.count('booking_records'),2);
 assert.equal(f.count('booking_cancellations'),1);
});
test('store staff may book telephone reservations; customers cannot forge source',async(t)=>{
 const f=await fixture(t);
 const first=await f.send('POST',bookingEndpoint,'alice',{...f.booked,source:'hpb'});
 assert.equal(first.status,201);
 const second=await f.send('POST',bookingEndpoint,'staffA',{
  ...f.booked,staffId:'s1',bedId:'b1',startMinute:540,
  idempotencyKey:'staff-phone-book-001',source:'phone',discovery:'unknown'
 });
 assert.equal(second.status,201);
 const rows=(await f.send('GET',listing,'staffA')).json.data;
 assert.equal(rows.find(x=>x.booking_id===first.json.data.bookingId).source,'website');
 assert.equal(rows.find(x=>x.booking_id===second.json.data.bookingId).source,'phone');
});
test('fake tokens, inactive membership and foreign-store access fail closed',async(t)=>{
 const f=await fixture(t);
 assert.equal((await f.send('GET',listing,null)).status,401);
 assert.equal((await f.send('GET',listing,'unknown')).status,401);
 assert.equal((await f.send('GET',listing,'staffB')).status,403);
 assert.equal((await f.send('GET',listing,'inactive')).status,403);
 const other='/v0.63/stores/B/bookings?date=2026-10-26';
 assert.equal((await f.send('GET',other,'staffA')).status,403);
 assert.equal((await f.send('GET',other,'staffB')).status,200);
});
test('customer has no audit access, while staff sees append-only timestamps and actions',async(t)=>{
 const f=await fixture(t);
 const booked=await f.send('POST',bookingEndpoint,'alice',f.booked);
 await f.send('POST',bookingEndpoint+'/'+booked.json.data.bookingId+'/cancel',
  'alice',{idempotencyKey:'cancel-audit-test-001'});
 assert.equal((await f.send('GET','/v0.63/stores/A/booking-audit','alice')).status,403);
 const audit=await f.send('GET','/v0.63/stores/A/booking-audit','staffA');
 assert.equal(audit.status,200);
 assert.deepEqual(audit.json.data.map(x=>x.action),
  ['BOOKING_CONFIRMED','BOOKING_CANCELLED']);
 assert.ok(audit.json.data[0].event_seq<audit.json.data[1].event_seq);
 assert.ok(audit.json.data.every(x=>x.occurred_at==='2026-11-08T03:04:05.000Z'));
});
test('unexpected identity and target fields are rejected, never trusted',async(t)=>{
 const f=await fixture(t);
 for(const changed of [
  {sessionHandle:'staffA'},{storeId:'B'},{ownerSubjectId:'bob'},
  {bookingId:'forged'},{customer:'real name'},{role:'owner'}
 ]){
  const response=await f.send('POST',bookingEndpoint,'alice',{...f.booked,...changed});
  assert.equal(response.status,400);
  assert.equal(response.json.error.code,'UNEXPECTED_FIELD');
 }
 assert.equal(f.count('booking_records'),0);
 const booked=await f.send('POST',bookingEndpoint,'alice',f.booked);
 assert.equal(booked.status,201);
 const path=bookingEndpoint+'/'+booked.json.data.bookingId+'/cancel';
 assert.equal((await f.send('POST',path,'alice',{
  idempotencyKey:'cancel-forge-001',bookingId:'forged'
 })).status,400);
 assert.equal(f.count('booking_cancellations'),0);
});
test('HTTP invalid JSON, bad content type, path, origin, query, method and oversized body reject',async(t)=>{
 const f=await fixture(t);
 assert.equal((await f.send('POST',bookingEndpoint,'alice','bad json')).status,400);
 assert.equal((await f.send('POST',bookingEndpoint,'alice',f.booked,{
  'Content-Type':'text/plain'
 })).status,415);
 assert.equal((await f.send('POST',bookingEndpoint,'alice',null)).status,415);
 assert.equal((await f.send('POST',bookingEndpoint,'alice',f.booked,{
  Origin:'https://another.example'
 })).status,403);
 assert.equal((await f.send('GET',listing+'&tracking=1','alice')).status,400);
 assert.equal((await f.send('GET','/v0.63/stores/%E0/bookings?date=2026-10-26','alice')).status,400);
 assert.equal((await f.send('DELETE',bookingEndpoint,'alice')).status,405);
 assert.equal((await f.send('POST',bookingEndpoint,'alice',{
  ...f.booked,discovery:'x'.repeat(17000)
 })).status,413);
 assert.equal(f.count('booking_records'),0);
});
test('failed audit insert never confirms HTTP booking and leaks no DB details',async(t)=>{
 const f=await fixture(t);
 f.db.exec("CREATE TRIGGER fail_test_audit BEFORE INSERT ON booking_audit_events BEGIN SELECT RAISE(ABORT,'secret diagnosis'); END;");
 const r=await f.send('POST',bookingEndpoint,'alice',f.booked);
 assert.equal(r.status,500);
 assert.equal(r.json.error.code,'INTERNAL_FAILURE');
 assert.equal(f.count('booking_records'),0);
 assert.ok(!JSON.stringify(r.json).includes('secret'));
 f.db.exec('DROP TRIGGER fail_test_audit');
 assert.equal((await f.send('POST',bookingEndpoint,'alice',f.booked)).status,201);
});
test('API disables client caching and applies restrictive response headers',async(t)=>{
 const f=await fixture(t);
 const r=await f.send('GET',listing,'alice');
 assert.equal(r.status,200);
 assert.match(r.headers['cache-control'],/no-store/);
 assert.equal(r.headers['x-content-type-options'],'nosniff');
 assert.equal(r.headers['x-frame-options'],'DENY');
 assert.doesNotMatch(JSON.stringify(r.json),/Bearer /);
});


test('HTTP move keeps original audit and changes customer/staff shared booking views atomically',async(t)=>{
 const f=await fixture(t);
 const first=await f.send('POST',bookingEndpoint,'alice',f.booked);
 assert.equal(first.status,201);
 const id=first.json.data.bookingId;
 const url=bookingEndpoint+'/'+id+'/move';
 const move=await f.send('POST',url,'alice',{
  serviceDate:'2026-10-26',menuId:'m60',staffId:'s2',bedId:'b3',
  startMinute:630,idempotencyKey:'http-move-key-001'
 });
 assert.equal(move.status,200);
 assert.equal(move.json.data.status,'MOVED');
 const list=(await f.send('GET',listing,'staffA')).json.data;
 assert.equal(list.length,2);
 const original=list.find(x=>x.booking_id===id);
 const newOne=list.find(x=>x.booking_id===move.json.data.bookingId);
 assert.equal(original.cancellation_reason,'MOVE');
 assert.equal(original.moved_to_booking_id,newOne.booking_id);
 assert.equal(newOne.canceled,0);
 assert.equal(newOne.start_minute,630);
 assert.equal(newOne.source,'website');
 assert.equal(newOne.discovery,'google');
 const audit=(await f.send('GET','/v0.63/stores/A/booking-audit','staffA')).json.data;
 assert.deepEqual(audit.map(x=>x.action),[
  'BOOKING_CONFIRMED','BOOKING_MOVED_FROM','BOOKING_MOVED_TO'
 ]);
 assert.equal(f.count('booking_moves'),1);
});
test('HTTP move to occupied slot gives 409 and preserves original booking',async(t)=>{
 const f=await fixture(t);
 const old=await f.send('POST',bookingEndpoint,'alice',f.booked);
 const other=await f.send('POST',bookingEndpoint,'bob',{
  ...f.booked,staffId:'s1',bedId:'b1',startMinute:630,
  idempotencyKey:'another-http-booking-01'
 });
 assert.equal(other.status,201);
 const failed=await f.send('POST',
  bookingEndpoint+'/'+old.json.data.bookingId+'/move','alice',{
   serviceDate:'2026-10-26',menuId:'m60',
   staffId:'s1',bedId:'b1',startMinute:630,
   idempotencyKey:'http-conflict-move-001'
  });
 assert.equal(failed.status,409);
 assert.equal(failed.json.error.code,'SLOT_UNAVAILABLE');
 assert.equal(f.count('booking_moves'),0);
 assert.equal(f.count('booking_cancellations'),0);
 assert.equal(f.count('booking_records'),2);
});
test('HTTP cross-day move preserves owner identity; foreign customer cannot perform move',async(t)=>{
 const f=await fixture(t);
 const saved=await f.send('POST',bookingEndpoint,'alice',f.booked);
 const url=bookingEndpoint+'/'+saved.json.data.bookingId+'/move';
 const target={serviceDate:'2026-10-27',menuId:'m60',
  staffId:'s2',bedId:'b3',startMinute:540,
  idempotencyKey:'http-nextday-move-001'};
 const forbidden=await f.send('POST',url,'bob',target);
 assert.equal(forbidden.status,403);
 assert.equal(forbidden.json.error.code,'NOT_BOOKING_OWNER');
 const denied=await f.send('POST',url,'staffB',target);
 assert.equal(denied.status,403);
 const moved=await f.send('POST',url,'alice',target);
 assert.equal(moved.status,200);
 assert.equal(moved.json.data.serviceDate,'2026-10-27');
 const next=(await f.send('GET',
  '/v0.63/stores/A/bookings?date=2026-10-27','alice')).json.data;
 assert.equal(next.length,1);
 assert.equal(next[0].owner_subject_id,'alice');
 assert.equal(next[0].source,'website');
 const before=(await f.send('GET',listing,'bob')).json.data;
 assert.equal(before.length,0);
});
test('HTTP repeated move returns same booking, conflicting retry returns 409',async(t)=>{
 const f=await fixture(t);
 const saved=await f.send('POST',bookingEndpoint,'alice',f.booked);
 const url=bookingEndpoint+'/'+saved.json.data.bookingId+'/move';
 const body={serviceDate:'2026-10-26',menuId:'m60',
  staffId:'s2',bedId:'b3',startMinute:630,
  idempotencyKey:'repeated-move-key-001'};
 const first=await f.send('POST',url,'alice',body);
 const second=await f.send('POST',url,'alice',body);
 assert.equal(first.status,200);
 assert.equal(second.status,200);
 assert.equal(second.json.data.replayed,true);
 assert.equal(first.json.data.bookingId,second.json.data.bookingId);
 const reused=await f.send('POST',url,'alice',{...body,startMinute:645});
 assert.equal(reused.status,409);
 assert.equal(reused.json.error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal(f.count('booking_records'),2);
});
test('HTTP move rejects forged store/owner/identity without mutation',async(t)=>{
 const f=await fixture(t);
 const saved=await f.send('POST',bookingEndpoint,'alice',f.booked);
 const url=bookingEndpoint+'/'+saved.json.data.bookingId+'/move';
 const params={serviceDate:'2026-10-26',menuId:'m60',
  staffId:'s2',bedId:'b3',startMinute:630,
  idempotencyKey:'anti-spoof-move-key-001'};
 for(const extras of [
  {storeId:'B'},{sessionHandle:'staffA'},{ownerSubjectId:'bob'},
  {bookingId:'fake'},{source:'hpb'},{customer:'test'}
 ]){
  const out=await f.send('POST',url,'alice',{...params,...extras});
  assert.equal(out.status,400);
  assert.equal(out.json.error.code,'UNEXPECTED_FIELD');
 }
 assert.equal(f.count('booking_records'),1);
 assert.equal(f.count('booking_moves'),0);
});
test('HTTP audit persistence failure returns generic error and does not change original booking',async(t)=>{
 const f=await fixture(t);
 const saved=await f.send('POST',bookingEndpoint,'alice',f.booked);
 const url=bookingEndpoint+'/'+saved.json.data.bookingId+'/move';
 f.db.exec("CREATE TRIGGER fail_move_audit BEFORE INSERT ON booking_audit_events WHEN NEW.action='BOOKING_MOVED_TO' BEGIN SELECT RAISE(ABORT,'secret audit diagnostic'); END;");
 const params={serviceDate:'2026-10-26',menuId:'m60',
  staffId:'s2',bedId:'b3',startMinute:630,
  idempotencyKey:'audit-fail-move-key-001'};
 const failed=await f.send('POST',url,'alice',params);
 assert.equal(failed.status,500);
 assert.equal(failed.json.error.code,'INTERNAL_FAILURE');
 assert.ok(!JSON.stringify(failed.json).includes('secret'));
 assert.equal(f.count('booking_records'),1);
 assert.equal(f.count('booking_moves'),0);
 assert.equal(f.count('booking_cancellations'),0);
 f.db.exec('DROP TRIGGER fail_move_audit');
 assert.equal((await f.send('POST',url,'alice',params)).status,200);
});
