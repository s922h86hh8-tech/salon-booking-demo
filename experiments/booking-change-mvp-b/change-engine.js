/* Isolated MVP-B booking change simulator, in-memory only.
 * Deliberately NOT connected to v0.63 SQLite or HTTP API.
 * All records are fictional. The v0.57 DemoCore is used unchanged.
 */
(function(root){
 'use strict';
 const validDay=/^\d{4}-\d{2}-\d{2}$/;
 const idString=x=>typeof x==='string'&&x.length>0;
 function bookingAt(models,ref){
  const model=ref&&models[ref.day];
  if(!model)return null;
  const booking=model.bookings.find(x=>String(x.id)===String(ref.id));
  return booking?{day:ref.day,booking,model}:null;
 }
 function check({Core,models,ref,target}){
  if(!Core||!models||!target||!idString(target.day)||
     !validDay.test(target.day)||!models[target.day])
   return {ok:false,code:'DAY_NOT_AVAILABLE',reason:'この日付は選択できません。'};
  const old=bookingAt(models,ref);
  if(!old||old.booking.status!=='CONFIRMED')
   return {ok:false,code:'ORIGINAL_UNAVAILABLE',reason:'変更前の有効な予約が見つかりません。'};
  if(!idString(target.menu)||!idString(target.staff)||!idString(target.bed)||
     !Number.isInteger(target.start))
   return {ok:false,code:'INVALID_REQUEST',reason:'変更先を確認してください。'};
  if(ref.day===target.day&&old.booking.menu===target.menu&&
     old.booking.staff===target.staff&&old.booking.bed===target.bed&&
     old.booking.start===target.start)
   return {ok:false,code:'NO_CHANGE',reason:'変更前と同じ内容です。'};
  const result=Core.canBook(models[target.day],{
   menu:target.menu,staff:target.staff,bed:target.bed,start:target.start
  },target.day===ref.day?old.booking.id:null);
  return {ok:!!result.ok,code:result.ok?'AVAILABLE':'SLOT_UNAVAILABLE',
   reason:result.reason};
 }
 function move({Core,models,ref,target,history=[],actor='架空のお客様（デモ）',
  occurredAt='2026-11-10T00:00:00.000Z'}){
  const valid=check({Core,models,ref,target});
  if(!valid.ok)return {ok:false,code:valid.code,reason:valid.reason,models,ref,history};
  // Copy only the two affected days. The caller's state is not modified until
  // Core.book completes on these isolated copies.
  const nextModels={...models};
  nextModels[ref.day]=Core.clone(models[ref.day]);
  if(target.day!==ref.day)nextModels[target.day]=Core.clone(models[target.day]);
  const origin=nextModels[ref.day].bookings.find(x=>String(x.id)===String(ref.id));
  if(!origin||origin.status!=='CONFIRMED')
   return {ok:false,code:'ORIGINAL_UNAVAILABLE',reason:'元の予約が変更されています。',models,ref,history};
  // Staged cancellation frees its resources before the standard Core.book call.
  origin.status='CANCELLED';
  origin.cancellationReason='MOVE';
  const destination=nextModels[target.day];
  let newId;
  try{
   newId=Core.book(destination,{
    menu:target.menu,staff:target.staff,bed:target.bed,start:target.start,
    customer:origin.customer,source:origin.source,discovery:origin.discovery
   });
  }catch(error){
   // Staged copies are discarded. No cancellation or booking is committed.
   return {ok:false,code:'SLOT_UNAVAILABLE',
    reason:'変更先の確定に失敗しました。元の予約は有効です。',models,ref,history};
  }
  const nextRef={day:target.day,id:newId};
  origin.movedTo={...nextRef};
  const added=destination.bookings.find(x=>String(x.id)===String(newId));
  added.previousRef={day:ref.day,id:ref.id};
  const event={
   type:'MOVE',from:{day:ref.day,id:ref.id,start:origin.start,
    menu:origin.menu,staff:origin.staff,bed:origin.bed},
   to:{...nextRef,start:added.start,menu:added.menu,
    staff:added.staff,bed:added.bed},
   actor,occurredAt
  };
  return {ok:true,code:'MOVED',reason:'変更が確定しました（架空）。',
   models:nextModels,ref:nextRef,history:[...history,event]};
 }
 function options({Core,models,ref,day,menu,staff='any'}){
  if(!models[day])return [];
  const list=[];
  const original=bookingAt(models,ref);
  if(!original||original.booking.status!=='CONFIRMED')return [];
  const staffs=models[day].staff.filter(s=>staff==='any'||s.id===staff);
  for(let start=540;start<=1020;start+=15){
   let first=null;
   for(const person of staffs){
    // When date, course, practitioner and start are unchanged, do not offer
    // an invisible bed-only change to the customer.
    if(day===ref.day&&menu===original.booking.menu&&
       person.id===original.booking.staff&&start===original.booking.start)
     continue;
    for(const bed of models[day].beds){
     const target={day,menu,staff:person.id,bed:bed.id,start};
     if(check({Core,models,ref,target}).ok){first=target;break;}
    }
    if(first)break;
   }
   if(first)list.push(first);
  }
  return list;
 }
 root.BookingChangeDemo=Object.freeze({bookingAt,check,move,options});
})(typeof module==='object'&&module.exports?module.exports:window);
