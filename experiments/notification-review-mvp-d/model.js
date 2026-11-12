/* MVP-D: offline, fully fictional notification-incident review model.
 * Mirrors the v0.67 outcome vocabulary. This is NOT the v0.67 SQLite API,
 * does not verify provider receipts, and never contacts LINE or sends data.
 */
(function(root){
'use strict';
const NOW='2026-11-12T12:00:00.000Z';
const EVENTS={ENQUEUED:'予定登録',CLAIMED:'試験用処理権限を取得',
 HANDOFF_UNCERTAIN:'結果不明として保留',MOCK_ACCEPTED:'模擬受付済みとの判断',
 MOCK_NOT_ACCEPTED:'模擬未受付との判断'};
const PURPOSES={reminder:'予約リマインド',return:'再来店のご案内',waitlist:'キャンセル枠のご案内'};
function entry(action,at,details=''){
 return {action,at,details};
}
function initial(){
 return {
  now:NOW,
  cases:[
   {
    id:'sample-a',draftId:'fictional-draft-a',handoffId:'fictional-handoff-a',
    customer:'架空のお客様A',purpose:'reminder',state:'OUTCOME_UNKNOWN',
    startedAt:'2026-11-12T11:14:00.000Z',createdAt:'2026-11-12T11:10:00.000Z',
    expiresAt:'2026-11-13T14:00:00.000Z',attempts:1,maxAttempts:3,
    consent:{allowed:true,checkedAt:'2026-11-12T11:10:00.000Z'},
    booking:{id:'fictional-booking-a',serviceDate:'2026-11-13',start:'14:00',
      course:'架空の60分コース',status:'ACTIVE'},
    history:[
     entry('ENQUEUED','2026-11-12T11:10:00.000Z'),
     entry('CLAIMED','2026-11-12T11:13:55.000Z'),
     entry('HANDOFF_UNCERTAIN','2026-11-12T11:14:00.000Z')
    ],finding:null,retryApproved:false
   },
   {
    id:'sample-b',draftId:'fictional-draft-b',handoffId:'fictional-handoff-b',
    customer:'架空のお客様B',purpose:'return',state:'OUTCOME_UNKNOWN',
    startedAt:'2026-11-12T10:20:00.000Z',createdAt:'2026-11-12T10:15:00.000Z',
    expiresAt:'2026-11-14T10:00:00.000Z',attempts:1,maxAttempts:3,
    consent:{allowed:false,checkedAt:'2026-11-12T10:40:00.000Z'},
    booking:null,
    history:[
     entry('ENQUEUED','2026-11-12T10:15:00.000Z'),
     entry('CLAIMED','2026-11-12T10:19:50.000Z'),
     entry('HANDOFF_UNCERTAIN','2026-11-12T10:20:00.000Z'),
     entry('CONSENT_REVOKED','2026-11-12T10:40:00.000Z','架空の同意撤回')
    ],finding:null,retryApproved:false
   },
   {
    id:'sample-c',draftId:'fictional-draft-c',handoffId:'fictional-handoff-c',
    customer:'架空のお客様C',purpose:'reminder',state:'OUTCOME_UNKNOWN',
    startedAt:'2026-11-12T09:30:00.000Z',createdAt:'2026-11-12T09:20:00.000Z',
    expiresAt:'2026-11-13T11:30:00.000Z',attempts:1,maxAttempts:3,
    consent:{allowed:true,checkedAt:'2026-11-12T09:20:00.000Z'},
    booking:{id:'fictional-booking-c',serviceDate:'2026-11-13',start:'11:30',
      course:'架空の90分コース',status:'MOVED'},
    history:[
     entry('ENQUEUED','2026-11-12T09:20:00.000Z'),
     entry('HANDOFF_UNCERTAIN','2026-11-12T09:30:00.000Z'),
     entry('BOOKING_MOVED','2026-11-12T09:55:00.000Z','架空の予約変更')
    ],finding:null,retryApproved:false
   },
   {
    id:'sample-d',draftId:'fictional-draft-d',handoffId:'fictional-handoff-d',
    customer:'架空のお客様D',purpose:'waitlist',state:'SIMULATED',
    startedAt:'2026-11-12T08:20:00.000Z',createdAt:'2026-11-12T08:10:00.000Z',
    expiresAt:'2026-11-13T08:20:00.000Z',attempts:1,maxAttempts:3,
    consent:{allowed:true,checkedAt:'2026-11-12T08:10:00.000Z'},
    booking:{id:'fictional-booking-d',serviceDate:'2026-11-13',start:'15:30',
      course:'架空の60分コース',status:'CANCELED'},
    history:[
     entry('HANDOFF_UNCERTAIN','2026-11-12T08:20:00.000Z'),
     entry('MOCK_ACCEPTED','2026-11-12T08:26:00.000Z','模擬判断。LINE受信証拠ではありません')
    ],finding:'MOCK_ACCEPTED',retryApproved:false
   }
  ],resetCount:0
 };
}
function deep(x){return JSON.parse(JSON.stringify(x));}
function get(state,id){return state.cases.find(x=>x.id===id)||null;}
function eligibility(item,now){
 const reasons=[];
 if(!item.consent.allowed)reasons.push('同意が停止されています');
 if(item.booking&&item.booking.status!=='ACTIVE'&&item.purpose!=='waitlist')
  reasons.push('元予約が現在は有効ではありません');
 if(item.purpose==='waitlist')reasons.push('希望条件・空き枠をサーバー側で再確認する必要があります');
 if(item.purpose==='return')reasons.push('来店周期・既存予約をサーバー側で再確認する必要があります');
 if(Date.parse(item.expiresAt)<=Date.parse(now)+60000)reasons.push('期限切れ、または再試行に必要な時間がありません');
 if(item.attempts>=item.maxAttempts)reasons.push('試行回数の上限に達しています');
 // The demo deliberately permits manual retry only for the fixed reminder
 // with a still-active booking and consent, not for unchecked other purposes.
 const safeForDemo=item.purpose==='reminder'&&reasons.length===0&&
   item.booking?.status==='ACTIVE';
 return {possible:safeForDemo,reasons,
  note:'実運用では本人確認・最新予約・同意・送信先・費用をサーバーが再検証する必要があります。'};
}
function counts(state){
 const cases=state.cases;
 return {
  unknown:cases.filter(x=>x.state==='OUTCOME_UNKNOWN').length,
  resolved:cases.filter(x=>x.state!=='OUTCOME_UNKNOWN').length,
  retry:cases.filter(x=>x.state==='RETRY').length,
  actualSent:0
 };
}
function visible(state,filter='unknown'){
 const items=state.cases.filter(x=>filter==='all'||(filter==='unknown'?
  x.state==='OUTCOME_UNKNOWN':x.state!=='OUTCOME_UNKNOWN'));
 return [...items].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
}
function decide(state,input={}){
 const fail=(code,message)=>({ok:false,code,message,state});
 const allowed=['id','handoffId','finding','retryApproved','acknowledged'];
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!allowed.includes(k)))
  return fail('INVALID_FIELDS','入力項目を確認してください。');
 const item=get(state,input.id);
 if(!item)return fail('NOT_FOUND','対象の案内が見つかりません。');
 if(item.handoffId!==input.handoffId)return fail('STALE_HANDOFF','試行番号が一致しません。');
 if(item.state!=='OUTCOME_UNKNOWN')return fail('ALREADY_RESOLVED','この案件はすでに処理済みです。');
 if(input.acknowledged!==true)return fail('ACK_REQUIRED','模擬調査の確認が必要です。');
 if(!['MOCK_ACCEPTED','MOCK_NOT_ACCEPTED'].includes(input.finding))
  return fail('INVALID_FINDING','模擬調査結果を選んでください。');
 if(input.retryApproved!==undefined&&typeof input.retryApproved!=='boolean')
  return fail('INVALID_RETRY','再試行の指定が不正です。');
 if(input.finding==='MOCK_ACCEPTED'&&input.retryApproved===true)
  return fail('RETRY_FORBIDDEN','模擬受付済みの場合は再試行できません。');
 const next=deep(state),row=get(next,input.id);
 const timestamp=next.now;
 let message;
 if(input.finding==='MOCK_ACCEPTED'){
  row.state='SIMULATED';row.finding='MOCK_ACCEPTED';row.retryApproved=false;
  row.history.push(entry('MOCK_ACCEPTED',timestamp,'架空の判断。実際の配信を確認したものではありません'));
  message='模擬受付済みとして記録しました。実際の送信確認ではありません。';
 }else{
  const check=eligibility(row,next.now);
  const retry= input.retryApproved===true&&check.possible;
  row.state=retry?'RETRY':'DEAD';
  row.finding='MOCK_NOT_ACCEPTED';row.retryApproved=retry;
  row.history.push(entry('MOCK_NOT_ACCEPTED',timestamp,retry?
   '架空のオーナーが再試行を承認（実送信なし）':
   '停止。模擬再試行を実行しない'));
  message=retry?'模擬再試行を承認済みとして記録しました。LINEへの送信はありません。':
   '模擬未受付として停止しました。再送は行いません。';
 }
 return {ok:true,code:'RECORDED',message,state:next};
}
root.NotificationReviewDemo=Object.freeze({
 initial,get,visible,counts,eligibility,decide,
 purposes:PURPOSES,actions:EVENTS
});
})(typeof module==='object'&&module.exports?module.exports:window);
