// v0.60 loopback integration, fictional identities and fictional money only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {randomBytes} from 'node:crypto';
import {openLocalPrototype} from '../server-design/v0.60-local-transaction-store.mjs';
import {createLoopbackApi} from '../server-design/v0.60-loopback-api.mjs';

async function fixture(t){
 const sessions={
  maker:{userId:'alice',authenticated:true},
  checker:{userId:'bob',authenticated:true},
  therapist:{userId:'staff-user',authenticated:true},
  other:{userId:'other',authenticated:true},
  inactive:{userId:'inactive',authenticated:true},
  desk:{userId:'desk',authenticated:true}
 };
 const tokens=Object.fromEntries(Object.keys(sessions).map(k=>[
  k,randomBytes(24).toString('base64url')
 ]));
 const byToken=new Map(Object.keys(tokens).map(k=>[tokens[k],k]));
 const dbApp=openLocalPrototype({
  resolveSession:handle=>Object.hasOwn(sessions,handle)?sessions[handle]:null,
  clock:()=>new Date('2026-11-03T07:10:11.000Z')
 });
 const db=dbApp.unsafeDbForTests;
 for(const [id,name] of [['A','架空店舗A'],['B','架空店舗B']])
  db.prepare('INSERT INTO stores(store_id,store_name) VALUES(?,?)').run(id,name);
 for(const [userId,active] of [
  ['alice',1],['bob',1],['staff-user',1],['other',1],['inactive',0],['desk',1]
 ])db.prepare('INSERT INTO users(user_id,display_name,active) VALUES(?,?,?)')
   .run(userId,'架空担当 '+userId,active);
 for(const [storeId,userId,role,staffId,active] of [
  ['A','alice','manager',null,1],
  ['A','bob','owner',null,1],
  ['A','staff-user','therapist','staff-A',1],
  ['B','other','owner',null,1],
  ['A','inactive','manager',null,1],
  ['A','desk','receptionist',null,1]
 ])db.prepare(
  'INSERT INTO store_memberships(store_id,user_id,role,staff_id,active) VALUES(?,?,?,?,?)'
 ).run(storeId,userId,role,staffId,active);
 for(const [storeId,closeId,sourceId,staffId] of [
  ['A','closing-1','source-1','staff-A'],
  ['A','closing-2','source-2','staff-B'],
  ['B','closing-1','source-1','staff-A']
 ]){
  db.prepare(
   'INSERT INTO monthly_closings(store_id,closing_id,staff_id,month,original_total) VALUES(?,?,?,?,?)'
  ).run(storeId,closeId,staffId,'2026-10',2400);
  db.prepare(
   'INSERT INTO closing_projections(store_id,closing_id,version,net_total) VALUES(?,?,0,2400)'
  ).run(storeId,closeId);
  db.prepare(
   'INSERT INTO earnings_source_lines(store_id,closing_id,source_id,original_amount,contract_version) VALUES(?,?,?,2400,2)'
  ).run(storeId,closeId,sourceId);
 }
 const api=createLoopbackApi({
  explicitFictionalTestMode:true,store:dbApp,
  resolveOpaqueToken:token=>byToken.get(token)||null
 });
 const base=await api.listen();
 t.after(async()=>{await api.close();dbApp.close()});
 const postBody={
  closingId:'closing-1',sourceId:'source-1',kind:'refund',delta:-400,
  reason:'架空の返金に伴う報酬訂正',idempotencyKey:'test-request-key-01'
 };
 async function send(method,path,as='maker',body=null,extraHeaders={}){
  const url=new URL(path,base);
  const payload=body===null?null:typeof body==='string'?body:JSON.stringify(body);
  const headers={
   ...(as===null?{}:{Authorization:'Bearer '+(tokens[as]||'invalid_token_that_is_long_enough')}),
   ...(payload===null?{}:{'Content-Type':'application/json'}),
   ...extraHeaders
  };
  const data=await new Promise((resolve,reject)=>{
   const req=httpRequest(url,{method,headers},res=>{
    const chunks=[];
    res.on('data',chunk=>chunks.push(chunk));
    res.on('end',()=>{
     try{resolve({status:res.statusCode,headers:res.headers,
      json:JSON.parse(Buffer.concat(chunks).toString('utf8'))})}
     catch(e){reject(e)}
    });
   });
   req.on('error',reject);
   if(payload!==null)req.write(payload);
   req.end();
  });
  return data;
 }
 const count=(table)=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
 return {api,base,tokens,postBody,send,db,dbApp,count};
}

test('loopback harness requires explicit fictional mode and never uses public bind address',async(t)=>{
 assert.throws(()=>createLoopbackApi(),/FICTIONAL_LOCAL_TEST_ONLY/);
 const f=await fixture(t);
 assert.match(f.base,/^http:\/\/127\.0\.0\.1:\d+$/);
 assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
});
test('missing, invalid and forged identity headers are refused before accessing stored data',async(t)=>{
 const f=await fixture(t);
 for(const as of [null,'unknown']){
  const res=await f.send('GET','/v0.60/stores/A/staff/staff-A/statements',as);
  assert.equal(res.status,401);
  assert.equal(res.json.ok,false);
 }
 for(const as of ['inactive','other']){
  const res=await f.send('GET','/v0.60/stores/A/staff/staff-A/statements',as);
  assert.ok([401,403].includes(res.status));
 }
 const cookie=await f.send('GET','/v0.60/stores/A/staff/staff-A/statements',
  'therapist',null,{Cookie:'session=foo'});
 assert.equal(cookie.status,403);
 assert.equal(cookie.json.error.code,'BROWSER_ORIGIN_NOT_ALLOWED');
});
test('therapist reads own store statement only; another staff or other store is denied',async(t)=>{
 const f=await fixture(t);
 const own=await f.send('GET','/v0.60/stores/A/staff/staff-A/statements','therapist');
 assert.equal(own.status,200);
 assert.equal(own.json.data.length,1);
 assert.equal(own.json.data[0].effectiveTotal,2400);
 const others=await f.send('GET','/v0.60/stores/A/staff/staff-B/statements','therapist');
 assert.equal(others.status,403);
 assert.equal(others.json.error.code,'NOT_OWN_STATEMENT');
 const foreign=await f.send('GET','/v0.60/stores/B/staff/staff-A/statements','therapist');
 assert.equal(foreign.status,403);
});
test('request then different-person approval runs through HTTP and writes atomic audit',async(t)=>{
 const f=await fixture(t),endpoint='/v0.60/stores/A/correction-requests';
 const request=await f.send('POST',endpoint,'maker',f.postBody);
 assert.equal(request.status,201);
 assert.equal(request.json.data.status,'PENDING');
 const id=request.json.data.requestId;
 assert.equal(f.dbApp.statement({sessionHandle:'therapist',storeId:'A',staffId:'staff-A'})[0].effectiveTotal,2400);
 const ownApproval=await f.send('POST',endpoint+'/'+id+'/decision','maker',{decision:'APPROVE'});
 assert.equal(ownApproval.status,403);
 assert.equal(ownApproval.json.error.code,'SELF_APPROVAL_FORBIDDEN');
 const approved=await f.send('POST',endpoint+'/'+id+'/decision','checker',{decision:'APPROVE'});
 assert.equal(approved.status,200);
 assert.equal(approved.json.data.status,'APPROVED');
 assert.equal(approved.json.data.reviewedByUserId,'bob');
 assert.equal(approved.json.data.monthBefore,2400);
 assert.equal(approved.json.data.monthAfter,2000);
 const after=await f.send('GET','/v0.60/stores/A/staff/staff-A/statements','therapist');
 assert.equal(after.status,200);
 assert.equal(after.json.data[0].originalTotal,2400);
 assert.equal(after.json.data[0].effectiveTotal,2000);
 const history=await f.send('GET','/v0.60/stores/A/audit-events?requestId='+id,'checker');
 assert.equal(history.status,200);
 assert.equal(history.json.data.length,2);
 assert.deepEqual(history.json.data.map(x=>x.actor_user_id),['alice','bob']);
 assert.deepEqual(history.json.data.map(x=>x.actor_name_snapshot),
  ['架空担当 alice','架空担当 bob']);
 assert.ok(history.json.data[0].event_seq<history.json.data[1].event_seq);
 assert.ok(history.json.data.every(x=>x.occurred_at==='2026-11-03T07:10:11.000Z'));
 assert.equal(f.count('correction_adjustments'),1);
});
test('request replay preserves ID and no duplicate audit; second approval conflicts',async(t)=>{
 const f=await fixture(t),endpoint='/v0.60/stores/A/correction-requests';
 const first=await f.send('POST',endpoint,'maker',f.postBody);
 const again=await f.send('POST',endpoint,'maker',f.postBody);
 assert.equal(again.status,200);
 assert.equal(again.json.data.replayed,true);
 assert.equal(again.json.data.requestId,first.json.data.requestId);
 assert.equal(f.count('audit_events'),1);
 const conflict=await f.send('POST',endpoint,'maker',{...f.postBody,delta:-200});
 assert.equal(conflict.status,409);
 assert.equal(conflict.json.error.code,'IDEMPOTENCY_CONFLICT');
 await f.send('POST',endpoint+'/'+first.json.data.requestId+'/decision','checker',{decision:'APPROVE'});
 const second=await f.send('POST',endpoint+'/'+first.json.data.requestId+'/decision','checker',{decision:'APPROVE'});
 assert.equal(second.status,409);
 assert.equal(second.json.error.code,'ALREADY_REVIEWED');
});
test('rejected and stale approvals do not change money',async(t)=>{
 const f=await fixture(t),endpoint='/v0.60/stores/A/correction-requests';
 const original=await f.send('POST',endpoint,'maker',f.postBody);
 const shortReason=await f.send('POST',endpoint+'/'+original.json.data.requestId+'/decision',
  'checker',{decision:'REJECT',reason:'短'});
 assert.equal(shortReason.status,400);
 assert.equal(shortReason.json.error.code,'REJECTION_REASON_REQUIRED');
 const rejection=await f.send('POST',endpoint+'/'+original.json.data.requestId+'/decision',
  'checker',{decision:'REJECT',reason:'架空の根拠確認ができません'});
 assert.equal(rejection.status,200);
 assert.equal(rejection.json.data.status,'REJECTED');
 assert.equal(f.count('correction_adjustments'),0);
 assert.equal(f.dbApp.statement({sessionHandle:'therapist',storeId:'A',staffId:'staff-A'})[0].effectiveTotal,2400);
 const stale=await f.send('POST',endpoint,'maker',{
  ...f.postBody,idempotencyKey:'test-request-key-02',delta:-100
 });
 const id=stale.json.data.requestId;
 f.db.prepare('INSERT INTO payment_records(store_id,closing_id,payment_id,amount,recorded_at) VALUES(?,?,?,?,?)')
  .run('A','closing-1','payment-1',300,'2026-11-03T07:00:00.000Z');
 const response=await f.send('POST',endpoint+'/'+id+'/decision','checker',{decision:'APPROVE'});
 assert.equal(response.status,200);
 assert.equal(response.json.data.status,'STALE');
 assert.equal(f.count('correction_adjustments'),0);
});
test('front desk cannot correct and cannot read audit, despite valid token',async(t)=>{
 const f=await fixture(t);
 const request=await f.send('POST','/v0.60/stores/A/correction-requests','desk',f.postBody);
 assert.equal(request.status,403);
 const history=await f.send('GET','/v0.60/stores/A/audit-events','desk');
 assert.equal(history.status,403);
 assert.equal(f.count('correction_requests'),0);
});
test('unknown paths, methods, content types, query and unexpected fields fail closed',async(t)=>{
 const f=await fixture(t);
 const path='/v0.60/stores/A/correction-requests';
 assert.equal((await f.send('POST',path,'maker',f.postBody,{'Content-Type':'text/plain'})).status,415);
 assert.equal((await f.send('POST',path,'maker',{...f.postBody,userId:'bob'})).status,400);
 assert.equal((await f.send('POST',path,'maker','{bad json')).status,400);
 assert.equal((await f.send('POST',path,'maker',null)).status,415);
 assert.equal((await f.send('GET','/v0.60/stores/A/staff/staff-A/statements?all=true','therapist')).status,400);
 assert.equal((await f.send('GET','/v0.60/stores/A/nope','maker')).status,404);
 assert.equal((await f.send('DELETE',path,'maker')).status,405);
 assert.equal((await f.send('POST',path,'maker',f.postBody,{Origin:'https://example.com'})).status,403);
 assert.equal(f.count('correction_requests'),0);
});
test('overlarge body is rejected without any correction or audit',async(t)=>{
 const f=await fixture(t);
 const body=JSON.stringify({...f.postBody,reason:'x'.repeat(17000)});
 const res=await f.send('POST','/v0.60/stores/A/correction-requests','maker',body);
 assert.equal(res.status,413);
 assert.equal(f.count('correction_requests'),0);
 assert.equal(f.count('audit_events'),0);
});
test('HTTP response disables caching and generic storage errors never leak internals',async(t)=>{
 const f=await fixture(t);
 const r=await f.send('GET','/v0.60/stores/A/staff/staff-A/statements','therapist');
 assert.match(r.headers['cache-control'],/no-store/);
 assert.equal(r.headers['x-content-type-options'],'nosniff');
 assert.equal(r.headers['x-frame-options'],'DENY');
 assert.ok(!JSON.stringify(r.json).includes('token'));
});

test('server-side actor name snapshot is immutable after later account display-name edits',async(t)=>{
 const f=await fixture(t),endpoint='/v0.60/stores/A/correction-requests';
 const initial=await f.send('POST',endpoint,'maker',f.postBody);
 assert.equal(initial.status,201);
 f.db.prepare('UPDATE users SET display_name=? WHERE user_id=?')
  .run('変更された架空名','alice');
 const approved=await f.send('POST',endpoint+'/'+initial.json.data.requestId+'/decision',
  'checker',{decision:'APPROVE'});
 assert.equal(approved.status,200);
 const history=await f.send('GET','/v0.60/stores/A/audit-events?requestId='+
  initial.json.data.requestId,'checker');
 assert.equal(history.status,200);
 assert.equal(history.json.data[0].actor_name_snapshot,'架空担当 alice');
 assert.equal(history.json.data[1].actor_name_snapshot,'架空担当 bob');
 assert.equal(history.json.data[0].occurred_at,'2026-11-03T07:10:11.000Z');
});
