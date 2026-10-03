/* Teacher-controlled class missions. Rolls, progress and prizes are server saved. */
(function (root) {
  'use strict';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function mount(host, options) {
    var data=null, pending=null, questionContext=null, questionRead=null, questionReadFailed=false, busy=false, loading=true, dead=false, error='', readError='', readVersion=0, payout='', timer=null;
    var key='polymath.classMission.'+options.teacherId+'.'+encodeURIComponent(options.classId);
    try {var saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved&&/^[a-zA-Z0-9_-]{8,100}$/.test(saved.id||''))pending=saved;}catch(_){}
    try {var savedQuestion=JSON.parse(sessionStorage.getItem(key+'.question')||'null');if(savedQuestion&&/^[a-zA-Z0-9_-]{8,100}$/.test(savedQuestion.spinId||'')&&Number.isSafeInteger(savedQuestion.missionRevision)&&savedQuestion.missionRevision>=0)questionContext=savedQuestion;}catch(_){}
    function blocked() {return loading||!data||busy||!!pending;}
    function canAct() {return !!data&&!loading&&!busy&&!pending&&options.canAct();}
    function saveQuestion() {try {sessionStorage.setItem(key+'.question',JSON.stringify(questionContext));}catch(_) {}}
    function getAnswerContext(spinId) {return questionContext&&questionContext.spinId===spinId?{missionId:questionContext.missionId,missionRevision:questionContext.missionRevision}:null;}
    function question(spinId) {
      if(!dead&&getAnswerContext(spinId))return getAnswerContext(spinId);
      if(dead||loading||questionReadFailed||!data||!/^[a-zA-Z0-9_-]{8,100}$/.test(spinId||''))return null;
      if(!questionContext||questionContext.spinId!==spinId) {
        questionContext={spinId:spinId,missionId:data&&data.current&&data.current.status==='active'?data.current.id:null,missionRevision:data?data.revision:0};
        saveQuestion();
      }
      return getAnswerContext(spinId);
    }
    function applyBalances(awards) {
      (awards||[]).forEach(function (entry) {var student=(root.rwStudents||[]).find(function (s) {return s.id===entry.studentId;});if(student&&Number.isSafeInteger(entry.marks))student.marks=entry.marks;});
    }
    function accept(result, initial, notify, applyMarks) {
      if(dead)return;
      var accepted=result.mission&&(!data||result.mission.revision>=data.revision);
      if(accepted)data=result.mission;
      var answer=result.answer;
      if(answer&&questionContext&&answer.spinId===questionContext.spinId&&answer.missionId===questionContext.missionId&&Number.isSafeInteger(answer.revision)) {
        questionContext.missionRevision=Math.max(questionContext.missionRevision,answer.revision);saveQuestion();
      }
      var award=data&&data.lastPayout;
      if(award&&award.id!==payout) {
        // Historical payout balances are not current marks, particularly after
        // a lost reply or another legitimate award. Canonical balances win.
        if(!initial&&applyMarks&&accepted&&!result.duplicate&&!Array.isArray(result.balances))applyBalances(award.awards);
        payout=award.id;
      }
      if(!initial&&applyMarks&&accepted&&Array.isArray(result.balances))applyBalances(result.balances);
      if(!initial&&applyMarks&&result.award)applyBalances([result.award]);
      if(options.onChange&&notify)options.onChange(result);
    }
    function refresh(fresh) {
      if(dead||busy)return Promise.resolve(false);
      // A new wheel question needs one fresh server read. Snapshot refreshes
      // must not supersede that request while its wheel animation is running.
      if(questionRead)return questionRead;
      var version=++readVersion,initial=!data;
      if(fresh===true){loading=true;render();if(options.onBusy)options.onBusy();}
      var read=Promise.resolve().then(async function () {
        try {
          var result=await options.store.mission({command:'get'});
          if(dead||version!==readVersion)return false;
          accept(result,initial,false);readError='';if(fresh===true)questionReadFailed=false;return true;
        } catch(e) {
          if(!dead&&version===readVersion){readError=e.message||'Could not load the class mission.';if(fresh===true)questionReadFailed=true;}
          return false;
        } finally {
          if(questionRead===read)questionRead=null;
          if(!dead&&version===readVersion){loading=false;render();if(options.onBusy)options.onBusy();}
        }
      });
      if(fresh===true)questionRead=read;
      return read;
    }
    function render() {
      if(dead)return;
      var drawer=host.parentElement&&host.parentElement.matches('details.cbMissionDrawer')?host.parentElement:null;
      if(drawer){if(pending)drawer.open=true;var label=drawer.querySelector('summary');label.textContent='Mission machine · '+(pending?'retry save':data&&data.current&&data.current.status==='active'?data.current.progress+' / '+data.current.target+' · '+data.current.objectiveName:'class quests');}
      var current=data&&data.current, active=current&&current.status==='active', ready=canAct(), encounter=options.getState(), spin=options.getSpinId&&options.getSpinId();
      var minutes=current&&current.objectiveId==='focus'?Math.max(0,Math.ceil((current.focusReadyAt-Date.now())/60000)):0;
      var progress=current?current.objectiveId==='focus'?(minutes?minutes+' minutes remaining':'30 minutes elapsed · confirm focus below'):current.progress+' / '+current.target:'';
      var available=(data&&data.bank||[]).filter(function (p) {return p.status==='available';});
      host.innerHTML='<section class="mmPanel" aria-label="Class mission machine"><div class="mmHeading"><span class="mmMachine'+(busy?' mmRolling':'')+'" role="img" aria-label="Pixel mission slot machine"></span><div><span class="mmEyebrow">WHOLE CLASS QUEST</span><h3>Mission machine</h3><p>Turn for a random objective and a class prize.</p></div></div><div class="mmReels" aria-live="polite"><div><small>OBJECTIVE</small><strong>'+esc(current?current.objectiveName:'A new challenge awaits')+'</strong>'+(current?'<span>'+esc(progress)+' · '+esc(current.status)+'</span>':'')+'</div><div class="'+(current&&current.prize.rare?'mmRare':'')+'"><small>CLASS PRIZE'+(current&&current.prize.rare?' · RARE':'')+'</small><strong>'+esc(current?current.prize.name:'Blooket, Gimkit, points or a summon')+'</strong></div></div><div class="mmActions"><button type="button" data-mm="turn"'+(!ready||active?' disabled':'')+'>↻ Turn</button>'+(active?'<button type="button" data-mm="cancel"'+(!ready?' disabled':'')+'>Cancel mission</button>':'')+(active&&current.objectiveId==='focus'?'<button type="button" data-mm="focus"'+(!ready||minutes?' disabled':'')+'>Confirm 30 focused minutes</button>':'')+(active&&current.objectiveId==='correct-streak'&&spin?'<button type="button" data-mm="incorrect"'+(!ready?' disabled':'')+'>Incorrect answer · reset streak</button>':'')+'</div>'+(active&&current.objectiveId==='focus'?'<p class="mmHint">The timer starts when this mission is saved. The teacher confirms the class stayed focused and quiet.</p>':'')+'<div class="mmSummon"><strong>One-Punch Chung</strong><span>'+(data?data.summonTokens:0)+' earned summon'+(data&&data.summonTokens===1?'':'s')+'</span><button type="button" data-mm="summon" data-source="reward"'+(!ready||!encounter||encounter.status!=='active'||!(data&&data.summonTokens)?' disabled':'')+'>Use earned summon</button><button type="button" data-mm="summon" data-source="teacher"'+(!ready||!encounter||encounter.status!=='active'?' disabled':'')+'>Teacher help · one punch</button></div>'+(available.length?'<details class="mmBank" open><summary>Class prize bank · '+available.length+'</summary>'+available.map(function (prize) {return '<article><div><strong>'+esc(prize.name)+'</strong><small>'+(prize.kind==='summon'?'Use the summon button during an encounter.':'For the entire class · teacher marks as used')+'</small></div>'+(prize.kind==='minutes'?'<button type="button" data-mm="redeem" data-prize="'+esc(prize.id)+'"'+(!ready?' disabled':'')+'>Mark as used</button>':'')+'</article>';}).join('')+'</details>':'')+'<p class="mmStatus" role="status">'+'</p>'+(pending?'<button type="button" data-mm="retry"'+(busy||loading||!options.canAct()?' disabled':'')+'>Retry saved request</button>':'')+'</section>';
      var status=host.querySelector('.mmStatus');status.textContent=busy?'Saving class mission…':pending?(error?error+' ':'')+'A save needs confirmation. Retry keeps the same roll or prize.':error||readError|| (loading?'Loading saved class mission…':current&&current.status==='complete'?'Mission complete! The class prize is saved.':'Progress and prizes save for this Lesson slot.');
      if(readError&&!data&&!loading) {var retryLoad=document.createElement('button');retryLoad.type='button';retryLoad.dataset.mm='load';retryLoad.textContent='Retry loading mission';host.querySelector('.mmPanel').appendChild(retryLoad);}
    }
    async function send(command, extra, retry) {
      if(dead||busy||loading||!data||!options.canAct())return;
      if(!retry&&pending)return;
      if(!retry) {
        var current=data&&data.current;
        pending=Object.assign({command:command,id:'mission-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),expectedRevision:data?data.revision:0},current?{missionId:current.id}:{},extra||{});
        if(command==='incorrect') {
          var spin=options.getSpinId(),answer=getAnswerContext(spin);
          if(!answer||!answer.missionId||!current||answer.missionId!==current.id){pending=null;error='Spin a new question for the current mission before resetting its streak.';render();return;}
          pending.spinId=spin;pending.missionId=answer.missionId;pending.expectedRevision=answer.missionRevision;
        }
        if(command==='summon') {var encounter=options.getState();pending.encounterId=encounter&&encounter.encounterId;pending.expectedRevision=encounter&&encounter.revision;}
      }
      if(!pending)return;
      var request=JSON.parse(JSON.stringify(pending));
      try {sessionStorage.setItem(key,JSON.stringify(request));}catch(_){pending=null;error='Enable session storage to save and retry class prizes safely.';render();return;}
      busy=true;error='';readVersion++;render();if(options.onBusy)options.onBusy();
      try {
        var result, summonEvent=null;
        if(request.command==='summon') {var next=await options.store.act(Object.assign({},request,{type:'summon'}));result={state:next};}
        else result=await options.store.mission(request);
        if(dead)return;
        var stored=JSON.parse(sessionStorage.getItem(key)||'null');if(stored&&stored.id===request.id)sessionStorage.removeItem(key);
        pending=null;accept(result,false,true,true);
        if(request.command==='summon'&&result.state&&result.state.lastEvent&&result.state.lastEvent.id===request.id)summonEvent=result.state.lastEvent;
      } catch(e) {
        if(dead)return;
        error=e.message||'Could not confirm this save.';
        if(['focus_not_ready','invalid_summon','summon_unavailable','teacher_required','invalid_balance','encounter_active','invalid_action','invalid_mission','invalid_slot','mission_changed','mission_active','mission_missing','mission_not_ready','invalid_prize','prize_unavailable','no_summon','battle_changed','encounter_inactive','pending_answer','roster_changed','invalid_command'].includes(e.code)) {pending=null;sessionStorage.removeItem(key);}
      } finally {if(!dead){busy=false;render();if(options.onBusy)options.onBusy();if(!pending)refresh();if(summonEvent&&options.onSummon)options.onSummon(summonEvent,result.state.encounterId);}}
    }
    function click(event) {var button=event.target.closest('[data-mm]');if(!button||button.disabled)return;var command=button.dataset.mm;if(command==='load'){loading=true;readError='';render();refresh();return;}send(command,command==='summon'?{source:button.dataset.source}:command==='redeem'?{prizeId:button.dataset.prize}:{},command==='retry');}
    host.addEventListener('click',click);timer=setInterval(function(){if(data&&data.current&&data.current.objectiveId==='focus')render();},15000);
    render();refresh();
    return {receive:function(result){accept(result,false,false,true);render();},question:question,getAnswerContext:getAnswerContext,refresh:refresh,render:render,blocked:blocked,destroy:function(){dead=true;readVersion++;clearInterval(timer);host.removeEventListener('click',click);host.innerHTML='';}};
  }
  root.ClassroomMissionMachine={mount:mount};
})(typeof window!=='undefined'?window:globalThis);
