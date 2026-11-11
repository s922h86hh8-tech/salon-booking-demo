/* v0.22 independent fictional demo. In-memory only. No network, no personal data. */
(function (root) {
  'use strict';
  const DATE='2026-10-26';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const SOURCE_CODES=['hpb','line','website','google','phone','instore','other','unknown'];
  const DISCOVERY_CODES=['hpb','line','google','referral','sns','storefront','other','unknown'];
  const initial=()=>({
    store:'架空・青空リラクゼーション',step:0,
    staff:[{id:'s1',name:'佐藤',prep:15,menus:['m60','m90']},{id:'s2',name:'田中',prep:30,menus:['m60']}],
    menus:[{id:'m60',name:'もみほぐし60分',duration:60,price:5000,private:false},{id:'m90',name:'個室ケア90分',duration:90,price:9000,private:true}],
    rooms:[{id:'open',private:false},{id:'pr1',private:true}],
    beds:[{id:'b1',name:'オープン1',room:'open',clean:15},{id:'b2',name:'オープン2',room:'open',clean:15},{id:'b3',name:'個室1',room:'pr1',clean:20}],
    breaks:{s1:{start:720,duration:60},s2:{start:750,duration:60}},
    bookings:[{id:1,staff:'s1',bed:'b1',menu:'m60',start:600,customer:'架空のお客様A',source:'hpb',discovery:'google',status:'CONFIRMED'},
      {id:2,staff:'s2',bed:'b2',menu:'m60',start:630,customer:'架空のお客様B',source:'line',discovery:'referral',status:'CONFIRMED'},
      {id:3,staff:'s1',bed:'b3',menu:'m90',start:840,customer:'架空のお客様C',source:'website',discovery:'unknown',status:'CONFIRMED'}],
    waiters:[{id:'w1',menu:'m60',earliest:570,latest:750,staff:null,consent:true,label:'架空の希望者A',status:'ACTIVE'},
      {id:'w2',menu:'m60',earliest:570,latest:750,staff:'s1',consent:true,label:'架空の希望者B',status:'ACTIVE'},
      {id:'w3',menu:'m90',earliest:780,latest:960,staff:'s1',consent:true,label:'架空の希望者C',status:'ACTIVE'}],
    unassigned:[{id:1,seq:1,menu:'m60',start:540,customer:'架空・自由枠のお客様A',source:'phone',discovery:'unknown'},{id:2,seq:2,menu:'m90',start:855,customer:'架空・自由枠のお客様B',source:'hpb',discovery:'unknown'}],nextUnassigned:3,
    releases:[], offers:[],nextBooking:4,nextRelease:1,nextOffer:1,
    connected:{line:false,google:false},guideDone:[],events:[]
  });
  function mins(value){if(!/^\d{2}:\d{2}$/.test(value))throw Error('時刻の形式が違います');const [h,m]=value.split(':').map(Number);if(h>23||m>59||m%15)throw Error('15分刻みの時刻を選んでください');return 60*h+m;}
  function clock(t){return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');}
  function intersects(a,b,c,d){return a<d&&c<b;}
  function serviceFor(model,booking){
    const menu=model.menus.find(x=>x.id===booking.menu);
    if(!menu)throw Error('コースが見つかりません');
    return booking.serviceMinutes===undefined?menu.duration:booking.serviceMinutes;
  }
  function resourceWindow(model,booking){
    const menu=model.menus.find(x=>x.id===booking.menu), staff=model.staff.find(x=>x.id===booking.staff),bed=model.beds.find(x=>x.id===booking.bed);
    if(!menu||!staff||!bed)throw Error('存在しないコース・スタッフ・設備です');
    return {start:booking.start,serviceEnd:booking.start+serviceFor(model,booking),staffEnd:booking.start+serviceFor(model,booking)+(booking.prepMinutes===undefined?staff.prep:booking.prepMinutes),bedEnd:booking.start+serviceFor(model,booking)+bed.clean,room:bed.room};
  }
  function breakFor(model,staffId){
    const item=model.breaks&&model.breaks[staffId];
    if(!item)return null;
    return {start:item.start,end:item.start+item.duration,duration:item.duration};
  }
  // Both moving and resizing a break use the same collision rules.
  function validateBreakWindow(model,staffId,start,duration){
    const staff=model.staff.find(s=>s.id===staffId);
    assert(staff&&breakFor(model,staffId),'変更対象の休憩が見つかりません');
    assert(Number.isInteger(start)&&start%15===0&&start>=540,'休憩の開始は09:00以降・15分刻みです');
    assert(Number.isInteger(duration)&&duration%15===0&&duration>=15&&duration<=180,'休憩は15〜180分の15分刻みで指定してください');
    assert(start+duration<=1080,'営業時間を超えて休憩を設定できません');
    for(const b of model.bookings.filter(b=>b.status==='CONFIRMED'&&b.staff===staffId)){
      const occupied=resourceWindow(model,b);
      assert(!intersects(start,start+duration,occupied.start,occupied.staffEnd),'予約や準備時間と重なるため変更できません');
    }
    return staff;
  }
  function changeBreak(model,staffId,minutes){
    const original=breakFor(model,staffId);
    assert(original,'変更対象の休憩が見つかりません');
    if(original.duration===minutes)return minutes;
    const staff=validateBreakWindow(model,staffId,original.start,minutes);
    model.breaks[staffId].duration=minutes;
    model.events.push(staff.name+'の休憩 '+original.duration+'分→'+minutes+'分');
    return minutes;
  }
  function moveBreak(model,staffId,newStart){
    const original=breakFor(model,staffId);
    assert(original,'変更対象の休憩が見つかりません');
    // A no-op should still require a correctly snapped start.
    const staff=validateBreakWindow(model,staffId,newStart,original.duration);
    if(original.start===newStart)return newStart;
    model.breaks[staffId].start=newStart;
    model.events.push(staff.name+'の休憩を'+clock(original.start)+'〜'+clock(original.end)+'から'+clock(newStart)+'〜'+clock(newStart+original.duration)+'へ移動');
    return newStart;
  }
  function canBook(model,request,excludeBookingId=null){
    const m=model.menus.find(x=>x.id===request.menu), s=model.staff.find(x=>x.id===request.staff),b=model.beds.find(x=>x.id===request.bed);
    if(!m||!s||!b)return {ok:false,reason:'コース・スタッフ・設備を選択してください'};
    if(!Number.isInteger(request.start)||request.start%15||request.start<540)return {ok:false,reason:'予約は09:00以降、15分刻みです'};
    if(!s.menus.includes(m.id))return {ok:false,reason:'担当スタッフはこのコースに対応していません'};
    if(m.private&&b.room!=='pr1')return {ok:false,reason:'このコースには個室が必要です'};
    const r=resourceWindow(model,request);
    if(r.staffEnd>1080||r.bedEnd>1080)return {ok:false,reason:'施術・準備が営業時間を超えます'};
    const rest=breakFor(model,s.id);
    if(rest&&intersects(r.start,r.staffEnd,rest.start,rest.end))return {ok:false,reason:'担当スタッフの休憩と重なります'};
    for(const old of model.bookings.filter(x=>x.status==='CONFIRMED'&&x.id!==excludeBookingId)){
      const occupied=resourceWindow(model,old);
      if(old.staff===request.staff&&intersects(r.start,r.staffEnd,occupied.start,occupied.staffEnd))return {ok:false,reason:'スタッフの予約・準備と重なります'};
      if(old.bed===request.bed&&intersects(r.start,r.bedEnd,occupied.start,occupied.bedEnd))return {ok:false,reason:'ベッドの使用・清掃と重なります'};
      if(b.room==='pr1'&&occupied.room==='pr1'&&intersects(r.start,r.bedEnd,occupied.start,occupied.bedEnd))return {ok:false,reason:'個室が使用中です'};
    }
    return {ok:true,reason:'予約可能（架空の体験）'};
  }
  function assert(cond,msg){if(!cond)throw Error(msg);}
  function book(model,request){
    const check=canBook(model,request);assert(check.ok,check.reason);
    const id=model.nextBooking++;
    model.bookings.push({id,menu:request.menu,staff:request.staff,bed:request.bed,start:request.start,customer:request.customer||'架空の体験予約',source:SOURCE_CODES.includes(request.source)?request.source:'unknown',discovery:DISCOVERY_CODES.includes(request.discovery)?request.discovery:'unknown',status:'CONFIRMED',prepMinutes:model.staff.find(x=>x.id===request.staff).prep});
    model.events.push('架空予約 #'+id+' を確定（外部送信なし）');return id;
  }
  function canQueue(model,request){
    const m=model.menus.find(x=>x.id===request.menu);
    if(!m)return {ok:false,reason:'コースを選んでください'};
    if(!Number.isInteger(request.start)||request.start%15!==0||request.start<540||request.start+m.duration>1080)return {ok:false,reason:'営業時間内の15分刻みの開始時刻を指定してください'};
    return {ok:true,reason:'担当未定の自由枠に追加できます（予約未確定）'};
  }
  function queueUnassigned(model,request){
    const ok=canQueue(model,request);assert(ok.ok,ok.reason);
    const id=model.nextUnassigned++;
    const safeName=request.customer||('架空・自由枠のお客様'+id);
    model.unassigned.push({id,seq:id,menu:request.menu,start:request.start,customer:safeName,source:SOURCE_CODES.includes(request.source)?request.source:'unknown',discovery:DISCOVERY_CODES.includes(request.discovery)?request.discovery:'unknown'});
    model.events.push('自由枠 #'+id+' 仮受付（未確定）');return id;
  }
  function assignUnassigned(model,id,request){
    const job=model.unassigned.find(x=>x.id===id);assert(job,'自由枠の対象が見つかりません');
    assert(request.menu===job.menu,'コースは自由枠の内容と一致させてください');
    const check=canBook(model,request);assert(check.ok,check.reason);
    const assigned=book(model,{...request,customer:job.customer,source:job.source,discovery:job.discovery});
    model.unassigned=model.unassigned.filter(x=>x.id!==id);
    model.events.push('自由枠 #'+id+' をスタッフへ付け回し・架空予約 #'+assigned+' 確定');
    return assigned;
  }
  function prepFor(model,booking){
    const staff=model.staff.find(x=>x.id===booking.staff);
    if(!staff)throw Error('担当スタッフが見つかりません');
    return booking.prepMinutes===undefined?staff.prep:booking.prepMinutes;
  }
  function changePrep(model,id,minutes){
    const booking=model.bookings.find(x=>x.id===id&&x.status==='CONFIRMED');
    assert(booking,'変更できる予約が見つかりません');
    assert(minutes===15||minutes===30,'準備時間は15分か30分を選んでください');
    const before=booking.prepMinutes;
    const original=prepFor(model,booking);
    if(original===minutes)return original;
    booking.prepMinutes=minutes;
    try{
      const own=resourceWindow(model,booking);
      assert(own.staffEnd<=1080,'営業時間を超えて準備を延長できません');
      const rest=breakFor(model,booking.staff);
      assert(!rest||!intersects(own.start,own.staffEnd,rest.start,rest.end),'スタッフの休憩と重なります');
      for(const old of model.bookings.filter(x=>x.status==='CONFIRMED'&&x.id!==booking.id&&x.staff===booking.staff)){
        const occupied=resourceWindow(model,old);
        assert(!intersects(own.start,own.staffEnd,occupied.start,occupied.staffEnd),'次の予約・準備と重なります');
      }
      model.events.push('架空予約 #'+id+' の準備 '+original+'分→'+minutes+'分');
      return minutes;
    }catch(err){
      if(before===undefined)delete booking.prepMinutes;else booking.prepMinutes=before;
      throw err;
    }
  }
  function changeService(model,id,minutes){
    const booking=model.bookings.find(x=>x.id===id&&x.status==='CONFIRMED');
    assert(booking,'変更できる予約が見つかりません');
    assert(Number.isInteger(minutes)&&minutes%15===0&&minutes>=30&&minutes<=180,'予約枠は30〜180分の15分刻みで指定してください');
    const original=serviceFor(model,booking);
    if(original===minutes)return original;
    const previous=booking.serviceMinutes;
    booking.serviceMinutes=minutes;
    try{
      const check=canBook(model,booking,id);
      assert(check.ok,check.reason);
      model.events.push('架空予約 #'+id+' の予約枠 '+original+'分→'+minutes+'分');
      return minutes;
    }catch(err){
      if(previous===undefined)delete booking.serviceMinutes;else booking.serviceMinutes=previous;
      throw err;
    }
  }
  function cancel(model,id){
    const b=model.bookings.find(x=>x.id===id);assert(b&&b.status==='CONFIRMED','取消できる予約がありません');
    b.status='CANCELLED';const rid=model.nextRelease++;
    model.releases.push({id:rid,booking:id,offer:null,recovered:false});model.events.push('架空予約 #'+id+' の取消・空き枠発生');return rid;
  }
  function candidates(model,rid){
    const release=model.releases.find(x=>x.id===rid);if(!release||release.recovered)return [];
    const origin=model.bookings.find(x=>x.id===release.booking);
    return model.waiters.filter(w=>w.status==='ACTIVE'&&w.consent&&w.menu===origin.menu&&(!w.staff||w.staff===origin.staff)&&w.earliest<=origin.start&&w.latest>=origin.start&&canBook(model,origin).ok);
  }
  function offer(model,rid){
    const release=model.releases.find(x=>x.id===rid);assert(release&&!release.recovered,'空き枠がありません');
    assert(!release.offer,'この空き枠には案内中の候補があります');
    const list=candidates(model,rid);assert(list.length,'条件に合う希望者がいません');
    const chosen=list[0];const id=model.nextOffer++;
    model.offers.push({id,release:rid,waiter:chosen.id,status:'PENDING',delivery:'NOT_SENT'});
    release.offer=id;chosen.status='OFFERED';model.events.push('架空の希望者に模擬案内（実送信なし）');return id;
  }
  function decline(model,oid){
    const o=model.offers.find(x=>x.id===oid);assert(o&&o.status==='PENDING','有効な案内がありません');
    o.status='DECLINED';const r=model.releases.find(x=>x.id===o.release);r.offer=null;
    const w=model.waiters.find(x=>x.id===o.waiter);w.status='DECLINED';model.events.push('模擬辞退を受付');
  }
  function accept(model,oid,approved){
    const o=model.offers.find(x=>x.id===oid);assert(o&&o.status==='PENDING','有効な案内がありません');
    assert(approved===true,'架空のお客様の承諾確認が必要です');
    const r=model.releases.find(x=>x.id===o.release),old=model.bookings.find(x=>x.id===r.booking);
    assert(!r.recovered,'空き枠は回収済みです');
    const id=book(model,{menu:old.menu,staff:old.staff,bed:old.bed,start:old.start});
    o.status='ACCEPTED';r.recovered=true;r.offer=null;model.waiters.find(x=>x.id===o.waiter).status='BOOKED';
    model.events.push('架空の空き枠を1件回収');return id;
  }
  function quote(model){return {total:model.bookings.filter(x=>x.status==='CONFIRMED').length,waiting:model.waiters.filter(x=>x.status==='ACTIVE').length,recovered:model.releases.filter(x=>x.recovered).length,notified:0};}
  root.DemoCore={initial,mins,clock,canBook,book,cancel,candidates,offer,decline,accept,quote,clone,DATE,prepFor,changePrep,serviceFor,changeService,breakFor,changeBreak,moveBreak,canQueue,queueUnassigned,assignUnassigned};
})(typeof module==='object'&&module.exports?module.exports:window);
