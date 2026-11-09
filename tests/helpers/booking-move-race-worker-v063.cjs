// Two-worker atomic relocation race against the same fictional target slot.
const {workerData,parentPort}=require('node:worker_threads');
(async()=>{
 const {openLocalBookingPrototype}=await import(workerData.moduleUrl);
 const app=openLocalBookingPrototype({
  path:workerData.path,
  resolveSession:handle=>handle==='staff'?{
   authenticated:true,kind:'staff',subjectId:'managerA'
  }:null,
  clock:()=>new Date('2026-11-09T12:50:00.000Z')
 });
 parentPort.postMessage({type:'ready'});
 parentPort.on('message',message=>{
  if(message!=='go')return;
  try{
   const result=app.move({
    sessionHandle:'staff',storeId:'A',bookingId:workerData.bookingId,
    serviceDate:'2026-10-26',menuId:'m60',staffId:'s2',bedId:'b3',
    startMinute:630,idempotencyKey:workerData.key
   });
   parentPort.postMessage({type:'done',outcome:'moved',bookingId:result.bookingId});
  }catch(err){
   parentPort.postMessage({type:'done',outcome:err.code||err.message});
  }finally{app.close();}
 });
})().catch(err=>parentPort.postMessage({type:'done',outcome:err.code||err.message}));
