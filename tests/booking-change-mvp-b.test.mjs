// MVP-B mobile booking-change proof. Test only fictional, in-memory operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext,Script} from 'node:vm';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=resolve(root,'experiments/booking-change-mvp-b');
const html=readFileSync(resolve(dir,'index.html'),'utf8');
const style=readFileSync(resolve(dir,'style.css'),'utf8');
const source=readFileSync(resolve(dir,'app.js'),'utf8');
const engine=readFileSync(resolve(dir,'change-engine.js'),'utf8');
const core=readFileSync(resolve(dir,'core-v057.js'),'utf8');
const oldCore=readFileSync(resolve(root,'experiments/marketing-booking-mvp-a/core-v057.js'),'utf8');
function startModels(Core){
 const first=Core.initial();
 const id=Core.book(first,{
  menu:'m60',staff:'s2',bed:'b3',start:540,
  source:'website',discovery:'google',customer:'架空・テスト'
 });
 const second=Core.initial();second.bookings=[];second.nextBooking=100;
 return {models:{'2026-10-26':first,'2026-10-27':second},
  ref:{day:'2026-10-26',id},history:[]};
}
function vmEngine(){
 const fakeWindow={};
 runInNewContext(core,{window:fakeWindow});
 runInNewContext(engine,{window:fakeWindow});
 return {Core:fakeWindow.DemoCore,Change:fakeWindow.BookingChangeDemo};
}
function moveParams(Core,models,ref,target,history=[]){
 const {Change}=vmEngine();
 return Change.move({Core,models,ref,target,history});
}
function target(overrides={}){
 return {day:'2026-10-26',menu:'m60',staff:'s2',bed:'b3',start:900,...overrides};
}
function fakeNode(tag){
 const node={
  tagName:tag,children:[],events:{},dataset:{},attributes:{},
  textContent:'',className:'',disabled:false,hidden:false,_value:'',
  classList:{toggle(name,value){this[name]=value;}},
  replaceChildren(){this.children=[];this._value='';},
  appendChild(child){this.children.push(child);
   if(this.isSelect&&this.children.length===1)this._value=String(child.value);
  },
  addEventListener(name,handler){this.events[name]=handler;},
  setAttribute(name,value){this.attributes[name]=value;}
 };
 Object.defineProperty(node,'value',{
  get(){return this._value||(this.isSelect&&this.children.length?this.children[0].value:'');},
  set(value){this._value=String(value);}
 });
 return node;
}
function fakeDocument(){
 const byId=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>{
  const n=fakeNode(m[1]);
  n.isSelect=['changeDay','changeMenu','changeStaff'].includes(m[1]);
  return [m[1],n];
 }));
 byId.changeDay.value='2026-10-26'; // Browser default first <option>.
 const tabs=Object.fromEntries([...html.matchAll(/data-tab="([^"]+)"/g)].map(m=>{
  const n=fakeNode('tab-'+m[1]);n.dataset.tab=m[1];return [m[1],n];
 }));
 return {byId,tabs,document:{
  createElement:tag=>fakeNode(tag),
  getElementById:id=>{assert.ok(byId[id],id+' should exist');return byId[id];},
  querySelector:sel=>tabs[sel.match(/^\[data-tab="([^"]+)"\]$/)?.[1]]||null,
  querySelectorAll:sel=>sel==='[data-tab]'?Object.values(tabs):[]
 }};
}
function uiFixture(){
 const f=fakeDocument(),win={confirm:()=>true};
 runInNewContext(core,{window:win});
 runInNewContext(engine,{window:win});
 runInNewContext(source,{window:win,document:f.document});
 const click=el=>{
  assert.equal(typeof el.events.click,'function');
  return el.events.click({preventDefault(){}});
 };
 const change=el=>{
  assert.equal(typeof el.events.change,'function');
  return el.events.change({preventDefault(){}});
 };
 const allText=node=>[node.textContent||'',...node.children.map(allText)].join(' ');
 return {...f,click,change,allText,win};
}

test('MVP-B retains exactly the same v0.57 booking engine as MVP-A',()=>{
 assert.equal(core,oldCore);
 assert.equal(createHash('sha256').update(core).digest('hex'),
  createHash('sha256').update(oldCore).digest('hex'));
});
test('MVP-B is noindex, offline-only, mobile responsive, and disclaims real bookings',()=>{
 for(const name of ['panel-customer','panel-desk','chooseStage',
  'reviewStage','resultStage','currentBooking','beforeDetails','afterDetails'])
  assert.match(html,new RegExp('id="'+name+'"'));
 assert.match(html,/noindex,nofollow/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/script-src 'self'/);
 assert.match(html,/実情報は入力しないでください/);
 assert.match(html,/外部送信・通知・決済・データ保存はありません/);
 assert.match(style,/@media\(max-width:560px\)/);
 assert.match(style,/min-height:44px/);
 assert.doesNotMatch(source,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bWebSocket\b|\bindexedDB\b/);
 assert.doesNotMatch(source,/\binnerHTML\s*=/);
 new Script(source);new Script(engine);
});
test('change options derive from original Core.canBook with only original ID excluded',()=>{
 const {Core,Change}=vmEngine(),{models,ref}=startModels(Core);
 const options=Change.options({Core,models,ref,day:'2026-10-26',menu:'m60',staff:'s2'});
 assert.ok(options.length>0);
 assert.ok(options.every(x=>x.day==='2026-10-26'&&x.menu==='m60'&&x.staff==='s2'));
 assert.ok(options.every(x=>x.start!==540)); // Avoid invisible bed-only change.
 assert.ok(options.some(x=>x.start===900));
});
test('atomic same-day booking change preserves old data and acquires new slot',()=>{
 const {Core,Change}=vmEngine(),state=startModels(Core);
 const desired=target();
 const result=Change.move({Core,...state,target:desired});
 assert.equal(result.ok,true);
 assert.notEqual(result.ref.id,state.ref.id);
 assert.notEqual(result.models,state.models);
 assert.equal(state.models[state.ref.day].bookings.find(x=>x.id===state.ref.id).status,'CONFIRMED');
 const old=result.models[state.ref.day].bookings.find(x=>x.id===state.ref.id);
 const next=result.models[result.ref.day].bookings.find(x=>x.id===result.ref.id);
 assert.equal(old.status,'CANCELLED');
 assert.equal(old.cancellationReason,'MOVE');
 assert.equal(old.movedTo.id,next.id);
 assert.equal(next.status,'CONFIRMED');
 assert.equal(next.customer,old.customer);
 assert.equal(next.source,'website');
 assert.equal(next.discovery,'google');
 assert.equal(result.history.length,1);
});
test('cross-day in-memory change creates a link while preserving both day records',()=>{
 const {Core,Change}=vmEngine(),state=startModels(Core);
 const result=Change.move({Core,...state,target:target({
  day:'2026-10-27',start:540
 })});
 assert.equal(result.ok,true);
 assert.equal(result.ref.day,'2026-10-27');
 assert.equal(result.models['2026-10-26'].bookings.filter(x=>x.status==='CONFIRMED').length,
  state.models['2026-10-26'].bookings.filter(x=>x.status==='CONFIRMED').length-1);
 assert.equal(result.models['2026-10-27'].bookings.filter(x=>x.status==='CONFIRMED').length,1);
 assert.equal(result.history[0].from.day,'2026-10-26');
 assert.equal(result.history[0].to.day,'2026-10-27');
});
test('occupied requested slot does not cancel or overwrite the old booking',()=>{
 const {Core,Change}=vmEngine(),state=startModels(Core);
 Core.book(state.models['2026-10-26'],{
  menu:'m60',staff:'s2',bed:'b3',start:900,
  customer:'架空・競合',source:'website',discovery:'unknown'
 });
 const count=state.models['2026-10-26'].bookings.length;
 const result=Change.move({Core,...state,target:target()});
 assert.equal(result.ok,false);
 assert.equal(result.code,'SLOT_UNAVAILABLE');
 assert.equal(result.models,state.models);
 assert.equal(result.history.length,0);
 assert.equal(state.models['2026-10-26'].bookings.length,count);
 assert.equal(state.models['2026-10-26'].bookings.find(x=>x.id===state.ref.id).status,'CONFIRMED');
});
test('unchanged or missing target date fails without any booking mutation',()=>{
 const {Core,Change}=vmEngine(),state=startModels(Core);
 for(const targetCandidate of [
  target({start:540}),target({day:'2026-10-28'}),target({day:'invalid'})
 ]){
  const r=Change.move({Core,...state,target:targetCandidate});
  assert.equal(r.ok,false);
  assert.equal(r.models,state.models);
 }
 assert.equal(state.models['2026-10-26'].bookings.find(x=>x.id===state.ref.id).status,'CONFIRMED');
});
test('unexpected failure inside Core.book rolls back staged copies',()=>{
 const {Core,Change}=vmEngine(),state=startModels(Core);
 const failingCore={...Core,book(){throw Error('simulated insertion failure')}};
 const r=Change.move({Core:failingCore,...state,target:target()});
 assert.equal(r.ok,false);
 assert.equal(r.models,state.models);
 assert.equal(state.models['2026-10-26'].bookings.find(x=>x.id===state.ref.id).status,'CONFIRMED');
});
test('multiple moves form an immutable chain of source and destination links',()=>{
 const {Core,Change}=vmEngine(),state=startModels(Core);
 const one=Change.move({Core,...state,target:target()});
 const two=Change.move({Core,models:one.models,ref:one.ref,history:one.history,
  target:target({day:'2026-10-27',start:540})});
 assert.equal(two.ok,true);
 assert.equal(two.history.length,2);
 assert.equal(two.history[0].to.id,two.history[1].from.id);
 assert.equal(two.models['2026-10-26'].bookings.find(x=>x.id===one.ref.id).status,'CANCELLED');
 assert.equal(two.models['2026-10-27'].bookings.find(x=>x.id===two.ref.id).status,'CONFIRMED');
});
test('UI starts with a clearly visible fictional confirmed booking and no pending change',()=>{
 const f=uiFixture(),e=f.byId;
 assert.match(f.allText(e.currentBooking),/2026年10月26日/);
 assert.match(f.allText(e.currentBooking),/09:00/);
 assert.equal(e.panelCustomer?.hidden,undefined);
 assert.equal(e['panel-desk'].hidden,true);
 assert.equal(e['reviewStage'].hidden,true);
 assert.equal(e['resultStage'].hidden,true);
 assert.equal(e.goReview.disabled,true);
 assert.ok(e.changeTimes.children.length>0);
});
test('UI selection leads to before/after comparison; back retains original',()=>{
 const f=uiFixture(),e=f.byId;
 f.click(e.changeTimes.children[0]);
 assert.equal(e.goReview.disabled,false);
 f.click(e.goReview);
 assert.equal(e.reviewStage.hidden,false);
 assert.match(f.allText(e.beforeDetails),/09:00/);
 assert.match(f.allText(e.afterDetails),/変更後|2026年10月26日/);
 f.click(e.backToChoose);
 assert.equal(e.chooseStage.hidden,false);
 assert.match(f.allText(e.currentBooking),/09:00/);
});
test('UI successful move updates customer confirmation and store history',()=>{
 const f=uiFixture(),e=f.byId;
 e.changeDay.value='2026-10-27';f.change(e.changeDay);
 f.click(e.changeTimes.children[0]);
 f.click(e.goReview);
 f.click(e.confirmMove);
 assert.equal(e.resultStage.hidden,false);
 assert.match(e.resultTitle.textContent,/予約を変更しました/);
 assert.match(f.allText(e.currentBooking),/2026年10月27日/);
 assert.match(f.allText(e.history),/2026年10月26日.*2026年10月27日/);
 assert.match(f.allText(e.bookingList),/移動先/);
});
test('UI simulated conflict presents failure while original remains confirmed',()=>{
 const f=uiFixture(),e=f.byId;
 f.click(e.changeTimes.children[0]);
 f.click(e.goReview);
 f.click(e.simulateConflict);
 assert.match(e.notice.textContent,/別のお客様の架空予約/);
 f.click(e.confirmMove);
 assert.match(e.resultTitle.textContent,/変更できませんでした/);
 assert.match(e.resultMessage.textContent,/元の予約/);
 assert.match(f.allText(e.currentBooking),/09:00/);
 assert.match(f.allText(e.history),/まだありません/);
});
test('UI reset returns to original mock state without network or persistent storage',()=>{
 const f=uiFixture(),e=f.byId;
 e.changeDay.value='2026-10-27';f.change(e.changeDay);
 f.click(e.changeTimes.children[0]);f.click(e.goReview);f.click(e.confirmMove);
 f.click(f.tabs.desk);
 f.click(e.resetDemo);
 assert.match(f.allText(e.currentBooking),/2026年10月26日/);
 assert.match(f.allText(e.history),/まだありません/);
 assert.equal(e.chooseStage.hidden,false);
 assert.equal(e['panel-desk'].hidden,true);
});
