/* MVP-A — fictional, in-memory integration trial.
 * Uses the exact v0.57 Core.canBook/Core.book engine; no persistent storage.
 * Do not accept real customer data or use this as a live booking page.
 */
(function(){
 'use strict';
 const Core=window.DemoCore;
 if(!Core)throw Error('予約判定エンジンが見つかりません');
 const $=id=>document.getElementById(id);
 const fakeDate='2026-10-26';
 const sourceNames=Object.freeze({
  hpb:'外部予約媒体（手入力）',line:'LINE（手入力）',website:'自店Web',
  google:'Google予約リンク（模擬）',phone:'電話',instore:'店頭',
  other:'その他',unknown:'不明'
 });
 const discoveryNames=Object.freeze({
  hpb:'外部集客媒体',line:'LINE',google:'Google検索・マップ',
  referral:'紹介',sns:'SNS',storefront:'店頭',other:'その他',unknown:'不明'
 });
 function initialConfig(){
  return {
   name:'架空・青空リラクゼーション',
   tagline:'いつもの一日に、静かな休息を。',
   area:'架空エリア・駅から徒歩数分という想定',
   intro:'スタッフに相談しながら、コースとお時間をお選びください。掲載内容・店舗・料金はすべて操作体験用の架空情報です。'
  };
 }
 let config=initialConfig(),model=Core.initial(),chosen=null,guestSerial=1,manualSerial=1;
 function element(tag,className='',text=''){
  const n=document.createElement(tag);
  if(className)n.className=className;
  if(text!==undefined)n.textContent=String(text);
  return n;
 }
 function add(parent,node){parent.appendChild(node);return node;}
 function clear(parent){parent.replaceChildren();}
 function text(id,value){$(id).textContent=String(value);}
 function notify(value){text('notice',value);}
 const price=n=>Number(n).toLocaleString('ja-JP')+'円';
 const time=n=>Core.clock(n);
 function fill(select,options){
  const previous=select.value;
  clear(select);
  for(const [value,label] of options){
   const opt=element('option','',label);opt.value=value;add(select,opt);
  }
  select.value=options.some(([v])=>v===previous)?previous:(options[0]?.[0]||'');
 }
 function activate(tab){
  for(const name of ['settings','guest','desk']){
   const panel=$('panel-'+name),button=document.querySelector('[data-tab="'+name+'"]');
   const active=name===tab;
   panel.hidden=!active;
   button.classList.toggle('is-active',active);
   button.setAttribute('aria-selected',active?'true':'false');
  }
  if(tab==='guest')renderGuest();
  if(tab==='desk')renderDesk();
 }
 function renderProfile(){
  text('previewName',config.name);text('previewTagline',config.tagline);
  text('previewIntro',config.intro);text('previewArea',config.area);
  text('guestName',config.name);text('guestTagline',config.tagline);
  text('guestIntro',config.intro);text('guestArea',config.area);
 }
 function renderMenus(){
  const host=$('settingsMenus');clear(host);
  for(const menu of model.menus){
   const card=add(host,element('article','menu-card'));
   const details=add(card,element('div'));
   add(details,element('strong','',menu.name));
   add(details,element('small','',menu.duration+'分 ／ '+(menu.private?'個室対応':'通常コース')));
   add(card,element('span','',price(menu.price)));
  }
 }
 function optionsFor(menuId,staffChoice){
  const found=[];
  const staff=model.staff.filter(s=>staffChoice==='any'||s.id===staffChoice);
  for(let start=540;start<=1020;start+=15){
   let accepted=null;
   for(const person of staff){
    for(const bed of model.beds){
     const req={menu:menuId,staff:person.id,bed:bed.id,start};
     if(Core.canBook(model,req).ok){accepted=req;break;}
    }
    if(accepted)break;
   }
   if(accepted)found.push(accepted);
  }
  return found;
 }
 function renderGuest(){
  const menuEl=$('guestMenu'),staffEl=$('guestStaff');
  const previousMenu=menuEl.value;
  fill(menuEl,model.menus.map(m=>[m.id,m.name+'（'+price(m.price)+'）']));
  fill(staffEl,[['any','指名なし（空いている担当者）'],...model.staff.map(s=>[s.id,s.name])]);
  const possible=optionsFor(menuEl.value,staffEl.value),host=$('guestTimes');
  clear(host);
  if(chosen&&!possible.some(x=>x.menu===chosen.menu&&x.staff===chosen.staff&&x.bed===chosen.bed&&x.start===chosen.start))
   chosen=null;
  if(!possible.length)add(host,element('p','time-empty','この条件では空きがありません。別の担当者・コースをご確認ください。'));
  for(const req of possible){
   const selected=!!(chosen&&chosen.menu===req.menu&&chosen.start===req.start&&
    chosen.staff===req.staff&&chosen.bed===req.bed);
   const button=element('button','time'+(selected?' is-selected':''),time(req.start));
   button.type='button';button.setAttribute('aria-pressed',selected?'true':'false');
   button.addEventListener('click',()=>{chosen={...req};renderGuest();});
   add(host,button);
  }
  if(chosen){
   const menu=model.menus.find(x=>x.id===chosen.menu);
   const staff=model.staff.find(x=>x.id===chosen.staff);
   text('guestSummary',fakeDate+' ／ '+time(chosen.start)+'開始 ／ '+menu.name+
    ' ／ '+price(menu.price)+' ／ '+staff.name+' ／ 実際の予約ではありません');
  }else text('guestSummary','ご希望の開始時刻を選んでください（実際の予約ではありません）。');
  $('guestBook').disabled=!chosen;
 }
 function renderManualTimes(){
  const menu=$('manualMenu'),staff=$('manualStaff');
  fill(menu,model.menus.map(x=>[x.id,x.name]));
  fill(staff,model.staff.map(x=>[x.id,x.name]));
  const starts=optionsFor(menu.value,staff.value);
  fill($('manualTime'),starts.map(x=>[String(x.start),time(x.start)]));
  $('manualBook').disabled=!starts.length;
 }
 function metric(host,label,value){
  const box=add(host,element('div','metric'));
  add(box,element('small','',label));
  add(box,element('strong','',value));
 }
 function renderMetrics(){
  const active=model.bookings.filter(x=>x.status==='CONFIRMED');
  const host=$('metrics');clear(host);
  metric(host,'模擬の確定予約',active.length+'件');
  metric(host,'自店Web経由',active.filter(x=>x.source==='website').length+'件');
  metric(host,'電話・店頭の入力',active.filter(x=>x.source==='phone'||x.source==='instore').length+'件');
  metric(host,'模擬のキャンセル',model.bookings.filter(x=>x.status==='CANCELLED').length+'件');
 }
 function renderStaffLanes(){
  const root=$('staffLanes');clear(root);
  for(const staff of model.staff){
   const lane=add(root,element('section','staff-lane'));
   add(lane,element('h4','',staff.name+' ／ 担当できるコース：'+staff.menus.length));
   const list=add(lane,element('div','lane-items'));
   const booked=model.bookings.filter(x=>x.status==='CONFIRMED'&&x.staff===staff.id)
    .sort((a,b)=>a.start-b.start);
   if(!booked.length)add(list,element('p','lane-empty','この日の模擬予約なし'));
   for(const booking of booked){
    const menu=model.menus.find(x=>x.id===booking.menu);
    const block=add(list,element('div','lane-entry'));
    add(block,element('strong','',time(booking.start)+' ／ '+menu.name));
    add(block,element('small','',booking.customer+' ／ '+(sourceNames[booking.source]||'不明')));
   }
  }
 }
 function renderLedger(){
  const root=$('bookingLedger');clear(root);
  const bookings=[...model.bookings].sort((a,b)=>a.start-b.start||a.id-b.id);
  if(!bookings.length)add(root,element('p','','予約記録はありません。'));
  for(const booking of bookings){
   const staff=model.staff.find(x=>x.id===booking.staff);
   const course=model.menus.find(x=>x.id===booking.menu);
   const row=add(root,element('article','booking-row'+(booking.status==='CANCELLED'?' is-cancelled':'')));
   const primary=add(row,element('div'));
   add(primary,element('strong','','#'+booking.id+' '+time(booking.start)+' '+course.name+
    ' ／ '+staff.name+' ／ '+(booking.status==='CANCELLED'?'取消済み':'確定（模擬）')));
   add(primary,element('small','',booking.customer));
   const pills=add(primary,element('div','pills'));
   add(pills,element('span','pill','予約経路：'+(sourceNames[booking.source]||'不明')));
   add(pills,element('span','pill other','認知経路：'+(discoveryNames[booking.discovery]||'不明')));
   if(booking.status==='CONFIRMED'){
    const cancel=element('button','cancel-btn','模擬予約を取消');
    cancel.type='button';
    cancel.addEventListener('click',()=>{
     if(!window.confirm('架空予約 #'+booking.id+' を取り消しますか？\n実際の予約取消や通知は発生しません。'))return;
     try{
      Core.cancel(model,booking.id);
      chosen=null;renderAll();
      notify('架空予約 #'+booking.id+' を取り消しました。同じ枠が再び予約可能になる場合があります。');
     }catch(err){notify('取消できません：'+err.message);}
    });
    add(row,cancel);
   }
  }
 }
 function renderDesk(){renderManualTimes();renderMetrics();renderStaffLanes();renderLedger();}
 function renderAll(){renderProfile();renderMenus();renderGuest();renderDesk();}
 function setupSelections(){
  fill($('guestMenu'),model.menus.map(x=>[x.id,x.name+'（'+price(x.price)+'）']));
  fill($('guestStaff'),[['any','指名なし（空いている担当者）'],...model.staff.map(x=>[x.id,x.name])]);
  fill($('manualMenu'),model.menus.map(x=>[x.id,x.name]));
  fill($('manualStaff'),model.staff.map(x=>[x.id,x.name]));
 }
 function hydrateSettings(){
  $('storeName').value=config.name;
  $('storeTagline').value=config.tagline;
  $('storeArea').value=config.area;
  $('storeIntro').value=config.intro;
 }
 function bookGuest(){
  if(!chosen){notify('まず予約時刻を選んでください。');return;}
  const requested={...chosen};
  const check=Core.canBook(model,requested);
  if(!check.ok){
   chosen=null;renderAll();notify('この枠は予約できなくなりました。別の時刻をお選びください。');return;
  }
  try{
   const id=Core.book(model,{
    ...requested,source:'website',discovery:$('guestDiscovery').value,
    customer:'架空・自店Web予約'+guestSerial++
   });
   chosen=null;renderAll();activate('desk');
   notify('架空の自店Web予約 #'+id+' を登録しました。店舗の共通予約表に反映されています。');
  }catch(err){chosen=null;renderAll();notify('予約できません：'+err.message);}
 }
 function bookManual(){
  const start=Number($('manualTime').value);
  const possible=optionsFor($('manualMenu').value,$('manualStaff').value);
  const selected=possible.find(x=>x.start===start);
  if(!selected){notify('空き時間を選択してください。');return;}
  try{
   const source=$('manualSource').value;
   const id=Core.book(model,{
    ...selected,source,discovery:$('manualDiscovery').value,
    customer:'架空・手入力予約'+manualSerial++
   });
   renderAll();
   notify('架空の'+(sourceNames[source]||'手入力')+'予約 #'+id+' を共通台帳に登録しました。');
  }catch(err){renderAll();notify('登録できません：'+err.message);}
 }
 function reset(){
  if(!window.confirm('入力した架空の設定・模擬予約を初期状態に戻しますか？'))return;
  config=initialConfig();model=Core.initial();chosen=null;guestSerial=1;manualSerial=1;
  hydrateSettings();setupSelections();renderAll();activate('settings');
  notify('初期の架空データに戻しました。永続保存や外部送信はありません。');
 }
 function setup(){
  hydrateSettings();setupSelections();
  document.querySelectorAll('[data-tab]').forEach(button=>{
   button.addEventListener('click',()=>activate(button.dataset.tab));
  });
  $('toGuest').addEventListener('click',()=>activate('guest'));
  $('toGuestFromDesk').addEventListener('click',()=>activate('guest'));
  $('storeForm').addEventListener('submit',event=>{
   event.preventDefault();
   const next={
    name:$('storeName').value.trim(),tagline:$('storeTagline').value.trim(),
    area:$('storeArea').value.trim(),intro:$('storeIntro').value.trim()
   };
   if(Object.values(next).some(v=>!v)){notify('紹介内容の未入力欄を確認してください。');return;}
   config=next;renderProfile();
   notify('架空の店舗紹介文をプレビューに反映しました。ネット公開・保存はしていません。');
  });
  $('guestMenu').addEventListener('change',()=>{chosen=null;renderGuest();});
  $('guestStaff').addEventListener('change',()=>{chosen=null;renderGuest();});
  $('guestBook').addEventListener('click',bookGuest);
  $('manualMenu').addEventListener('change',renderManualTimes);
  $('manualStaff').addEventListener('change',renderManualTimes);
  $('manualBook').addEventListener('click',bookManual);
  $('resetDemo').addEventListener('click',reset);
  renderAll();activate('settings');
 }
 setup();
})();
