// v0.51: isolated fictional contractor version calculation. No payroll, tax, bank or API operations.
function v51BasisPoints(rate) {
 const value=String(rate).trim();
 if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('歩合は0〜100%、小数第2位まで');
 const hundredths=Math.round(Number(value)*100);
 if(!Number.isSafeInteger(hundredths)||hundredths<0||hundredths>10000)throw Error('歩合は0〜100%');
 return hundredths;
}
function v51Round(numerator,denominator,rounding){
 const q=Math.floor(numerator/denominator),r=numerator%denominator;
 if(rounding==='floor')return q;
 if(rounding==='ceil')return q+(r?1:0);
 if(rounding==='half-up')return q+(r*2>=denominator?1:0);
 throw Error('端数処理の設定を確認してください');
}
function v51Calculate(version,gross,discount){
 if(!version||!['contract-store','contract-personal'].includes(version.kind))throw Error('業務委託の契約版がありません');
 if(!Number.isSafeInteger(gross)||gross<0||gross>1000000||
 !Number.isSafeInteger(discount)||discount<0||discount>gross)throw Error('売上・割引を0〜100万円の整数で確認してください');
 const rateBP=v51BasisPoints(version.rate);
 const basis=version.basis==='gross'?gross:version.basis==='net'?gross-discount:null;
 if(basis===null)throw Error('計算基準が不明です');
 const amount=v51Round(basis*rateBP,10000,version.rounding);
 return {gross,discount,basis,amount,rateBP,version:version.version,
   kind:version.kind,rounding:version.rounding,ruleEffective:version.effective};
}
function v51Select(versions,date){
 if(!validDemoDay(date))throw Error('対象日を確認してください');
 return versions.filter(v=>v.effective<=date)
  .sort((a,b)=>b.effective.localeCompare(a.effective)||b.version-a.version)[0]||null;
}
function v51InitialHistory(master){
 return Object.fromEntries(Object.entries(master.contractRules).map(([id,rule])=>
 [id,[Object.freeze({...rule,rounding:'floor',createdAt:'初期の架空設定'})]]));
}
let v51RuleHistory=v51InitialHistory(demoMaster);
let v51PreviewSnapshots=[];
let v51QuoteNumber=1;
function v51GetCurrentStaff(){
 return demoMaster.staff.find(s=>s.id===$('masterContractStaff').value);
}
function v51RuleForDate(staffId,date){
 return v51Select(v51RuleHistory[staffId]||[],date);
}
function v51GetPreview(){
 const st=v51GetCurrentStaff();
 if(!st)throw Error('スタッフを選んでください');
 const date=$('v51ServiceDate').value;
 const rule=v51RuleForDate(st.id,date);
 if(!rule)throw Error('対象日に有効な契約版がありません');
 const gross=Number($('masterPreviewGross').value);
 const discount=Number($('masterPreviewDiscount').value);
 const calc=v51Calculate(rule,gross,discount);
 return {staff:st,day:date,rule,calc};
}
function v51Render(){
 const area=$('v51RateResult'),list=$('v51RuleList'),snapshots=$('v51QuoteList');
 const st=v51GetCurrentStaff();
 list.replaceChildren();snapshots.replaceChildren();
 if(!st){area.textContent='スタッフを選んでください。';return;}
 const versions=v51RuleHistory[st.id]||[];
 for(const v of [...versions].reverse()){
  const row=add(list,node('div','v51-entry'));
  add(row,node('strong','', '契約版 '+v.version+' ／ '+v.effective));
  add(row,node('span','',demoContractKind(v.kind)+' ／ '+(v.basis==='net'?'割引後':'通常料金')+
     ' × '+v.rate+'% ／ '+({floor:'切捨て',ceil:'切上げ','half-up':'四捨五入'}[v.rounding]||'未設定')));
 }
 const saved=v51PreviewSnapshots.filter(x=>x.staffId===st.id);
 for(const x of [...saved].reverse()){
  const row=add(snapshots,node('div','v51-entry'));
  add(row,node('strong','','試算 #'+x.no+' ／ 対象日 '+x.day+' ／ '+x.amount.toLocaleString('ja-JP')+'円'));
  add(row,node('span','','契約版 '+x.contract.version+' ／ '+x.contract.rate+'% ／ 保存 '+x.createdAt+
   '（仮試算・支払確定ではありません）'));
 }
 try{
  const {day,rule,calc}=v51GetPreview();
  area.textContent=day+' ／ 契約版 '+rule.version+'（'+rule.effective+'から）'+
   ' ／ '+calc.basis.toLocaleString('ja-JP')+'円 × '+rule.rate+'%'+
   ' ＝ '+calc.amount.toLocaleString('ja-JP')+'円（'+
   ({floor:'切捨て',ceil:'切上げ','half-up':'四捨五入'}[rule.rounding])+'）'+
   (rule.kind==='contract-personal'?' ／ 本人売上型：店舗から支払う報酬ではありません':' ／ 店舗売上型：支払前の参考試算');
 }catch(error){area.textContent=error.message||'試算できません';}
}
function v51SaveContract(){
 const st=v51GetCurrentStaff();
 if(!st)throw Error('スタッフを選んでください');
 const candidate=demoMasterValidateContract($('masterContractKind').value,
 $('masterContractBasis').value,$('masterContractRate').value,$('masterContractEffective').value);
 const rounding=$('v51RoundRule').value;
 if(!['floor','ceil','half-up'].includes(rounding))throw Error('端数処理を選んでください');
 const history=v51RuleHistory[st.id]||[];
 const previous=history.at(-1);
 if(previous&&previous.kind!=='unset'&&candidate.effective<=previous.effective)
  throw Error('契約改定の開始日は前版より後の日付にしてください');
 if(previous&&previous.kind===candidate.kind&&previous.basis===candidate.basis&&
 previous.rate===candidate.rate&&previous.effective===candidate.effective&&previous.rounding===rounding)
  throw Error('変更内容がありません');
 const current=Object.freeze({...candidate,rounding,version:(previous?.version||0)+1,
 createdAt:new Date().toISOString()});
 v51RuleHistory[st.id]=[...history,current];
 demoMaster.contractRules[st.id]={...current};
 recordOperation('店舗設定',st.name+'の契約試算ルール版 '+current.version+
 '（適用 '+current.effective+'）。過去の版と試算スナップショットは保持');
 renderDemoMaster();v51Render();info('契約ルールを版付きで保存しました（試算専用）。');
}
function v51AddStaff(){
 const id=addDemoStaff();
 const rule=demoMaster.contractRules[id];
 if(rule)v51RuleHistory[id]=[Object.freeze({...rule,rounding:'floor',createdAt:new Date().toISOString()})];
 v51Render();
 return id;
}
function v51SaveQuote(){
 const {staff,day,rule,calc}=v51GetPreview();
 const quote=Object.freeze({no:v51QuoteNumber++,staffId:staff.id,day,contract:Object.freeze({...rule}),
 ...calc,createdAt:new Date().toLocaleString('ja-JP')});
 v51PreviewSnapshots.push(quote);
 recordOperation('店舗設定',staff.name+'の報酬試算 #'+quote.no+'：'+quote.amount+
 '円 ／ 契約版'+quote.contract.version+'（未確定）',day);
 v51Render();info('試算の控えを保存しました。報酬の確定や支払ではありません。');
 return quote;
}
function v51Reset(){
 v51RuleHistory=v51InitialHistory(demoMaster);
 v51PreviewSnapshots=[];
 v51QuoteNumber=1;
}
