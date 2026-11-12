// MVP-D is deliberately a fictional, browser-memory-only review of v0.67 terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext,Script} from 'node:vm';
const base=resolve(dirname(fileURLToPath(import.meta.url)),'../experiments/notification-review-mvp-d');
const read=file=>readFileSync(resolve(base,file),'utf8');
const html=read('index.html'),css=read('style.css'),model=read('model.js'),app=read('app.js');
function logic(){
 const window={};runInNewContext(model,{window});
 return window.NotificationReviewDemo;
}
function state(){const Demo=logic();return {Demo,s:Demo.initial()};}
const decide=(d,s,id,finding,retryApproved=false,acknowledged=true)=>{
 const row=d.get(s,id);
 return d.decide(s,{id,handoffId:row.handoffId,finding,retryApproved,acknowledged});
};
function stub(tag){
 const n={tagName:tag,className:'',textContent:'',children:[],events:{},
  value:'',checked:false,disabled:false,hidden:false,dataset:{},attributes:{},
  classList:{toggle(name,value){this[name]=value;}},
  replaceChildren(){this.children=[];},
  appendChild(child){this.children.push(child);return child;},
  addEventListener(type,callback){this.events[type]=callback;},
  setAttribute(name,value){this.attributes[name]=value;}
 };
 return n;
}
function ui(){
 const byId=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>
  [m[1],stub(m[1])]
 ));
 byId.statusFilter.value='unknown';
 const radios=[
  Object.assign(stub('radio1'),{value:'MOCK_ACCEPTED'}),
  Object.assign(stub('radio2'),{value:'MOCK_NOT_ACCEPTED'})
 ];
 const doc={
  createElement:tag=>stub(tag),
  getElementById:id=>{assert.ok(byId[id],'missing ID '+id);return byId[id];},
  querySelector:query=>query==='input[name="finding"]:checked'?
   radios.find(x=>x.checked)||null:null,
  querySelectorAll:query=>query==='input[name="finding"]'?radios:[]
 };
 const win={confirm:()=>true};
 runInNewContext(model,{window:win});
 runInNewContext(app,{window:win,document:doc,Intl,Date});
 const fire=(obj,event='click')=>{
  assert.ok(obj&&typeof obj.events[event]==='function','missing handler '+event);
  obj.events[event]({preventDefault(){}});
 };
 const content=x=>[x.textContent,...x.children.map(content)].join(' ');
 const find=(root,predicate)=>{
  if(predicate(root))return root;
  for(const child of root.children){
   const v=find(child,predicate);if(v)return v;
  }return null;
 };
 const caseButton=id=>find(byId.incidentList,x=>x.tagName==='button'&&x.dataset.id===id);
 return {byId,radios,fire,content,caseButton,win};
}
test('MVP-D is a dedicated offline noindex, no real data and no provider interface',()=>{
 assert.match(html,/noindex,nofollow/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/実際の配信状況を取得・照合する機能はありません/);
 assert.match(html,/実店舗・実顧客情報は入力しないでください/);
 assert.match(html,/v0.67 SQLite・HTTP APIとの接続はありません/);
 assert.match(css,/@media\(max-width:560px\)/);
 assert.match(css,/min-height:44px/);
 assert.doesNotMatch(app,/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|indexedDB/);
 assert.doesNotMatch(model,/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|indexedDB/);
 assert.doesNotMatch(app,/\binnerHTML\s*=/);
 new Script(app);new Script(model);
});
test('unknown cases are held and visible first, not automatically sent',()=>{
 const {Demo,s}=state();
 assert.deepEqual(Demo.counts(s),{unknown:3,resolved:1,retry:0,actualSent:0});
 assert.equal(Demo.visible(s).length,3);
 assert.equal(Demo.visible(s,'all').length,4);
 assert.equal(Demo.visible(s,'resolved').length,1);
 assert.ok(Demo.visible(s).every(x=>x.state==='OUTCOME_UNKNOWN'));
});
test('review details include fictional reservation, consent, started time and history',()=>{
 const {Demo,s}=state();
 const one=Demo.get(s,'sample-a');
 assert.equal(one.purpose,'reminder');
 assert.equal(one.booking.serviceDate,'2026-11-13');
 assert.equal(one.booking.status,'ACTIVE');
 assert.equal(one.consent.allowed,true);
 assert.equal(one.history.at(-1).action,'HANDOFF_UNCERTAIN');
});
test('explicit acknowledged mocked acceptance marks simulated, not real provider delivery',()=>{
 const {Demo,s}=state();
 const out=decide(Demo,s,'sample-a','MOCK_ACCEPTED');
 assert.equal(out.ok,true);
 assert.equal(out.state.cases[0].state,'SIMULATED');
 assert.equal(Demo.counts(out.state).unknown,2);
 assert.equal(Demo.counts(out.state).actualSent,0);
 assert.equal(s.cases[0].state,'OUTCOME_UNKNOWN');
 assert.equal(Demo.get(out.state,'sample-a').history.at(-1).action,'MOCK_ACCEPTED');
});
test('a finding cannot be committed without explicit operator acknowledgement',()=>{
 const {Demo,s}=state();
 const out=decide(Demo,s,'sample-a','MOCK_ACCEPTED',false,false);
 assert.equal(out.ok,false);
 assert.equal(out.code,'ACK_REQUIRED');
 assert.equal(out.state,s);
});
test('a mock accepted finding cannot simultaneously authorize retry',()=>{
 const {Demo,s}=state();
 const out=decide(Demo,s,'sample-a','MOCK_ACCEPTED',true);
 assert.equal(out.code,'RETRY_FORBIDDEN');
 assert.equal(out.state,s);
});
test('mock not accepted defaults to no resend and a terminated incident',()=>{
 const {Demo,s}=state();
 const out=decide(Demo,s,'sample-a','MOCK_NOT_ACCEPTED');
 assert.equal(out.ok,true);
 assert.equal(Demo.get(out.state,'sample-a').state,'DEAD');
 assert.equal(Demo.counts(out.state).retry,0);
 assert.equal(Demo.get(out.state,'sample-a').history.at(-1).action,'MOCK_NOT_ACCEPTED');
});
test('explicit manual retry is only a fictional approval when active booking and consent allow',()=>{
 const {Demo,s}=state();
 const out=decide(Demo,s,'sample-a','MOCK_NOT_ACCEPTED',true);
 assert.equal(out.ok,true);
 assert.equal(Demo.get(out.state,'sample-a').state,'RETRY');
 assert.equal(Demo.get(out.state,'sample-a').retryApproved,true);
 assert.equal(Demo.counts(out.state).retry,1);
 assert.equal(Demo.counts(out.state).actualSent,0);
});
test('revoked consent never permits mock retry even when owner checkbox is true',()=>{
 const {Demo,s}=state();
 assert.equal(Demo.eligibility(Demo.get(s,'sample-b'),s.now).possible,false);
 const out=decide(Demo,s,'sample-b','MOCK_NOT_ACCEPTED',true);
 assert.equal(out.ok,true);
 assert.equal(Demo.get(out.state,'sample-b').state,'DEAD');
 assert.equal(Demo.get(out.state,'sample-b').retryApproved,false);
 assert.equal(Demo.get(out.state,'sample-b').history.some(x=>x.action==='CONSENT_REVOKED'),true);
});
test('moved booking never permits mock retry of the old reminder',()=>{
 const {Demo,s}=state();
 assert.equal(Demo.eligibility(Demo.get(s,'sample-c'),s.now).possible,false);
 const out=decide(Demo,s,'sample-c','MOCK_NOT_ACCEPTED',true);
 assert.equal(Demo.get(out.state,'sample-c').state,'DEAD');
 assert.equal(Demo.get(out.state,'sample-c').history.some(x=>x.action==='BOOKING_MOVED'),true);
});
test('already decided case cannot be silently reversed or decided twice',()=>{
 const {Demo,s}=state();
 const first=decide(Demo,s,'sample-a','MOCK_ACCEPTED');
 const second=decide(Demo,first.state,'sample-a','MOCK_NOT_ACCEPTED',true);
 assert.equal(second.ok,false);
 assert.equal(second.code,'ALREADY_RESOLVED');
 assert.equal(second.state,first.state);
});
test('wrong case or stale handoff ID leaves state unchanged',()=>{
 const {Demo,s}=state();
 const missing=Demo.decide(s,{id:'missing',handoffId:'x',finding:'MOCK_ACCEPTED',acknowledged:true});
 assert.equal(missing.code,'NOT_FOUND');
 const wrong=Demo.decide(s,{id:'sample-a',handoffId:'forged',
  finding:'MOCK_ACCEPTED',acknowledged:true});
 assert.equal(wrong.code,'STALE_HANDOFF');
 assert.equal(wrong.state,s);
});
test('unsupported fields or findings fail closed',()=>{
 const {Demo,s}=state();
 const a=Demo.decide(s,{id:'sample-a',handoffId:'fictional-handoff-a',
  finding:'REAL_ACCEPTED',acknowledged:true});
 assert.equal(a.code,'INVALID_FINDING');
 const b=Demo.decide(s,{id:'sample-a',handoffId:'fictional-handoff-a',
  finding:'MOCK_ACCEPTED',acknowledged:true,providerToken:'secret'});
 assert.equal(b.code,'INVALID_FIELDS');
 assert.equal(s.cases[0].state,'OUTCOME_UNKNOWN');
});
test('UI initial list gives incident details, status, and disabled unconfirmed action',()=>{
 const f=ui(),e=f.byId;
 assert.match(f.content(e.incidentList),/結果不明・保留/);
 assert.match(f.content(e.caseDetails),/架空のお客様A/);
 assert.match(f.content(e.eventHistory),/結果不明として保留/);
 assert.equal(e.recordDecision.disabled,true);
 assert.equal(e.retryToggle.disabled,true);
 assert.equal(e.closedPanel.hidden,true);
 assert.equal(e.metricUnknown.textContent,'3件');
});
test('UI selecting revoked-consent case disables retry and exposes consent reason',()=>{
 const f=ui(),e=f.byId;
 f.fire(f.caseButton('sample-b'));
 assert.match(f.content(e.caseDetails),/模擬同意停止/);
 assert.match(f.content(e.eligibility),/同意が停止されています/);
 f.radios[1].checked=true;f.fire(f.radios[1],'change');
 assert.equal(e.retryToggle.disabled,true);
 assert.match(e.retryHelp.textContent,/再試行を許可できません/);
});
test('UI accepted judgment requires acknowledgement and updates both detail and summary',()=>{
 const f=ui(),e=f.byId;
 f.radios[0].checked=true;f.fire(f.radios[0],'change');
 assert.equal(e.recordDecision.disabled,true);
 e.acknowledge.checked=true;f.fire(e.acknowledge,'change');
 assert.equal(e.recordDecision.disabled,false);
 f.fire(e.recordDecision);
 assert.equal(e.metricUnknown.textContent,'2件');
 assert.equal(e.metricResolved.textContent,'2件');
 assert.equal(e.decisionPanel.hidden,true);
 assert.equal(e.closedPanel.hidden,false);
 assert.match(e.notice.textContent,/実際の送信確認ではありません/);
});
test('UI manually approved retry never sends and is visible in resolved filter',()=>{
 const f=ui(),e=f.byId;
 f.radios[1].checked=true;f.fire(f.radios[1],'change');
 assert.equal(e.retryToggle.disabled,false);
 e.retryToggle.checked=true;f.fire(e.retryToggle,'change');
 e.acknowledge.checked=true;f.fire(e.acknowledge,'change');
 f.fire(e.recordDecision);
 assert.equal(e.metricRetry.textContent,'1件');
 assert.match(f.content(e.eventHistory),/模擬未受付との判断/);
 e.statusFilter.value='resolved';f.fire(e.statusFilter,'change');
 assert.match(f.content(e.incidentList),/再試行を模擬承認/);
});
test('UI cancel selection clears mock finding and leaves incident held',()=>{
 const f=ui(),e=f.byId;
 f.radios[0].checked=true;f.fire(f.radios[0],'change');
 e.acknowledge.checked=true;f.fire(e.acknowledge,'change');
 f.fire(e.clearDecision);
 assert.equal(e.acknowledge.checked,false);
 assert.equal(f.radios.some(x=>x.checked),false);
 assert.equal(e.recordDecision.disabled,true);
 assert.equal(e.metricUnknown.textContent,'3件');
});
test('UI reset recovers four original fictional incidents and no real messages',()=>{
 const f=ui(),e=f.byId;
 f.radios[0].checked=true;f.fire(f.radios[0],'change');
 e.acknowledge.checked=true;f.fire(e.acknowledge,'change');
 f.fire(e.recordDecision);
 assert.equal(e.metricUnknown.textContent,'2件');
 f.fire(e.resetDemo);
 assert.equal(e.metricUnknown.textContent,'3件');
 assert.equal(e.metricRetry.textContent,'0件');
 assert.equal(e.statusFilter.value,'unknown');
 assert.match(e.notice.textContent,/架空の操作試験を初期状態に戻しました/);
});
