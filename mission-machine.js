/* Teacher-controlled class missions. Rolls, progress and prizes are server saved. */
(function (root) {
  'use strict';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  /* Slot machine reels. Presentation only: the server still decides the roll, and
     the reels only ever stop on the mission it saved. ROW must match .mmFace. */
  var REEL_ROW = 46, REEL_SPEEDS = [14, 11], REEL_MIN_MS = 1100, REEL_STAGGER_MS = 520, REEL_STOP_MS = 900, REEL_REVEAL_MS = 900;
  function reducedMotion() {try {return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);} catch (_) {return false;}}
  function reelFaces() {
    var content = root.ClassroomMissionContent || {};
    return [
      (content.OBJECTIVES || []).map(function (o) {return {id: o.id, name: o.name, rare: false};}),
      (content.PRIZES || []).map(function (p) {return {id: p.id, name: p.name, rare: !!p.rare};})
    ];
  }
  function easeOut(u) {return 1 - Math.pow(1 - u, 3);}
  // Where a reel is at time t: spinning freely, decelerating onto its face, or stopped.
  function reelPos(reel, t) {
    if (reel.stop) {var u = Math.min(1, (t - reel.stop.at) / reel.stop.ms);return reel.stop.from + (reel.stop.to - reel.stop.from) * easeOut(u);}
    return reel.base + reel.speed * (t - reel.since) / 1000;
  }
  function reelSpeed(reel, t) {
    if (!reel.stop) return reel.speed;
    var u = Math.min(1, (t - reel.stop.at) / reel.stop.ms);
    return 3 * Math.pow(1 - u, 2) * (reel.stop.to - reel.stop.from) / (reel.stop.ms / 1000);
  }
  function reelMarkup(faces) {
    if (!faces.length) return '';
    var strip = [faces[faces.length - 1]].concat(faces, [faces[0], faces[1 % faces.length]]);
    return strip.map(function (f) {return '<span class="mmFace' + (f.rare ? ' mmFaceRare' : '') + '">' + esc(f.name) + '</span>';}).join('');
  }
  function mount(host, options) {
    var spin=null, spinFrame=0, data=null, pending=null, busy=false, loading=true, dead=false, error='', readError='', readVersion=0, payout='', timer=null;
    var key='polymath.classMission.'+options.teacherId+'.'+encodeURIComponent(options.classId);
    try {var saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved&&/^[a-zA-Z0-9_-]{8,100}$/.test(saved.id||''))pending=saved;}catch(_){}
    function blocked() {return busy||!!pending;}
    function canAct() {return !loading&&!busy&&!pending&&!spin&&options.canAct();}
    function startSpin(id) {
      stopSpin();
      var faces=reelFaces();if(reducedMotion()||!faces[0].length||!faces[1].length)return;
      var now=performance.now();
      spin={id:id,started:now,result:null,landedAt:0,reels:faces.map(function (list,i) {return {faces:list,speed:REEL_SPEEDS[i],base:Math.floor(Math.random()*list.length),since:now,stop:null,target:-1,done:false};})};
      spinFrame=requestAnimationFrame(spinTick);
    }
    function stopSpin() {if(spinFrame)cancelAnimationFrame(spinFrame);spinFrame=0;spin=null;}
    // The saved mission arrived: each reel lands on the face the server chose.
    function landSpin(current) {
      if(!spin)return;
      var objective=spin.reels[0].faces.findIndex(function (f) {return f.id===current.objectiveId;}),prize=spin.reels[1].faces.findIndex(function (f) {return f.id===(current.prize&&current.prize.id);});
      if(objective<0||prize<0){stopSpin();return;}
      spin.reels[0].target=objective;spin.reels[1].target=prize;spin.result=performance.now();
    }
    function spinTick(t) {
      spinFrame=0;if(dead||!spin)return;
      var go=Math.max(spin.result||Infinity,spin.started+REEL_MIN_MS);
      spin.reels.forEach(function (reel,i) {
        if(reel.done||reel.target<0)return;
        if(reel.stop){if(t>=reel.stop.at+reel.stop.ms)reel.done=true;return;}
        if(t<go+i*REEL_STAGGER_MS)return;
        // Begin slowing only when the face lands within one row of the natural stopping distance.
        var n=reel.faces.length,from=reelPos(reel,t),reach=from+reel.speed*REEL_STOP_MS/3000,extra=((reel.target-reach)%n+n)%n;
        if(extra>=1)return;
        var to=reach+extra;reel.stop={at:t,from:from,to:to,ms:3000*(to-from)/reel.speed};
      });
      var strips=host.querySelectorAll('.mmStrip');
      spin.reels.forEach(function (reel,i) {
        var node=strips[i];if(!node)return;
        var n=reel.faces.length,pos=reel.done?reel.stop.to:reelPos(reel,t),at=((pos%n)+n)%n,speed=reel.done?0:reelSpeed(reel,t);
        node.style.transform='translateY('+(-(at+1)*REEL_ROW+REEL_ROW*.3).toFixed(2)+'px)';
        node.style.filter=speed>6?'blur('+Math.min(1.4,speed/12).toFixed(2)+'px)':'none';
        var slot=node.parentElement&&node.parentElement.parentElement;if(slot){slot.classList.toggle('mmLanded',reel.done);slot.classList.toggle('mmRare',reel.done&&!!reel.faces[reel.target].rare);}
      });
      if(spin.reels.every(function (reel) {return reel.done;})) {
        if(!spin.landedAt){spin.landedAt=t;host.querySelector('.mmReels')&&host.querySelector('.mmReels').classList.add('mmJackpot');}
        if(t-spin.landedAt>=REEL_REVEAL_MS){spin=null;render();return;}
      }
      spinFrame=requestAnimationFrame(spinTick);
    }
    function accept(result, initial, notify, applyMarks) {
      if(dead)return;
      if(result.mission&&(!data||result.mission.revision>=data.revision))data=result.mission;
      var award=data&&data.lastPayout;
      if(award&&award.id!==payout) {
        if(!initial && applyMarks) (award.awards||[]).forEach(function (entry) {var student=(root.rwStudents||[]).find(function (s) {return s.id===entry.studentId;});if(student)student.marks=entry.marks;});
        payout=award.id;
      }
      if(options.onChange&&notify)options.onChange(result);
    }
    async function refresh() {
      if(dead||busy)return;
      var version=++readVersion,initial=!data;
      try {var result=await options.store.mission({command:'get'});if(dead||version!==readVersion)return;accept(result,initial,false);readError='';}
      catch(e){if(!dead&&version===readVersion&&!pending)readError=e.message||'Could not load the class mission.';}
      finally{if(!dead&&version===readVersion){loading=false;render();}}
    }
    function render() {
      if(dead)return;
      var drawer=host.parentElement&&host.parentElement.matches('details.cbMissionDrawer')?host.parentElement:null;
      if(drawer){if(pending)drawer.open=true;var label=drawer.querySelector('summary');label.textContent='Mission machine · '+(spin?'spinning…':pending?'retry save':data&&data.current&&data.current.status==='active'?data.current.progress+' / '+data.current.target+' · '+data.current.objectiveName:'class quests');}
      var current=data&&data.current, active=current&&current.status==='active', ready=canAct(), encounter=options.getState(), questionSpin=options.getSpinId&&options.getSpinId();
      var minutes=current&&current.objectiveId==='focus'?Math.max(0,Math.ceil((current.focusReadyAt-Date.now())/60000)):0;
      var progress=current?current.objectiveId==='focus'?(minutes?minutes+' minutes remaining':'30 minutes elapsed · confirm focus below'):current.progress+' / '+current.target:'';
      var available=(data&&data.bank||[]).filter(function (p) {return p.status==='available';});
      var reels=spin?'<div class="mmReels mmSpinning'+(spin.landedAt?' mmJackpot':'')+'" aria-live="polite"><span class="mmSr">Spinning the mission machine…</span>'+spin.reels.map(function (reel,i) {var face=reel.done?reel.faces[reel.target]:null;return '<div class="mmReel'+(reel.done?' mmLanded':'')+(face&&face.rare?' mmRare':'')+'" aria-hidden="true"><small>'+(i?'CLASS PRIZE':'OBJECTIVE')+'</small><div class="mmSlot"><div class="mmStrip">'+reelMarkup(reel.faces)+'</div></div></div>';}).join('')+'</div>':null;
      host.innerHTML='<section class="mmPanel" aria-label="Class mission machine"><div class="mmHeading"><span class="mmMachine'+(busy||spin?' mmRolling':'')+'" role="img" aria-label="Pixel mission slot machine"></span><div><span class="mmEyebrow">WHOLE CLASS QUEST</span><h3>Mission machine</h3><p>Turn for a random objective and a class prize.</p></div></div>'+(reels||'<div class="mmReels" aria-live="polite"><div><small>OBJECTIVE</small><strong>'+esc(current?current.objectiveName:'A new challenge awaits')+'</strong>'+(current?'<span>'+esc(progress)+' · '+esc(current.status)+'</span>':'')+'</div><div class="'+(current&&current.prize.rare?'mmRare':'')+'"><small>CLASS PRIZE'+(current&&current.prize.rare?' · RARE':'')+'</small><strong>'+esc(current?current.prize.name:'Blooket, Gimkit, points or a summon')+'</strong></div></div>')+'<div class="mmActions"><button type="button" data-mm="turn"'+(!ready||active?' disabled':'')+'>↻ Turn</button>'+(active?'<button type="button" data-mm="cancel"'+(!ready?' disabled':'')+'>Cancel mission</button>':'')+(active&&current.objectiveId==='focus'?'<button type="button" data-mm="focus"'+(!ready||minutes?' disabled':'')+'>Confirm 30 focused minutes</button>':'')+(active&&current.objectiveId==='correct-streak'&&questionSpin?'<button type="button" data-mm="incorrect"'+(!ready?' disabled':'')+'>Incorrect answer · reset streak</button>':'')+'</div>'+(active&&current.objectiveId==='focus'?'<p class="mmHint">The timer starts when this mission is saved. The teacher confirms the class stayed focused and quiet.</p>':'')+'<div class="mmSummon"><strong>One-Punch Chung</strong><span>'+(data?data.summonTokens:0)+' earned summon'+(data&&data.summonTokens===1?'':'s')+'</span><button type="button" data-mm="summon" data-source="reward"'+(!ready||!encounter||encounter.status!=='active'||!(data&&data.summonTokens)?' disabled':'')+'>Use earned summon</button><button type="button" data-mm="summon" data-source="teacher"'+(!ready||!encounter||encounter.status!=='active'?' disabled':'')+'>Teacher help · one punch</button></div>'+(available.length?'<details class="mmBank" open><summary>Class prize bank · '+available.length+'</summary>'+available.map(function (prize) {return '<article><div><strong>'+esc(prize.name)+'</strong><small>'+(prize.kind==='summon'?'Use the summon button during an encounter.':'For the entire class · teacher marks as used')+'</small></div>'+(prize.kind==='minutes'?'<button type="button" data-mm="redeem" data-prize="'+esc(prize.id)+'"'+(!ready?' disabled':'')+'>Mark as used</button>':'')+'</article>';}).join('')+'</details>':'')+'<p class="mmStatus" role="status">'+'</p>'+(pending?'<button type="button" data-mm="retry"'+(busy||loading||!options.canAct()?' disabled':'')+'>Retry saved request</button>':'')+'</section>';
      var status=host.querySelector('.mmStatus');status.textContent=busy?'Saving class mission…':spin?'The reels are stopping on the saved mission…':pending?(error?error+' ':'')+'A save needs confirmation. Retry keeps the same roll or prize.':error||readError|| (loading?'Loading saved class mission…':current&&current.status==='complete'?'Mission complete! The class prize is saved.':'Progress and prizes save for this Lesson slot.');
      // A rebuilt panel gets its reels placed at once, so the strip never flashes its first face.
      if(spin){if(spinFrame)cancelAnimationFrame(spinFrame);spinTick(performance.now());}
    }
    async function send(command, extra, retry) {
      if(dead||busy||loading||!options.canAct())return;
      if(!retry&&pending)return;
      if(!retry) {
        var current=data&&data.current;
        pending=Object.assign({command:command,id:'mission-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),expectedRevision:data?data.revision:0},current?{missionId:current.id}:{},extra||{});
        if(command==='incorrect')pending.spinId=options.getSpinId();
        if(command==='summon') {var encounter=options.getState();pending.encounterId=encounter&&encounter.encounterId;pending.expectedRevision=encounter&&encounter.revision;}
      }
      if(!pending)return;
      var request=JSON.parse(JSON.stringify(pending));
      try {sessionStorage.setItem(key,JSON.stringify(request));}catch(_){pending=null;error='Enable session storage to save and retry class prizes safely.';render();return;}
      if(request.command==='turn')startSpin(request.id);
      busy=true;error='';readVersion++;render();if(options.onBusy)options.onBusy();
      try {
        var result, summonEvent=null;
        if(request.command==='summon') {var next=await options.store.act(Object.assign({},request,{type:'summon'}));result={state:next};}
        else result=await options.store.mission(request);
        if(dead)return;
        var stored=JSON.parse(sessionStorage.getItem(key)||'null');if(stored&&stored.id===request.id)sessionStorage.removeItem(key);
        pending=null;accept(result,false,true,true);
        if(spin&&spin.id===request.id){var landed=data&&data.current;if(landed&&landed.id===request.id&&landed.status==='active')landSpin(landed);else stopSpin();}
        if(request.command==='summon'&&result.state&&result.state.lastEvent&&result.state.lastEvent.id===request.id)summonEvent=result.state.lastEvent;
      } catch(e) {
        if(dead)return;
        stopSpin();error=e.message||'Could not confirm this save.';
        if(['focus_not_ready','invalid_summon','summon_unavailable','teacher_required','invalid_balance','encounter_active','invalid_action','invalid_mission','invalid_slot','mission_changed','mission_active','mission_missing','mission_not_ready','invalid_prize','prize_unavailable','no_summon','battle_changed','encounter_inactive','pending_answer','roster_changed','invalid_command'].includes(e.code)) {pending=null;sessionStorage.removeItem(key);}
      } finally {if(!dead){busy=false;render();if(options.onBusy)options.onBusy();if(!pending)refresh();if(summonEvent&&options.onSummon)options.onSummon(summonEvent,result.state.encounterId);}}
    }
    function click(event) {var button=event.target.closest('[data-mm]');if(!button||button.disabled)return;var command=button.dataset.mm;send(command,command==='summon'?{source:button.dataset.source}:command==='redeem'?{prizeId:button.dataset.prize}:{},command==='retry');}
    host.addEventListener('click',click);timer=setInterval(function(){if(data&&data.current&&data.current.objectiveId==='focus')render();},15000);
    render();refresh();
    return {receive:function(result){accept(result,false,false,true);render();},refresh:refresh,render:render,blocked:blocked,destroy:function(){dead=true;stopSpin();readVersion++;clearInterval(timer);host.removeEventListener('click',click);host.innerHTML='';}};
  }
  root.ClassroomMissionMachine={mount:mount};
})(typeof window!=='undefined'?window:globalThis);
