// Run: node --test tests/cancel-history-operation-ledger.test.mjs
// Public fictional demo only; verifies cancellations and timestamped history without persistence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.49-cancel-and-operation-history.html'),'utf8');
const scripts=Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g),m=>m[1]);
assert.equal(scripts.length,2);
const rootObject={};
runInNewContext(scripts[0],{window:rootObject});
const Core=rootObject.DemoCore;
const body=readFileSync(resolve(root,'preview/modules/v0.49-history-body.js'),'utf8');
assert.ok(scripts[1].includes(body),'History controller must be included in v0.49');

function el(tag='div',cls='',text=''){
 return {tag,cls,textContent:text,children:[],value:'',
  appendChild(child){this.children.push(child)},
  replaceChildren(){this.children=[]}
 };
}
function setup(){
 const model=Core.initial();
 const dayContexts=new Map();
 const ui=Object.fromEntries(['cancellationHistoryList','cancellationHistoryCount',
  'operationHistoryList','operationHistoryCount','operationHistoryFilter'].map(id=>[id,el()]));
 ui.operationHistoryFilter.value='all';
 const sandbox={Core,model,demoDayContexts:dayContexts,selectedDemoDay:'2026-10-26',
  $:id=>{assert.ok(ui[id]);return ui[id]},
  node:el,add:(parent,child)=>{parent.appendChild(child);return child;}};
 const api=runInNewContext(body+'\n({canceledVisibleOnCalendar,allCancellationRecords,renderCancellationHistory,recordOperation,syncModelOperationEvents,renderOperationHistory,clearOperationHistoryForReset,log:()=>operationLog});',sandbox);
 return {model,ui,api,dayContexts};
}
test('cancel remains faint until another confirmed booking overlaps the staff/time slot',()=>{
 const {model,api,ui}=setup();
 const prior=model.bookings[0];
 Core.cancel(model,prior.id);
 prior.cancelledAt=new Date('2026-11-01T09:30:00+09:00').toISOString();
 assert.equal(api.canceledVisibleOnCalendar(prior),true);
 api.renderCancellationHistory();
 assert.equal(ui.cancellationHistoryCount.textContent,'1');
 const req={menu:prior.menu,staff:prior.staff,bed:prior.bed,start:prior.start,customer:'架空の新予約',source:'phone'};
 assert.equal(Core.canBook(model,req).ok,true);
 Core.book(model,req);
 assert.equal(api.canceledVisibleOnCalendar(prior),false);
 api.renderCancellationHistory();
 assert.equal(ui.cancellationHistoryCount.textContent,'1');
 assert.equal(api.allCancellationRecords()[0].replacement,true);
 assert.match(ui.cancellationHistoryList.children[0].children[0].children[1].textContent,/予約表では非表示/);
});
test('cancellation remains faint if a new appointment is on a different staff or nonoverlapping time',()=>{
 const {model,api}=setup();
 const first=model.bookings[0];
 Core.cancel(model,first.id);
 assert.equal(api.canceledVisibleOnCalendar(first),true);
 // An unrelated confirmed appointment must not hide a different time/staff cancellation.
 assert.equal(api.canceledVisibleOnCalendar(first),true);
});
test('core actions and checkout examples appear with operation time, date and category',()=>{
 const {model,api,ui}=setup();
 const first=model.bookings[0];
 Core.cancel(model,first.id);
 api.syncModelOperationEvents();
 const request={menu:first.menu,staff:first.staff,bed:first.bed,start:first.start,customer:'架空の再予約',source:'phone'};
 Core.book(model,request);
 api.syncModelOperationEvents();
 api.recordOperation('会計','架空の会計 5,000円','2026-10-26');
 api.renderOperationHistory();
 const logs=Array.from(api.log());
 assert.equal(logs.length,3);
 assert.equal(logs[0].category,'予約取消');
 assert.equal(logs[1].category,'予約登録');
 assert.equal(logs[2].category,'会計');
 assert.ok(logs.every(x=>x.stamp&&!Number.isNaN(Date.parse(x.stamp))&&x.day&&x.when&&x.who));
 ui.operationHistoryFilter.value='会計';
 api.renderOperationHistory();
 assert.equal(ui.operationHistoryList.children.length,1);
 assert.match(ui.operationHistoryList.children[0].children[1].textContent,/5,000/);
 api.clearOperationHistoryForReset();
 assert.equal(api.log().length,0);
});
test('the UI exposes both independent history pages without persistence or APIs',()=>{
 for(const name of ['cancellations','activity']){
  assert.match(html,new RegExp('data-page="'+name+'"'));
  assert.match(html,new RegExp('id="page-'+name+'"'));
 }
 assert.match(html,/id="operationHistoryFilter"/);
 assert.match(html,/id="cancellationHistoryList"/);
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
