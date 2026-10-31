// v0.47: in-memory date navigation for the fictional appointment schedule.
// Uses the demo's original 2026-10-26 data for the baseline. Other dates start empty.
// State is isolated by selected date, including fictional receipts and cash register.
const DEMO_BASE_DAY=Core.DATE;
const DEMO_MIN_DAY='2000-01-01';
const DEMO_MAX_DAY='2100-12-31';
let selectedDemoDay=DEMO_BASE_DAY;
const demoDayContexts=new Map();

function validDemoDay(key){
 if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key))return false;
 if(key<DEMO_MIN_DAY||key>DEMO_MAX_DAY)return false;
 const d=new Date(key+'T00:00:00.000Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===key;
}
function advanceDemoDay(key,days){
 if(!validDemoDay(key)||!Number.isInteger(days)||Math.abs(days)>366)return null;
 const date=new Date(key+'T00:00:00.000Z');
 date.setUTCDate(date.getUTCDate()+days);
 const next=date.toISOString().slice(0,10);
 return validDemoDay(next)?next:null;
}
function displayDemoDay(key){
 if(!validDemoDay(key))return '日付不明';
 const date=new Date(key+'T00:00:00.000Z');
 const weekdays=['日','月','火','水','木','金','土'];
 return Number(key.slice(0,4))+'年'+Number(key.slice(5,7))+'月'+Number(key.slice(8,10))+'日（'+weekdays[date.getUTCDay()]+'）';
}
function freshDemoDayContext(){
 const empty=Core.initial();
 empty.bookings=[];
 empty.waiters=[];
 empty.unassigned=[];
 empty.releases=[];
 empty.offers=[];
 empty.nextBooking=1;
 empty.nextUnassigned=1;
 empty.nextRelease=1;
 empty.nextOffer=1;
 return {model:empty,receipts:[],drawer:initialRegister(),nextReceipt:1,counts:Object.fromEntries(REG_DENOMS.map(n=>[n,'0']))};
}
function keepDemoDayContext(){
 demoDayContexts.set(selectedDemoDay,{
  model,
  receipts:demoReceipts,
  drawer:register,
  nextReceipt:checkoutNextNumber,
  counts:Object.fromEntries(REG_DENOMS.map(n=>[n,$('reg_'+n).value]))
 });
}
function showDemoDayContext(ctx){
 model=ctx.model;
 demoReceipts=ctx.receipts;
 register=ctx.drawer;
 checkoutNextNumber=ctx.nextReceipt;
 for(const n of REG_DENOMS)$('reg_'+n).value=ctx.counts[n]??'0';
}
function renderDemoDaySelector(){
 const title=displayDemoDay(selectedDemoDay);
 $('demoDatePicker').value=selectedDemoDay;
 $('demoDateLabel').textContent=title;
 $('demoPrevDay').disabled=!advanceDemoDay(selectedDemoDay,-1);
 $('demoNextDay').disabled=!advanceDemoDay(selectedDemoDay,1);
 $('demoBaseDay').disabled=selectedDemoDay===DEMO_BASE_DAY;
 $('demoDayHint').textContent=selectedDemoDay===DEMO_BASE_DAY?'初期日の架空予約を表示中':'この日には初期予約がありません（架空データ）';
 $('customerDemoDay').textContent='架空の体験日 · '+title;
 $('checkoutDemoDay').textContent=title+' · 架空の会計';
 $('registerDemoDay').textContent=title+' · 架空のレジ';
}
function changeDemoDay(next){
 if(!validDemoDay(next)){
  $('demoDatePicker').value=selectedDemoDay;
  info('選べる日付は2000年〜2100年です。',true);
  return false;
 }
 if(next===selectedDemoDay){renderDemoDaySelector();return true;}
 keepDemoDayContext();
 const ctx=demoDayContexts.get(next)||freshDemoDayContext();
 demoDayContexts.set(next,ctx);
 selectedDemoDay=next;
 showDemoDayContext(ctx);
 chosenCustomer=null;
 selectedUnassigned=null;
 undoPrep=null;
 pendingTimeChange=null;
 quickDraft=null;
 quickConfirming=false;
 quickMenuId=null;
 checkoutBookingId=null;
 $('checkoutBooking').replaceChildren();
 resetCheckoutForm();
 hidePrepFeedback();
 go('booking');
 return true;
}
function resetDemoDayContexts(){
 demoDayContexts.clear();
 selectedDemoDay=DEMO_BASE_DAY;
}
