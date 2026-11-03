/**
 * v0.58 — SERVER-SIDE AUTHORIZATION POLICY CONTRACT (NOT A DEPLOYED BACKEND).
 *
 * Pure, testable decision helpers. Call ONLY with principal/membership/resource
 * loaded and verified by a trusted server. The static demo does not call this.
 * This module performs NO authentication, storage, network, or payment actions.
 */
export const ROLES = Object.freeze(['owner', 'manager', 'receptionist', 'therapist']);
export const ACTIONS = Object.freeze([
  'booking.read', 'booking.write', 'checkout.read',
  'statement.read', 'correction.request', 'correction.review', 'audit.read'
]);

const GRANTS = Object.freeze({
  owner: Object.freeze(['booking.read','booking.write','checkout.read',
    'statement.read','correction.request','correction.review','audit.read']),
  manager: Object.freeze(['booking.read','booking.write','checkout.read',
    'statement.read','correction.request','correction.review','audit.read']),
  receptionist: Object.freeze(['booking.read','booking.write','checkout.read']),
  therapist: Object.freeze(['statement.read'])
});

const DENIAL = Object.freeze({
  INVALID:'INVALID_CONTEXT',
  UNAUTHENTICATED:'UNAUTHENTICATED',
  INACTIVE:'INACTIVE_MEMBERSHIP',
  WRONG_PRINCIPAL:'MEMBERSHIP_PRINCIPAL_MISMATCH',
  WRONG_STORE:'CROSS_STORE_DENIED',
  UNKNOWN:'UNKNOWN_ACTION_OR_ROLE',
  FORBIDDEN:'ROLE_FORBIDDEN',
  OWN_ONLY:'NOT_OWN_STATEMENT',
  INVALID_REQUEST:'INVALID_APPROVAL_REQUEST',
  SELF_APPROVAL:'SELF_APPROVAL_FORBIDDEN'
});
function deny(code){return Object.freeze({allowed:false,code});}
const allow=()=>Object.freeze({allowed:true,code:'ALLOW'});

function validId(x){return typeof x==='string'&&x.length>0&&x.length<=128;}
function validResource(r){return r&&validId(r.storeId);}
function validPrincipal(p){
 return p&&p.authenticated===true&&p.accountActive===true&&validId(p.userId);
}
/**
 * Permission check only; this is not a substitute for authentication.
 * principal, membership, resource, request MUST be read from trusted services.
 * Never derive identity, role, resource owner or request author from client JSON.
 */
export function decideAccess({principal,membership,action,resource,request=null}={}){
 if(!validResource(resource)||!validId(action))return deny(DENIAL.INVALID);
 if(!validPrincipal(principal))return deny(DENIAL.UNAUTHENTICATED);
 if(!membership||membership.active!==true)return deny(DENIAL.INACTIVE);
 if(!validId(membership.userId)||membership.userId!==principal.userId)
  return deny(DENIAL.WRONG_PRINCIPAL);
 if(!validId(membership.storeId)||membership.storeId!==resource.storeId)
  return deny(DENIAL.WRONG_STORE);
 if(!ACTIONS.includes(action)||!ROLES.includes(membership.role))
  return deny(DENIAL.UNKNOWN);
 if(!GRANTS[membership.role].includes(action))return deny(DENIAL.FORBIDDEN);

 if(action==='statement.read'&&membership.role==='therapist'){
  if(!validId(resource.staffId)||!validId(membership.staffId)||
     membership.staffId!==resource.staffId)return deny(DENIAL.OWN_ONLY);
 }
 if(action==='correction.review'){
  if(!request||!validId(request.id)||request.storeId!==resource.storeId||
    request.status!=='PENDING'||!validId(request.requestedByUserId))
   return deny(DENIAL.INVALID_REQUEST);
  if(request.requestedByUserId===principal.userId)
   return deny(DENIAL.SELF_APPROVAL);
 }
 return allow();
}
export function assertAllowed(params){
 const verdict=decideAccess(params);
 if(!verdict.allowed){
  const error=new Error('Operation denied: '+verdict.code);
  error.code=verdict.code;throw error;
 }
 return verdict;
}

/**
 * Request/decision atomicity is the responsibility of the backend transaction.
 * The values here are derived only after loading a locked snapshot from storage.
 * A stale request must not mutate payment or correction totals.
 */
export function evaluateCorrectionDecision({
 principal,membership,resource,request,current,decision,reason=''
}={}){
 assertAllowed({principal,membership,resource,request,action:'correction.review'});
 if(decision!=='APPROVE'&&decision!=='REJECT'){
  const err=new Error('Unknown decision');err.code='INVALID_DECISION';throw err;
 }
 if(decision==='REJECT'){
  if(typeof reason!=='string'||reason.trim().length<5||reason.trim().length>200){
   const err=new Error('A rejection reason of 5–200 characters is required');
   err.code='REJECTION_REASON_REQUIRED';throw err;
  }
  return Object.freeze({status:'REJECTED',apply:false,reason:reason.trim()});
 }
 const isInt=(x)=>Number.isSafeInteger(x);
 if(!request||!current||!validId(request.closingId)||
   !validId(request.sourceId)||request.closingId!==current.closingId||
   request.sourceId!==current.sourceId||current.storeId!==resource.storeId||
   !isInt(request.delta)||request.delta===0||
   !isInt(request.expectedVersion)||!isInt(current.version)||
   !isInt(request.sourceBefore)||!isInt(request.monthBefore)||
   !isInt(request.paidBefore)||
   !isInt(current.sourceNet)||!isInt(current.monthNet)||
   !isInt(current.paidTotal)||current.sourceNet<0||current.monthNet<0||
   current.paidTotal<0){
  const err=new Error('Invalid correction snapshot');err.code='INVALID_SNAPSHOT';throw err;
 }
 if(request.expectedVersion!==current.version||
   request.sourceBefore!==current.sourceNet||
   request.monthBefore!==current.monthNet||
   request.paidBefore!==current.paidTotal){
  return Object.freeze({status:'STALE',apply:false,
   reason:'The closing, source line or payment changed; request must be recreated'});
 }
 const adjustedSource=current.sourceNet+request.delta;
 const adjustedMonth=current.monthNet+request.delta;
 if(!isInt(adjustedSource)||!isInt(adjustedMonth)||
    adjustedSource<0||adjustedMonth<0){
  const err=new Error('Invalid adjusted amounts');err.code='INVALID_ADJUSTMENT';throw err;
 }
 return Object.freeze({status:'APPROVED',apply:true,delta:request.delta,
  sourceBefore:current.sourceNet,sourceAfter:adjustedSource,
  monthBefore:current.monthNet,monthAfter:adjustedMonth,
  nextVersion:current.version+1});
}
/**
 * Produces a proposed audit event payload. It does NOT write or sign it.
 * Event timestamp, eventId, principal, & transaction reference MUST be
 * created by trusted server/database code, never by the browser.
 */
export function makeAuditPayload({
 eventId,storeId,principal,action,subjectId,occurredAt,
 before,after,reason,requestId
}={}){
 if(!validId(eventId)||!validId(storeId)||!validId(principal?.userId)||
   !validId(action)||!validId(subjectId)||!validId(requestId)||
   typeof reason!=='string'||reason.trim().length<5||
   !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(occurredAt||'')||
   !Number.isFinite(Date.parse(occurredAt))||
   !Number.isSafeInteger(before)||!Number.isSafeInteger(after)){
  const err=new Error('Invalid audit payload');err.code='INVALID_AUDIT_PAYLOAD';throw err;
 }
 return Object.freeze({
  eventId,storeId,actorUserId:principal.userId,action,subjectId,requestId,
  occurredAt,before,after,reason:reason.trim()
 });
}
