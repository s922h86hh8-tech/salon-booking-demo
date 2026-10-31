// v0.48 booking hand-off tray. Works only with fictional in-memory day contexts.
// Original booking remains confirmed until an explicit target and confirmation succeed.
let stagedBookingMove=null;
function sourceStagedBooking(){
 if(!stagedBookingMove)return null;
 const ctx=stagedBookingMove.day===selectedDemoDay
   ?{model,receipts:demoReceipts}:demoDayContexts.get(stagedBookingMove.day);
 const booking=ctx?.model.bookings.find(b=>b.id===stagedBookingMove.bookingId&&b.status==='CONFIRMED');
 return booking?{ctx,booking}:null;
}
function renderBookingMoveTray(){
 const tray=$('bookingMoveTray'),card=$('bookingMoveCard'),label=$('bookingMoveLabel');
 const active=sourceStagedBooking();
 tray.classList.toggle('active',!!active);
 card.hidden=!active;
 $('bookingMoveCancel').hidden=!active;
 if(!active){
  stagedBookingMove=null;
  label.textContent='予約枠の「移動」をここへドラッグ（タップでも可）';
  return;
 }
 const menu=active.ctx.model.menus.find(m=>m.id===active.booking.menu);
 label.textContent='元の予約：'+displayDemoDay(stagedBookingMove.day)+' '+Core.clock(active.booking.start);
 card.textContent=(menu?.name||'コース')+'｜'+shortScheduleCustomer(active.booking.customer)+'　↗ 移動先へ';
 card.setAttribute('aria-label',label.textContent+' '+card.textContent+'。新しい時間へドラッグ、または空き枠をタップ');
}
function stageBookingMove(bookingId){
 const booking=model.bookings.find(b=>b.id===bookingId&&b.status==='CONFIRMED');
 if(!booking){info('移動できる予約がありません。',true);return false;}
 if(demoReceipts.some(r=>r.bookingId===booking.id)){
  info('会計済みの予約は移動できません。会計訂正・返金の手続きが必要です。',true);
  return false;
 }
 if(stagedBookingMove&&(stagedBookingMove.day!==selectedDemoDay||stagedBookingMove.bookingId!==bookingId)){
  info('すでに仮置きがあります。先に移動を確定するか、仮置きを解除してください。',true);
  return false;
 }
 stagedBookingMove={day:selectedDemoDay,bookingId:booking.id};
 quickMenuId=null;
 renderStaffSchedule();
 renderBookingMoveTray();
 return true;
}
function cancelStagedBookingMove(){
 stagedBookingMove=null;
 renderBookingMoveTray();
 if(page==='booking')renderStaffSchedule();
}
function movePlanFor(staffId,time){
 const found=sourceStagedBooking();
 if(!found||!Number.isInteger(time)||time%15!==0)return {ok:false,reason:'仮置きの予約を確認してください'};
 const booking=found.booking,fromDay=stagedBookingMove.day,toDay=selectedDemoDay;
 if(fromDay===toDay&&staffId===booking.staff&&time===booking.start)return {ok:false,reason:'移動前と同じ日時です'};
 const sourceCtx=found.ctx;
 // A confirmed booking is not silently moved once a checkout record exists.
 if(sourceCtx.receipts.some(r=>r.bookingId===booking.id))return {ok:false,reason:'会計済みの予約は移動できません'};
 const targetCtx=fromDay===toDay?sourceCtx:(demoDayContexts.get(toDay)||freshDemoDayContext());
 const sourceModel=Core.clone(sourceCtx.model);
 const old=sourceModel.bookings.find(b=>b.id===booking.id&&b.status==='CONFIRMED');
 if(!old)return {ok:false,reason:'元の予約が変更されています'};
 const destModel=fromDay===toDay?sourceModel:Core.clone(targetCtx.model);
 old.status='CANCELLED'; // historical ghost; no cancellation-waitlist offer is created
 old.movedTo=toDay;
 const menu=destModel.menus.find(m=>m.id===booking.menu);
 const staff=destModel.staff.find(p=>p.id===staffId);
 if(!menu||!staff)return {ok:false,reason:'コースまたはスタッフを確認してください'};
 const beds=[...destModel.beds].sort((a,b)=>Number(b.id===booking.bed)-Number(a.id===booking.bed));
 let fail='担当者・ベッド・休憩・準備時間の重複を確認してください';
 for(const bed of beds){
  const draft=Core.clone(destModel);
  try{
   const id=Core.book(draft,{menu:booking.menu,staff:staffId,bed:bed.id,start:time,
     customer:booking.customer,source:booking.source,discovery:booking.discovery});
   const originalService=Core.serviceFor(sourceCtx.model,booking);
   if(originalService!==menu.duration)Core.changeService(draft,id,originalService);
   const originalPrep=Core.prepFor(sourceCtx.model,booking);
   if(originalPrep!==Core.prepFor(draft,draft.bookings.find(b=>b.id===id)))Core.changePrep(draft,id,originalPrep);
   const placed=draft.bookings.find(b=>b.id===id);
   // Verify final duration, rest and available resources again after custom time lengths.
   const check=Core.canBook(draft,placed,id);
   if(!check.ok)throw Error(check.reason);
   return {ok:true,sourceCtx,targetCtx,sourceModel,targetModel:draft,fromDay,toDay,
     original:booking,placed,staff,bed,menu};
  }catch(err){fail=err.message||fail;}
 }
 return {ok:false,reason:fail};
}
function confirmBookingMove(staffId,time){
 const plan=movePlanFor(staffId,time);
 if(!plan.ok){info(plan.reason,true);return false;}
 const description='予約を移動しますか？\n'+plan.original.customer+
  '\n変更前：'+displayDemoDay(plan.fromDay)+' '+Core.clock(plan.original.start)+
  '\n変更後：'+displayDemoDay(plan.toDay)+' '+Core.clock(time)+
  '\n担当：'+plan.staff.name+' ／ ベッド：'+plan.bed.name+
  '\n\n確認するまで元の予約は残っています。';
 if(!window.confirm(description))return false;
 // Revalidate in the same event after confirmation before mutating any visible day.
 const verified=movePlanFor(staffId,time);
 if(!verified.ok){info(verified.reason,true);return false;}
 if(verified.fromDay===verified.toDay){
  model=verified.targetModel;
  const existing=demoDayContexts.get(selectedDemoDay);
  if(existing)existing.model=model;
 }else{
  verified.sourceCtx.model=verified.sourceModel;
  verified.targetCtx.model=verified.targetModel;
  demoDayContexts.set(verified.fromDay,verified.sourceCtx);
  demoDayContexts.set(verified.toDay,verified.targetCtx);
  model=verified.targetModel;
 }
 stagedBookingMove=null;
 selectedUnassigned=null;
 checkoutBookingId=null;
 $('checkoutBooking').replaceChildren();
 renderBookingMoveTray();
 go('booking');
 info('予約を移動しました。元の予約は薄く履歴に残ります。');
 return true;
}
function wireBookingMoveHandle(button,booking){
 button.type='button';
 button.setAttribute('aria-label',booking.customer+'の予約を仮置きへ');
 let down=null,ghost=null,suppress=false;
 const cleanup=()=>{button.classList.remove('moving');if(ghost){ghost.remove();ghost=null;}};
 button.addEventListener('pointerdown',ev=>{
  if(ev.pointerType==='mouse'&&ev.button!==0)return;
  down={id:ev.pointerId,x:ev.clientX,y:ev.clientY,moved:false};
  button.setPointerCapture(ev.pointerId);ev.preventDefault();ev.stopPropagation();
 });
 button.addEventListener('pointermove',ev=>{
  if(!down||down.id!==ev.pointerId)return;
  if(Math.hypot(ev.clientX-down.x,ev.clientY-down.y)>9)down.moved=true;
  if(!down.moved)return;
  if(!ghost){ghost=node('div','move-drag-ghost',shortScheduleCustomer(booking.customer)+' → 仮置き');document.body.appendChild(ghost);}
  ghost.style.left=ev.clientX+'px';ghost.style.top=ev.clientY+'px';
  button.classList.add('moving');
 });
 button.addEventListener('pointerup',ev=>{
  if(!down||down.id!==ev.pointerId)return;
  const moved=down.moved;down=null;cleanup();ev.stopPropagation();
  if(moved){
   suppress=true;window.setTimeout(()=>{suppress=false},160);
   const r=$('bookingMoveTray').getBoundingClientRect();
   if(ev.clientX>=r.left&&ev.clientX<r.right&&ev.clientY>=r.top&&ev.clientY<r.bottom)stageBookingMove(booking.id);
   else info('上の「予約の仮置き」へ移動してください。');
  }else stageBookingMove(booking.id);
 });
 button.addEventListener('pointercancel',()=>{down=null;cleanup();});
 button.addEventListener('click',ev=>{
  ev.preventDefault();ev.stopPropagation();
  if(suppress){suppress=false;return;}
  if(!down)stageBookingMove(booking.id);
 });
}
function wireBookingMoveChip(){
 const chip=$('bookingMoveCard');
 let down=null,ghost=null,preview=null,suppress=false;
 function cleanup(){
  if(ghost){ghost.remove();ghost=null;}
  if(preview){preview.remove();preview=null;}
 }
 function paint(x,y){
  if(!down?.moved)return;
  const target=quickDropFromPoint(x,y);
  if(preview){preview.remove();preview=null;}
  if(!ghost){ghost=node('div','move-drag-ghost','移動先の時間へ');document.body.appendChild(ghost);}
  ghost.style.left=x+'px';ghost.style.top=y+'px';
  if(!target){ghost.textContent='予約を時間枠へ';ghost.classList.remove('blocked');return;}
  const p=movePlanFor(target.staffId,target.time);
  ghost.textContent=Core.clock(target.time)+(p.ok?' · 仮配置':' · 要調整');
  ghost.classList.toggle('blocked',!p.ok);
  const found=sourceStagedBooking();
  if(!found)return;
  const minutes=Core.serviceFor(found.ctx.model,found.booking);
  preview=node('div','quick-drop-hover'+(p.ok?'':' blocked'),p.ok?'仮配置':'要調整');
  preview.style.left=((target.time-540)/15*target.q+2)+'px';
  preview.style.width=(minutes/15*target.q-4)+'px';
  target.lane.appendChild(preview);
 }
 chip.addEventListener('pointerdown',ev=>{
  if(chip.hidden||(ev.pointerType==='mouse'&&ev.button!==0))return;
  down={id:ev.pointerId,x:ev.clientX,y:ev.clientY,moved:false};
  chip.setPointerCapture(ev.pointerId);ev.preventDefault();
 });
 chip.addEventListener('pointermove',ev=>{
  if(!down||down.id!==ev.pointerId)return;
  if(Math.hypot(ev.clientX-down.x,ev.clientY-down.y)>9)down.moved=true;
  paint(ev.clientX,ev.clientY);
 });
 chip.addEventListener('pointerup',ev=>{
  if(!down||down.id!==ev.pointerId)return;
  const moved=down.moved;down=null;
  const target=moved?quickDropFromPoint(ev.clientX,ev.clientY):null;
  cleanup();
  if(moved){
   suppress=true;window.setTimeout(()=>{suppress=false},160);
   if(target)confirmBookingMove(target.staffId,target.time);
   else info('移動先のスタッフと時間を選んでください。');
  }
 });
 chip.addEventListener('pointercancel',()=>{down=null;cleanup();});
 chip.addEventListener('click',ev=>{
  ev.preventDefault();
  if(suppress){suppress=false;return;}
  info('移動先の予約表をタップするか、ここから時間枠へドラッグしてください。');
 });
}
