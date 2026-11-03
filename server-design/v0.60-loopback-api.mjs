/**
 * v0.60 — loopback-only JSON API harness for fictional integration tests.
 * NOT a production server, authentication provider, browser endpoint, or real
 * employee identity system. Never deploy this harness or enter real data.
 *
 * Credentials are random opaque tokens supplied by the test fixture. Only a
 * trusted, injected in-process token->session handle lookup can resolve them.
 * A real service MUST replace this with audited authentication/session handling.
 */
import {createServer} from 'node:http';

const MAX_BODY_BYTES=16*1024;
const SAFE_SEGMENT=/^[A-Za-z0-9_-]{1,128}$/;
const DENIAL_CODES=new Set([
 'UNAUTHENTICATED','INACTIVE_MEMBERSHIP',
 'MEMBERSHIP_PRINCIPAL_MISMATCH','ROLE_FORBIDDEN',
 'CROSS_STORE_DENIED','NOT_OWN_STATEMENT',
 'SELF_APPROVAL_FORBIDDEN','INVALID_APPROVAL_REQUEST'
]);
const CONFLICT_CODES=new Set([
 'ALREADY_REVIEWED','IDEMPOTENCY_CONFLICT',
 'CONCURRENT_VERSION_CHANGE','NEGATIVE_ADJUSTED_AMOUNT',
 'INVALID_ADJUSTMENT','INVALID_SNAPSHOT'
]);
const NOT_FOUND_CODES=new Set([
 'CLOSING_NOT_FOUND','SOURCE_NOT_FOUND','REQUEST_NOT_FOUND',
 'PROJECTION_NOT_FOUND'
]);
class ApiError extends Error{
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
function fail(status,code){throw new ApiError(status,code);}
function send(res,status,body){
 res.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, private, max-age=0',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"
 });
 res.end(JSON.stringify(body));
}
function mapError(error){
 if(error instanceof ApiError)return {status:error.status,code:error.code};
 if(DENIAL_CODES.has(error?.code))return {
  status:error.code==='UNAUTHENTICATED'?401:403,code:error.code
 };
 if(CONFLICT_CODES.has(error?.code))return {status:409,code:error.code};
 if(NOT_FOUND_CODES.has(error?.code))return {status:404,code:'RESOURCE_NOT_FOUND'};
 if(error?.code==='INVALID_TARGET'||error?.code==='INVALID_STORE_ID'||
   error?.code==='INVALID_IDEMPOTENCY_KEY'||error?.code==='INVALID_REASON')
  return {status:400,code:error.code};
 // Never disclose SQL details, tokens, stack traces or filesystem paths.
 return {status:500,code:'INTERNAL_FAILURE'};
}
function parseRoute(req,port){
 const path=new URL(req.url||'/', 'http://127.0.0.1');
 if(path.hostname!=='127.0.0.1'||path.port&&path.port!==String(port))
  fail(400,'INVALID_TARGET');
 const parts=path.pathname.split('/').filter(Boolean).map(decodeURIComponent);
 if(parts.some(part=>!SAFE_SEGMENT.test(part)))fail(400,'INVALID_PATH');
 if(parts[0]!=='v0.60'||parts[1]!=='stores'||!parts[2])fail(404,'NOT_FOUND');
 const storeId=parts[2];
 if(path.searchParams.size&&
    !(req.method==='GET'&&parts.length===4&&parts[3]==='audit-events'))
   fail(400,'UNKNOWN_QUERY');
 if(req.method==='POST'&&parts.length===4&&parts[3]==='correction-requests')
  return {operation:'request',storeId};
 if(req.method==='POST'&&parts.length===6&&parts[3]==='correction-requests'&&
    parts[5]==='decision')
  return {operation:'review',storeId,requestId:parts[4]};
 if(req.method==='GET'&&parts.length===6&&parts[3]==='staff'&&
    parts[5]==='statements')return {operation:'statement',storeId,staffId:parts[4]};
 if(req.method==='GET'&&parts.length===4&&parts[3]==='audit-events'){
  if([...path.searchParams.keys()].some(x=>x!=='requestId')||
    path.searchParams.getAll('requestId').length>1)fail(400,'UNKNOWN_QUERY');
  const requestId=path.searchParams.get('requestId');
  if(requestId!==null&&!SAFE_SEGMENT.test(requestId))fail(400,'INVALID_QUERY');
  return {operation:'audit',storeId,requestId};
 }
 fail(404,'NOT_FOUND');
}
async function readJson(req){
 const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
 if(type!=='application/json')fail(415,'JSON_REQUIRED');
 let bytes=0,oversized=false;
 const chunks=[];
 for await(const part of req){
  bytes+=part.length;
  if(bytes>MAX_BODY_BYTES){oversized=true;chunks.length=0;continue;}
  if(!oversized)chunks.push(part);
 }
 if(oversized)fail(413,'BODY_TOO_LARGE');
 let result;
 try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{fail(400,'INVALID_JSON');}
 if(result===null||Array.isArray(result)||typeof result!=='object')
  fail(400,'OBJECT_REQUIRED');
 return result;
}
function onlyFields(data,allowed){
 if(Object.keys(data).some(k=>!allowed.includes(k)))fail(400,'UNEXPECTED_FIELD');
}
function bearer(req,resolveOpaqueToken){
 const header=req.headers.authorization;
 if(typeof header!=='string'||!/^Bearer [A-Za-z0-9_-]{20,200}$/.test(header))
  fail(401,'AUTH_REQUIRED');
 const token=header.slice(7);
 const handle=resolveOpaqueToken(token);
 if(typeof handle!=='string'||!handle)fail(401,'AUTH_REQUIRED');
 return handle;
}
export function createLoopbackApi({
 store,resolveOpaqueToken,explicitFictionalTestMode=false
}={}){
 if(explicitFictionalTestMode!==true||typeof resolveOpaqueToken!=='function'||
   !store||typeof store.requestCorrection!=='function'||
   typeof store.reviewCorrection!=='function'||
   typeof store.statement!=='function'||typeof store.audit!=='function')
  throw new Error('FICTIONAL_LOCAL_TEST_ONLY');
 let listening=false;
 let activePort=null;
 const server=createServer(async(req,res)=>{
  try{
   // Loopback-only bind AND request-level host/origin checks. No CORS.
   if(req.socket.remoteAddress!=='127.0.0.1'||
      req.headers.host!==('127.0.0.1:'+activePort))
    fail(403,'LOCAL_ONLY');
   if(req.headers.origin!==undefined||req.headers.cookie!==undefined)
    fail(403,'BROWSER_ORIGIN_NOT_ALLOWED');
   if(req.method!=='GET'&&req.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
   const route=parseRoute(req,activePort);
   const handle=bearer(req,resolveOpaqueToken);
   let value,status=200;
   if(route.operation==='request'){
    const body=await readJson(req);
    onlyFields(body,['closingId','sourceId','kind','delta','reason','idempotencyKey']);
    value=store.requestCorrection({sessionHandle:handle,storeId:route.storeId,
     ...body});
    status=value.replayed?200:201;
   }else if(route.operation==='review'){
    const body=await readJson(req);
    onlyFields(body,['decision','reason']);
    value=store.reviewCorrection({sessionHandle:handle,storeId:route.storeId,
     requestId:route.requestId,...body});
   }else if(route.operation==='statement'){
    value=store.statement({sessionHandle:handle,storeId:route.storeId,
     staffId:route.staffId});
   }else if(route.operation==='audit'){
    value=store.audit({sessionHandle:handle,storeId:route.storeId,
     requestId:route.requestId});
   }else fail(404,'NOT_FOUND');
   send(res,status,{ok:true,data:value});
  }catch(error){
   const {status,code}=mapError(error);
   send(res,status,{ok:false,error:{code}});
  }
 });
 return Object.freeze({
  async listen(){
   if(listening)throw new Error('ALREADY_LISTENING');
   // Not configurable by caller: never bind 0.0.0.0, ::, or a public interface.
   await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
     server.removeListener('error',reject);
     resolve();
    });
   });
   listening=true;activePort=server.address().port;
   return 'http://127.0.0.1:'+activePort;
  },
  async close(){
   if(!listening)return;
   await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
   listening=false;activePort=null;
  }
 });
}
