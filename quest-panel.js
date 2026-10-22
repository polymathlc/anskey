/* Teacher-recorded class decisions; every choice uses the battle API receipt. */
(function () {
  'use strict';
  var C=window.ClassroomBattleCore;
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function uuid(){return crypto.randomUUID();}
  function mount(host,options){
    var destroyed=false,busy=false,pending=null,error='',selected='',expanded=false,lastBurst='';
    var key='polymath.questChoice.'+options.teacherId+'.'+encodeURIComponent(options.classId);
    try{pending=JSON.parse(sessionStorage.getItem(key)||'null');if(pending && (pending.type!=='quest'||!/^[a-zA-Z0-9_-]{8,100}$/.test(pending.id||'')))pending=null;}catch(_){}
    function persist(){try{if(pending)sessionStorage.setItem(key,JSON.stringify(pending));else sessionStorage.removeItem(key);}catch(_){} }
    function blocked(){return busy||!!pending;}
    function button(text,attrs,disabled){return '<button type="button" '+attrs+(disabled?' disabled':'')+'>'+text+'</button>';}
    function render(){
      if(destroyed)return;
      var state=options.getState(),j=state&&state.journey,heroes=(state&&state.heroes||[]).filter(function(h){return !options.isEligible || options.isEligible(h);});
      var active=state&&state.status==='active',disabled=busy||!!pending||!options.canAct()||!!(state&&state.pending);
      if(!heroes.some(function(h){return h.id===selected;}))selected=heroes[0]&&heroes[0].id||'';
      var hero=heroes.find(function(h){return h.id===selected;}),combo=state&&state.combo,intent=C.bossIntentFor(state);
      var event=state&&state.lastEvent,burst=event&&event.comboBurst;
      var animate=burst&&event.id!==lastBurst;if(animate)lastBurst=event.id;
      var html='<section class="qpPanel" aria-label="Class adventure decisions"><div class="qpTitle"><span class="qpCompass" aria-hidden="true">✦</span><div><small>OUR CLASS ADVENTURE</small><h3>'+(j?'Chapter '+j.chapter+(j.node===4?' · Guardian ahead':''):'A new adventure awaits')+'</h3></div>'+button(expanded?'Hide choices':'Open choices','data-quest-expand aria-expanded="'+expanded+'"',false)+'</div>';
      if(j){
        html+='<ol class="qpMap" aria-label="Five encounter chapter">'+Array.from({length:5},function(_,i){return '<li class="'+(i<j.node?'qpDone':i===j.node?'qpHere':'')+'"><span>'+(i<j.node?'✓':i===4?'♜':i+1)+'</span><small>'+(i===4?'Boss':i===j.node?'Here':i<j.node?'Cleared':'Trail')+'</small></li>';}).join('')+'</ol><p class="qpSaved">'+j.totalWins+' victories · progress saved between lessons'+(j.route?' · '+esc(C.QUEST_ROUTES[j.route].name):'')+'</p>';
      }else html+='<p>Start your next encounter to unlock route votes, team combos and personal treasure choices.</p>';
      if(combo){
        html+='<div class="qpCombo '+(combo.paused?'qpPaused':'')+'" aria-label="Team combo"><div><strong>'+(combo.paused?'Combo paused — explain and recover':'Team combo · '+combo.count+'/5')+'</strong><small>Take turns: 3 = Together strike · 5 = Class constellation + party healing</small></div><div class="qpPips" aria-hidden="true">'+Array.from({length:5},function(_,i){return '<i class="'+(i<combo.count?'qpLit':'')+'"></i>';}).join('')+'</div></div>';
      }
      if(burst)html+='<div class="qpBurst '+(animate?'qpBurstNew':'')+'" role="status"><span aria-hidden="true">✦ ✧ ✦</span> '+esc(burst.name)+'! '+(burst.level===5?'The whole class lights up the battlefield.':'A bonus strike hits every standing enemy.')+'</div>';
      if(intent){html+='<div class="qpIntent '+(intent.ultimate?'qpDanger':'')+'"><strong>'+(intent.ultimate?'⚠ Ultimate ready':intent.charging?'⚠ Ultimate charging':'Enemy plans')+'</strong>'+intent.attacks.map(function(a){return '<p>'+esc(a.name)+': '+esc(a.move)+' → '+esc(a.aoe?'all active heroes':a.targets.join(', ')||'the next called team')+'</p>';}).join('')+'<small>'+esc(intent.advice)+'</small></div>';}
      var inboxCount=heroes.reduce(function(n,h){return n+(h.treasureInbox||[]).length;},0);
      if(inboxCount)html+='<p class="qpPrizeNotice">✧ '+inboxCount+' personal treasure choice'+(inboxCount===1?'':'s')+' waiting. '+button('Choose treasure','data-quest-open',false)+'</p>';
      html+='<div class="qpDetails"'+(!expanded?' hidden':'')+'>';
      if(heroes.length)html+='<label class="qpStudent">Student making a choice <select data-quest-student'+(busy?' disabled':'')+'>'+heroes.map(function(h){return '<option value="'+esc(h.id)+'"'+(h.id===selected?' selected':'')+'>'+esc(h.name)+'</option>';}).join('')+'</select></label>';
      if(j && !active){
        var votes=Object.entries(j.votes).filter(function(pair){return heroes.some(function(h){return h.id===pair[0];});});
        html+='<h4>Class route vote</h4><p>Record one vote per present student. The teacher confirms the majority route or breaks a tie.</p><div class="qpChoices">'+C.routeOptions(state).map(function(id){var route=C.QUEST_ROUTES[id],count=votes.filter(function(pair){return pair[1]===id;}).length;return '<article class="qpRoute" style="--qp-scene:url(assets/battle-pixel/adventure/'+route.biome+'.png)"><strong>'+esc(route.name)+'</strong><p>'+esc(route.description)+'</p><small>'+count+' vote'+(count===1?'':'s')+(j.votes[selected]===id?' · your recorded vote':'')+'</small>'+button('Vote for this route','data-quest-command="vote" data-route-id="'+id+'"',disabled||!hero||!!j.route)+button(j.route===id?'✓ Route chosen':'Take this route','data-quest-command="route" data-route-id="'+id+'"',disabled||!!j.route)+'</article>';}).join('')+'</div>';
        if(j.event){var surprise=j.event,definition=C.QUEST_EVENTS[surprise.kind];html+='<div class="qpSurprise"><span class="qpEventArt qpEvent-'+esc(surprise.kind)+'" aria-hidden="true">'+(surprise.kind==='creature'?'♥':surprise.kind==='merchant'?'✧':'◆')+'</span><div><h4>'+esc(definition.name)+'</h4><p>'+esc(definition.description)+'</p></div></div><div class="qpChoices">'+definition.choices.map(function(choice){return '<article><strong>'+esc(choice.name)+'</strong><p>'+esc(choice.description)+'</p>'+button(surprise.choice===choice.id?'✓ Gift saved':'Choose gift','data-quest-command="event" data-choice-id="'+choice.id+'"',disabled||!!surprise.choice)+'</article>';}).join('')+'</div>';}
      }
      if(j&&active){html+='<h4>Prepare together</h4><p>Choose once before each enemy turn. The benefit activates with the next correct answer, or when the enemy attacks. Attack preparation needs a correct answer first.</p><div class="qpTactics">'+[['shield','Shield · 20% HP'],['heal','Heal · 15% HP'],['attack','Power up · 3% enemy HP']].map(function(pair){return button(pair[1],'data-quest-command="prepare" data-choice-id="'+pair[0]+'" aria-pressed="'+!!(state.preparation&&state.preparation.bossTurn===state.bossTurns&&state.preparation.choice===pair[0])+'"',disabled||!!(state.preparation&&state.preparation.bossTurn===state.bossTurns));}).join('')+'</div>';}
      if(combo&&combo.paused)html+='<p class="qpRecovery">A wrong answer keeps the meter. Let the student explain the correction, or select the teammate who helped.</p>'+button('✓ Explanation complete — resume combo','data-quest-command="recover"',disabled||!hero);
      if(hero){
        var prize=(hero.treasureInbox||[])[0];
        html+='<h4>'+esc(hero.name)+'’s treasure</h4>';
        if(prize)html+='<p>Choose one extra reward. Ordinary victory loot and bonus runes are already saved. '+hero.treasureInbox.length+' unopened.</p><div class="qpChoices qpRewards">'+prize.options.map(function(choice){var item=choice.itemId&&C.itemById(choice.itemId);return '<article>'+(item&&window.ClassroomBattleDisplay?ClassroomBattleDisplay.itemIcon(item):'<span class="qpShard" aria-hidden="true">✧</span>')+'<strong>'+esc(item?item.name:'3 star shards')+'</strong><small>'+esc(item?item.rarity+' · '+choice.id:'Equipment upgrade materials')+'</small><p>'+esc(item?item.description:'Save shards to forge a piece of equipment into the next rarity.')+'</p>'+button('Choose this reward','data-quest-command="treasure" data-treasure-id="'+esc(prize.id)+'" data-choice-id="'+choice.id+'"',disabled)+'</article>';}).join('')+'</div>';
        else html+='<p>No unopened choices. Win another encounter to earn one.</p>';
        html+='<p>✧ Star shards: '+(hero.upgradeShards||0)+'</p>';
        if(!active&&(hero.upgradeShards||0)>=3){
          var forgeable=hero.inventory.filter(function(entry){var item=C.itemById(entry.itemId);return C.equipmentSlot(item)&&!['mythical','unique'].includes(item.rarity)&&!C.socketsFor(entry).some(Boolean);});
          if(forgeable.length)html+='<label class="qpStudent">Equipment to upgrade <select data-quest-forge>'+forgeable.map(function(entry){var item=C.itemById(entry.itemId),cost=(Object.keys(C.RARITIES).indexOf(item.rarity)+1)*3;return '<option value="'+esc(entry.id)+'">'+esc(item.name)+' · '+cost+' shards</option>';}).join('')+'</select></label>'+button('Forge into the next rarity','data-quest-command="forge"',disabled);
        }
      }
      html+='</div>';
      if(error)html+='<p class="qpError" role="alert">'+esc(error)+'</p>';
      if(pending)html+='<p class="qpRetry">'+(busy?'Saving your choice…':'Choice needs confirmation. Retry the same saved request.')+'</p>'+button('Confirm saved choice','data-quest-retry',busy||!options.canAct());
      html+='</section>';
      var focus=document.activeElement&&host.contains(document.activeElement)?document.activeElement:null,command=focus&&focus.dataset.questCommand,choice=focus&&focus.dataset.choiceId;
      host.innerHTML=html;
      if(command){var next=[...host.querySelectorAll('[data-quest-command]')].find(function(n){return n.dataset.questCommand===command&&n.dataset.choiceId===choice&&!n.disabled;});if(next)next.focus({preventScroll:true});}
    }
    async function send(action,retry){
      if(destroyed||busy||!options.canAct())return;
      var state=options.getState();if(!state)return;
      if(!retry){if(pending)return;pending=Object.assign({type:'quest',id:uuid(),encounterId:state.encounterId,expectedRevision:state.revision,heroId:selected},action);persist();}
      if(!pending)return;
      var request=JSON.parse(JSON.stringify(pending));busy=true;error='';options.onBusy();render();
      try{var next=await options.store.act(request);if(destroyed)return;pending=null;persist();options.onChange(next);}
      catch(e){if(destroyed)return;error=e.message;if(e.status>=400&&e.status<500){pending=null;persist();}}
      finally{busy=false;if(!destroyed){options.onBusy();render();}}
    }
    function click(event){var button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-quest-expand')){expanded=!expanded;render();return;}
      if(button.hasAttribute('data-quest-open')){expanded=true;render();return;}
      if(button.hasAttribute('data-quest-retry')){send(null,true);return;}
      if(button.dataset.questCommand){var d=button.dataset,action={command:d.questCommand};['choiceId','routeId','treasureId'].forEach(function(k){if(d[k])action[k]=d[k];});if(action.command==='forge')action.itemId=host.querySelector('[data-quest-forge]').value;send(action,false);}
    }
    function change(event){if(event.target.hasAttribute('data-quest-student')){selected=event.target.value;render();}}
    host.addEventListener('click',click);host.addEventListener('change',change);render();
    return {render:render,blocked:blocked,destroy:function(){destroyed=true;host.removeEventListener('click',click);host.removeEventListener('change',change);host.innerHTML='';}};
  }
  window.ClassroomQuestPanel={mount:mount};
})();
