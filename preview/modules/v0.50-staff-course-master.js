// v0.50: fictional store-wide course/staff registration and contractor rate preview.
// Registration is volatile in-browser and is NOT a contract, payslip or tax document.
function initialDemoMaster(){
 const initial=Core.initial();
 return {staff:Core.clone(initial.staff),menus:Core.clone(initial.menus),
   contractRules:Object.fromEntries(initial.staff.map(st=>[st.id,{kind:'unset',basis:'net',rate:0,effective:'2026-10-26',version:1}])),
   staffSeq:initial.staff.length+1,menuSeq:initial.menus.length+1};
}
let demoMaster=initialDemoMaster();
function masterContexts(){
 // Current date is sometimes also in the Map; de-duplicate by model object identity.
 return Array.from(new Set([model,...Array.from(demoDayContexts.values(),c=>c.model)].filter(Boolean)));
}
function applyDemoMaster(){
 for(const ctx of masterContexts()){
  ctx.menus=Core.clone(demoMaster.menus);
  ctx.staff=Core.clone(demoMaster.staff);
  ctx.breaks=ctx.breaks||{};
  for(const st of demoMaster.staff){
   if(!ctx.breaks[st.id])ctx.breaks[st.id]={start:720,duration:60};
  }
 }
}
function newDemoDayMaster(ctx){
 ctx.menus=Core.clone(demoMaster.menus);
 ctx.staff=Core.clone(demoMaster.staff);
 for(const st of ctx.staff)if(!ctx.breaks[st.id])ctx.breaks[st.id]={start:720,duration:60};
 return ctx;
}
function demoMasterOption(select,values,keep){
 const selected=select.value;
 select.replaceChildren();
 for(const item of values){
  const op=add(select,node('option','',item.label));
  op.value=item.id;
 }
 if(values.some(item=>item.id===selected))select.value=selected;
 else if(values.some(item=>item.id===keep))select.value=keep;
 else if(values.length)select.value=values[0].id;
}
function syncDemoMasterSelectors(){
 // All customer, manager, checkout and cash-drawer selectors use the same master.
 const menuItems=model.menus.map(m=>({id:m.id,label:m.name}));
 const staffItems=model.staff.map(st=>({id:st.id,label:st.name}));
 demoMasterOption($('bMenu'),menuItems,'m60');
 demoMasterOption($('bStaff'),staffItems.concat([{id:'unassigned',label:'担当未定（仮受付）'}]),'s1');
 demoMasterOption($('cMenu'),model.menus.map(m=>({id:m.id,label:m.name+'（'+m.price.toLocaleString('ja-JP')+'円）'})),'m60');
 demoMasterOption($('cStaff'),[{id:'any',label:'指名なし（空いている担当者）'},...staffItems],'any');
 demoMasterOption($('checkoutCashier'),staffItems,'s1');
 demoMasterOption($('regStaff'),staffItems,'s1');
}
function demoMasterNonEmptyName(value){
 const name=String(value||'').trim().replace(/\s+/g,' ');
 if(!name||name.length>35)throw Error('名称は1〜35文字で入力してください');
 return name;
}
function demoMasterPercent(input){
 const value=Number(input);
 if(!/^\d+(?:\.\d{1,2})?$/.test(String(input))||!Number.isFinite(value)||value<0||value>100)
  throw Error('歩合は0〜100％、小数第2位までで入力してください');
 return value;
}
function demoMasterValidateContract(kind,basis,rate,effective){
 if(!['unset','contract-store','contract-personal','employment','owner'].includes(kind))throw Error('契約区分を選んでください');
 if(!['gross','net'].includes(basis))throw Error('報酬の基準額を選んでください');
 const percent=demoMasterPercent(rate);
 if(!validDemoDay(effective))throw Error('契約の適用開始日を選んでください');
 return {kind,basis,rate:percent,effective};
}
function addDemoMenu(){
 const name=demoMasterNonEmptyName($('masterMenuName').value);
 if(demoMaster.menus.some(m=>m.name===name))throw Error('同じ名前のコースがあります');
 const duration=Number($('masterMenuMinutes').value),price=Number($('masterMenuPrice').value);
 if(!Number.isSafeInteger(duration)||duration<15||duration>240||duration%15!==0)throw Error('コース時間は15〜240分、15分刻みです');
 if(!Number.isSafeInteger(price)||price<0||price>1000000)throw Error('料金は0〜100万円の整数で入力してください');
 const privateRoom=$('masterMenuPrivate').checked;
 if(!model.beds.some(b=>!privateRoom||b.room==='pr1'))throw Error('使用可能なベッドがありません');
 const id='m'+demoMaster.menuSeq++;
 demoMaster.menus.push({id,name,duration,price,private:privateRoom});
 // New courses start disabled for all therapists: an administrator must assign skills.
 applyDemoMaster();
 $('masterMenuName').value='';
 recordOperation('店舗設定','コースを登録：'+name+'（'+duration+'分／'+price+'円、対応スタッフは未登録）');
 syncDemoMasterSelectors();renderDemoMaster();
 info('コースを登録しました。対応するセラピストも設定してください。');
 return id;
}
function addDemoStaff(){
 const name=demoMasterNonEmptyName($('masterStaffName').value);
 if(demoMaster.staff.some(st=>st.name===name))throw Error('同じ名前のスタッフがいます');
 const prep=Number($('masterStaffPrep').value);
 if(!Number.isSafeInteger(prep)||prep<0||prep>60||prep%15!==0)throw Error('準備時間は0〜60分、15分刻みです');
 const rule=demoMasterValidateContract(
  $('masterStaffKind').value,$('masterStaffBasis').value,
  $('masterStaffRate').value,$('masterStaffEffective').value
 );
 const id='s'+demoMaster.staffSeq++;
 // No unverified skills are automatically assigned to a new therapist.
 demoMaster.staff.push({id,name,prep,menus:[]});
 demoMaster.contractRules[id]={...rule,version:1};
 applyDemoMaster();
 $('masterStaffName').value='';
 recordOperation('店舗設定','スタッフを登録：'+name+' ／ 契約区分 '+demoContractKind(rule.kind)+' ／ 対応コース未設定');
 syncDemoMasterSelectors();renderDemoMaster();
 info('スタッフを登録しました。対応コースを選んでください。');
 return id;
}
function demoContractKind(k){
 return {unset:'未設定','contract-store':'業務委託（店舗の売上）','contract-personal':'業務委託（本人の売上）',
  employment:'雇用（給与は別管理）',owner:'店舗オーナー'}[k]||'不明';
}
function renderDemoMaster(){
 const menus=$('masterMenuList');menus.replaceChildren();
 for(const m of demoMaster.menus){
  const row=add(menus,node('div','master-line'));
  add(row,node('strong','',m.name));
  add(row,node('span','',m.duration+'分 ／ '+m.price.toLocaleString('ja-JP')+'円'+(m.private?' ／ 個室':'')+
   ' ／ 対応 '+demoMaster.staff.filter(st=>st.menus.includes(m.id)).length+'名'));
 }
 const staff=$('masterStaffList');staff.replaceChildren();
 for(const st of demoMaster.staff){
  const rule=demoMaster.contractRules[st.id];
  const row=add(staff,node('div','master-line'));
  add(row,node('strong','',st.name+'（準備'+st.prep+'分）'));
  add(row,node('span','',demoContractKind(rule?.kind)+' ／ 対応コース '+st.menus.length+'件'+
   (rule?.kind?.startsWith('contract-')?' ／ '+rule.rate+'%（試算設定）':'')));
 }
 demoMasterOption($('masterSkillsStaff'),demoMaster.staff.map(st=>({id:st.id,label:st.name})),'s1');
 demoMasterOption($('masterContractStaff'),demoMaster.staff.map(st=>({id:st.id,label:st.name})),'s1');
 renderDemoSkills();
 renderDemoContractForm();
 renderDemoRatePreview();
}
function renderDemoSkills(){
 const st=demoMaster.staff.find(s=>s.id===$('masterSkillsStaff').value);
 const target=$('masterSkillsList');target.replaceChildren();
 if(!st)return;
 for(const menu of demoMaster.menus){
  const label=add(target,node('label','master-check-row'));
  const cb=add(label,node('input'));cb.type='checkbox';cb.value=menu.id;cb.checked=st.menus.includes(menu.id);
  add(label,node('span','',menu.name));
 }
}
function saveDemoSkills(){
 const st=demoMaster.staff.find(s=>s.id===$('masterSkillsStaff').value);
 if(!st)throw Error('スタッフを選んでください');
 const selected=[...$('masterSkillsList').querySelectorAll('input[type=checkbox]:checked')].map(e=>e.value);
 // Restrict changing skills when a confirmed reservation or staged move still uses a removed skill.
 for(const ctx of masterContexts()){
  if(ctx.bookings.some(b=>b.status==='CONFIRMED'&&b.staff===st.id&&!selected.includes(b.menu)))
   throw Error('予約済みの対応コースは外せません。予約を確認してください');
 }
 st.menus=selected;
 applyDemoMaster();
 recordOperation('店舗設定',st.name+'の対応コースを変更：'+selected.length+'件');
 renderDemoMaster();info('対応コースを保存しました。');
}
function renderDemoContractForm(){
 const st=demoMaster.staff.find(s=>s.id===$('masterContractStaff').value);
 const rule=st&&demoMaster.contractRules[st.id];
 if(!rule)return;
 $('masterContractKind').value=rule.kind;
 $('masterContractBasis').value=rule.basis;
 $('masterContractRate').value=String(rule.rate);
 $('masterContractEffective').value=rule.effective;
 $('masterContractVersion').textContent='試算ルール版 '+rule.version+'（旧版保存・明細確定は未実装）';
}
function saveDemoContract(){
 const st=demoMaster.staff.find(s=>s.id===$('masterContractStaff').value);
 if(!st)throw Error('スタッフを選んでください');
 const rule=demoMasterValidateContract(
  $('masterContractKind').value,$('masterContractBasis').value,
  $('masterContractRate').value,$('masterContractEffective').value
 );
 const before=demoMaster.contractRules[st.id];
 if(before&&before.kind===rule.kind&&before.rate===rule.rate&&before.basis===rule.basis&&before.effective===rule.effective)
  throw Error('変更内容がありません');
 demoMaster.contractRules[st.id]={...rule,version:(before?.version||0)+1};
 recordOperation('店舗設定',st.name+'の契約設定を変更（表示用ルール版 '+demoMaster.contractRules[st.id].version+'）。確定明細には未反映。');
 renderDemoMaster();info('契約の試算条件を保存しました。');
}
function renderDemoRatePreview(){
 const st=demoMaster.staff.find(s=>s.id===$('masterContractStaff').value);
 const rule=st&&demoMaster.contractRules[st.id];
 const area=$('masterRateResult');
 const gross=Number($('masterPreviewGross').value),discount=Number($('masterPreviewDiscount').value);
 if(!rule||!Number.isSafeInteger(gross)||gross<0||gross>1000000||
  !Number.isSafeInteger(discount)||discount<0||discount>gross){
  area.textContent='売上・割引の金額を確認してください。';return;
 }
 if(!rule.kind.startsWith('contract-')){
  area.textContent='業務委託の契約区分と報酬条件を設定すると、試算を表示します。';return;
 }
 const basis=rule.basis==='gross'?gross:gross-discount;
 const share=Math.floor((basis*Math.round(rule.rate*100))/10000);
 area.textContent='対象額 '+basis.toLocaleString('ja-JP')+'円 × '+rule.rate+'% ＝ '+share.toLocaleString('ja-JP')+
 '円（税区分・端数処理等を確定していない試算）'+
 (rule.kind==='contract-personal'?' ／ 本人売上型はこれを店舗の報酬支払額とみなせません。':'');
}
function resetDemoMaster(){
 demoMaster=initialDemoMaster();
 applyDemoMaster();
 syncDemoMasterSelectors();
}
