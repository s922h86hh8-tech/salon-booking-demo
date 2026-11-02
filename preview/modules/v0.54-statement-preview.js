// v0.54 - fictional staff/year statement preview. Browser memory only.
// Admin-side preview selector is NOT authentication or staff-only access.
// Do not use these amounts directly as taxable income, bank evidence or actual payslips.

function v54Year(year){
 const text=String(year);
 if(!/^20\d{2}$/.test(text))throw Error('対象年は2000〜2099の4桁で選んでください');
 return text;
}
function v54Rows(year,staffId){
 const y=v54Year(year);
 if(!demoMaster.staff.some(st=>st.id===staffId))throw Error('表示するセラピストを選んでください');
 return Array.from({length:12},(_,i)=>{
  const month=y+'-'+String(i+1).padStart(2,'0');
  const closing=v53Find(month,staffId);
  const draft=v53DraftLines(month,staffId);
  const pending=v53Unprocessed(month,staffId).length;
  const state=closing?v53State(closing):null;
  return {
   month,sourceCount:closing?closing.sourceCount:0,
   closed:closing?closing.total:0,
   provisional:closing?0:draft.reduce((sum,line)=>sum+line.amount,0),
   paid:state?state.paid:0,remaining:state?state.remaining:0,
   pending,dueDate:closing?closing.dueDate:'',
   status:closing?(pending?'要訂正（模擬）':state.label):
    pending?'要確認（未締め）':draft.length?'未締め（参考）':'記録なし'
  };
 });
}
function v54Summary(year,staffId){
 const y=v54Year(year),rows=v54Rows(y,staffId);
 const sum=field=>rows.reduce((total,row)=>total+row[field],0);
 // These simulated receipts are grouped by entered payment date, regardless of service year.
 const paymentsByDate=v53Payments.filter(p=>{
  const closing=v53Closings.get(p.closingId);
  return closing?.staffId===staffId&&p.paidDate.slice(0,4)===y;
 });
 return {year:y,staffId,rows,closed:sum('closed'),provisional:sum('provisional'),
  paidOnYearClosings:sum('paid'),remaining:sum('remaining'),
  paidByDate:paymentsByDate.reduce((n,p)=>n+p.amount,0),
  paymentCount:paymentsByDate.length,issues:sum('pending')};
}
function v54Details(month,staffId){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象月を確認してください');
 v53Key(month,staffId);
 const closing=v53Find(month,staffId);
 const lines=closing?closing.lines.map(x=>({day:x.day,sourceId:x.sourceId,
  amount:x.amount,contractVersion:x.contractVersion,kind:'締め済み（模擬）'})):
  v53DraftLines(month,staffId).map(x=>({day:x.day,sourceId:x.id,
   amount:x.amount,contractVersion:x.contract.version,kind:'未締め（参考）'}));
 return lines.sort((a,b)=>a.day.localeCompare(b.day)||a.sourceId.localeCompare(b.sourceId));
}
function v54CsvValue(value){
 let s=String(value??'');
 // Prevent spreadsheet formula interpretation if future data fields become editable.
 if(/^[\s]*[=+\-@]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
function v54Csv(year,staffId){
 const result=v54Summary(year,staffId);
 const rows=[
  ['対象年','対象月','締め原票件数','締め額（模擬円）','未締め参考額（円）',
   '締め分への支払記録累計（円）','締め分の未払い（円）','要確認予約件数','状態','支払予定日'],
  ...result.rows.map(r=>[result.year,r.month,r.sourceCount,r.closed,r.provisional,
   r.paid,r.remaining,r.pending,r.status,r.dueDate]),
  [],
  ['集計区分','金額（模擬円）','説明'],
  ['対象年に締めた額',result.closed,'施術対象年・月次締め単位'],
  ['締め分への支払記録累計',result.paidOnYearClosings,'支払入力日が対象年以外のものも含む'],
  ['締め分の未払い',result.remaining,'未締め参考額は含まない'],
  ['対象年の支払日で集計',result.paidByDate,'別の施術年の締めへの支払も含む'],
  ['未締め原票参考額',result.provisional,'報酬確定・支払を意味しない'],
  ['注意','架空データ','本人認証なし／実送金なし／申告額ではない']
 ];
 return '\uFEFF'+rows.map(cells=>cells.map(v54CsvValue).join(',')).join('\r\n')+'\r\n';
}
function v54Render(){
 const year=v54Year($('v54Year').value||'2026');
 demoMasterOption($('v54Staff'),demoMaster.staff.map(st=>({id:st.id,label:st.name})),'s1');
 const staffId=$('v54Staff').value,report=v54Summary(year,staffId);
 const yen=n=>n.toLocaleString('ja-JP')+'円';
 $('v54Closed').textContent=yen(report.closed);
 $('v54PaidClosing').textContent=yen(report.paidOnYearClosings);
 $('v54Remaining').textContent=yen(report.remaining);
 $('v54PaidByDate').textContent=yen(report.paidByDate);
 $('v54Provisional').textContent=yen(report.provisional);
 $('v54Issues').textContent=String(report.issues);
 const table=$('v54Rows');table.replaceChildren();
 for(const row of report.rows){
  const entry=add(table,node('div','v54-month'));
  const head=add(entry,node('div','v54-month-head'));
  add(head,node('strong','',row.month+' ／ '+row.status));
  add(head,node('span','',row.sourceCount+'件'));
  add(entry,node('div','v54-money','締め '+yen(row.closed)+' ／ 入力済み支払累計 '+yen(row.paid)+' ／ 未払い '+yen(row.remaining)));
  if(row.provisional||row.pending)add(entry,node('small','muted','未締め参考 '+yen(row.provisional)+' ／ 要確認 '+row.pending+'件'));
 }
 const monthSelect=$('v54Month'),prior=monthSelect.value;
 monthSelect.replaceChildren();
 for(const row of report.rows){const option=add(monthSelect,node('option','',row.month));option.value=row.month;}
 monthSelect.value=report.rows.some(r=>r.month===prior)?prior:year+'-10';
 const lines=v54Details(monthSelect.value,staffId),area=$('v54Details');area.replaceChildren();
 if(!lines.length)add(area,node('p','muted','この月の店舗売上型・業務委託報酬原票はありません。'));
 for(const entry of lines){
  const row=add(area,node('div','v54-line'));
  add(row,node('strong','',entry.day+' ／ '+entry.amount.toLocaleString('ja-JP')+'円'));
  add(row,node('small','',entry.kind+' ／ 契約版 '+entry.contractVersion+' ／ 架空の施術記録'));
 }
 $('v54CsvPreview').value='';
}
function v54ShowCsv(){
 $('v54CsvPreview').value=v54Csv($('v54Year').value,$('v54Staff').value);
}
function v54DownloadCsv(){
 const year=v54Year($('v54Year').value),staff=$('v54Staff').value;
 const csv=v54Csv(year,staff);
 $('v54CsvPreview').value=csv;
 if(typeof Blob==='undefined'||typeof URL==='undefined'||!URL.createObjectURL){
  info('CSVを画面に表示しました。内容をコピーして保存してください。');
  return;
 }
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='fictional-contractor-statement-'+year+'.csv';
 document.body.appendChild(a);a.click();a.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),30000);
 info('CSV保存の操作を開始しました。保存先を確認してください（架空データのみ）。');
}
