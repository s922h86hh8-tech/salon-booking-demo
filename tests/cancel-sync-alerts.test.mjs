// Run from repository root: node --test tests/cancel-sync-alerts.test.mjs
// Cancellation history and simulated integration errors; no customer data or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root,'preview/v0.45-cancel-and-sync-alerts.html'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,2);
const coreWindow={};
runInNewContext(scripts[0],{window:coreWindow});
const Core=coreWindow.DemoCore;
assert.ok(Core);

test('cancel keeps the record but the original time becomes bookable again',()=>{
 const model=Core.initial();
 const existing=model.bookings.find(b=>b.id===1);
 const request={menu:existing.menu,staff:existing.staff,bed:existing.bed,start:existing.start};
 assert.equal(Core.canBook(model,request).ok,false);
 const total=model.bookings.length;
 Core.cancel(model,existing.id);
 assert.equal(model.bookings.length,total);
 assert.equal(model.bookings.find(b=>b.id===existing.id).status,'CANCELLED');
 assert.equal(model.releases.length,1);
 assert.equal(Core.canBook(model,request).ok,true);
 Core.book(model,{...request,customer:'架空・再予約'});
 assert.equal(model.bookings.find(b=>b.id===existing.id).status,'CANCELLED');
 assert.equal(model.bookings.length,total+1);
 assert.equal(Core.quote(model).total,3,'Cancellation and replacement should not double count');
});

test('cancelled bookings render as noninteractive faded history beneath active bookings',()=>{
 const ctrl=scripts[1];
 const a=ctrl.indexOf('function drawCancelledBooking('),b=ctrl.indexOf('function renderStaffSchedule(){',a);
 assert.ok(a>=0&&b>a);
 const cancelledSource=ctrl.slice(a,b);
 const block={
  dataset:{},children:[], appendChild(node){this.children.push(node)}
 };
 const node=(tag,cls='',value='')=>({tag,cls,textContent:value,children:[],appendChild(n){this.children.push(n)}});
 const bkg=runInNewContext(cancelledSource+'\ndrawCancelledBooking;',{
   model:{},
   Core:{serviceFor:()=>60,clock:t=>String(Math.floor(t/60)).padStart(2,'0')+':00'},
   add:(parent,child)=>{parent.appendChild(child);return child;},
   node,
   shortScheduleCourse:()=> 'ほぐし60分',
   shortScheduleCustomer:()=> 'お客様A'
 });
 let params;
 bkg({}, {id:1,start:600,customer:'架空のお客様A'}, {name:'もみほぐし60分'}, (...args)=>{params=args;return block});
 assert.equal(params[1],'schedule-cancelled');
 assert.equal(block.dataset.bookingId,'1');
 assert.equal(block.children[0].textContent,'10:00〜11:00');
 assert.equal(block.children[1].children[0].textContent,'ほぐし60分');
 assert.equal(block.children[2].textContent,'取消');
 const style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
 assert.match(style,/\.schedule-cancelled\{[^}]*pointer-events:none/);
 assert.match(style,/\.schedule-cancelled\{[^}]*z-index:1/);
 assert.match(style,/\.schedule-book\.resizable\{[^}]*z-index:3/);
 assert.ok(ctrl.indexOf("filter(b=>b.status==='CANCELLED'&&b.staff===s.id)") <
   ctrl.indexOf("filter(b=>b.status==='CONFIRMED'&&b.staff===s.id)"),'History must paint first');
});

function mockNode(tag='div',cls='',value=''){
 return {tag,cls,textContent:value,children:[],attrs:{},listeners:{},
  value:'',classList:{flags:{},toggle(k,b){this.flags[k]=b}},
  appendChild(child){this.children.push(child)},
  replaceChildren(){this.children=[]},
  setAttribute(k,v){this.attrs[k]=v},
  addEventListener(k,fn){this.listeners[k]=fn}
 };
}
function simulation(){
 const ctrl=scripts[1],a=ctrl.indexOf('const DEMO_CONNECTIONS={'),b=ctrl.indexOf('function setMode(next){',a);
 assert.ok(a>=0&&b>a,'Integration display functions missing');
 const elements={
  connectList:mockNode('div'),
  integrationAlert:mockNode('div'),
  integrationAlertTitle:mockNode('strong'),
  integrationAlertText:mockNode('p')
 };
 const sandbox={
  $:id=>{assert.ok(elements[id],id);return elements[id]},
  node:mockNode,
  add:(parent,child)=>{parent.appendChild(child);return child}
 };
 const api=runInNewContext("const demoConnectionFailures={line:null,google:null};let page='connect';"+
  ctrl.slice(a,b)+
  '\n({renderConnect,renderIntegrationAlert,setDemoConnectionFailure,failures:demoConnectionFailures})',sandbox);
 return {api,elements};
}
test('real integration is never claimed; the default state is not connected',()=>{
 const {api,elements}=simulation();
 api.renderConnect();
 assert.equal(elements.connectList.children.length,2);
 const statuses=elements.connectList.children.map(c=>c.children[0].children[1].textContent);
 assert.deepEqual([...statuses],['未接続','未接続']);
 api.renderIntegrationAlert();
 assert.equal(elements.integrationAlert.classList.flags.hidden,true);
});

test('mock failures identify the service, cause and next step; clearing is not a success',()=>{
 const {api,elements}=simulation();
 for (const kind of ['auth','network','sync']) {
  api.setDemoConnectionFailure('line',kind);
  assert.equal(elements.integrationAlert.classList.flags.hidden,false);
  assert.match(elements.integrationAlertText.textContent,/LINE公式アカウント/);
  const first=elements.connectList.children[0];
  const error=first.children.find(n=>n.cls==='demo-connection-error');
  assert.ok(error);
  assert.match(error.children[1].textContent,/確認すること：/);
  assert.match(error.children[2].textContent,/実際の通信失敗ではありません/);
 }
 api.setDemoConnectionFailure('google','network');
 assert.match(elements.integrationAlertTitle.textContent,/2件/);
 api.setDemoConnectionFailure('line',null);
 assert.match(elements.integrationAlertText.textContent,/Google/);
 api.setDemoConnectionFailure('google',null);
 assert.equal(elements.integrationAlert.classList.flags.hidden,true);
 const states=elements.connectList.children.map(c=>c.children[0].children[1].textContent);
 assert.deepEqual([...states],['未接続','未接続'],'Clearing mock errors must not imply connected');
});
test('the public demo never sends data or makes real API requests',()=>{
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/架空データ専用/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
