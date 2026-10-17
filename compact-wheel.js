/* A compact view of the existing picker. Reels never select names or resolve combat. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(null);
  else root.CompactWheel=factory(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  var ROW=42,CENTER=17,homes=new Map(),mounted=false,spinId='',progress=0,plan=null;
  function reelPlan(names,winner){
    var pool=(names||[]).map(String);if(!pool.length)pool=[winner||'Ready'];
    var faces=Array.from({length:46},function(_,i){return pool[i%pool.length];});
    faces.push(String(winner||pool[0]),pool[0]);
    return {faces:faces,target:faces.length-2};
  }
  function offset(value,target){var k=Math.max(0,Math.min(1,Number(value)||0));return CENTER-(1+(target-1)*(1-Math.pow(1-k,4)))*ROW;}
  function el(id){return root.document.getElementById(id);}
  function move(id,target){
    var node=el(id);if(!node||!target)return;
    if(!homes.has(id)){var anchor=root.document.createComment('compact home: '+id);node.parentNode.insertBefore(anchor,node);homes.set(id,anchor);}
    if(node.parentNode!==target)target.appendChild(node);
  }
  function restore(){homes.forEach(function(anchor,id){var node=el(id);if(node&&anchor.parentNode&&node.parentNode!==anchor.parentNode)anchor.parentNode.insertBefore(node,anchor.nextSibling);});}
  function mount(){
    if(mounted||!root||!el('wheelCard'))return;mounted=true;
    var panel=root.document.createElement('section');panel.id='wheelCompact';panel.className='cwMini';panel.hidden=true;
    panel.setAttribute('aria-label','Compact name slots and battle');
    panel.innerHTML='<div class="cwMain"><div class="cwPicker"><span class="cwEyebrow">CALL A HERO</span><div class="cwReel"><span class="cwPointer" aria-hidden="true">▸</span><div class="cwSlot" aria-hidden="true"><div class="cwStrip" id="cwStrip"></div></div><span class="cwPointer" aria-hidden="true">◂</span></div><span id="cwWinnerLive" class="cwSr" role="status" aria-live="polite"></span><button type="button" id="cwSpin" class="btn btnPrimary">Turn</button><span id="cwRound" class="cwRound"></span></div><div class="cwBattle" id="cwBattle"><p id="cwBattleEmpty">Turn to meet the next enemy.</p></div></div><div id="cwAwards" class="cwAwards"></div><div class="cwFeedback" id="cwFeedback"></div>';
    el('wheelCard').insertBefore(panel,el('wheelGrip'));
    el('cwSpin').addEventListener('click',function(){if(!el('wheelSpinBtn').disabled)root.wheelSpin();});
    if(root.MutationObserver)new root.MutationObserver(syncButton).observe(el('wheelSpinBtn'),{attributes:true,attributeFilter:['disabled']});
  }
  function syncButton(){if(mounted)el('cwSpin').disabled=el('wheelSpinBtn').disabled||!root.wheelTeacher();}
  function paintFaces(faces){var strip=el('cwStrip');strip.replaceChildren();faces.forEach(function(name){var face=root.document.createElement('strong');face.className='cwFace';face.textContent=name;strip.appendChild(face);});}
  function frame(k){progress=k;if(!mounted||!root.wheelMin||!root.wheelSpinning||!plan)return;if(root.matchMedia('(prefers-reduced-motion: reduce)').matches)k=1;el('cwStrip').style.transform='translateY('+offset(k,plan.target)+'px)';}
  function refresh(){
    if(!root)return;mount();if(!mounted)return;
    var active=!!root.wheelMin&&root.wheelIsOpen()&&!(root.ClassroomBattle&&root.ClassroomBattle.isOpen());
    el('wheelCompact').hidden=!active;
    if(!active){restore();return;}
    move('wheelQuickDuel',el('cwBattle'));move('wheelQuickStatus',el('cwFeedback'));move('wheelQuickRetry',el('cwFeedback'));move('wheelAward',el('cwAwards'));
    if(el('wheelQuickStatus'))el('wheelQuickStatus').title=el('wheelQuickStatus').textContent;
    syncButton();
    var duel=el('wheelQuickDuel'),empty=el('cwBattleEmpty');empty.hidden=!!duel&&!duel.hidden;
    empty.textContent=root.QuickBattle&&!root.QuickBattle.enabled()?'Quick fight is off. Restore the window to enable it.':'Choose a lesson slot in the full wheel to show your party.';
    var st=root.wheelState,entry=st&&st.names[root.wheelWinnerIdx],newId=st&&st.lastSpinId||'';
    el('cwRound').textContent=el('wheelRound').textContent;el('cwRound').title=el('wheelRound').textContent;
    el('cwSpin').textContent=root.wheelSpinning?'Turning…':'Turn';
    el('wheelCompact').classList.toggle('cwTurning',!!root.wheelSpinning);
    if(root.wheelSpinning){
      if(newId!==spinId||!plan){spinId=newId;progress=0;plan=reelPlan(root.wheelSegs||[],entry&&entry.n);paintFaces(plan.faces);}
      frame(progress);el('cwWinnerLive').textContent='Choosing a student…';
    }else{
      plan=null;paintFaces([entry?entry.n:'Ready to turn']);el('cwStrip').style.transform='translateY('+CENTER+'px)';
      el('cwWinnerLive').textContent=entry?entry.n+' selected.':'Ready to choose a student.';
    }
  }
  function stop(){progress=0;plan=null;restore();if(mounted)el('wheelCompact').hidden=true;}
  return {refresh:refresh,frame:frame,stop:stop,reelPlan:reelPlan,offset:offset};
});
