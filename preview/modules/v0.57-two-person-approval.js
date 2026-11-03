// v0.57: mock two-person authorization for append-only financial adjustment ledger.
// No real refund, transfer, invoice, tax adjustment, payroll or database operation.
// The original v0.53 closing and v0.52 earnings source are never rewritten.
// A fixed, fictional demo session. No login is implemented or implied.
// Production must derive both identity and time from an authenticated, trusted backend.
const v56DemoActor=Object.freeze({
 id:'demo-manager-01', name:'デモ管理者（架空）', role:'店舗管理者（模擬）',
 authenticated:false
});
function v56Actor(){return v56DemoActor;}
function v56Jst(iso){
 const formatted=new Intl.DateTimeFormat('ja-JP',{
  timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
 }).format(new Date(iso));
 return formatted+'（日本時間）';
}
const v55Adjustments=[];
let v55NextId=1;
function v55FindSource(closing,sourceId){
 if(!closing||!v53Closings.has(closing.id))throw Error('締め済み明細を選んでください');
 const source=closing.lines.find(x=>x.sourceId===sourceId);
 if(!source)throw Error('この月次締めに属する原票を選んでください');
 return source;
}
function v55SourceNet(closing,sourceId){
 const source=v55FindSource(closing,sourceId);
 const delta=v55Adjustments.filter(x=>x.closingId===closing.id&&x.sourceId===sourceId)
  .reduce((sum,x)=>sum+x.delta,0);
 return source.amount+delta;
}
function v55State(closing){
 if(!closing||!v53Closings.has(closing.id))throw Error('締め済み明細を選んでください');
 const delta=v55Adjustments.filter(x=>x.closingId===closing.id)
  .reduce((sum,x)=>sum+x.delta,0);
 const effective=closing.total+delta,paid=v53PaymentSum(closing.id);
 const remaining=Math.max(0,effective-paid),excess=Math.max(0,paid-effective);
 if(!Number.isSafeInteger(effective)||effective<0)throw Error('調整後の合計が不正です');
 const label=excess?'過払の要確認（模擬）':
  remaining===0?'支払記録済み（模擬）':paid?'一部支払（模擬）':'支払予定（模擬）';
 return {original:closing.total,delta,effective,paid,remaining,excess,label};
}
function v55Adjust(closingId,sourceId,kind,delta,reason,authorization){
 if(!authorization||authorization.permit!==v57PrivatePermit||
    !v57Requests.includes(authorization.request)||
    v57ReviewRecords.has(authorization.request.id)||
    authorization.request.closingId!==closingId||
    authorization.request.sourceId!==sourceId||
    authorization.request.kind!==kind||
    authorization.request.delta!==delta||
    authorization.request.reason!==reason)
  throw Error('承認されていない調整は反映できません');
 const closing=v53Closings.get(closingId);
 if(!closing)throw Error('締め済みの対象月を選んでください');
 if(!['refund','correction'].includes(kind))throw Error('調整の種類を選んでください');
 if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1000000)
  throw Error('調整金額は1円以上、100万円以下の整数で入力してください');
 if(kind==='refund'&&delta>=0)throw Error('返金に伴う報酬減額はマイナス金額で入力してください');
 if(typeof reason!=='string'||reason.trim().length<5||reason.trim().length>200)
  throw Error('理由を5〜200文字で入力してください');
 const normalizedReason=reason.trim();
 if(v55Adjustments.some(x=>x.closingId===closing.id&&x.sourceId===sourceId&&
  x.kind===kind&&x.delta===delta&&x.reason===normalizedReason))
  throw Error('同じ内容の調整履歴はすでに登録されています。二重計上を防止しました');
 const source=v55FindSource(closing,sourceId);
 if(v55SourceNet(closing,sourceId)+delta<0)throw Error('原票単位の調整後額はマイナスにできません');
 const sum=v55State(closing);
 if(!Number.isSafeInteger(sum.effective+delta)||sum.effective+delta<0)
  throw Error('月次の調整後額はマイナスにできません');
 const operator=v57Actor(),now=new Date();
 const sourceBefore=v55SourceNet(closing,sourceId);
 const entry=Object.freeze({
  id:'fictional-store-1/adjustment/'+v55NextId++,
  closingId,sourceId,receiptKey:source.receiptKey,day:source.day,
  kind,delta,reason:normalizedReason,createdAt:now.toISOString(),
  recordedById:operator.id,recordedByName:operator.name,
  recordedByRole:operator.role,identityVerified:operator.authenticated,
  targetStaffId:closing.staffId,targetStaffName:closing.staffName,
  sourceBefore,sourceAfter:sourceBefore+delta,
  monthBefore:sum.effective,monthAfter:sum.effective+delta,
  originalSourceAmount:source.amount,
  approvalRequestId:authorization.request.id,
  requestedById:authorization.request.requestedById,
  requestedByName:authorization.request.requestedByName,
  requestedAt:authorization.request.requestedAt,
  approvedById:operator.id,approvedByName:operator.name,
  approvedAt:now.toISOString()
 });
 v55Adjustments.push(entry);
 recordOperation('月次報酬の調整',
  closing.staffName+' ／ '+closing.month+' ／ '+(kind==='refund'?'返金に伴う報酬減額':'報酬訂正')+
  ' '+delta+'円 ／ 原票 '+sourceId+
  ' ／ 訂正担当：'+entry.recordedByName+'（ID:'+entry.recordedById+'、本人未確認）'+
  ' ／ 自動記録時刻：'+entry.createdAt+
  ' ／ 調整前：'+entry.monthBefore+'円 → 調整後：'+entry.monthAfter+'円'+
  ' ／ 承認申請：'+entry.approvalRequestId+' ／ 理由：'+entry.reason,closing.periodStart);
 return entry;
}
function v55Entries(closingId){
 return v55Adjustments.filter(x=>x.closingId===closingId);
}
function v55Render(){
 const select=$('v55Closing'),before=select.value;
 select.replaceChildren();
 const closings=[...v53Closings.values()].sort((a,b)=>b.month.localeCompare(a.month)||a.staffName.localeCompare(b.staffName));
 for(const c of closings){
  const opt=add(select,node('option','',c.month+' ／ '+c.staffName));opt.value=c.id;
 }
 select.value=closings.some(x=>x.id===before)?before:closings[0]?.id||'';
 const closing=v53Closings.get(select.value);
 $('v56Operator').value=v57Actor().name+' ／ 本人未確認（役割模擬）';
 const last=closing?v55Entries(closing.id).at(-1):null;
 $('v56LastRecorded').value=last?v56Jst(last.createdAt):'この締めには訂正履歴なし';
 const sourceSel=$('v55Source'),prior=sourceSel.value;
 sourceSel.replaceChildren();
 if(closing)for(const line of closing.lines){
  const opt=add(sourceSel,node('option','',
   line.day+' ／ 原票 '+line.sourceId+' ／ '+line.amount.toLocaleString('ja-JP')+'円'));
  opt.value=line.sourceId;
 }
 sourceSel.value=closing?.lines.some(x=>x.sourceId===prior)?prior:closing?.lines[0]?.sourceId||'';
 $('v55Confirm').disabled=!closing||v57Actor().role!=='requester';
 if(!closing){
  $('v55Summary').textContent='締め済みの報酬はまだありません。施術・会計・原票・月次締めから登録してください。';
 }else{
  const s=v55State(closing);
  $('v55Summary').textContent='元の締め額 '+s.original.toLocaleString('ja-JP')+'円 ／ 調整の累計 '+
   s.delta.toLocaleString('ja-JP')+'円 ／ 調整後 '+s.effective.toLocaleString('ja-JP')+
   '円 ／ 支払の模擬記録 '+s.paid.toLocaleString('ja-JP')+'円 ／ 未払 '+s.remaining.toLocaleString('ja-JP')+
   '円 ／ 過払の確認額 '+s.excess.toLocaleString('ja-JP')+'円 ／ '+s.label;
 }
 const list=$('v55History');list.replaceChildren();
 if(!closing||!v55Entries(closing.id).length){
  add(list,node('p','muted','この月次締めに関する調整履歴はまだありません。'));
 }else for(const e of [...v55Entries(closing.id)].reverse()){
  const row=add(list,node('article','v55-entry'));
  add(row,node('strong','',e.day+' ／ '+(e.kind==='refund'?'返金に伴う報酬減額':'報酬訂正')+
   ' ／ '+e.delta.toLocaleString('ja-JP')+'円'));
  add(row,node('small','','対象：'+e.targetStaffName+' ／ 原票 '+e.sourceId+
   ' ／ 理由：'+e.reason));
  add(row,node('small','','訂正前（原票）：'+e.sourceBefore.toLocaleString('ja-JP')+
   '円 → 訂正後：'+e.sourceAfter.toLocaleString('ja-JP')+'円 ／ 月次：'+
   e.monthBefore.toLocaleString('ja-JP')+'円 → '+e.monthAfter.toLocaleString('ja-JP')+'円'));
  add(row,node('small','','操作担当：'+e.recordedByName+'（ID: '+e.recordedById+
   ' ／ 本人認証なし） ／ 自動記録：'+v56Jst(e.createdAt)+
   ' ／ 架空の操作。実返金・実送金なし'));
 }
}
function v55Reset(){v55Adjustments.length=0;v55NextId=1;}


// v0.57: role simulations are NOT authentication or production permissions.
// Only two fixed fictional actors exist; the UI can switch them without a password.
// A trusted backend must enforce role permissions, maker/checker separation and append-only audit.
const v57Actors=Object.freeze({
 requester:Object.freeze({id:'demo-manager-01',name:'デモ申請担当（架空）',role:'requester',authenticated:false}),
 approver:Object.freeze({id:'demo-owner-01',name:'デモ承認担当（架空）',role:'approver',authenticated:false})
});
let v57Role='requester';
function v57Actor(){return v57Actors[v57Role];}
function v57SelectRole(role){
 if(!Object.prototype.hasOwnProperty.call(v57Actors,role))throw Error('模擬役割を確認してください');
 v57Role=role;
 return v57Actor();
}
const v57Requests=[];
const v57ReviewRecords=new Map();
const v57PrivatePermit=Symbol('fictional approval-only entry');
let v57NextRequest=1;
function v57ValidateProposal(closingId,sourceId,kind,delta,reason){
 const closing=v53Closings.get(closingId);
 if(!closing)throw Error('締め済みの対象月を選んでください');
 if(!['refund','correction'].includes(kind))throw Error('調整の種類を選んでください');
 if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1000000)
  throw Error('調整金額は1円以上、100万円以下の整数で入力してください');
 if(kind==='refund'&&delta>=0)throw Error('返金に伴う報酬減額はマイナス金額にしてください');
 if(typeof reason!=='string'||reason.trim().length<5||reason.trim().length>200)
  throw Error('訂正理由は5〜200文字で入力してください');
 const normalized=reason.trim();
 const source=v55FindSource(closing,sourceId);
 const sourceBefore=v55SourceNet(closing,sourceId),month=v55State(closing);
 if(sourceBefore+delta<0||month.effective+delta<0||
  !Number.isSafeInteger(sourceBefore+delta)||!Number.isSafeInteger(month.effective+delta))
  throw Error('調整後の金額を確認してください');
 if(v55Adjustments.some(x=>x.closingId===closingId&&x.sourceId===sourceId&&
  x.kind===kind&&x.delta===delta&&x.reason===normalized))
  throw Error('すでに反映済みの同一訂正です');
 return {closing,source,sourceBefore,monthBefore:month.effective,paidBefore:month.paid,reason:normalized};
}
function v57Request(closingId,sourceId,kind,delta,reason){
 const actor=v57Actor();
 if(actor.role!=='requester')throw Error('訂正の申請は申請担当者の役割で行ってください');
 const check=v57ValidateProposal(closingId,sourceId,kind,delta,reason);
 if(v57Requests.some(r=>r.closingId===closingId&&r.sourceId===sourceId&&
  r.kind===kind&&r.delta===delta&&r.reason===check.reason&&!v57ReviewRecords.has(r.id)))
  throw Error('同じ内容の申請が承認待ちです');
 const req=Object.freeze({
  id:'fictional-store-1/request/'+v57NextRequest++,
  closingId,sourceId,kind,delta,reason:check.reason,
  month:check.closing.month,staffId:check.closing.staffId,staffName:check.closing.staffName,
  sourceBefore:check.sourceBefore,sourceAfter:check.sourceBefore+delta,
  monthBefore:check.monthBefore,monthAfter:check.monthBefore+delta,
  paidBefore:check.paidBefore,
  requestedById:actor.id,requestedByName:actor.name,
  requesterAuthenticated:actor.authenticated,requestedAt:new Date().toISOString()
 });
 v57Requests.push(req);
 recordOperation('訂正申請（模擬）',req.id+' ／ '+req.staffName+' ／ '+delta+'円'+
  ' ／ '+req.requestedByName+' ／ '+req.reason,req.month+'-01');
 return req;
}
function v57RequestStatus(req){
 const record=v57ReviewRecords.get(req.id);
 return record?record.status:'PENDING';
}
function v57Review(requestId,decision,explanation=''){
 const actor=v57Actor();
 if(actor.role!=='approver')throw Error('承認担当者の役割ではありません');
 const req=v57Requests.find(x=>x.id===requestId);
 if(!req)throw Error('申請が見つかりません');
 if(actor.id===req.requestedById)throw Error('申請者本人による自己承認はできません');
 if(v57ReviewRecords.has(req.id))throw Error('この申請はすでに判断済みです。二重承認できません');
 if(!['APPROVE','REJECT'].includes(decision))throw Error('承認または差戻しを選んでください');
 if(decision==='REJECT'&&(typeof explanation!=='string'||explanation.trim().length<5||explanation.trim().length>200))
  throw Error('差戻し理由は5〜200文字で入力してください');
 let adjustment=null,finalStatus=decision==='REJECT'?'REJECTED':'APPROVED';
 let note=decision==='REJECT'?explanation.trim():'模擬承認（実金銭処理なし）';
 if(decision==='APPROVE'){
  const current=v57ValidateProposal(req.closingId,req.sourceId,req.kind,req.delta,req.reason);
  if(current.sourceBefore!==req.sourceBefore||current.monthBefore!==req.monthBefore||
     current.paidBefore!==req.paidBefore){
   // The original proposal must never be silently approved against changed amounts.
   finalStatus='STALE';
   note='申請後に原票額・月次額・支払記録が変わりました。再申請が必要です';
  }else{
   adjustment=v55Adjust(req.closingId,req.sourceId,req.kind,req.delta,req.reason,
    {permit:v57PrivatePermit,request:req});
  }
 }
 const record=Object.freeze({
  requestId:req.id,status:finalStatus,
  reviewedById:actor.id,reviewedByName:actor.name,
  reviewerAuthenticated:actor.authenticated,reviewedAt:new Date().toISOString(),
  reason:note,adjustmentId:adjustment?adjustment.id:null
 });
 v57ReviewRecords.set(req.id,record);
 recordOperation('訂正判断（模擬）',req.id+' ／ '+finalStatus+' ／ '+actor.name+
  ' ／ '+note,req.month+'-01');
 return {record,adjustment};
}
function v57RequestFromUI(){
 const id=$('v55Closing').value,sourceId=$('v55Source').value,kind=$('v55Kind').value;
 const raw=$('v55Amount').value.trim(),dir=$('v55Direction').value;
 if(!/^[1-9]\d*$/.test(raw)||!['minus','plus'].includes(dir))throw Error('調整額と増減を確認してください');
 const delta=Number(raw)*(dir==='minus'?-1:1),reason=$('v55Reason').value.trim();
 const check=v57ValidateProposal(id,sourceId,kind,delta,reason);
 if(!window.confirm('申請担当：'+v57Actor().name+'（本人認証なし）'+
  '\n対象：'+check.closing.month+' ／ '+check.closing.staffName+
  '\n原票調整前：'+check.sourceBefore.toLocaleString('ja-JP')+'円'+
  ' → 調整後：'+(check.sourceBefore+delta).toLocaleString('ja-JP')+'円'+
  '\n理由：'+reason+'\n\n訂正を申請しますか？\n承認前は金額を変更しません。'))return;
 v57Request(id,sourceId,kind,delta,reason);
 $('v55Amount').value='';$('v55Reason').value='';
 v57Render();info('訂正申請を記録しました（架空）。まだ報酬額は変更されていません。');
}
function v57ReviewFromUI(id,decision){
 const req=v57Requests.find(x=>x.id===id);
 if(!req)throw Error('申請が見つかりません');
 const note=$('v57RejectReason').value.trim();
 if(decision==='REJECT'&&(note.length<5||note.length>200))
  throw Error('差戻し理由は5〜200文字で入力してください');
 if(!window.confirm(req.staffName+' ／ '+req.month+' ／ '+req.delta.toLocaleString('ja-JP')+
  '円の申請を'+(decision==='APPROVE'?'承認':'差戻し')+'しますか？'+
  '\n操作担当：'+v57Actor().name+'（本人認証なし／架空）'))return;
 const result=v57Review(id,decision,note);
 $('v57RejectReason').value='';
 v57Render();
 info(result.record.status==='APPROVED'?'模擬承認後、報酬調整を反映しました。':
  result.record.status==='STALE'?'申請後に数字が変わったため反映せず、再申請が必要です。':
  '差戻しを記録しました。報酬額は変更されていません。');
}
function v57Render(){
 v55Render();
 const mode=$('v57Mode');mode.value=v57Role;
 const actor=v57Actor(), root=$('v57RequestList');root.replaceChildren();
 $('v57CurrentActor').textContent=actor.name+'（役割を切り替えられる架空の操作。本人認証なし）';
 $('v55Confirm').disabled=$('v55Confirm').disabled||actor.role!=='requester';
 const select=$('v55Closing').value;
 const requests=v57Requests.filter(r=>r.closingId===select).slice().reverse();
 if(!requests.length){
  add(root,node('p','muted','この月次締めの訂正申請はありません。'));
 }
 for(const req of requests){
  const status=v57RequestStatus(req),decision=v57ReviewRecords.get(req.id);
  const card=add(root,node('article','v55-entry'));
  const statusLabel={PENDING:'承認待ち',APPROVED:'承認済み・反映',REJECTED:'差戻し',STALE:'申請失効・再申請'}[status];
  add(card,node('strong','',statusLabel+' ／ '+req.month+' ／ '+req.staffName+' ／ '+
   req.delta.toLocaleString('ja-JP')+'円'));
  add(card,node('small','','対象原票：'+req.sourceId+' ／ 申請前：'+
   req.sourceBefore.toLocaleString('ja-JP')+'円 → 予定：'+
   req.sourceAfter.toLocaleString('ja-JP')+'円 ／ 理由：'+req.reason));
  add(card,node('small','','申請者：'+req.requestedByName+' ／ '+v56Jst(req.requestedAt)));
  if(decision)add(card,node('small','','判断担当：'+decision.reviewedByName+
   ' ／ '+v56Jst(decision.reviewedAt)+' ／ '+decision.reason));
  if(status==='PENDING'){
   const actions=add(card,node('div','buttonrow'));
   const approve=add(actions,node('button','primary','承認（模擬）'));
   approve.type='button';approve.disabled=actor.role!=='approver';
   approve.addEventListener('click',()=>attempt(()=>v57ReviewFromUI(req.id,'APPROVE')));
   const reject=add(actions,node('button','secondary','差戻し（模擬）'));
   reject.type='button';reject.disabled=actor.role!=='approver';
   reject.addEventListener('click',()=>attempt(()=>v57ReviewFromUI(req.id,'REJECT')));
  }
 }
}
function v57Reset(){
 v57Requests.length=0;
 v57ReviewRecords.clear();
 v57NextRequest=1;
 v57Role='requester';
}
