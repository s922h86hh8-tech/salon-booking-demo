/**
 * v0.62 — loopback-only, fictional reservation HTTP integration harness.
 * NOT a production server, login system, public customer API, or live booking.
 * No real customers, external services, email/SMS, money, advertising or payments.
 */
import {createServer} from 'node:http';

const segment=/^[A-Za-z0-9_-]{1,128}$/;
const MAX_BODY=16384;
const badRequestCodes=new Set([
 'INVALID_FIELDS','INVALID_STORE','INVALID_DATE','INVALID_BOOKING_INPUT',
 'INVALID_CONFIGURATION'
]);
const forbiddenCodes=new Set([
 'STORE_ACCESS_DENIED','NOT_BOOKING_OWNER','ROLE_FORBIDDEN'
]);
const conflicts=new Set([
 'SLOT_UNAVAILABLE','IDEMPOTENCY_CONFLICT','ALREADY_CANCELLED'
]);
const missing=new Set(['BOOKING_NOT_FOUND','DATE_NOT_CONFIGURED']);
class HttpProblem extends Error{
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
function fail(status,code){throw new HttpProblem(status,code);}
function respond(res,status,payload){
 res.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none';frame-ancestors 'none'"
 });
 res.end(JSON.stringify(payload));
}
function mapError(err){
 if(err instanceof HttpProblem)return {status:err.status,code:err.code};
 if(err?.code==='UNAUTHENTICATED')return {status:401,code:err.code};
 if(badRequestCodes.has(err?.code))return {status:400,code:err.code};
 if(forbiddenCodes.has(err?.code))return {status:403,code:err.code};
 if(conflicts.has(err?.code))return {status:409,code:err.code};
 if(missing.has(err?.code))return {status:404,code:'RESOURCE_NOT_FOUND'};
 return {status:500,code:'INTERNAL_FAILURE'};
}
function route(req,port){
 let u,parts;
 try{
  u=new URL(req.url||'/', 'http://127.0.0.1:'+port);
  parts=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
 }catch{fail(400,'INVALID_PATH');}
 if(u.hostname!=='127.0.0.1'||(u.port&&u.port!==String(port)))
  fail(400,'INVALID_HOST');
 if(parts.some((x,i)=>!(i===0&&x==='v0.62')&&!segment.test(x)))
  fail(400,'INVALID_PATH');
 if(parts[0]!=='v0.62'||parts[1]!=='stores'||!parts[2])
  fail(404,'ROUTE_NOT_FOUND');
 const storeId=parts[2],search=u.searchParams;
 if([...search.keys()].some(x=>!['date','menuId','staffId','bedId','startMinute'].includes(x)))
  fail(400,'UNEXPECTED_QUERY');
 for(const key of search.keys())if(search.getAll(key).length!==1)fail(400,'DUPLICATE_QUERY');
 const query=Object.fromEntries(search.entries());
 if(req.method==='POST'&&parts.length===4&&parts[3]==='bookings'&&search.size===0)
  return {type:'reserve',storeId};
 if(req.method==='POST'&&parts.length===6&&parts[3]==='bookings'&&
  parts[5]==='cancel'&&search.size===0)
  return {type:'cancel',storeId,bookingId:parts[4]};
 if(req.method==='GET'&&parts.length===4&&parts[3]==='bookings'&&
  search.size===1&&search.has('date'))
  return {type:'list',storeId,serviceDate:query.date};
 if(req.method==='GET'&&parts.length===4&&parts[3]==='availability'&&
  search.size===5&&['date','menuId','staffId','bedId','startMinute']
  .every(x=>search.has(x)))
  return {type:'available',storeId,serviceDate:query.date,
   menuId:query.menuId,staffId:query.staffId,bedId:query.bedId,
   startMinute:Number(query.startMinute)};
 if(req.method==='GET'&&parts.length===4&&parts[3]==='booking-audit'&&search.size===0)
  return {type:'audit',storeId};
 fail(404,'ROUTE_NOT_FOUND');
}
async function jsonBody(req){
 const media=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
 if(media!=='application/json')fail(415,'JSON_REQUIRED');
 let size=0,tooLarge=false;
 const chunks=[];
 for await(const part of req){
  size+=part.length;
  if(size>MAX_BODY){tooLarge=true;chunks.length=0;continue;}
  if(!tooLarge)chunks.push(part);
 }
 if(tooLarge)fail(413,'BODY_TOO_LARGE');
 let obj;
 try{obj=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{fail(400,'INVALID_JSON');}
 if(!obj||typeof obj!=='object'||Array.isArray(obj))fail(400,'JSON_OBJECT_REQUIRED');
 return obj;
}
function onlyFields(obj,allowed){
 if(Object.keys(obj).some(key=>!allowed.includes(key)))fail(400,'UNEXPECTED_FIELD');
}
function bearer(req,resolveOpaqueToken){
 const header=req.headers.authorization;
 if(typeof header!=='string'||!/^Bearer [A-Za-z0-9_-]{20,200}$/.test(header))
  fail(401,'TEST_TOKEN_REQUIRED');
 const handle=resolveOpaqueToken(header.slice(7));
 if(typeof handle!=='string'||!handle)fail(401,'TEST_TOKEN_REQUIRED');
 return handle;
}
export function createLocalBookingApi({
 bookingStore,resolveOpaqueToken,fictionalTestOnly=false
}={}){
 if(fictionalTestOnly!==true||!bookingStore||
  typeof bookingStore.reserve!=='function'||typeof bookingStore.cancel!=='function'||
  typeof bookingStore.list!=='function'||typeof bookingStore.available!=='function'||
  typeof bookingStore.audit!=='function'||typeof resolveOpaqueToken!=='function')
  throw new Error('LOCAL_FICTIONAL_TEST_MODE_REQUIRED');
 let listening=false,port=null;
 const server=createServer(async(req,res)=>{
  try{
   if(req.socket.remoteAddress!=='127.0.0.1'||
     req.headers.host!=='127.0.0.1:'+port)fail(403,'LOOPBACK_ONLY');
   if(req.headers.origin!==undefined||req.headers.cookie!==undefined)
    fail(403,'BROWSER_ORIGIN_NOT_ALLOWED');
   if(!['GET','POST'].includes(req.method))fail(405,'METHOD_NOT_ALLOWED');
   const r=route(req,port),handle=bearer(req,resolveOpaqueToken);
   let result,status=200;
   if(r.type==='reserve'){
    const body=await jsonBody(req);
    onlyFields(body,['serviceDate','menuId','staffId','bedId','startMinute',
     'idempotencyKey','source','discovery']);
    result=bookingStore.reserve({...body,sessionHandle:handle,storeId:r.storeId});
    status=result.replayed?200:201;
   }else if(r.type==='cancel'){
    const body=await jsonBody(req);
    onlyFields(body,['idempotencyKey']);
    result=bookingStore.cancel({
     ...body,sessionHandle:handle,storeId:r.storeId,bookingId:r.bookingId
    });
   }else if(r.type==='list'){
    result=bookingStore.list({
     sessionHandle:handle,storeId:r.storeId,serviceDate:r.serviceDate
    });
   }else if(r.type==='available'){
    result=bookingStore.available({sessionHandle:handle,
     storeId:r.storeId,serviceDate:r.serviceDate,menuId:r.menuId,
     staffId:r.staffId,bedId:r.bedId,startMinute:r.startMinute
    });
   }else if(r.type==='audit'){
    result=bookingStore.audit({sessionHandle:handle,storeId:r.storeId});
   }
   respond(res,status,{ok:true,data:result});
  }catch(e){
   const {status,code}=mapError(e);
   respond(res,status,{ok:false,error:{code}});
  }
 });
 return Object.freeze({
  async listen(){
   if(listening)throw Error('ALREADY_STARTED');
   await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
     server.removeListener('error',reject);resolve();
    });
   });
   port=server.address().port;listening=true;
   return 'http://127.0.0.1:'+port;
  },
  async close(){
   if(!listening)return;
   await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
   listening=false;port=null;
  }
 });
}
