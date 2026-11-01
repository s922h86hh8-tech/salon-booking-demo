// Run: node --test tests/contractor-rule-versions.test.mjs
// Contractor rate calculation and quote snapshots are fictional, not wages or payouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'preview/v0.51-contract-rule-versions.html'),'utf8');
const master=readFileSync(resolve(root,'preview/modules/v0.50-staff-course-master.js'),'utf8');
const moduleCode=readFileSync(resolve(root,'preview/modules/v0.51-contractor-versioned-rate.js'),'utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(js.length,2);
assert.ok(js[1].includes(moduleCode));
const window={};runInNewContext(js[0],{window});
const Core=window.DemoCore;
const names=['masterMenuName','masterMenuMinutes','masterMenuPrice','masterMenuPrivate','masterStaffName',
 'masterStaffPrep','masterStaffKind','masterStaffBasis','masterStaffRate','masterStaffEffective','masterMenuList',
 'masterStaffList','masterSkillsStaff','masterContractStaff','masterSkillsList','masterContractKind',
 'masterContractBasis','masterContractRate','masterContractEffective','masterContractVersion',
 'masterPreviewGross','masterPreviewDiscount','masterRateResult','bMenu','bStaff','cMenu','cStaff',
 'checkoutCashier','regStaff','v51ServiceDate','v51RoundRule','v51RateResult','v51RuleList','v51QuoteList'];
function element(tag='div',cls='',text=''){
 return {tag,cls,textContent:text,value:'',checked:false,children:[],
  appendChild(child){this.children.push(child)},replaceChildren(){this.children=[]},
  querySelectorAll(){return this.children.filter(x=>x.children[0]?.checked).map(x=>x.children[0])}};
}
function fixture(){
 const ui=Object.fromEntries(names.map(k=>[k,element()]));
 for(const [k,v] of Object.entries({masterContractKind:'contract-store',masterContractStaff:'s1',
  masterContractBasis:'net',masterContractRate:'60',masterContractEffective:'2026-10-26',
  masterPreviewGross:'5000',masterPreviewDiscount:'1000',
  v51ServiceDate:'2026-10-26',v51RoundRule:'floor'}))ui[k].value=v;
 const events=[],model=Core.initial(),other=Core.initial(),contexts=new Map([['2026-10-27',{model:other}]]);
 const insert=master.indexOf('function masterContexts(){');
 assert.ok(insert>0);
 const source=master.slice(0,insert)+'\n'+moduleCode+'\n'+master.slice(insert)+
 '\n({save:v51SaveContract,quote:v51SaveQuote,render:v51Render,calculate:v51Calculate,select:v51RuleForDate,'+
 'ruleMap:()=>v51RuleHistory,quotes:()=>v51PreviewSnapshots,addStaff:v51AddStaff});';
 const api=runInNewContext(source,{Core,model,demoDayContexts:contexts,
  validDemoDay:s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z')),
  $:id=>{assert.ok(ui[id],id);return ui[id]},node:element,
  add:(p,c)=>{p.appendChild(c);return c},
  recordOperation:(kind,detail)=>events.push({kind,detail}),info:()=>{}});
 return {api,ui,events};
}
test('a discounted 5,000 yen service generates a 2,400 yen rate preview at 60%',()=>{
 const {api,ui}=fixture();
 api.save();api.render();
 assert.match(ui.v51RateResult.textContent,/2,400円/);
 assert.match(ui.v51RateResult.textContent,/契約版 2/);
});
test('a revision never changes the stored quote or earlier day, even if the new rate rises',()=>{
 const {api,ui}=fixture();
 api.save();
 const original=api.quote();
 ui.masterContractRate.value='80';
 ui.masterContractEffective.value='2026-10-27';
 ui.v51RoundRule.value='half-up';
 api.save();
 ui.v51ServiceDate.value='2026-10-26';api.render();
 assert.match(ui.v51RateResult.textContent,/2,400円/);
 ui.v51ServiceDate.value='2026-10-27';api.render();
 assert.match(ui.v51RateResult.textContent,/3,200円/);
 assert.equal(original.amount,2400);
 assert.equal(original.contract.rate,60);
 assert.equal(original.contract.version,2);
 assert.equal(api.ruleMap().s1.length,3);
 assert.equal(Object.isFrozen(original),true);
 assert.equal(Object.isFrozen(original.contract),true);
 ui.masterContractRate.value='90';
 ui.masterContractEffective.value='2026-10-26';
 assert.throws(()=>api.save(),/前版より後/);
});
test('rounding is explicit and invalid or noncontractor rules cannot be valued',()=>{
 const {api}=fixture();
 const version={kind:'contract-store',basis:'net',rate:33.33,rounding:'floor',effective:'2026-10-26',version:3};
 assert.equal(api.calculate(version,100,0).amount,33);
 assert.equal(api.calculate({...version,rounding:'half-up'},100,0).amount,33);
 assert.equal(api.calculate({...version,rounding:'ceil'},100,0).amount,34);
 assert.equal(api.calculate({...version,rate:33.5,rounding:'half-up'},10,0).amount,3);
 assert.throws(()=>api.calculate({...version,kind:'employment'},100,0),/契約版/);
 assert.throws(()=>api.calculate({...version,rate:150},100,0),/歩合/);
 assert.throws(()=>api.calculate(version,500,600),/売上・割引/);
});
test('v0.51 remains an unconnected demo and keeps its previous booking engine',()=>{
 assert.match(html,/契約の版履歴/);
 assert.match(html,/試算の控えを残す/);
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
});
