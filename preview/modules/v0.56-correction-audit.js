// v0.56: append-only fictional correction ledger with captured operator and timestamp.
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
function v55Adjust(closingId,sourceId,kind,delta,reason){
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
 const operator=v56Actor(),now=new Date();
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
  originalSourceAmount:source.amount
 });
 v55Adjustments.push(entry);
 recordOperation('月次報酬の調整',
  closing.staffName+' ／ '+closing.month+' ／ '+(kind==='refund'?'返金に伴う報酬減額':'報酬訂正')+
  ' '+delta+'円 ／ 原票 '+sourceId+
  ' ／ 訂正担当：'+entry.recordedByName+'（ID:'+entry.recordedById+'、本人未確認）'+
  ' ／ 自動記録時刻：'+entry.createdAt+
  ' ／ 調整前：'+entry.monthBefore+'円 → 調整後：'+entry.monthAfter+'円'+
  ' ／ 理由：'+entry.reason,closing.periodStart);
 return entry;
}
function v55Entries(closingId){
 return v55Adjustments.filter(x=>x.closingId===closingId);
}
function v55AdjustFromUI(){
 const id=$('v55Closing').value,sourceId=$('v55Source').value;
 const kind=$('v55Kind').value,value=$('v55Amount').value.trim();
 if(!/^[1-9]\d*$/.test(value))throw Error('金額は1円以上の整数で入力してください');
 const amount=Number(value),dir=$('v55Direction').value;
 if(!['minus','plus'].includes(dir))throw Error('増額・減額を選んでください');
 const delta=dir==='minus'?-amount:amount,reason=$('v55Reason').value.trim();
 const closing=v53Closings.get(id),source=v55FindSource(closing,sourceId);
 // Validate before prompting: no misleading confirmation for impossible changes.
 if(!['refund','correction'].includes(kind)||kind==='refund'&&delta>=0)
  throw Error('返金調整では減額を選んでください');
 if(!Number.isSafeInteger(delta)||Math.abs(delta)>1000000||
    reason.length<5||reason.length>200||
    v55SourceNet(closing,sourceId)+delta<0)
  throw Error('金額・理由・元の原票を確認してください');
 const preview=v55State(closing),after=preview.effective+delta;
 if(!window.confirm(closing.staffName+' ／ '+closing.month+
  '\n原票 '+source.day+' ／ 元の報酬 '+source.amount.toLocaleString('ja-JP')+'円'+
  '\n調整 '+delta.toLocaleString('ja-JP')+'円 ／ 調整後の月次報酬 '+after.toLocaleString('ja-JP')+'円'+
  '\n理由：'+reason+
  '\n操作担当：'+v56Actor().name+'（本人認証なし）'+
  '\n記録日時：確定時に自動取得'+
  '\n\n元の締め・原票・支払記録は変更しません。調整履歴を追加しますか？'+
  '\n※実際の返金や銀行振込は実行しません。'))return;
 v55Adjust(id,sourceId,kind,delta,reason);
 $('v55Amount').value='';$('v55Reason').value='';
 v55Render();info('調整履歴を追加しました。元の締め記録・支払記録は変更していません。');
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
 $('v56Operator').value=v56Actor().name+' ／ 本人未確認';
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
 $('v55Confirm').disabled=!closing;
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
