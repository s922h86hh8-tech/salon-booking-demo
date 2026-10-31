// v0.49: visible-until-reused cancellation history + fictional in-memory operation ledger.
// No customer records or audit log are transmitted or retained after a refresh.
const operationLog=[];
const operationCursors=new Map();
let operationSequence=1;
function currentOperationStamp(){
 const now=new Date();
 return {iso:now.toISOString(),display:now.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})};
}
function recordOperation(category,details,bookingDay=selectedDemoDay){
 const stamp=currentOperationStamp();
 const entry={id:operationSequence++,stamp:stamp.iso,when:stamp.display,day:bookingDay,category,details:String(details||''),who:'デモ操作（本人確認なし）'};
 operationLog.push(entry);return entry;
}
function operationTypeFromCore(message){
 const s=String(message);
 if(s.includes('取消'))return '予約取消';
 if(s.includes('予約枠')||s.includes('準備')||s.includes('休憩'))return '時間変更';
 if(s.includes('付け回し'))return '担当設定';
 if(s.includes('仮受付'))return '仮受付';
 if(s.includes('確定')||s.includes('予約'))return '予約登録';
 if(s.includes('案内')||s.includes('承諾'))return '空き枠回収';
 return '店舗操作';
}
function syncModelOperationEvents(){
 const previous=operationCursors.get(selectedDemoDay)||0;
 const events=Array.isArray(model.events)?model.events:[];
 if(events.length<previous)operationCursors.set(selectedDemoDay,0);
 const from=operationCursors.get(selectedDemoDay)||0;
 for(let i=from;i<events.length;i++)recordOperation(operationTypeFromCore(events[i]),events[i]);
 operationCursors.set(selectedDemoDay,events.length);
}
function cancelledReplacedInCalendar(booking,dayModel){
 if(booking.status!=='CANCELLED')return false;
 const start=booking.start,end=start+Core.serviceFor(dayModel,booking);
 return dayModel.bookings.some(other=>{
  if(other.status!=='CONFIRMED'||other.staff!==booking.staff)return false;
  const b=other.start,e=b+Core.serviceFor(dayModel,other);
  return start<e&&b<end;
 });
}
function canceledVisibleOnCalendar(booking,dayModel=model){
 return booking.status==='CANCELLED'&&!cancelledReplacedInCalendar(booking,dayModel);
}
function allCancellationRecords(){
 const dated=new Map(demoDayContexts);
 dated.set(selectedDemoDay,{model});
 const records=[];
 for(const [day,ctx] of dated){
  if(!ctx?.model)continue;
  for(const booking of ctx.model.bookings.filter(b=>b.status==='CANCELLED')){
   const m=ctx.model;
   const menu=m.menus.find(x=>x.id===booking.menu);
   const staff=m.staff.find(x=>x.id===booking.staff);
   const replacement=cancelledReplacedInCalendar(booking,m);
   records.push({day,booking,menu,staff,replacement});
  }
 }
 return records.sort((a,b)=>b.day.localeCompare(a.day)||b.booking.start-a.booking.start);
}
function renderCancellationHistory(){
 const list=$('cancellationHistoryList');list.replaceChildren();
 const records=allCancellationRecords();
 $('cancellationHistoryCount').textContent=String(records.length);
 if(!records.length){add(list,node('p','muted','取消・移動済みの予約はまだありません。'));return;}
 for(const item of records){
  const row=add(list,node('article','operation-history-row'));
  const headline=add(row,node('div','operation-history-headline'));
  add(headline,node('strong','',item.booking.movedTo?'移動済み':'取消済み'));
  const state=item.replacement?'予約表では非表示（枠を再利用）':'予約表に薄く表示中';
  add(headline,node('span','operation-history-state',state));
  add(row,node('p','',item.day+' '+Core.clock(item.booking.start)+'〜'+Core.clock(item.booking.start+Core.serviceFor(
    item.day===selectedDemoDay?model:demoDayContexts.get(item.day).model,item.booking))+
    ' ／ '+(item.staff?.name||'担当不明')+' ／ '+(item.menu?.name||'コース不明')));
  add(row,node('p','',item.booking.customer+' ／ 予約番号 '+item.booking.id+
    (item.booking.movedTo?' ／ 移動先 '+item.booking.movedTo:'')));
  add(row,node('small','',item.booking.cancelledAt||item.booking.movedAt?'処理日時：'+new Date(item.booking.cancelledAt||item.booking.movedAt).toLocaleString('ja-JP'):'処理日時：記録なし（旧データ）'));
 }
}
function renderOperationHistory(){
 syncModelOperationEvents();
 const list=$('operationHistoryList');list.replaceChildren();
 $('operationHistoryCount').textContent=String(operationLog.length);
 const chosen=$('operationHistoryFilter').value;
 const entries=operationLog.filter(entry=>chosen==='all'||chosen===entry.category).slice().reverse();
 if(!entries.length){add(list,node('p','muted','条件に合う操作履歴はありません。'));return;}
 for(const entry of entries){
  const row=add(list,node('article','operation-history-row'));
  const head=add(row,node('div','operation-history-headline'));
  add(head,node('strong','',entry.category));
  add(head,node('time','operation-history-timestamp',entry.when));
  add(row,node('p','',entry.details));
  add(row,node('small','','対象予約日：'+entry.day+' ／ '+entry.who));
 }
}
function clearOperationHistoryForReset(){
 operationLog.length=0;
 operationCursors.clear();
 operationSequence=1;
}
