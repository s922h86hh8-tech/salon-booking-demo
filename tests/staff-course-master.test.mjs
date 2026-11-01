// node --test tests/staff-course-master.test.mjs
// Fictional staff/menu shared master and contract-rate preview. No real payroll.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.50-staff-course-contractor.html'),'utf8');
const moduleCode=readFileSync(resolve(root,'preview/modules/v0.50-staff-course-master.js'),'utf8');
assert.ok(html.includes(moduleCode),'Store-wide model must be embedded in the demo');
const scripts=Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g),m=>m[1]);
const window={};
runInNewContext(scripts[0],{window});
const Core=window.DemoCore;

function node(tag='div',cls='',txt=''){
 return {tag,cls,textContent:txt,value:'',checked:false,children:[],
  appendChild(x){this.children.push(x)},replaceChildren(){this.children=[]},
  querySelectorAll(){return this.children.filter(x=>x.children[0]?.tag==='input'&&x.children[0].checked).map(x=>x.children[0])}};
}
const IDS=['masterMenuName','masterMenuMinutes','masterMenuPrice','masterMenuPrivate','masterStaffName','masterStaffPrep',
'masterStaffKind','masterStaffBasis','masterStaffRate','masterStaffEffective','masterMenuList','masterStaffList',
'masterSkillsStaff','masterContractStaff','masterSkillsList','masterContractKind','masterContractBasis',
'masterContractRate','masterContractEffective','masterContractVersion','masterPreviewGross','masterPreviewDiscount',
'masterRateResult','bMenu','bStaff','cMenu','cStaff','checkoutCashier','regStaff'];
function fixture(){
 const model=Core.initial(),next=Core.initial();
 next.bookings=[];
 const contexts=new Map([['2026-10-27',{model:next}]]);
 const fields=Object.fromEntries(IDS.map(id=>[id,node()]));
 Object.entries({masterMenuName:'ほぐし75分',masterMenuMinutes:'75',masterMenuPrice:'6500',
  masterStaffName:'架空のセラピストC',masterStaffPrep:'15',masterStaffKind:'contract-store',
  masterStaffBasis:'net',masterStaffRate:'60',masterStaffEffective:'2026-10-26',
  masterPreviewGross:'5000',masterPreviewDiscount:'1000'}).forEach(([id,value])=>fields[id].value=value);
 const log=[];
 const api=runInNewContext(moduleCode+
 '\n({addDemoMenu,addDemoStaff,renderDemoMaster,renderDemoSkills,saveDemoSkills,renderDemoRatePreview,saveDemoContract,applyDemoMaster,syncDemoMasterSelectors,get:()=>demoMaster});',{
  Core,model,demoDayContexts:contexts,
  validDemoDay:day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&!Number.isNaN(Date.parse(day+'T00:00:00Z')),
  $:id=>{assert.ok(fields[id],'Missing UI mock '+id);return fields[id]},
  node,add:(p,c)=>{p.appendChild(c);return c},
  recordOperation:(kind,message)=>log.push({kind,message}),
  info:()=>{}
 });
 return {api,fields,model,next,log};
}
test('course registration is store-wide; no staff becomes eligible automatically',()=>{
 const {api,model,next}=fixture();
 const id=api.addDemoMenu();
 assert.equal(model.menus.length,3);
 assert.equal(next.menus.length,3);
 assert.equal(model.menus.find(x=>x.id===id).duration,75);
 assert.equal(model.staff.every(st=>!st.menus.includes(id)),true);
 assert.equal(Core.canBook(model,{menu:id,staff:'s1',bed:'b1',start:960}).ok,false);
});
test('a new contractor requires explicit skill approval before booking',()=>{
 const {api,fields,model,next}=fixture();
 const menu=api.addDemoMenu();
 const staff=api.addDemoStaff();
 assert.equal(model.staff.length,3);
 assert.equal(next.staff.length,3);
 assert.equal(api.get().contractRules[staff].rate,60);
 assert.equal(Core.canBook(model,{menu,staff,bed:'b1',start:960}).ok,false);
 fields.masterSkillsStaff.value=staff;
 api.renderDemoSkills();
 const wanted=fields.masterSkillsList.children.find(x=>x.children[0]?.value===menu);
 assert.ok(wanted);
 wanted.children[0].checked=true;
 api.saveDemoSkills();
 assert.equal(Core.canBook(model,{menu,staff,bed:'b1',start:960}).ok,true);
 assert.equal(next.staff.find(x=>x.id===staff).menus.includes(menu),true);
});
test('removing a booked skill or duplicating a menu is blocked',()=>{
 const {api,fields,model}=fixture();
 fields.masterMenuName.value='もみほぐし60分';
 assert.throws(()=>api.addDemoMenu(),/同じ名前/);
 fields.masterSkillsStaff.value='s1';
 api.renderDemoSkills();
 for(const item of fields.masterSkillsList.children)item.children[0].checked=false;
 assert.throws(()=>api.saveDemoSkills(),/予約済み/);
 assert.equal(model.staff.find(x=>x.id==='s1').menus.includes('m60'),true);
});
test('60% on net 4,000 yen previews 2,400 yen, not final pay',()=>{
 const {api,fields}=fixture();
 const staff=api.addDemoStaff();
 fields.masterContractStaff.value=staff;
 api.renderDemoRatePreview();
 assert.match(fields.masterRateResult.textContent,/2,400円/);
 assert.match(fields.masterRateResult.textContent,/試算/);
 fields.masterContractRate.value='150';
 assert.throws(()=>api.saveDemoContract(),/0〜100/);
});
test('original booking engine, public demo and no network access remain unchanged',()=>{
 assert.equal(scripts.length,2);
 assert.match(html,/id="page-master"/);
 assert.match(html,/data-page="master"/);
 assert.match(html,/架空データ専用/);
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
