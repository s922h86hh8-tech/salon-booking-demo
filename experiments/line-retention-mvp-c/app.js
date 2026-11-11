/* Fictional MVP-C UI. No real LINE sends, network calls, booking API,
   customer identifiers, persistent storage or external communications. */
(function(){
'use strict';
const Core=window.DemoCore,Logic=window.RebookingDemo;
if(!Core||!Logic)throw Error('架空の予約案内エンジンがありません');
const $=id=>document.getElementById(id);
let state=Logic.initial(Core);
const typeName={reminder:'予約前日の確認',return:'来店周期の再予約案内',waitlist:'キャンセル待ち案内'};
const statusName={DRAFT:'下書き・未送信',APPROVED:'店舗承認済み・未送信',
 SIMULATED_SENT:'模擬配信記録のみ',SUPPRESSED:'配信停止',CANCELED:'取消'};
const actionName={DRAFT_CREATED:'下書き作成',MOCK_CANCELED:'模擬キャンセル',
 OWNER_APPROVED:'店舗が承認',SIMULATED_DELIVERY_ONLY:'模擬配信記録',
 SIMULATED_BOOKING:'模擬予約成立',CONSENT_CHANGED:'案内同意を変更',
 OPT_OUT_SUPPRESSED:'未送信案内を停止'};
function element(tag,cls='',content=''){
 const n=document.createElement(tag);if(cls)n.className=cls;n.textContent=String(content);return n;
}
function add(el,child){el.appendChild(child);return child;}
function clear(el){el.replaceChildren();}
function setText(id,s){$(id).textContent=String(s);}
function info(message,error=false){setText('notice',message);$('notice').classList.toggle('error',error);}
function button(label,cls,handler){
 const b=element('button',cls,label);b.type='button';b.addEventListener('click',handler);return b;
}
function chooseTab(name){
 for(const key of ['home','drafts','settings']){
  $('panel-'+key).hidden=key!==name;
  const tab=document.querySelector('[data-tab="'+key+'"]');
  tab.classList.toggle('is-active',key===name);
  tab.setAttribute('aria-selected',key===name?'true':'false');
 }
}
function execute(result,tab='drafts'){
 if(result.ok)state=result.state;
 info(result.message,!result.ok);
 renderAll();
 if(result.ok&&tab)chooseTab(tab);
 return result.ok;
}
function metric(root,label,value){
 const card=add(root,element('div','metric'));
 add(card,element('small','',label));
 add(card,element('strong','',value));
}
function renderMetrics(){
 const host=$('metrics');clear(host);
 const n=Logic.numbers(state);
 metric(host,'確認待ちの下書き',n.drafts+'件');
 metric(host,'承認済み・未送信',n.approved+'件');
 metric(host,'模擬配信記録',n.simulated+'件');
 metric(host,'模擬予約成立',n.bookings+'件');
 // Real-world messaging, arrival and sales are intentionally NOT rendered as zero.
}
function renderDrafts(){
 const root=$('draftList');clear(root);
 if(state.drafts.length===0){
  const empty=add(root,element('article','card'));
  add(empty,element('h3','','案内の下書きはまだありません'));
  add(empty,element('p','','「提案を準備」から、架空の対象に案内文を作ってください。'));
  return;
 }
 for(const d of [...state.drafts].reverse()){
  const c=state.customers.find(x=>x.id===d.customerId);
  const card=add(root,element('article','draft'));
  add(card,element('h3','',typeName[d.type]+' ／ '+(c?.name||'架空のお客様')));
  add(card,element('span','status'+(d.status==='SIMULATED_SENT'?' sent':d.status==='SUPPRESSED'?' stop':''),statusName[d.status]||'確認中'));
  add(card,element('p','message',d.text));
  if(d.convertedBooking!==null)add(card,element('p','detail','架空予約 #'+d.convertedBooking+' に接続（実来店・売上ではありません）'));
  const actions=add(card,element('div','actions'));
  if(d.status==='DRAFT'){
   add(actions,button('店舗オーナーが模擬承認','primary',
    ()=>execute(Logic.approve(state,Core,d.id))));
  }
  if(d.status==='APPROVED'){
   add(actions,button('模擬配信として記録（実送信なし）','primary',
    ()=>execute(Logic.simulateDelivery(state,Core,d.id))));
  }
  if(d.status==='SIMULATED_SENT'&&d.convertedBooking===null&&d.type!=='reminder'){
   add(actions,button(d.type==='waitlist'?'空き枠の模擬予約を確定':'案内から模擬予約をする',
    'primary',()=>execute(Logic.acceptInvitation(state,Core,d.id))));
  }
 }
}
function renderBookings(){
 const root=$('bookingList');clear(root);
 const ordered=[...state.model.bookings].sort((a,b)=>a.start-b.start||a.id-b.id);
 for(const b of ordered){
  const course=state.model.menus.find(x=>x.id===b.menu);
  const s=state.model.staff.find(x=>x.id===b.staff);
  const label='架空予約 #'+b.id+'｜'+Core.clock(b.start)+' '+(course?.name||'コース未設定')+
   '｜'+(s?.name||'担当不明')+'｜'+b.customer;
  const row=add(root,element('div','line'));
  add(row,element('strong','',label));
  add(row,element('small','',b.status==='CANCELLED'?'取消済み':'確定（模擬）'));
 }
}
function renderAudit(){
 const root=$('auditLog');clear(root);
 if(state.audit.length===0){
  add(root,element('p','helper','まだ操作履歴はありません。'));return;
 }
 for(const event of [...state.audit].reverse().slice(0,20)){
  const row=add(root,element('div','line'));
  add(row,element('strong','',actionName[event.action]||event.action));
  add(row,element('small','',
   [event.id||'',event.type||'',event.bookingId===undefined?'':'架空予約 #'+event.bookingId].filter(Boolean).join(' ／ ')));
 }
}
function renderCustomers(){
 const host=$('customers');clear(host);
 for(const c of state.customers){
  const box=add(host,element('article','customer'));
  const who=add(box,element('div','who'));
  add(who,element('strong','',c.name));
  const cycle=Logic.calculateCycle(c);
  add(who,element('small','',cycle?'過去の周期 '+cycle.days+'日（試算）':'来店履歴不足・要手動確認'));
  const ctrls=add(box,element('div','controls'));
  for(const [type,field,label] of [
   ['return','returnConsent','再来店'],
   ['reminder','reminderConsent','予約確認'],
   ['waitlist','waitlistConsent','キャンセル待ち']
  ]){
   const on=c[field]===true;
   const b=button(label+'：'+(on?'許可':'停止'),'opt'+(on?' on':''),
    ()=>execute(Logic.setConsent(state,Core,c.id,type,!on),'settings'));
   b.setAttribute('aria-pressed',on?'true':'false');
   add(ctrls,b);
  }
 }
}
function renderAll(){
 renderMetrics();renderDrafts();renderBookings();renderAudit();renderCustomers();
}
function setup(){
 document.querySelectorAll('[data-tab]').forEach(tab=>{
  tab.addEventListener('click',()=>chooseTab(tab.dataset.tab));
 });
 $('prepareReminder').addEventListener('click',()=>{
  execute(Logic.prepare(state,Core,'reminder','c2'));
 });
 $('prepareReturn').addEventListener('click',()=>{
  execute(Logic.prepare(state,Core,'return','c4'));
 });
 $('createCancellation').addEventListener('click',()=>{
  execute(Logic.cancelForWaitlist(state,Core),'home');
 });
 $('prepareWaitlist').addEventListener('click',()=>{
  execute(Logic.prepareWaitlist(state,Core));
 });
 $('resetDemo').addEventListener('click',()=>{
  if(!window.confirm('架空の案内、予約、同意変更、操作履歴をすべて初期状態に戻しますか？'))return;
  state=Logic.initial(Core);renderAll();chooseTab('home');
  info('架空データを初期状態に戻しました。実際のLINEや予約には影響しません。');
 });
 renderAll();chooseTab('home');
}
setup();
})();
