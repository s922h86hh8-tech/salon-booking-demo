// Separate-process-style worker for fictional SQLite booking collision tests.
// Never use real customer information or tokens.
const {workerData,parentPort}=require('node:worker_threads');
(async()=>{
 const {openLocalBookingPrototype}=await import(workerData.moduleUrl);
 const store=openLocalBookingPrototype({
  path:workerData.path,
  resolveSession:handle=>handle==='guest'?{
   authenticated:true,kind:'customer',subjectId:workerData.subjectId
  }:null,
  clock:()=>new Date('2026-11-08T00:00:00.000Z')
 });
 parentPort.postMessage({type:'ready'});
 parentPort.on('message',command=>{
  if(command!=='go')return;
  try{
   const result=store.reserve({
    sessionHandle:'guest',storeId:'A',serviceDate:'2026-10-26',
    menuId:'m60',staffId:'s2',bedId:'b3',startMinute:540,
    idempotencyKey:workerData.key,discovery:'unknown'
   });
   parentPort.postMessage({type:'done',outcome:'confirmed',id:result.bookingId});
  }catch(e){
   parentPort.postMessage({type:'done',outcome:e.code||e.message});
  }finally{store.close();}
 });
})().catch(e=>parentPort.postMessage({type:'done',outcome:e.code||e.message}));
