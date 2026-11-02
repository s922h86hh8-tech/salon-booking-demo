// v0.52 fictional service completion and contractor draft ledger.
// No actual work certification, invoice, transfer, tax withholding or server storage.
const v52Completed=new Map();
const v52Ledger=new Map();
const v52Prefix='fictional-store-1';
function v52ServiceKey(day,bookingId){
 if(!validDemoDay(day)||!Number.isSafeInteger(bookingId)||bookingId<1)throw Error('予約の日付と番号を確認してください');
 return v52Prefix+'/service/'+day+'/'+bookingId;
}
function v52ReceiptKey(day,number){
 if(!validDemoDay(day)||!Number.isSafeInteger(number)||number<1)throw Error('会計番号を確認してください');
 return v52Prefix+'/receipt/'+day+'/'+number;
}
function v52Day(day){
 if(!validDemoDay(day))throw Error('対象日を確認してください');
 if(day===selectedDemoDay)return {model,receipts:demoReceipts};
 const ctx=demoDayContexts.get(day);
 if(!ctx)throw Error('対象日の予約表が見つかりません');
 return {model:ctx.model,receipts:ctx.receipts};
}
function v52FindBooking(day,bookingId){
 const ctx=v52Day(day),booking=ctx.model.bookings.find(b=>b.id===bookingId);
 if(!booking)return null;
 return {ctx,booking};
}
function v52CompletionFor(day,bookingId){
 return v52Completed.get(v52ServiceKey(day,bookingId))||null;
}
function v52Complete(day,bookingId){
 const pair=v52FindBooking(day,bookingId),booking=pair?.booking;
 if(!booking||booking.status!=='CONFIRMED')throw Error('確定した予約のみ施術完了を記録できます');
 const key=v52ServiceKey(day,bookingId);
 if(v52Completed.has(key))throw Error('この施術はすでに完了記録があります');
 if(stagedBookingMove&&stagedBookingMove.day===day&&stagedBookingMove.bookingId===bookingId)
  throw Error('予約の仮置きを解除してから完了記録を行ってください');
 const entry=Object.freeze({key,day,bookingId,staffId:booking.staff,menuId:booking.menu,
   completedAt:new Date().toISOString(),state:'COMPLETED_DEMO'});
 v52Completed.set(key,entry);
 recordOperation('施術完了','予約 #'+bookingId+' ／ '+booking.customer+' ／ 施術完了を記録（架空）',day);
 if(page==='earnings')v52Render();
 return entry;
}
function v52Draft(day,bookingId){
 const key=v52ServiceKey(day,bookingId);
 if(v52Ledger.has(key))throw Error('この施術の原票は作成済みです。二重計上はできません');
 const completion=v52Completed.get(key);
 if(!completion)throw Error('先に施術完了を記録してください');
 const pair=v52FindBooking(day,bookingId),booking=pair?.booking;
 if(!booking||booking.status!=='CONFIRMED')throw Error('予約の取消・変更がありました。確認してください');
 if(completion.staffId!==booking.staff||completion.menuId!==booking.menu)
  throw Error('完了時と予約情報が異なります。確認してください');
 const matches=pair.ctx.receipts.filter(r=>r.bookingId===bookingId);
 if(matches.length!==1)throw Error(matches.length?'同じ予約に複数の会計記録があります':'会計記録がありません');
 const receipt=matches[0];
 if(!Number.isSafeInteger(receipt.number)||!Number.isSafeInteger(receipt.full)||
    !Number.isSafeInteger(receipt.discounts)||!Number.isSafeInteger(receipt.due)||
    receipt.full<0||receipt.discounts<0||receipt.due<0||receipt.full-receipt.discounts!==receipt.due)
  throw Error('会計金額の整合性を確認してください');
 const rule=v51RuleForDate(completion.staffId,day);
 if(!rule||!['contract-store','contract-personal'].includes(rule.kind))
  throw Error('この施術日の業務委託契約版がありません。契約設定を確認してください');
 const calc=v51Calculate(rule,receipt.full,receipt.discounts);
 const menu=pair.ctx.model.menus.find(x=>x.id===booking.menu);
 const therapist=pair.ctx.model.staff.find(x=>x.id===booking.staff);
 const kind=rule.kind==='contract-store'?'CONTRACTOR_DRAFT':'PERSONAL_SALE_REFERENCE';
 // A stable date-scoped composite key prevents collisions between per-day sequence numbers.
 const entry=Object.freeze({
  id:key,day,bookingId,receiptKey:v52ReceiptKey(day,receipt.number),
  recordedAt:new Date().toISOString(),completionAt:completion.completedAt,
  staffId:completion.staffId,staffName:therapist?.name||receipt.serviceStaff||'不明',
  menuId:completion.menuId,menuName:receipt.menuName||menu?.name||'不明',
  customer:booking.customer,kind,
  full:receipt.full,discounts:receipt.discounts,due:receipt.due,
  basis:calc.basis,rate:rule.rate,rounding:rule.rounding,
  amount:calc.amount,contract:Object.freeze({...rule}),
  state:'DRAFT_UNCONFIRMED'
 });
 // Existing demos only have one day-scoped receipt per booking. The composite key is demo-only.
 v52Ledger.set(key,entry);
 recordOperation('報酬原票',entry.staffName+' ／ '+day+' #'+bookingId+
  ' ／ 契約版'+entry.contract.version+' ／ 参考 '+entry.amount+'円（未確定）',day);
 if(page==='earnings')v52Render();
 return entry;
}
function v52AllDayBookings(day){
 const ctx=v52Day(day);
 return [...ctx.model.bookings].filter(b=>b.status==='CONFIRMED')
  .sort((a,b)=>a.start-b.start);
}
function v52Status(day,b){
 const key=v52ServiceKey(day,b.id);
 if(v52Ledger.has(key))return '原票作成済み（未確定）';
 if(!v52Completed.has(key))return '施術完了の記録待ち';
 const pair=v52FindBooking(day,b.id);
 const receipts=pair.ctx.receipts.filter(r=>r.bookingId===b.id);
 return receipts.length===1?'完了・会計済み／原票作成待ち':
  receipts.length===0?'施術完了・会計待ち':'会計の重複要確認';
}
function v52Render(){
 const day=selectedDemoDay;
 $('v52CurrentDay').textContent=displayDemoDay(day);
 const dayList=$('v52DayBookings');dayList.replaceChildren();
 const bookings=v52AllDayBookings(day);
 if(!bookings.length)add(dayList,node('p','muted','この日に確定予約はありません。予約表で予約を作成してください。'));
 for(const b of bookings){
  const row=add(dayList,node('article','v52-line'));
  const staff=model.staff.find(x=>x.id===b.staff),menu=model.menus.find(x=>x.id===b.menu);
  add(row,node('strong','',Core.clock(b.start)+' ／ '+b.customer+' ／ '+(menu?.name||'コース不明')));
  add(row,node('small','','担当 '+(staff?.name||'不明')+' ／ '+v52Status(day,b)));
  const actions=add(row,node('div','buttonrow'));
  const complete=add(actions,node('button','secondary','施術完了を記録'));
  complete.type='button';complete.disabled=Boolean(v52CompletionFor(day,b.id));
  complete.addEventListener('click',()=>attempt(()=>v52Complete(day,b.id)));
  const draft=add(actions,node('button','secondary','報酬原票を作成'));
  draft.type='button';draft.disabled=v52Ledger.has(v52ServiceKey(day,b.id));
  draft.addEventListener('click',()=>attempt(()=>v52Draft(day,b.id)));
 }
 const list=$('v52DraftList');list.replaceChildren();
 const rows=[...v52Ledger.values()].sort((a,b)=>b.day.localeCompare(a.day)||b.recordedAt.localeCompare(a.recordedAt));
 const payable=rows.filter(x=>x.kind==='CONTRACTOR_DRAFT');
 $('v52DraftCount').textContent=String(rows.length);
 $('v52DraftAmount').textContent=payable.reduce((n,x)=>n+x.amount,0).toLocaleString('ja-JP')+'円';
 if(!rows.length)add(list,node('p','muted','まだ原票はありません。施術完了と模擬会計を記録すると作成できます。'));
 for(const item of rows){
  const row=add(list,node('article','v52-line'));
  add(row,node('strong','',item.day+' ／ '+item.staffName+' ／ '+item.amount.toLocaleString('ja-JP')+'円'));
  add(row,node('small','',item.kind==='CONTRACTOR_DRAFT'?'業務委託報酬の原票（未確定）':
  'セラピスト本人売上の参考取り分（店舗の支払報酬ではない）'));
  add(row,node('span','',item.menuName+' ／ 通常 '+item.full.toLocaleString('ja-JP')+'円 ／ 割引 '+item.discounts.toLocaleString('ja-JP')+'円'));
  add(row,node('small','', '施術 '+item.id+' ／ 会計 '+item.receiptKey+
    ' ／ 契約版 '+item.contract.version+' ／ '+item.contract.rate+'%'));
 }
}
function v52Reset(){
 v52Completed.clear();v52Ledger.clear();
}
