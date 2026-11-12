/* MVP-D independent, fictional, in-memory review UI. No network or LINE operations. */
(function(){
'use strict';
const Demo=window.NotificationReviewDemo;
if(!Demo)throw Error('架空の通知保留エンジンが見つかりません。');
const $=id=>document.getElementById(id);
const fmt=iso=>{
 try{return new Intl.DateTimeFormat('ja-JP',{
  timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
 }).format(new Date(iso));}
 catch{return '架空の日時（確認不可）';}
};
const stateLabels={
 OUTCOME_UNKNOWN:'結果不明・保留',SIMULATED:'模擬受付済み',
 RETRY:'再試行を模擬承認',DEAD:'停止'
};
const historyLabels={
 ...Demo.actions,CONSENT_REVOKED:'同意撤回',
 BOOKING_MOVED:'予約日時の変更'
};
let state=Demo.initial(),selectedId='sample-a';
const el=(tag,cls='',value='')=>{
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 n.textContent=String(value);
 return n;
};
const append=(parent,child)=>{parent.appendChild(child);return child;};
const clear=parent=>parent.replaceChildren();
const setText=(id,value)=>{$(id).textContent=String(value);};
const fact=(root,label,value)=>{
 const div=append(root,el('div','fact'));
 append(div,el('small','',label));
 append(div,el('strong','',value===null||value===undefined?'なし':value));
};
const statusText=status=>stateLabels[status]||'未定義の状態';
function notice(msg,error=false){
 setText('notice',msg);$('notice').classList.toggle('error',error);
}
function selected(){return Demo.get(state,selectedId);}
function currentFinding(){
 const checked=document.querySelector('input[name="finding"]:checked');
 return checked?.value||null;
}
function resetDecisionFields(){
 for(const input of document.querySelectorAll('input[name="finding"]'))input.checked=false;
 $('retryToggle').checked=false;
 $('acknowledge').checked=false;
 updateControls();
}
function updateControls(){
 const item=selected(),finding=currentFinding();
 const allowedRetry=!!item&&item.state==='OUTCOME_UNKNOWN'&&finding==='MOCK_NOT_ACCEPTED'&&
  Demo.eligibility(item,state.now).possible;
 $('retryToggle').disabled=!allowedRetry;
 if(!allowedRetry)$('retryToggle').checked=false;
 $('retryArea').classList.toggle('muted',!allowedRetry);
 const note=!finding?'模擬調査結果を先に選択してください。':
  finding==='MOCK_ACCEPTED'?'模擬受付済み：再送しません。':
  allowedRetry?'模擬未受付の場合のみ、明示的な許可で再試行候補にできます（実送信なし）。':
  '模擬未受付として停止します。現在の条件では再試行を許可できません。';
 setText('retryHelp',note);
 $('recordDecision').disabled=!(item&&item.state==='OUTCOME_UNKNOWN'&&
  !!finding&&$('acknowledge').checked);
}
function renderMetrics(){
 const n=Demo.counts(state);
 setText('metricUnknown',n.unknown+'件');
 setText('metricResolved',n.resolved+'件');
 setText('metricRetry',n.retry+'件');
}
function renderList(){
 const root=$('incidentList');clear(root);
 const items=Demo.visible(state,$('statusFilter').value);
 if(!items.length){
  append(root,el('p','micro','該当する架空の通知はありません。'));
  return;
 }
 for(const item of items){
  const b=append(root,el('button','case'+(item.id===selectedId?' selected':'')));
  b.type='button';b.dataset.id=item.id;
  b.setAttribute('aria-pressed',item.id===selectedId?'true':'false');
  const top=append(b,el('div','case-top'));
  append(top,el('small','','模擬案件 '+item.id.toUpperCase()));
  append(top,el('span','status-badge'+(item.state==='OUTCOME_UNKNOWN'?'':' closed'),statusText(item.state)));
  append(b,el('strong','',item.customer+' ／ '+Demo.purposes[item.purpose]));
  append(b,el('small','','保留発生：'+fmt(item.startedAt)));
  append(b,el('span','meta','対象予約：'+(item.booking?'架空 #'+item.booking.id:'対象予約なし')));
  b.addEventListener('click',()=>{
   selectedId=item.id;
   resetDecisionFields();
   renderAll();
   notice('選択した架空の案内 '+item.id+' の詳細を表示しました。');
  });
 }
}
function renderFacts(item){
 const root=$('caseDetails');clear(root);
 fact(root,'案内の種類',Demo.purposes[item.purpose]);
 fact(root,'お客様',item.customer);
 fact(root,'通知保留の発生日時',fmt(item.startedAt));
 fact(root,'対象予約番号',item.booking?item.booking.id:'なし（再来店案内）');
 fact(root,'予約日時',item.booking?item.booking.serviceDate+' '+item.booking.start:'対象の確定予約なし');
 fact(root,'予約状態',item.booking?item.booking.status:'なし');
 fact(root,'配信目的別の同意',item.consent.allowed?'模擬同意あり':'模擬同意停止');
 fact(root,'試行回数',item.attempts+' / '+item.maxAttempts);
 fact(root,'有効期限',fmt(item.expiresAt));
 fact(root,'模擬処理ID',item.handoffId);
}
function renderEligibility(item){
 const root=$('eligibility');clear(root);
 const check=Demo.eligibility(item,state.now);
 if(item.state!=='OUTCOME_UNKNOWN'){
  append(root,el('p','check-item','模擬判断済み。新たな再送は行いません。'));
 }else if(check.possible){
  append(root,el('p','check-item','架空のデータ上は模擬再試行候補です。最新の本番同意や予約を確認できたわけではありません。'));
 }else{
  if(check.reasons.length===0)append(root,el('p','check-item warning','実データの安全確認ができていません。'));
  for(const reason of check.reasons)append(root,el('p','check-item warning',reason));
 }
}
function renderHistory(item){
 const root=$('eventHistory');clear(root);
 for(const event of item.history){
  const row=append(root,el('div','event'));
  append(row,el('strong','',historyLabels[event.action]||event.action));
  append(row,el('small','',fmt(event.at)));
  if(event.details)append(row,el('small','',event.details));
 }
}
function renderDetail(){
 const item=selected();
 if(!item){
  setText('caseHeading','架空の案件がありません。');
  $('decisionPanel').hidden=true;$('closedPanel').hidden=true;
  return;
 }
 setText('caseHeading',item.customer+'の'+Demo.purposes[item.purpose]);
 setText('caseSub','保留した通知の模擬履歴を確認します。LINEから受付結果を取得するものではありません。');
 setText('statusBadge',statusText(item.state));
 $('statusBadge').classList.toggle('closed',item.state!=='OUTCOME_UNKNOWN');
 renderFacts(item);renderEligibility(item);renderHistory(item);
 $('decisionPanel').hidden=item.state!=='OUTCOME_UNKNOWN';
 $('closedPanel').hidden=item.state==='OUTCOME_UNKNOWN';
 if(item.state==='OUTCOME_UNKNOWN')updateControls();
}
function renderAll(){
 renderMetrics();renderList();renderDetail();
}
function record(){
 const item=selected(),finding=currentFinding();
 if(!item)return;
 const input={id:item.id,handoffId:item.handoffId,finding,
  retryApproved:$('retryToggle').checked,acknowledged:$('acknowledge').checked};
 const result=Demo.decide(state,input);
 if(result.ok){
  state=result.state;
  resetDecisionFields();
  renderAll();
 }
 notice(result.message,!result.ok);
}
function init(){
 $('statusFilter').addEventListener('change',()=>renderList());
 for(const radio of document.querySelectorAll('input[name="finding"]'))
  radio.addEventListener('change',updateControls);
 $('retryToggle').addEventListener('change',updateControls);
 $('acknowledge').addEventListener('change',updateControls);
 $('recordDecision').addEventListener('click',record);
 $('clearDecision').addEventListener('click',()=>{
  resetDecisionFields();
  notice('判断内容の選択を戻しました。まだ記録していません。');
 });
 $('resetDemo').addEventListener('click',()=>{
  if(!window.confirm('架空の案内と判断履歴を初期状態に戻しますか？'))return;
  state=Demo.initial();selectedId='sample-a';$('statusFilter').value='unknown';
  resetDecisionFields();renderAll();
  notice('架空の操作試験を初期状態に戻しました。実送信・実予約には影響ありません。');
 });
 resetDecisionFields();renderAll();
}
init();
})();