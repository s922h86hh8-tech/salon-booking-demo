/* MVP-B fictional browser-only reservation-change UX.
 * Uses copied v0.57 DemoCore for availability and BookingChangeDemo for
 * in-memory staged commit. This is NOT the v0.63 SQLite/API implementation.
 */
(function(){
 'use strict';
 const Core=window.DemoCore,Change=window.BookingChangeDemo;
 if(!Core||!Change)throw Error('架空の予約変更エンジンがありません');
 const $=id=>document.getElementById(id);
 const days={'2026-10-26':'2026年10月26日（月）','2026-10-27':'2026年10月27日（火）'};
 const dayIds=Object.keys(days);
 function makeState(){
  const first=Core.initial();
  const id=Core.book(first,{
   menu:'m60',staff:'s2',bed:'b3',start:540,
   customer:'架空・操作体験のお客様',source:'website',discovery:'google'
  });
  const second=Core.initial();
  second.bookings=[];second.nextBooking=100;
  second.events=[];
  return {models:{[dayIds[0]]:first,[dayIds[1]]:second},
   ref:{day:dayIds[0],id},history:[],selection:null,phase:'choose'};
 }
 let state=makeState(),stageChoice=null;
 function node(tag,className='',txt=''){
  const el=document.createElement(tag);
  if(className)el.className=className;
  el.textContent=String(txt);
  return el;
 }
 const append=(parent,item)=>{parent.appendChild(item);return item;};
 function clear(el){el.replaceChildren();}
 function text(id,value){$(id).textContent=String(value);}
 function notice(value,error=false){
  text('notice',value);
  $('notice').classList.toggle('is-error',error);
 }
 const time=minutes=>Core.clock(minutes);
 const price=n=>Number(n).toLocaleString('ja-JP')+'円';
 function details(booking,day){
  const model=state.models[day];
  const m=model.menus.find(x=>x.id===booking.menu);
  const staff=model.staff.find(x=>x.id===booking.staff);
  return {
   date:days[day]||day,
   when:time(booking.start)+'開始',
   menu:m?.name||'不明なコース',
   staff:staff?.name||'担当不明',
   price:price(m?.price||0)
  };
 }
 function summaryBlock(target,info){
  clear(target);
  append(target,node('strong','',info.date+'　'+info.when));
  append(target,node('small','',info.menu+' ／ '+info.staff));
  append(target,node('small','','料金（架空）：'+info.price));
 }
 function fill(select,values){
  const prev=select.value;
  clear(select);
  for(const [id,label] of values){
   const option=node('option','',label);option.value=id;append(select,option);
  }
  select.value=values.some(x=>x[0]===prev)?prev:(values[0]?.[0]||'');
 }
 function active(){
  return Change.bookingAt(state.models,state.ref);
 }
 function renderCurrent(){
  const record=active(),host=$('currentBooking');
  clear(host);
  if(!record){
   append(host,node('p','','有効な予約がありません。'));
   text('currentStatus','確認が必要');
   return;
  }
  const d=details(record.booking,state.ref.day);
  summaryBlock(host,d);
  text('currentStatus','予約番号 '+state.ref.day+' / #'+record.booking.id+'（架空）');
 }
 function selections(){
  const day=$('changeDay').value,menu=$('changeMenu').value,staff=$('changeStaff').value;
  return Change.options({Core,models:state.models,ref:state.ref,day,menu,staff});
 }
 function renderTimes(){
  const options=selections(),host=$('changeTimes');
  clear(host);
  if(stageChoice&&!options.some(v=>matches(stageChoice,v)))stageChoice=null;
  if(!options.length){
   append(host,node('p','empty-time','この条件の空き時間はありません。日付・コース・担当者を変更してください。'));
  }
  for(const choice of options){
   const button=node('button','time'+(stageChoice&&matches(stageChoice,choice)?' is-selected':''),time(choice.start));
   button.type='button';
   button.setAttribute('aria-pressed',stageChoice&&matches(stageChoice,choice)?'true':'false');
   button.addEventListener('click',()=>{
    stageChoice={...choice};
    renderTimes();
   });
   append(host,button);
  }
  if(stageChoice){
   const d=state.models[stageChoice.day],course=d.menus.find(x=>x.id===stageChoice.menu),
    staff=d.staff.find(x=>x.id===stageChoice.staff);
   text('chosenSummary',days[stageChoice.day]+' '+time(stageChoice.start)+' ／ '+course.name+' ／ '+staff.name+'（確定前）');
  }else{
   text('chosenSummary','空き時間を選択してください。選択だけでは元の予約は変わりません。');
  }
  $('goReview').disabled=!stageChoice;
 }
 function matches(a,b){
  return !!a&&!!b&&a.day===b.day&&a.menu===b.menu&&
   a.staff===b.staff&&a.bed===b.bed&&a.start===b.start;
 }
 function setPhase(next){
  state.phase=next;
  $('chooseStage').hidden=next!=='choose';
  $('reviewStage').hidden=next!=='review';
  $('resultStage').hidden=next!=='result';
  for(const [id,selected] of [['step1',true],['step2',next==='choose'],['step3',next!=='choose']]){
   $(id).classList.toggle('step-active',selected);
  }
  if(next==='choose')renderTimes();
 }
 function chooseTab(tab){
  for(const name of ['customer','desk']){
   $('panel-'+name).hidden=name!==tab;
   const tabButton=document.querySelector('[data-tab="'+name+'"]');
   tabButton.classList.toggle('is-active',name===tab);
   tabButton.setAttribute('aria-selected',name===tab?'true':'false');
  }
  if(tab==='desk')renderDesk();
 }
 function renderReview(){
  if(!stageChoice)return;
  const original=active();
  if(!original){showResult(false,'予約が見つかりません','変更前の予約が見つかりません。');return;}
  summaryBlock($('beforeDetails'),details(original.booking,state.ref.day));
  const previewBooking={menu:stageChoice.menu,staff:stageChoice.staff,start:stageChoice.start};
  summaryBlock($('afterDetails'),details(previewBooking,stageChoice.day));
  setPhase('review');
  notice('変更前・変更後を比較してください。まだ変更は確定していません。');
 }
 function showResult(ok,title,message){
  text('resultIcon',ok?'✓':'!');
  $('resultIcon').classList.toggle('is-error',!ok);
  text('resultTitle',title);
  text('resultMessage',message);
  setPhase('result');
  notice(message,!ok);
 }
 function confirmMove(){
  if(!stageChoice){setPhase('choose');return;}
  const oldRef={...state.ref},target={...stageChoice};
  const outcome=Change.move({
   Core,models:state.models,ref:state.ref,target,history:state.history,
   actor:'架空・予約変更のお客様',occurredAt:'2026-11-10T09:00:00.000Z'
  });
  if(!outcome.ok){
   showResult(false,'希望枠に変更できませんでした',
    '元の予約（'+days[oldRef.day]+'）は確定済みのままです。'+outcome.reason);
   return;
  }
  state.models=outcome.models;
  state.ref=outcome.ref;
  state.history=outcome.history;
  stageChoice=null;
  renderCurrent();renderDesk();
  showResult(true,'予約を変更しました（架空）',
   days[outcome.ref.day]+' '+time(target.start)+'開始に変更しました。変更前の予約も履歴に残しています。実際の通知はありません。');
 }
 function simulateConflict(){
  if(!stageChoice)return;
  const target={...stageChoice},model=state.models[target.day];
  if(!Core.canBook(model,{
   menu:target.menu,staff:target.staff,bed:target.bed,start:target.start
  }).ok){
   notice('この枠は元予約の影響で競合の再現ができません。別の時間を選んでください。',true);
   return;
  }
  try{
   Core.book(model,{
    menu:target.menu,staff:target.staff,bed:target.bed,start:target.start,
    customer:'架空・別のお客様の先行予約',
    source:'website',discovery:'unknown'
   });
   notice('別のお客様の架空予約が希望枠に入りました。「模擬変更を確定」で、元の予約が残る動作を試してください。',true);
  }catch(error){
   notice('競合の再現に失敗しました。元の予約は変更されていません。',true);
  }
 }
 function stat(host,label,value){
  const card=append(host,node('div','metric'));
  append(card,node('small','',label));
  append(card,node('strong','',value));
 }
 function renderDesk(){
  const metrics=$('metrics');clear(metrics);
  const all=dayIds.flatMap(day=>state.models[day].bookings.map(b=>({day,booking:b})));
  stat(metrics,'架空の有効予約',all.filter(x=>x.booking.status==='CONFIRMED').length+'件');
  stat(metrics,'予約変更回数',state.history.length+'件');
  stat(metrics,'変更前の保存履歴',all.filter(x=>x.booking.cancellationReason==='MOVE').length+'件');
  const root=$('bookingList');clear(root);
  all.sort((a,b)=>a.day.localeCompare(b.day)||a.booking.start-b.booking.start);
  for(const item of all){
   const b=item.booking,d=details(b,item.day);
   const row=append(root,node('article','booking-row'+(b.status==='CANCELLED'?' is-closed':'')));
   append(row,node('strong','','#'+b.id+'　'+d.date+'　'+d.when));
   append(row,node('small','',d.menu+' ／ '+d.staff+' ／ '+b.customer));
   append(row,node('span','tag'+(b.status==='CANCELLED'?' is-canceled':''),
    b.status==='CANCELLED'?'元予約・取消済み':'確定済み（架空）'));
   if(b.cancellationReason==='MOVE'&&b.movedTo){
    append(row,node('span','tag is-move','移動先 '+b.movedTo.day+' / #'+b.movedTo.id));
   }
   if(b.previousRef){
    append(row,node('span','tag is-move','変更元 '+b.previousRef.day+' / #'+b.previousRef.id));
   }
  }
  const hist=$('history');clear(hist);
  if(!state.history.length)append(hist,node('p','helper','変更履歴はまだありません。'));
  for(const log of state.history){
   const row=append(hist,node('article','history-row'));
   append(row,node('strong','',days[log.from.day]+' '+time(log.from.start)+' → '+days[log.to.day]+' '+time(log.to.start)));
   append(row,node('small','',log.actor+' ／ 架空の記録時刻 '+log.occurredAt));
   append(row,node('small','','元番号 #'+log.from.id+' → 新番号 #'+log.to.id));
  }
 }
 function reset(){
  if(!window.confirm('架空予約・変更履歴を初期状態に戻しますか？'))return;
  state=makeState();stageChoice=null;
  $('changeDay').value=dayIds[0];
  $('changeMenu').value='m60';
  $('changeStaff').value='any';
  renderCurrent();renderDesk();setPhase('choose');chooseTab('customer');
  notice('初期の架空予約に戻しました。実際の予約・データは変更していません。');
 }
 function setup(){
  const first=state.models[dayIds[0]];
  fill($('changeMenu'),first.menus.map(x=>[x.id,x.name+'（'+price(x.price)+'）']));
  fill($('changeStaff'),[['any','指名なし'],...first.staff.map(s=>[s.id,s.name])]);
  $('changeMenu').value='m60';
  document.querySelectorAll('[data-tab]').forEach(button=>
   button.addEventListener('click',()=>chooseTab(button.dataset.tab))
  );
  for(const id of ['changeDay','changeMenu','changeStaff']){
   $(id).addEventListener('change',()=>{stageChoice=null;renderTimes();});
  }
  $('goReview').addEventListener('click',renderReview);
  $('backToChoose').addEventListener('click',()=>{setPhase('choose');notice('変更先の選択に戻りました。元の予約は有効です。');});
  $('confirmMove').addEventListener('click',confirmMove);
  $('simulateConflict').addEventListener('click',simulateConflict);
  $('resultBack').addEventListener('click',()=>{
   setPhase('choose');
   notice('現在の予約を確認して、次の変更先を選んでください。');
  });
  $('resultDesk').addEventListener('click',()=>chooseTab('desk'));
  $('returnCustomer').addEventListener('click',()=>chooseTab('customer'));
  $('resetDemo').addEventListener('click',reset);
  renderCurrent();renderDesk();setPhase('choose');chooseTab('customer');
 }
 setup();
})();
