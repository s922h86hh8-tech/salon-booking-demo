// v0.66: two independent worker threads contend for one fictional queue job.
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 const {openLocalBookingPrototype}=await import(workerData.bookingUrl);
 const {openFictionalNotificationAddon}=await import(workerData.addonUrl);
 const {openFictionalNotificationQueue}=await import(workerData.queueUrl);
 const resolveSession=handle=>handle==='ownerA'?{
  authenticated:true,kind:'staff',subjectId:'ownerA'
 }:null;
 const booking=openLocalBookingPrototype({
  path:workerData.dbPath,resolveSession,
  clock:()=>new Date('2026-10-25T08:00:00.000Z')
 });
 openFictionalNotificationAddon({
  bookingStore:booking,resolveSession,fictionalTestOnly:true,
  clock:()=>new Date('2026-10-25T08:00:00.000Z')
 });
 const queue=openFictionalNotificationQueue({
  bookingStore:booking,resolveSession,fictionalTestOnly:true,
  clock:()=>new Date('2026-10-25T08:00:00.000Z')
 });
 parentPort.postMessage({type:'ready'});
 parentPort.on('message',command=>{
  if(command!=='go')return;
  try{
   const claimed=queue.claim({
    sessionHandle:'ownerA',storeId:'A',workerId:workerData.workerId
   });
   parentPort.postMessage({
    type:'done',status:claimed?'CLAIMED':'NONE',
    draftId:claimed?.draftId||null
   });
  }catch(error){
   parentPort.postMessage({type:'done',status:'ERROR',code:error.code||error.message});
  }finally{booking.close();}
 });
})().catch(error=>parentPort.postMessage({
 type:'done',status:'ERROR',code:error.code||error.message
}));
