// v0.46 source fragment: pasted into the inline fictional demo controller.
// This fragment depends on demo globals and intentionally performs no external I/O.
const DEMO_TARGETS={
 line:{name:'LINE公式',group:'external',types:['auth','network','sync']},
 calendar:{name:'カレンダー',group:'external',types:['auth','network','sync']},
 bookingSite:{name:'外部予約サイト',group:'external',types:['auth','network','sync']},
 website:{name:'自社HP予約',group:'external',types:['network','sync']},
 payment:{name:'決済サービス',group:'external',types:['network','result']},
 pos:{name:'POS・会計ソフト',group:'external',types:['auth','network','sync']},
 booking:{name:'予約操作',group:'internal',types:['conflict','record']},
 checkout:{name:'会計操作',group:'internal',types:['mismatch','result']},
 register:{name:'レジ操作',group:'internal',types:['difference','record']}
};
const DEMO_FAILURE_TYPES={
 auth:{title:'許可を確認できません',action:'接続先の権限と設定を確認'},
 network:{title:'通信できません',action:'通信状況と処理結果を確認。二重送信しない'},
 sync:{title:'反映を確認できません',action:'元と先の記録を照合。二重登録に注意'},
 result:{title:'処理結果が不明です',action:'取引や決済の記録を確認。確認前に再実行しない'},
 conflict:{title:'予約が重なっています',action:'担当者・設備・時間を確認'},
 mismatch:{title:'支払い額が合いません',action:'請求額と支払い内訳を確認'},
 difference:{title:'現金に差額があります',action:'金種・入出金履歴を確認して数え直す'},
 record:{title:'記録を確認できません',action:'元の記録を確認。重複登録を避ける'}
};
function activeDemoAlerts(){
 return Object.entries(demoAlertActive).filter(([key,type])=>DEMO_TARGETS[key]&&DEMO_FAILURE_TYPES[type]);
}
function renderIntegrationAlert(){
 const issues=activeDemoAlerts();
 $('integrationAlert').classList.toggle('hidden',issues.length===0);
 $('noticeOpenCount').textContent=String(issues.length);
 $('integrationAlertTitle').textContent=issues.length?'要確認（模擬） '+issues.length+'件':'要確認（模擬）';
 const labels=issues.slice(0,2).map(([key,type])=>DEMO_TARGETS[key].name+'：'+DEMO_FAILURE_TYPES[type].title);
 if(issues.length>2)labels.push('ほか'+(issues.length-2)+'件');
 $('integrationAlertText').textContent=labels.join(' ／ ');
}
function logDemoAlert(target,type,action){
 demoAlertHistory.push({id:demoAlertNext++,target,type,action,at:new Date().toLocaleString('ja-JP')});
}
function showDemoAlert(target,type){
 const item=DEMO_TARGETS[target];
 if(!item||!item.types.includes(type))return false;
 demoAlertActive[target]=type;
 logDemoAlert(target,type,'表示');
 renderIntegrationAlert();
 if(page==='connect')renderConnect();
 return true;
}
function dismissDemoAlert(target){
 const type=demoAlertActive[target];
 if(!type)return false;
 delete demoAlertActive[target];
 logDemoAlert(target,type,'表示を閉じた（未解決）');
 renderIntegrationAlert();
 if(page==='connect')renderConnect();
 return true;
}
function renderDemoAlertHistory(){
 const root=$('noticeHistory');root.replaceChildren();
 if(!demoAlertHistory.length){add(root,node('p','muted','まだ履歴はありません。'));return;}
 for(const entry of [...demoAlertHistory].reverse()){
  const div=add(root,node('div','v46-log-entry'));
  add(div,node('strong','',DEMO_TARGETS[entry.target].name+'：'+DEMO_FAILURE_TYPES[entry.type].title));
  add(div,node('span','',entry.action+' ／ '+entry.at));
 }
}
function renderConnect(){
 const root=$('connectList');root.replaceChildren();
 for(const group of [
  {id:'external',title:'外部サービス',note:'接続可否は個別確認・現在は未接続'},
  {id:'internal',title:'店舗内の操作',note:'実際の操作エラー検出ではなく表示例'}
 ]){
  const area=add(root,node('div','v46-group'));
  add(area,node('h4','',group.title));
  add(area,node('p','muted',group.note));
  for(const [key,target] of Object.entries(DEMO_TARGETS)){
   if(target.group!==group.id)continue;
   const type=demoAlertActive[key],failure=DEMO_FAILURE_TYPES[type];
   const card=add(area,node('section','demo-connection-card'+(failure?' is-error':'')));
   const head=add(card,node('div','demo-connection-head'));
   add(head,node('strong','',target.name));
   add(head,node('span','demo-connection-status'+(failure?' failed':''),failure?'要確認（模擬）':target.group==='external'?'未接続':'表示テスト'));
   if(failure){
    const box=add(card,node('div','demo-connection-error'));
    add(box,node('strong','','! '+failure.title+'（模擬）'));
    add(box,node('p','','確認すること：'+failure.action));
    add(box,node('small','','実際の障害や処理失敗ではありません。'));
   }
   const actions=add(card,node('div','demo-connection-actions'));
   const select=add(actions,node('select'));
   select.setAttribute('aria-label',target.name+'の表示例');
   for(const allowed of target.types){
    const opt=add(select,node('option','',DEMO_FAILURE_TYPES[allowed].title));opt.value=allowed;
   }
   if(failure)select.value=type;
   const show=add(actions,node('button','secondary','表示を試す'));
   show.type='button';show.addEventListener('click',()=>showDemoAlert(key,select.value));
   if(failure){
    const close=add(actions,node('button','secondary','表示を閉じる'));
    close.type='button';close.addEventListener('click',()=>dismissDemoAlert(key));
   }
  }
 }
 renderDemoAlertHistory();
}
