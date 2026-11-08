// Regression for standalone MVP-A (marketing page -> fictional booking -> unified desk).
// All operations are local to a fake DOM and v0.57 DemoCore; no real user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext,Script} from 'node:vm';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const folder=resolve(root,'experiments/marketing-booking-mvp-a');
const html=readFileSync(resolve(folder,'index.html'),'utf8');
const style=readFileSync(resolve(folder,'style.css'),'utf8');
const source=readFileSync(resolve(folder,'app.js'),'utf8');
const bookingCore=readFileSync(resolve(folder,'core-v057.js'),'utf8');
const oldPage=readFileSync(resolve(root,'preview/v0.57-two-person-approval.html'),'utf8');
const oldScripts=[...oldPage.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

function fixture(){
 const byId=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],fake(m[1])]));
 const tabs=Object.fromEntries([...html.matchAll(/data-tab="([^"]+)"/g)].map(m=>{
  const node=fake('tab-'+m[1]);node.dataset.tab=m[1];return [m[1],node];
 }));
 const win={confirm:()=>true},doc={
  getElementById:(id)=>{assert.ok(byId[id],'Expected DOM node #'+id);return byId[id];},
  createElement:(tag)=>fake(tag),
  querySelector:(selector)=>tabs[selector.match(/^\[data-tab="([^"]+)"\]$/)?.[1]]||null,
  querySelectorAll:(selector)=>selector==='[data-tab]'?Object.values(tabs):[]
 };
 runInNewContext(bookingCore,{window:win});
 runInNewContext(source,{window:win,document:doc});
 const click=node=>{
  const event=node.events.click;assert.equal(typeof event,'function');
  return event({preventDefault(){}});
 };
 const change=node=>{
  const event=node.events.change;assert.equal(typeof event,'function');
  return event({preventDefault(){}});
 };
 const submit=node=>{
  const event=node.events.submit;assert.equal(typeof event,'function');
  return event({preventDefault(){}});
 };
 function textTree(node){
  return [node.textContent||'',...node.children.map(textTree)].join(' ');
 }
 return {nodes:byId,tabs,win,click,change,submit,textTree,Core:win.DemoCore};
}
function fake(tag){
 const node={
  tagName:tag,children:[],events:{},attributes:{},dataset:{},
  textContent:'',className:'',hidden:false,disabled:false,_value:'',
  classList:{toggle(name,active){this[name]=active;}},
  replaceChildren(){this.children=[];this._value='';},
  appendChild(child){
   this.children.push(child);
   if(this.children.length===1&&this.tagName==='option-parent')this._value=child.value;
   // Select uses its first option as the default value in browsers.
   if(this.children.length===1&&this.isSelect)this._value=child.value;
  },
  addEventListener(name,handler){this.events[name]=handler;},
  setAttribute(name,value){this.attributes[name]=value;}
 };
 Object.defineProperty(node,'value',{
  get(){return this._value||((this.isSelect&&this.children.length)?this.children[0].value:'');},
  set(v){this._value=String(v);}
 });
 node.isSelect=['guestMenu','guestStaff','guestDiscovery','manualMenu','manualStaff',
  'manualTime','manualSource','manualDiscovery'].includes(tag);
 return node;
}
test('MVP-A keeps the exact v0.57 booking engine and latest formal edition untouched',()=>{
 assert.equal(oldScripts.length,2);
 assert.equal(bookingCore,oldScripts[0]);
 assert.ok(bookingCore.includes('Core')===false||bookingCore.includes('DemoCore'));
 assert.equal(createHash('sha256').update(bookingCore).digest('hex'),
  createHash('sha256').update(oldScripts[0]).digest('hex'));
});
test('all three screens are independent, noindex, offline-only and explicitly fake',()=>{
 for(const id of ['panel-settings','panel-guest','panel-desk'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/noindex,nofollow/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/script-src 'self'/);
 assert.match(html,/実際の予約・決済・通知/);
 assert.match(html,/実在する氏名・電話番号・住所などは入力しないでください/);
 assert.match(html,/core-v057\.js/);
 assert.doesNotMatch(html,/<script>(?!\s*<\/script>)/);
 assert.doesNotMatch(source,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b|\bWebSocket\b/);
 assert.doesNotMatch(source,/\binnerHTML\s*=/);
 assert.match(style,/@media\(max-width:640px\)/);
 new Script(source);
});
test('settings form changes only the generated preview in this fake browser',()=>{
 const f=fixture(),e=f.nodes;
 assert.equal(e.previewName.textContent,'架空・青空リラクゼーション');
 e.storeName.value='架空・小さなエステ店';
 e.storeTagline.value='ゆったり過ごす時間を';
 e.storeArea.value='架空の商店街';
 e.storeIntro.value='架空の施術案内';
 f.submit(e.storeForm);
 assert.equal(e.previewName.textContent,'架空・小さなエステ店');
 assert.equal(e.guestName.textContent,'架空・小さなエステ店');
 assert.equal(e.guestIntro.textContent,'架空の施術案内');
 assert.match(e.notice.textContent,/公開・保存はしていません/);
});
test('customer sees valid slots and selected reservation appears in shared desk with source',()=>{
 const f=fixture(),e=f.nodes;
 f.click(f.tabs.guest);
 assert.equal(e['panel-guest'].hidden,false);
 assert.ok(e.guestTimes.children.length>0);
 assert.equal(e.guestBook.disabled,true);
 e.guestDiscovery.value='google';
 f.click(e.guestTimes.children[0]);
 assert.equal(e.guestBook.disabled,false);
 assert.match(e.guestSummary.textContent,/架空/);
 f.click(e.guestBook);
 assert.equal(e['panel-desk'].hidden,false);
 assert.match(e.notice.textContent,/自店Web予約 #4/);
 assert.match(f.textTree(e.bookingLedger),/予約経路：自店Web/);
 assert.match(f.textTree(e.bookingLedger),/認知経路：Google検索・マップ/);
 assert.match(f.textTree(e.metrics),/自店Web経由 2件/);
});
test('manual phone/instore reservations use the same clock and ledger',()=>{
 const f=fixture(),e=f.nodes;
 f.click(f.tabs.desk);
 assert.ok(e.manualTime.children.length>0);
 e.manualSource.value='instore';
 e.manualDiscovery.value='unknown';
 f.click(e.manualBook);
 assert.match(e.notice.textContent,/模擬/);
 assert.match(f.textTree(e.bookingLedger),/予約経路：店頭/);
 assert.match(f.textTree(e.bookingLedger),/認知経路：不明/);
 assert.match(f.textTree(e.metrics),/模擬の確定予約 4件/);
});
test('cancelling booking releases its slot and does not count as new sales',()=>{
 const f=fixture(),e=f.nodes;
 f.click(f.tabs.guest);
 f.click(e.guestTimes.children[0]);f.click(e.guestBook);
 assert.match(f.textTree(e.bookingLedger),/#4/);
 const row=e.bookingLedger.children.find(row=>f.textTree(row).includes('#4'));
 assert.ok(row);
 const button=row.children.find(x=>x.tagName==='button');
 assert.ok(button);
 f.click(button);
 assert.match(f.textTree(e.bookingLedger),/取消済み/);
 assert.match(f.textTree(e.metrics),/模擬のキャンセル 1件/);
 assert.match(e.notice.textContent,/同じ枠が再び予約可能/);
 assert.match(html,/予約数.*売上・実来店・新規獲得の実績ではありません/);
});
test('v0.57 Core.canBook rejects duplicates including preparation/resource conflicts',()=>{
 const f=fixture(),m=f.Core.initial();
 const req={menu:'m60',staff:'s1',bed:'b1',start:540};
 assert.equal(f.Core.canBook(m,req).ok,true);
 f.Core.book(m,{...req,source:'website',discovery:'unknown',customer:'架空'});
 assert.equal(f.Core.canBook(m,req).ok,false);
 assert.equal(f.Core.canBook(m,{...req,start:585}).ok,false);
 assert.equal(f.Core.canBook(m,{...req,start:615}).ok,false);
});
test('demo resetting restores initial source counts and page content',()=>{
 const f=fixture(),e=f.nodes;
 f.click(f.tabs.desk);f.click(e.manualBook);
 assert.match(f.textTree(e.metrics),/模擬の確定予約 4件/);
 f.click(e.resetDemo);
 assert.match(f.textTree(e.metrics),/模擬の確定予約 3件/);
 assert.equal(e['panel-settings'].hidden,false);
 assert.equal(e.previewName.textContent,'架空・青空リラクゼーション');
});
