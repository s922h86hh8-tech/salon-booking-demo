// MVP-C: LINE messaging intent without sending, fictional booking and consent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext,Script} from 'node:vm';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=resolve(root,'experiments/line-retention-mvp-c');
const html=readFileSync(resolve(dir,'index.html'),'utf8');
const css=readFileSync(resolve(dir,'style.css'),'utf8');
const code=readFileSync(resolve(dir,'logic.js'),'utf8');
const ui=readFileSync(resolve(dir,'app.js'),'utf8');
const source=readFileSync(resolve(dir,'core-v057.js'),'utf8');
const oldSource=readFileSync(resolve(root,'experiments/marketing-booking-mvp-a/core-v057.js'),'utf8');
function fixture(){
 const window={};
 runInNewContext(source,{window});
 runInNewContext(code,{window});
 return {Core:window.DemoCore,Logic:window.RebookingDemo,
  state:window.RebookingDemo.initial(window.DemoCore)};
}
function transition(f,name,...args){
 const r=f.Logic[name](f.state,f.Core,...args);
 if(r.ok)f.state=r.state;
 return r;
}
function assertCode(r,code){
 assert.equal(r.ok,false);
 assert.equal(r.code,code);
}
function fake(tag){
 const n={
  tagName:tag,className:'',textContent:'',children:[],events:{},
  dataset:{},attributes:{},hidden:false,
  classList:{toggle(name,value){this[name]=value;}},
  replaceChildren(){this.children=[];},
  appendChild(x){this.children.push(x);return x;},
  addEventListener(name,fn){this.events[name]=fn;},
  setAttribute(name,value){this.attributes[name]=value;}
 };
 return n;
}
function uiFixture(){
 const byId=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],fake(m[1])]));
 const tabs=Object.fromEntries([...html.matchAll(/data-tab="([^"]+)"/g)].map(m=>{
  const t=fake('tab');t.dataset.tab=m[1];return [m[1],t];
 }));
 const document={
  createElement:tag=>fake(tag),
  getElementById:id=>{assert.ok(byId[id],'missing '+id);return byId[id];},
  querySelector:sel=>tabs[sel.match(/^\[data-tab="([^"]+)"\]$/)?.[1]]||null,
  querySelectorAll:sel=>sel==='[data-tab]'?Object.values(tabs):[]
 };
 const window={confirm:()=>true};
 runInNewContext(source,{window});runInNewContext(code,{window});
 runInNewContext(ui,{window,document});
 const click=x=>{
  assert.ok(x&&typeof x.events.click==='function');
  x.events.click({preventDefault(){}});
 };
 const content=x=>[x.textContent,...x.children.map(content)].join(' ');
 const findButton=(root,label)=>{
  const search=node=>{
   if(node.tagName==='button'&&node.textContent.includes(label))return node;
   for(const child of node.children){const r=search(child);if(r)return r;}
   return null;
  };return search(root);
 };
 return {byId,tabs,window,click,content,findButton};
}
test('the v0.57 booking and waitlist core is byte-for-byte unchanged',()=>{
 assert.equal(source,oldSource);
 assert.equal(createHash('sha256').update(source).digest('hex'),
  createHash('sha256').update(oldSource).digest('hex'));
});
test('MVP-C is noindex, network-free and does not collect live contact details',()=>{
 assert.match(html,/noindex,nofollow/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/LINEへの送信、実予約、通知、会計、顧客情報の保存は一切行いません/);
 assert.match(html,/再読み込みすると初期状態に戻ります/);
 assert.match(css,/@media\(max-width:560px\)/);
 assert.match(css,/min-height:44px/);
 assert.doesNotMatch(ui,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b|\bWebSocket\b/);
 assert.doesNotMatch(code,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b|\bWebSocket\b/);
 assert.doesNotMatch(ui,/\binnerHTML\s*=/);
 new Script(ui);new Script(code);
});
test('historical intervals yield an explicitly estimated 28-day cycle',()=>{
 const f=fixture();
 const d=f.state.customers.find(x=>x.id==='c4');
 const cycle=f.Logic.calculateCycle(d);
 assert.equal(cycle.days,28);
 assert.equal(cycle.basis,2);
 assert.equal(cycle.next,'2026-11-12');
 assert.equal(f.Logic.calculateCycle(f.state.customers.find(x=>x.id==='c3')),null);
});
test('reservation reminder is a consented draft, without external delivery',()=>{
 const f=fixture();
 const r=transition(f,'prepare','reminder','c2');
 assert.equal(r.ok,true);
 assert.equal(f.state.drafts.length,1);
 assert.equal(f.state.drafts[0].status,'DRAFT');
 assert.equal(f.Logic.numbers(f.state).simulated,0);
 assertCode(transition(f,'prepare','reminder','c3'),'NO_CONSENT');
 assertCode(transition(f,'prepare','reminder','c2'),'DUPLICATE');
});
test('rebooking suggestions require a due cycle, marketing consent, and no existing booking',()=>{
 const f=fixture();
 assert.equal(transition(f,'prepare','return','c4').ok,true);
 assertCode(transition(f,'prepare','return','c1'),'NOT_DUE');
 assertCode(transition(f,'prepare','return','c5'),'NO_CONSENT');
 assert.equal(f.state.drafts[0].details.next,'2026-11-12');
 const consent=transition(f,'setConsent','c3','return',true);
 assert.equal(consent.ok,true);
 assertCode(transition(f,'prepare','return','c3'),'NOT_ENOUGH_HISTORY');
});
test('a fictional owner must approve before any simulated delivery mark',()=>{
 const f=fixture();
 transition(f,'prepare','return','c4');
 const id=f.state.drafts[0].id;
 assertCode(transition(f,'simulateDelivery',id),'NOT_APPROVED');
 assert.equal(transition(f,'approve',id).ok,true);
 assert.equal(f.state.drafts[0].status,'APPROVED');
 assert.equal(f.Logic.numbers(f.state).approved,1);
 assert.equal(transition(f,'simulateDelivery',id).ok,true);
 assert.equal(f.state.drafts[0].status,'SIMULATED_SENT');
 assert.equal(f.state.audit.some(x=>x.action==='SIMULATED_DELIVERY_ONLY'),true);
 assertCode(transition(f,'simulateDelivery',id),'NOT_APPROVED');
});
test('marketing opt-out suppresses prepared draft and prevents release',()=>{
 const f=fixture();
 transition(f,'prepare','return','c4');
 const id=f.state.drafts[0].id;
 transition(f,'approve',id);
 const off=transition(f,'setConsent','c4','return',false);
 assert.equal(off.ok,true);
 assert.equal(f.state.drafts[0].status,'SUPPRESSED');
 assertCode(transition(f,'simulateDelivery',id),'NOT_APPROVED');
 assertCode(transition(f,'prepare','return','c4'),'NO_CONSENT');
});
test('the three notification consents are independent',()=>{
 const f=fixture();
 transition(f,'setConsent','c2','return',false);
 assert.equal(f.state.customers.find(x=>x.id==='c2').reminderConsent,true);
 assert.equal(f.state.customers.find(x=>x.id==='c2').waitlistConsent,true);
 assert.equal(transition(f,'prepare','reminder','c2').ok,true);
 transition(f,'setConsent','c2','reminder',false);
 assert.equal(f.state.drafts[0].status,'SUPPRESSED');
});
test('waitlist proposal reuses original v0.57 cancellation matching and never sends automatically',()=>{
 const f=fixture();
 assertCode(transition(f,'prepareWaitlist'),'NO_RELEASE');
 assert.equal(transition(f,'cancelForWaitlist').ok,true);
 assert.equal(f.state.model.bookings.find(x=>x.id===2).status,'CANCELLED');
 const m=transition(f,'prepareWaitlist');
 assert.equal(m.ok,true);
 assert.equal(f.state.drafts.length,1);
 assert.equal(f.state.drafts[0].status,'DRAFT');
 assert.equal(f.state.drafts[0].type,'waitlist');
 assert.ok(f.state.drafts[0].details.offerId);
 assert.equal(f.Logic.numbers(f.state).recovered,0);
 assertCode(transition(f,'prepareWaitlist'),'NO_CANDIDATE');
});
test('waitlist opt-out blocks offering to that fictional customer',()=>{
 const f=fixture();
 transition(f,'setConsent','c4','waitlist',false);
 transition(f,'cancelForWaitlist');
 assertCode(transition(f,'prepareWaitlist'),'NO_CANDIDATE');
 assert.equal(f.state.drafts.length,0);
});
test('consented waitlist acceptance recovers a fictional slot once, not actual revenue',()=>{
 const f=fixture();
 transition(f,'cancelForWaitlist');
 transition(f,'prepareWaitlist');
 const id=f.state.drafts[0].id;
 assertCode(transition(f,'acceptInvitation',id),'NOT_DELIVERED');
 transition(f,'approve',id);transition(f,'simulateDelivery',id);
 const r=transition(f,'acceptInvitation',id);
 assert.equal(r.ok,true);
 assert.equal(f.Logic.numbers(f.state).recovered,1);
 assert.equal(f.Logic.numbers(f.state).bookings,1);
 const d=f.state.drafts[0];
 const b=f.state.model.bookings.find(x=>x.id===d.convertedBooking);
 assert.ok(b);
 assert.equal(b.source,'line');
 assert.equal(b.customer,'架空のお客様D');
 assert.equal(f.state.model.bookings.find(x=>x.id===2).status,'CANCELLED');
 assert.equal(f.Logic.numbers(f.state).actualRevenue,null);
 assertCode(transition(f,'acceptInvitation',id),'ALREADY_CONVERTED');
});
test('the already-occupied cancellation slot refuses acceptance without partial updates',()=>{
 const f=fixture();
 transition(f,'cancelForWaitlist');transition(f,'prepareWaitlist');
 const id=f.state.drafts[0].id;
 transition(f,'approve',id);transition(f,'simulateDelivery',id);
 // Another fictional caller books the original resource before acceptance.
 f.Core.book(f.state.model,{menu:'m60',staff:'s2',bed:'b2',start:630,
  customer:'架空の競合予約',source:'website',discovery:'unknown'});
 const old=f.state, beforeCount=old.model.bookings.length;
 const r=transition(f,'acceptInvitation',id);
 assert.equal(r.ok,false);
 assert.equal(f.state,old);
 assert.equal(f.state.model.bookings.length,beforeCount);
 assert.equal(f.Logic.numbers(f.state).recovered,0);
});
test('consented return invitation can become a booking without a false arrival claim',()=>{
 const f=fixture();
 transition(f,'prepare','return','c4');
 const id=f.state.drafts[0].id;
 transition(f,'approve',id);transition(f,'simulateDelivery',id);
 assert.equal(transition(f,'acceptInvitation',id).ok,true);
 const metrics=f.Logic.numbers(f.state);
 assert.equal(metrics.bookings,1);
 assert.equal(metrics.actualVisits,null);
 assert.equal(metrics.actualRevenue,null);
 assertCode(transition(f,'prepare','return','c4'),'DUPLICATE');
});
test('reminder cannot be mislabeled as a newly acquired booking',()=>{
 const f=fixture();
 transition(f,'prepare','reminder','c2');
 const id=f.state.drafts[0].id;
 transition(f,'approve',id);transition(f,'simulateDelivery',id);
 assertCode(transition(f,'acceptInvitation',id),'NO_ACTION');
 assert.equal(f.Logic.numbers(f.state).bookings,0);
});
test('UI can draft, approve and simulate without contacting LINE',()=>{
 const f=uiFixture(),e=f.byId;
 assert.equal(e['panel-home'].hidden,false);
 f.click(e.prepareReturn);
 assert.equal(e['panel-drafts'].hidden,false);
 assert.match(f.content(e.draftList),/来店周期の再予約案内/);
 let b=f.findButton(e.draftList,'店舗オーナーが模擬承認');
 assert.ok(b);f.click(b);
 assert.match(f.content(e.draftList),/店舗承認済み/);
 b=f.findButton(e.draftList,'模擬配信として記録');
 assert.ok(b);f.click(b);
 assert.match(f.content(e.draftList),/模擬配信記録のみ/);
 b=f.findButton(e.draftList,'案内から模擬予約をする');
 assert.ok(b);f.click(b);
 assert.match(f.content(e.metrics),/模擬予約成立 1件/);
 assert.match(f.content(e.bookingList),/架空のお客様D/);
});
test('UI reset clears drafts and restores fictional initial booking counts',()=>{
 const f=uiFixture(),e=f.byId;
 f.click(e.prepareReminder);
 assert.match(f.content(e.draftList),/予約前日の確認/);
 f.click(f.tabs.settings);
 f.click(e.resetDemo);
 assert.equal(e['panel-home'].hidden,false);
 assert.match(f.content(e.draftList),/下書きはまだありません/);
 assert.match(f.content(e.metrics),/模擬予約成立 0件/);
});
