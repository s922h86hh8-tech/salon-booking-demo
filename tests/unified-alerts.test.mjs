// Run from repository root: node --test tests/unified-alerts.test.mjs
// UI-only fictitious sources. No connection, network or payment processing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.46-unified-alerts.html'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,2);
const ctrl=scripts[1],begin=ctrl.indexOf('const DEMO_TARGETS={'),end=ctrl.indexOf('function setMode(next){',begin);
assert.ok(begin>=0&&end>begin);
const fragment=ctrl.slice(begin,end);

function element(tag='div',cls='',text=''){
 return {
  tag,cls,textContent:text,value:'',children:[],attrs:{},listeners:{},
  classList:{flags:{},toggle(key,value){this.flags[key]=value;}},
  appendChild(child){this.children.push(child);},
  replaceChildren(){this.children=[];},
  setAttribute(key,value){this.attrs[key]=value;},
  addEventListener(key,fn){this.listeners[key]=fn;}
 };
}
function fixture(){
 const fields=Object.fromEntries(
  ['integrationAlert','integrationAlertTitle','integrationAlertText',
   'noticeOpenCount','connectList','noticeHistory'].map(id=>[id,element()])
 );
 const sandbox={
  $:id=>{assert.ok(fields[id],'Missing UI field '+id);return fields[id]},
  node:element,
  add:(parent,child)=>{parent.appendChild(child);return child}
 };
 const source='const demoAlertActive={};const demoAlertHistory=[];let demoAlertNext=1;let page="connect";\n'+fragment+
  '\n({DEMO_TARGETS,activeDemoAlerts,showDemoAlert,dismissDemoAlert,renderConnect,renderIntegrationAlert,getHistory:()=>demoAlertHistory});';
 const api=runInNewContext(source,sandbox);
 return {fields,api};
}
test('nine illustrative sources share two groups and are not connected by default',()=>{
 const {api,fields}=fixture();
 api.renderConnect();api.renderIntegrationAlert();
 assert.equal(Object.keys(api.DEMO_TARGETS).length,9);
 assert.equal(fields.connectList.children.length,2);
 const cards=fields.connectList.children.flatMap(group=>group.children.filter(x=>x.tag==='section'));
 assert.equal(cards.length,9);
 assert.equal(fields.noticeOpenCount.textContent,'0');
 assert.equal(fields.integrationAlert.classList.flags.hidden,true);
 assert.equal(cards[0].children[0].children[1].textContent,'未接続');
});
test('external and internal examples have one count, next action and history',()=>{
 const {api,fields}=fixture();
 api.renderConnect();
 assert.equal(api.showDemoAlert('line','auth'),true);
 assert.equal(api.showDemoAlert('payment','result'),true);
 assert.equal(api.showDemoAlert('register','difference'),true);
 assert.equal(fields.noticeOpenCount.textContent,'3');
 assert.equal(fields.integrationAlert.classList.flags.hidden,false);
 assert.match(fields.integrationAlertText.textContent,/LINE/);
 assert.match(fields.integrationAlertText.textContent,/決済/);
 assert.match(fields.integrationAlertText.textContent,/ほか1件/);
 assert.equal(fields.noticeHistory.children.length,3);
 assert.equal(api.showDemoAlert('payment','auth'),false);
});
test('closing the example does not claim reconnection or resolution',()=>{
 const {api,fields}=fixture();
 api.showDemoAlert('payment','result');
 assert.equal(api.dismissDemoAlert('payment'),true);
 assert.equal(fields.noticeOpenCount.textContent,'0');
 assert.equal(fields.integrationAlert.classList.flags.hidden,true);
 const history=Array.from(api.getHistory());
 assert.equal(history.length,2);
 assert.match(history[1].action,/未解決/);
 const external=fields.connectList.children[0];
 const payment=external.children.find(card=>card.tag==='section'&&card.children[0].children[0].textContent==='決済サービス');
 assert.ok(payment);
 assert.equal(payment.children[0].children[1].textContent,'未接続');
});
test('this public demo never sends private information or processes payments',()=>{
 assert.match(html,/架空データ専用/);
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
