/* MVP-C: In-memory LINE notification/rebooking design trial.
   No LINE SDK, no HTTP, no browser storage, no identity or customer data.
   Uses exactly the preserved v0.57 DemoCore booking/waitlist logic.
*/
(function(root){
'use strict';
const DAY='2026-11-12',BOOK_DAY='2026-11-13';
const DAY_MS=86400000;
const dates=s=>new Date(s+'T00:00:00.000Z').getTime();
const stamp=n=>new Date(n).toISOString().slice(0,10);
const addDays=(date,n)=>stamp(dates(date)+n*DAY_MS);
const dayDiff=(later,earlier)=>Math.round((dates(later)-dates(earlier))/DAY_MS);
const idSafe=x=>typeof x==='string'&&/^[a-z0-9_-]+$/i.test(x);
function initial(Core){
  const model=Core.initial();
  // All names, visits and LINE statuses in the demo are fictional.
  const customers=[
   {id:'c1',name:'架空のお客様A',cycle:[ '2026-09-10','2026-10-08','2026-11-05'],returnConsent:true,reminderConsent:true,waitlistConsent:false},
   {id:'c2',name:'架空のお客様B',cycle:[ '2026-09-17','2026-10-15'],returnConsent:true,reminderConsent:true,waitlistConsent:true},
   {id:'c3',name:'架空のお客様C',cycle:[ '2026-10-10'],returnConsent:false,reminderConsent:false,waitlistConsent:false},
   {id:'c4',name:'架空のお客様D',cycle:[ '2026-08-20','2026-09-17','2026-10-15'],returnConsent:true,reminderConsent:false,waitlistConsent:true},
   {id:'c5',name:'架空のお客様E',cycle:[ '2026-08-23','2026-09-20','2026-10-18'],returnConsent:false,reminderConsent:true,waitlistConsent:true}
  ];
  // The existing demo has waiter w1; in this fictional scenario it belongs to c4.
  model.waiters[0].consent=true;
  return {now:DAY,bookingDate:BOOK_DAY,model,customers,
   drafts:[],audit:[],nextDraft:1,canceledRelease:null,conversions:[]};
}
const copy=(Core,s)=>Core.clone(s);
const customer=(s,id)=>s.customers.find(x=>x.id===id);
const draft=(s,id)=>s.drafts.find(x=>x.id===id);
function calculateCycle(c){
  if(!c||!Array.isArray(c.cycle)||c.cycle.length<2)return null;
  const visits=[...c.cycle].sort();
  const intervals=[];
  for(let i=1;i<visits.length;i++){
   const diff=dayDiff(visits[i],visits[i-1]);
   if(diff<14||diff>120)return null;
   intervals.push(diff);
  }
  const days=Math.round(intervals.reduce((a,b)=>a+b,0)/intervals.length);
  return {days,next:addDays(visits.at(-1),days),basis:intervals.length};
}
function result(s,Core,handler){
 const next=copy(Core,s);
 try{const outcome=handler(next);return {ok:true,state:next,code:'OK',message:outcome||'操作しました（架空）。'};}
 catch(err){return {ok:false,state:s,code:err.code||'REJECTED',message:err.message||'操作を確認してください。'};}
}
function reject(code,message){const err=new Error(message);err.code=code;throw err;}
function requireCustomer(s,id){const c=customer(s,id);if(!c)reject('NOT_FOUND','対象が見つかりません。');return c;}
function activeBooking(s,c){
 return s.model.bookings.some(b=>b.status==='CONFIRMED'&&b.customer===c.name);
}
function consentFor(c,type){
 return type==='reminder'?c.reminderConsent:
  type==='return'?c.returnConsent:type==='waitlist'?c.waitlistConsent:false;
}
function findExisting(s,type,cid){
 return s.drafts.find(d=>d.type===type&&d.customerId===cid&&
  d.status!=='SUPPRESSED'&&d.status!=='CANCELED');
}
function textFor(type,c,details){
 if(type==='reminder')return '【模擬プレビュー】'+c.name+'：明日'+BOOK_DAY+'のご予約を確認してください。日時・コースをご確認いただけます。';
 if(type==='return')return '【模擬プレビュー】'+c.name+'：次回来店の目安（'+details.next+'）が近づいています。ご希望でしたら空き時間をご確認ください。';
 return '【模擬プレビュー】'+c.name+'：キャンセルで空いた'+BOOK_DAY+'の'+details.time+'枠をご案内します。空き状況は確定時に再確認します。';
}
function addDraft(s,type,cid,details={}){
 const c=requireCustomer(s,cid);
 if(!consentFor(c,type))reject('NO_CONSENT','この種類の案内に同意がありません。');
 if(findExisting(s,type,cid))reject('DUPLICATE','同じ種類の案内がすでにあります。');
 if(type==='return'){
   const recent=s.drafts.some(d=>d.customerId===cid&&d.type==='return'&&
    d.status==='SIMULATED_SENT'&&dayDiff(s.now,d.sentAt)<7);
   if(recent)reject('FREQUENCY_LIMIT','再来店案内は7日以内に繰り返しません。');
 }
 const d={id:'d'+s.nextDraft++,type,customerId:cid,status:'DRAFT',
  text:textFor(type,c,details),details,createdAt:s.now,
  approvedBy:null,sentAt:null,convertedBooking:null};
 s.drafts.push(d);s.audit.push({action:'DRAFT_CREATED',type,id:d.id});
 return '案内文を作成しました。まだ送信していません。';
}
function prepare(s,Core,type,cid){
 return result(s,Core,n=>{
  const c=requireCustomer(n,cid);
  if(type==='reminder'){
   if(!n.model.bookings.some(b=>b.status==='CONFIRMED'&&b.customer===c.name))
    reject('NO_UPCOMING_BOOKING','対象の確定済み予約がありません。');
   return addDraft(n,type,cid,{date:n.bookingDate});
  }
  if(type==='return'){
   const cycle=calculateCycle(c);
   if(!cycle)reject('NOT_ENOUGH_HISTORY','来店周期を算出できません。手動確認が必要です。');
   if(dayDiff(cycle.next,n.now)>10)reject('NOT_DUE','来店目安の10日前より前です。');
   if(activeBooking(n,c))reject('ALREADY_BOOKED','確定済みの予約があるため再来店案内は作成しません。');
   return addDraft(n,type,cid,cycle);
  }
  reject('INVALID_TYPE','この案内種類には対応していません。');
 });
}
function cancelForWaitlist(s,Core){
 return result(s,Core,n=>{
  if(n.canceledRelease!==null)reject('ALREADY_CANCELED','取消枠はすでに発生しています。');
  const b=n.model.bookings.find(x=>x.id===2);
  if(!b||b.status!=='CONFIRMED')reject('NO_BOOKING','取消の対象予約がありません。');
  const rid=Core.cancel(n.model,2);
  n.canceledRelease=rid;
  n.audit.push({action:'MOCK_CANCELED',bookingId:2,release:rid});
  return '架空の予約 #2 を取消しました。候補はまだ案内していません。';
 });
}
function prepareWaitlist(s,Core){
 return result(s,Core,n=>{
  if(n.canceledRelease===null)reject('NO_RELEASE','先に架空のキャンセル枠を発生させてください。');
  if(activeBooking(n,requireCustomer(n,'c4')))
   reject('ALREADY_BOOKED','確定予約があるお客様にはキャンセル待ちを重ねて案内しません。');
  const list=Core.candidates(n.model,n.canceledRelease);
  const allowed=list.find(w=>w.id==='w1'&&customer(n,'c4')?.waitlistConsent);
  if(!allowed)reject('NO_CANDIDATE','条件に合う同意済みの希望者がいません。');
  const offer=Core.offer(n.model,n.canceledRelease);
  const entry=n.model.offers.find(o=>o.id===offer);
  if(entry.waiter!==allowed.id)reject('CANDIDATE_MISMATCH','希望者の条件が一致しません。');
  return addDraft(n,'waitlist','c4',{offerId:offer,releaseId:n.canceledRelease,time:'10:30'});
 });
}
function setConsent(s,Core,id,type,enabled){
 return result(s,Core,n=>{
  const c=requireCustomer(n,id);
  const field=type==='reminder'?'reminderConsent':
   type==='return'?'returnConsent':type==='waitlist'?'waitlistConsent':null;
  if(!field||typeof enabled!=='boolean')reject('INVALID_CONSENT','設定を確認してください。');
  c[field]=enabled;
  if(type==='waitlist'&&id==='c4')n.model.waiters[0].consent=enabled;
  if(!enabled)for(const d of n.drafts.filter(x=>x.customerId===id&&x.type===type&&
   ['DRAFT','APPROVED'].includes(x.status))){
    d.status='SUPPRESSED';
    n.audit.push({action:'OPT_OUT_SUPPRESSED',id:d.id});
    if(d.type==='waitlist'){
     const offer=n.model.offers.find(x=>x.id===d.details.offerId);
     if(offer&&offer.status==='PENDING'){
      Core.decline(n.model,offer.id);
     }
    }
   }
  n.audit.push({action:'CONSENT_CHANGED',id,type,enabled});
  return enabled?'この種類の模擬案内を許可しました。':'この種類の案内を停止し、未配信候補を無効にしました。';
 });
}
function approve(s,Core,id){
 return result(s,Core,n=>{
  const d=draft(n,id);
  if(!d||d.status!=='DRAFT')reject('NOT_DRAFT','承認可能な下書きではありません。');
  const c=requireCustomer(n,d.customerId);
  if(!consentFor(c,d.type))reject('NO_CONSENT','配信同意がありません。');
  d.status='APPROVED';d.approvedBy='架空の店舗オーナー';
  n.audit.push({action:'OWNER_APPROVED',id});
  return '店舗オーナーが模擬承認しました。まだ外部には送信していません。';
 });
}
function simulateDelivery(s,Core,id){
 return result(s,Core,n=>{
  const d=draft(n,id);
  if(!d||d.status!=='APPROVED')reject('NOT_APPROVED','店舗の承認が必要です。');
  const c=requireCustomer(n,d.customerId);
  if(!consentFor(c,d.type))reject('NO_CONSENT','配信同意がありません。');
  if((d.type==='return'||d.type==='waitlist')&&activeBooking(n,c))
   reject('ALREADY_BOOKED','すでに確定予約があるため案内を停止しました。');
  if(d.type==='reminder'&&!activeBooking(n,c))
   reject('NO_UPCOMING_BOOKING','対象予約がなくなったためリマインドを停止しました。');
  if(d.type==='return'){
   const sent=n.drafts.some(x=>x.id!==id&&x.type==='return'&&
     x.customerId===d.customerId&&x.status==='SIMULATED_SENT'&&
     dayDiff(n.now,x.sentAt)<7);
   if(sent)reject('FREQUENCY_LIMIT','7日以内に同じお客様へ再来店案内済みです。');
  }
  d.status='SIMULATED_SENT';d.sentAt=n.now;
  n.audit.push({action:'SIMULATED_DELIVERY_ONLY',id});
  return '配信済みとして架空の記録を追加しました。LINEには送信していません。';
 });
}
function acceptInvitation(s,Core,id){
 return result(s,Core,n=>{
  const d=draft(n,id);
  if(!d||d.status!=='SIMULATED_SENT')reject('NOT_DELIVERED','架空の案内を先に承認・配信記録してください。');
  if(d.convertedBooking!==null)reject('ALREADY_CONVERTED','すでに予約を記録しています。');
  const c=requireCustomer(n,d.customerId);
  if(d.type==='return'){
   if(activeBooking(n,c))reject('ALREADY_BOOKED','すでに有効な予約があります。');
   const req={menu:'m60',staff:'s2',bed:'b3',start:960};
   if(!Core.canBook(n.model,req).ok)reject('SLOT_UNAVAILABLE','希望時間が埋まっています。');
   const bid=Core.book(n.model,{...req,customer:c.name,source:'line',discovery:'unknown'});
   d.convertedBooking=bid;
   n.conversions.push({draftId:id,bookingId:bid,kind:'REVISIT_SIMULATION'});
  }else if(d.type==='waitlist'){
   if(activeBooking(n,c))reject('ALREADY_BOOKED','すでに確定予約があります。');
   const offer=n.model.offers.find(x=>x.id===d.details.offerId);
   if(!offer||offer.status!=='PENDING')reject('NOT_PENDING','空き枠の案内が有効ではありません。');
   if(!c.waitlistConsent)reject('NO_CONSENT','キャンセル待ち案内の同意がありません。');
   // Use a staged clone: Core.accept checks resource availability before booking.
   const bid=Core.accept(n.model,offer.id,true);
   const booking=n.model.bookings.find(x=>x.id===bid);
   if(booking){booking.customer=c.name;booking.source='line';booking.discovery='unknown';}
   d.convertedBooking=bid;
   n.conversions.push({draftId:id,bookingId:bid,kind:'CANCEL_RECOVERY_SIMULATION'});
  }else reject('NO_ACTION','リマインドからの新規予約を勝手に計上しません。');
  n.audit.push({action:'SIMULATED_BOOKING',id,bookingId:d.convertedBooking});
  return '架空の予約が成立しました。実際のLINE送信・来店・売上は発生していません。';
 });
}
function numbers(s){
 const simulated=s.drafts.filter(x=>x.status==='SIMULATED_SENT').length;
 return {drafts:s.drafts.filter(x=>x.status==='DRAFT').length,
  approved:s.drafts.filter(x=>x.status==='APPROVED').length,
  simulated,bookings:s.conversions.length,
  recovered:s.conversions.filter(x=>x.kind==='CANCEL_RECOVERY_SIMULATION').length,
  actualDelivered:null,actualVisits:null,actualRevenue:null};
}
root.RebookingDemo=Object.freeze({
 initial,calculateCycle,prepare,cancelForWaitlist,prepareWaitlist,
 setConsent,approve,simulateDelivery,acceptInvitation,numbers,DAY,BOOK_DAY
});
})(typeof module==='object'&&module.exports?module.exports:window);
