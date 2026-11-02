// v0.53: fictional monthly closing and payment evidence (browser-memory only).
// Calendar-month closing only. Legal due-date validation and bank transfer NOT implemented.
const v53Closings=new Map();
const v53Payments=[];
let v53NextPayment=1;
function v53ValidateMonth(month){
 if(typeof month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象月を選んでください（2000〜2099年）');
 return month;
}
function v53MonthEnd(month){
 v53ValidateMonth(month);
 const [y,m]=month.split('-').map(Number);
 return month+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0');
}
function v53Key(month,staffId){
 v53ValidateMonth(month);
 if(!demoMaster.staff.some(st=>st.id===staffId))throw Error('セラピストを選んでください');
 return 'fictional-store-1/closing/'+month+'/'+staffId;
}
function v53Find(month,staffId){return v53Closings.get(v53Key(month,staffId))||null;}
function v53ClosedForService(day,staffId){
 if(!validDemoDay(day))throw Error('対象日を確認してください');
 return Boolean(v53Find(day.slice(0,7),staffId));
}
function v53DraftLines(month,staffId){
 v53Key(month,staffId);
 return [...v52Ledger.values()].filter(v=>v.day.slice(0,7)===month&&v.staffId===staffId&&v.kind==='CONTRACTOR_DRAFT')
  .sort((a,b)=>a.day.localeCompare(b.day)||a.id.localeCompare(b.id));
}
function v53Unprocessed(month,staffId){
 v53Key(month,staffId);
 // Every unclosed confirmed appointment needs an explicit outcome, not just those already paid.
 const dated=new Map(demoDayContexts);
 dated.set(selectedDemoDay,{model,receipts:demoReceipts});
 const pending=[];
 for(const [day,ctx] of dated){
  if(day.slice(0,7)!==month||!ctx?.model)continue;
  for(const b of ctx.model.bookings){
   if(b.status!=='CONFIRMED'||b.staff!==staffId)continue;
   const key=v52ServiceKey(day,b.id);
   if(!v52Ledger.has(key))pending.push({day,bookingId:b.id,customer:b.customer,
     completed:v52Completed.has(key),receiptCount:ctx.receipts?.filter(x=>x.bookingId===b.id).length||0});
  }
 }
 return pending.sort((a,b)=>a.day.localeCompare(b.day)||a.bookingId-b.bookingId);
}
function v53Close(month,staffId,dueDate){
 v53Key(month,staffId);
 if(v53Find(month,staffId))throw Error('この月・スタッフは締め済みです。二重締めはできません');
 if(!validDemoDay(dueDate))throw Error('支払予定日を選んでください');
 if(dueDate<v53MonthEnd(month))throw Error('支払予定日が締め対象期間より前です');
 const pending=v53Unprocessed(month,staffId);
 if(pending.length)throw Error('原票のない確定予約が'+pending.length+'件あります。施術・会計・原票を確認してください');
 const lines=v53DraftLines(month,staffId);
 if(!lines.length)throw Error('締められる業務委託報酬原票がありません');
 const total=lines.reduce((sum,r)=>sum+r.amount,0);
 if(!Number.isSafeInteger(total)||total<0)throw Error('報酬合計が有効な金額ではありません');
 if(new Set(lines.map(x=>x.id)).size!==lines.length)throw Error('原票の重複が見つかりました');
 const staff=demoMaster.staff.find(st=>st.id===staffId);
 const closing=Object.freeze({
  id:v53Key(month,staffId),month,staffId,staffName:staff.name,
  periodStart:month+'-01',periodEnd:v53MonthEnd(month),dueDate,
  total,sourceCount:lines.length,lines:Object.freeze(lines.map(x=>Object.freeze({
   sourceId:x.id,receiptKey:x.receiptKey,day:x.day,amount:x.amount,
   rate:x.rate,contractVersion:x.contract.version
  }))),
  closedAt:new Date().toISOString(),status:'CLOSED_DEMO'
 });
 v53Closings.set(closing.id,closing);
 recordOperation('月次締め',staff.name+' ／ '+month+' ／ '+total.toLocaleString('ja-JP')+
  '円 ／ 支払予定 '+dueDate+'（架空・振込未実行）',month+'-01');
 return closing;
}
function v53PaymentSum(id){
 return v53Payments.filter(p=>p.closingId===id).reduce((sum,p)=>sum+p.amount,0);
}
function v53State(closing){
 const paid=v53PaymentSum(closing.id);
 return {paid,remaining:closing.total-paid,
  label:paid===0?'支払予定（模擬）':paid===closing.total?'支払済み（模擬）':'一部支払（模擬）'};
}
function v53Pay(closingId,amount,paidDate,method){
 const closing=v53Closings.get(closingId);
 if(!closing)throw Error('締め済みの報酬を選んでください');
 if(!Number.isSafeInteger(amount)||amount<=0)throw Error('支払記録額は1円以上の整数で入力してください');
 if(!validDemoDay(paidDate)||paidDate<closing.periodStart)throw Error('記録する支払日を確認してください');
 if(paidDate<closing.closedAt.slice(0,10))throw Error('締めより前の日付には支払記録を追加できません');
 if(!['bank-demo','cash-demo','other-demo'].includes(method))throw Error('支払方法を選んでください');
 const remaining=v53State(closing).remaining;
 if(amount>remaining)throw Error('未払い額を超えて支払済みとして記録できません');
 const payment=Object.freeze({
  id:'fictional-store-1/payment/'+v53NextPayment++,closingId,
  amount,paidDate,method,recordedAt:new Date().toISOString()
 });
 v53Payments.push(payment);
 recordOperation('報酬支払',closing.staffName+' ／ '+closing.month+' ／ '+amount.toLocaleString('ja-JP')+
  '円（支払記録の模擬入力。実振込なし）',closing.month+'-01');
 return payment;
}
function v53CloseFromUI(){
 const month=$('v53Month').value,staffId=$('v53Staff').value,dueDate=$('v53DueDate').value;
 const lines=v53DraftLines(month,staffId),amount=lines.reduce((n,x)=>n+x.amount,0);
 if(!window.confirm(month+' ／ '+demoMaster.staff.find(x=>x.id===staffId)?.name+
  '\n報酬原票 '+lines.length+'件 ／ '+amount.toLocaleString('ja-JP')+
  '円\n支払予定 '+dueDate+'\n\n月次締めを固定しますか？（架空データ。実際の支払ではありません）'))return;
 v53Close(month,staffId,dueDate);
 v53Render();info('月次締めを記録しました（架空）。支払・銀行振込は行っていません。');
}
function v53PayFromUI(){
 const id=$('v53ClosingSelect').value;
 const value=$('v53PayAmount').value;
 if(!/^[1-9]\d*$/.test(value))throw Error('支払記録額は1円以上の整数で入力してください');
 const amount=Number(value);
 const closing=v53Closings.get(id);
 if(!closing)throw Error('締め記録を選んでください');
 const date=$('v53PaidDate').value,method=$('v53PayMethod').value;
 if(!window.confirm(closing.staffName+' ／ '+closing.month+
  '\n'+amount.toLocaleString('ja-JP')+'円を「支払済み（模擬）」として記録しますか？'+
  '\n\n銀行送金・現金移動は実行しません。'))return;
 v53Pay(id,amount,date,method);
 $('v53PayAmount').value='';
 v53Render();info('支払いの模擬記録を追加しました。実際の送金は行っていません。');
}
function v53Render(){
 const month=$('v53Month').value||'2026-10';
 demoMasterOption($('v53Staff'),demoMaster.staff.map(x=>({id:x.id,label:x.name})),'s1');
 const staffId=$('v53Staff').value;
 const drafts=v53DraftLines(month,staffId);
 const pending=v53Unprocessed(month,staffId);
 const total=drafts.reduce((n,x)=>n+x.amount,0);
 const close=v53Find(month,staffId);
 $('v53SourceCount').textContent=String(drafts.length);
 $('v53SourceAmount').textContent=total.toLocaleString('ja-JP')+'円';
 $('v53PendingCount').textContent=String(pending.length);
 $('v53CloseStatus').textContent=close?
  (pending.length?'締め後に未処理の確定予約が'+pending.length+'件あります。訂正処理が必要です。 ／ ':'')+
  '締め済み（模擬） ／ '+close.sourceCount+'件 ／ '+close.total.toLocaleString('ja-JP')+'円'+
   ' ／ '+v53State(close).label :
  pending.length?'未処理の確定予約があります。月次締め前に確認してください。':
  !drafts.length?'締め対象の報酬原票がありません。':'締め前の仮集計。支払予定日を確認してください。';
 $('v53CloseButton').disabled=Boolean(close)||!drafts.length||Boolean(pending.length);
 const unprocessed=$('v53PendingList');unprocessed.replaceChildren();
 for(const x of pending.slice(0,12))add(unprocessed,node('div','v53-pending',
   x.day+' 予約#'+x.bookingId+' '+x.customer+' ／ '+
   (x.completed?'施術完了':'施術未完了')+'・会計'+x.receiptCount+'件'));
 const options=$('v53ClosingSelect'),selected=options.value;
 options.replaceChildren();
 const all=[...v53Closings.values()].sort((a,b)=>b.month.localeCompare(a.month)||a.staffName.localeCompare(b.staffName));
 for(const item of all){
  const opt=add(options,node('option','',item.month+' ／ '+item.staffName+' ／ '+item.total.toLocaleString('ja-JP')+'円'));
  opt.value=item.id;
 }
 options.disabled=!all.length;
 options.value=all.some(x=>x.id===selected)?selected:all[0]?.id||'';
 const current=v53Closings.get(options.value);
 const state=current?v53State(current):null;
 $('v53ClosingDetail').textContent=current?
  current.month+' ／ '+current.staffName+' ／ 締め額 '+current.total.toLocaleString('ja-JP')+
  '円 ／ 支払記録 '+state.paid.toLocaleString('ja-JP')+
  '円 ／ 未払い '+state.remaining.toLocaleString('ja-JP')+'円 ／ '+state.label+
  ' ／ 支払予定 '+current.dueDate : 'まだ月次締めの記録はありません。';
 $('v53PayButton').disabled=!current||!state.remaining;
 const ledger=$('v53ClosingList');ledger.replaceChildren();
 if(!all.length)add(ledger,node('p','muted','月次締めの記録はまだありません。'));
 for(const c of all){
  const st=v53State(c),row=add(ledger,node('article','v53-entry'));
  add(row,node('strong','',c.month+' ／ '+c.staffName+' ／ '+st.label));
  add(row,node('span','',c.sourceCount+'件 ／ 締め '+c.total.toLocaleString('ja-JP')+
    '円 ／ 支払済み '+st.paid.toLocaleString('ja-JP')+'円 ／ 未払い '+st.remaining.toLocaleString('ja-JP')+'円'));
  add(row,node('small','','支払予定 '+c.dueDate+' ／ 締め日時 '+new Date(c.closedAt).toLocaleString('ja-JP')+
    ' ／ 支払記録は実際の振込完了を意味しません'));
 }
 const payments=$('v53PaymentList');payments.replaceChildren();
 if(!v53Payments.length)add(payments,node('p','muted','支払いの模擬記録はまだありません。'));
 for(const p of [...v53Payments].reverse()){
  const parent=v53Closings.get(p.closingId),row=add(payments,node('article','v53-entry'));
  add(row,node('strong','',parent.month+' ／ '+parent.staffName+' ／ '+p.amount.toLocaleString('ja-JP')+'円'));
  add(row,node('small','','支払日（入力）'+p.paidDate+' ／ 記録日時 '+new Date(p.recordedAt).toLocaleString('ja-JP')+
    ' ／ '+({ 'bank-demo':'銀行振込（模擬）','cash-demo':'現金（模擬）','other-demo':'その他（模擬）'}[p.method])));
 }
}
function v53Reset(){v53Closings.clear();v53Payments.length=0;v53NextPayment=1;}
