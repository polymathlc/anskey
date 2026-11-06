/* Compact presentation: saved picks, live battle and canonical point awards.

   v1.189.0 — the compact window is the wheel quest's DEFAULT view and it SCALES.
   The window can be dragged to any size; one number, --cw-k, is worked out from
   the window's own width and height (scaleFor) and every font, reel row, button,
   bar and picture in compact-wheel.css is a multiple of it, so the text and the
   characters always grow and shrink together. A window much taller than it is
   wide switches to a stacked layout (data-cw-layout="tall"), which has its own
   base size, so a narrow column is not read as a tiny wide window.

   Nothing here picks a student, resolves combat or awards points: the reel
   still only shows the pick wheelSpin already saved, and + still calls the
   canonical wheelGive. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(null);
  else root.CompactWheel=factory(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  var ROW=42,CENTER=17,homes=new Map(),mounted=false,spinId='',progress=0,plan=null;

  /* ---- Scale: one number for every size in the compact window (pure) ----
     BASE is the window size at which --cw-k is exactly 1, per layout. The scale
     is the SMALLER of the two ratios, so nothing ever outgrows the window in
     either direction; the pictures then fill whatever room is left over through
     container units. K_MIN keeps a tiny window legible, K_MAX keeps a huge
     one from turning into a poster of one letter. */
  var BASE={wide:{w:620,h:280},tall:{w:340,h:480}};
  var K_MIN=0.5,K_MAX=5,TALL_BELOW=1.15;
  /* The smallest box the compact window may be dragged down to. */
  var MIN_W=240,MIN_H=170;
  function scaleFor(w,h){
    w=Number(w);h=Number(h);
    if(!(isFinite(w)&&isFinite(h)&&w>0&&h>0))return {layout:'wide',k:1};
    var layout=w/h<TALL_BELOW?'tall':'wide',base=BASE[layout];
    var k=Math.min(w/base.w,h/base.h);
    k=Math.max(K_MIN,Math.min(K_MAX,k));
    return {layout:layout,k:Math.round(k*1000)/1000};
  }
  /* Where a fresh compact window lands when nothing was remembered: near the
     full wheel's corner, the base size on a computer, stacked and taller on a
     phone so the characters are not drawn at half size. */
  function defaultBox(vw,vh,anchor){
    vw=Number(vw)||1024;vh=Number(vh)||768;
    var narrow=vw<560;
    var w=narrow?Math.min(vw-16,BASE.tall.w+40):Math.min(BASE.wide.w,vw-24);
    var h=narrow?Math.min(vh-24,BASE.tall.h):BASE.wide.h;
    var x=anchor&&isFinite(anchor.x)?anchor.x:12,y=anchor&&isFinite(anchor.y)?anchor.y:12;
    return {x:Math.max(8,Math.min(x,vw-w-8)),y:Math.max(8,Math.min(y,vh-h-8)),w:Math.max(MIN_W,Math.round(w)),h:Math.max(MIN_H,Math.round(h))};
  }

  function reelPlan(names,winner){
    var pool=(names||[]).map(String);if(!pool.length)pool=[winner||'Ready'];
    var faces=Array.from({length:46},function(_,i){return pool[i%pool.length];});
    faces.push(String(winner||pool[0]),pool[0]);
    return {faces:faces,target:faces.length-2};
  }
  function offset(value,target){var k=Math.max(0,Math.min(1,Number(value)||0));return CENTER-(1+(target-1)*(1-Math.pow(1-k,4)))*ROW;}
  /* The reel is laid out at base size and multiplied by --cw-k, so the
     transform is too: the pure offset stays in base pixels. */
  function reelTransform(px){return 'translateY(calc('+(Math.round(px*100)/100)+'px * var(--cw-k, 1)))';}

  var POINTS_KEY='polymath.wheelCompactPoints.v1',pointsDraft='1';
  function pointAmount(value){
    if(typeof value!=='string'&&typeof value!=='number')return null;
    var amount=Number(value);
    return Number.isSafeInteger(amount)&&amount>=1&&amount<=10000?amount:null;
  }
  if(root)try{var saved=pointAmount(root.localStorage.getItem(POINTS_KEY));if(saved!==null)pointsDraft=String(saved);}catch(_){}
  function renderAward(award,student,busy){
    var controls=root.document.createElement('div');controls.className='cwPointControls';
    var label=root.document.createElement('label');label.htmlFor='cwPoints';label.textContent='Points';
    var input=root.document.createElement('input');input.id='cwPoints';input.type='number';input.min='1';input.max='10000';input.step='1';input.inputMode='numeric';input.value=pointsDraft;input.disabled=busy;input.setAttribute('aria-label','Points to give');
    var button=root.document.createElement('button');button.id='cwGive';button.type='button';button.className='rwAmount btnPrimary';button.textContent='+';
    function sync(){
      pointsDraft=input.value;var amount=pointAmount(pointsDraft);
      input.setCustomValidity(amount===null?'Enter a whole number from 1 to 10,000.':'');
      button.disabled=!!busy||amount===null;
      button.title=amount===null?'Enter points to give':'Give '+amount+' point'+(amount===1?'':'s')+' to '+student.name;
      button.setAttribute('aria-label',button.title);
      if(amount!==null)try{root.localStorage.setItem(POINTS_KEY,String(amount));}catch(_){}
    }
    function give(){
      if(button.disabled||!root.wheelMin||!root.wheelIsOpen())return;
      var amount=pointAmount(input.value);if(amount===null)return;
      root.wheelGive(amount);
    }
    input.addEventListener('input',sync);input.addEventListener('change',sync);
    input.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();give();}});
    button.addEventListener('click',give);sync();
    controls.append(label,input,button);
    var note=root.document.createElement('div');note.className='whAwardNote';
    note.textContent=(student.marks||0)+((student.marks||0)===1?' mark':' marks')+' now'+(root.wheelGiven?' · +'+root.wheelGiven+' from this turn':'');
    award.replaceChildren(controls,note);
  }
  function el(id){return root.document.getElementById(id);}
  function move(id,target){
    var node=el(id);if(!node||!target)return;
    if(!homes.has(id)){var anchor=root.document.createComment('compact home: '+id);node.parentNode.insertBefore(anchor,node);homes.set(id,anchor);}
    if(node.parentNode!==target)target.appendChild(node);
  }
  function restore(){homes.forEach(function(anchor,id){var node=el(id);if(node&&anchor.parentNode&&node.parentNode!==anchor.parentNode)anchor.parentNode.insertBefore(node,anchor.nextSibling);});}

  /* ---- Fit: hand the scale to the CSS ----
     Called with the box the window is being set to (applyWheelWin, every
     pointermove of a drag), and again by a ResizeObserver for anything else
     that changes the card's size (the viewport clamping it, a font load). The
     card carries the numbers, so the title bar and the resize corner scale
     with the panel. */
  var lastFit='';
  function fit(box){
    if(!root)return null;
    var card=el('wheelCard');if(!card)return null;
    var w=box&&box.w,h=box&&box.h;
    if(!(w>0&&h>0)){var r=card.getBoundingClientRect();w=r.width;h=r.height;}
    var s=scaleFor(w,h),sig=s.layout+':'+s.k;
    if(sig!==lastFit){
      lastFit=sig;
      card.style.setProperty('--cw-k',String(s.k));
      card.dataset.cwLayout=s.layout;
      var panel=el('wheelCompact');if(panel)panel.dataset.cwLayout=s.layout;
    }
    return s;
  }
  function clearFit(){
    lastFit='';
    var card=el('wheelCard');if(!card)return;
    card.style.removeProperty('--cw-k');delete card.dataset.cwLayout;
  }

  /* ---- Lesson slot inside the compact window ----
     The window now opens compact, so the Lesson slot must be reachable
     without restoring the full wheel. This is a mirror of #wheelClassSelect:
     the options are copied from it and a change is handed BACK to it as an
     ordinary change event, so wheelSetClass stays the one door. */
  var classSig='';
  function syncClass(){
    var mine=el('cwClass'),full=el('wheelClassSelect');if(!mine||!full)return;
    var sig=Array.prototype.map.call(full.options,function(o){return o.value+'\u0001'+o.textContent;}).join('\u0002');
    if(sig!==classSig){
      classSig=sig;mine.replaceChildren();
      Array.prototype.forEach.call(full.options,function(o){
        var copy=root.document.createElement('option');copy.value=o.value;copy.textContent=o.value?o.textContent:'— no lesson slot —';mine.appendChild(copy);
      });
    }
    if(mine.value!==full.value)mine.value=full.value;
    mine.disabled=!!root.wheelSpinning||!root.wheelTeacher()||!full.options.length||!!(root.wheelGuestsBusy&&root.wheelGuestsBusy());
    mine.title=full.value?'Lesson slot: '+full.value:'Choose a Lesson slot to show your party';
  }
  function classChosen(){
    var mine=el('cwClass'),full=el('wheelClassSelect');if(!mine||!full||mine.disabled)return;
    if(!root.wheelTeacher()||root.wheelSpinning)return;
    if(full.value===mine.value)return;
    full.value=mine.value;
    if(full.value!==mine.value){mine.value=full.value;return;}
    full.dispatchEvent(new root.Event('change',{bubbles:true}));
  }

  function mount(){
    if(mounted||!root||!el('wheelCard'))return;mounted=true;
    var panel=root.document.createElement('section');panel.id='wheelCompact';panel.className='cwMini';panel.hidden=true;
    panel.setAttribute('aria-label','Compact name slots and battle');
    panel.innerHTML='<div class="cwMain"><div class="cwPicker"><span class="cwEyebrow">CALL A HERO</span><div class="cwReel"><span class="cwPointer" aria-hidden="true">▸</span><div class="cwSlot" aria-hidden="true"><div class="cwStrip" id="cwStrip"></div></div><span class="cwPointer" aria-hidden="true">◂</span></div><span id="cwWinnerLive" class="cwSr" role="status" aria-live="polite"></span><button type="button" id="cwSpin" class="btn btnPrimary">Turn</button><span id="cwRound" class="cwRound"></span><label class="cwClassWrap"><span class="cwSr">Lesson slot</span><select id="cwClass" class="cwClass" aria-label="Lesson slot"></select></label></div><div class="cwBattle" id="cwBattle"><p id="cwBattleEmpty">Turn to meet the next enemy.</p></div></div><div id="cwAwards" class="cwAwards"></div><div class="cwFeedback" id="cwFeedback"></div>';
    el('wheelCard').insertBefore(panel,el('wheelGrip'));
    el('cwSpin').addEventListener('click',function(){if(!el('wheelSpinBtn').disabled)root.wheelSpin();});
    el('cwClass').addEventListener('change',classChosen);
    if(root.MutationObserver){
      new root.MutationObserver(syncButton).observe(el('wheelSpinBtn'),{attributes:true,attributeFilter:['disabled']});
      new root.MutationObserver(function(){if(root.wheelMin)syncClass();}).observe(el('wheelClassSelect'),{childList:true});
    }
    if(root.ResizeObserver)new root.ResizeObserver(function(){if(root.wheelMin&&root.wheelIsOpen())fit();}).observe(el('wheelCard'));
  }
  function syncButton(){
    if(!mounted)return;
    var teacher=root.wheelTeacher();el('cwSpin').disabled=el('wheelSpinBtn').disabled||!teacher;
    var input=el('cwPoints'),button=el('cwGive');
    if(input&&button)button.disabled=input.disabled||!teacher||pointAmount(input.value)===null;
  }
  function paintFaces(faces){var strip=el('cwStrip');strip.replaceChildren();faces.forEach(function(name){var face=root.document.createElement('strong');face.className='cwFace';face.textContent=name;strip.appendChild(face);});}
  function frame(k){progress=k;if(!mounted||!root.wheelMin||!root.wheelSpinning||!plan)return;if(root.matchMedia('(prefers-reduced-motion: reduce)').matches)k=1;el('cwStrip').style.transform=reelTransform(offset(k,plan.target));}
  /* How many heroes and enemies the battle box is showing, written on the
     panel so the CSS can give a crowded team smaller text before it gives it
     smaller pictures. */
  function countTeams(){
    var battle=el('cwBattle');if(!battle)return;
    var heroes=battle.querySelectorAll('.cbActiveTeam>.cbQuickHero').length,enemies=battle.querySelectorAll('.cbEnemyMember').length;
    battle.dataset.cwHeroes=String(heroes);battle.dataset.cwEnemies=String(enemies);
    battle.classList.toggle('cwTeamFight',heroes>0||enemies>0);
  }
  function refresh(){
    if(!root)return;mount();if(!mounted)return;
    var active=!!root.wheelMin&&root.wheelIsOpen()&&!(root.ClassroomBattle&&root.ClassroomBattle.isOpen());
    el('wheelCompact').hidden=!active;
    if(!active){restore();return;}
    fit();
    move('wheelQuickDuel',el('cwBattle'));move('wheelQuickStatus',el('cwFeedback'));move('wheelQuickRetry',el('cwFeedback'));move('wheelAward',el('cwAwards'));
    if(el('wheelQuickStatus'))el('wheelQuickStatus').title=el('wheelQuickStatus').textContent;
    syncButton();syncClass();countTeams();
    var duel=el('wheelQuickDuel'),empty=el('cwBattleEmpty');empty.hidden=!!duel&&!duel.hidden;
    var full=el('wheelClassSelect');
    empty.textContent=root.QuickBattle&&!root.QuickBattle.enabled()?'Quick fight is off. Restore the window to enable it.':full&&!full.value?'Choose a lesson slot under Turn to show your party.':'Turn to meet the next enemy.';
    var st=root.wheelState,entry=st&&st.names[root.wheelWinnerIdx],newId=st&&st.lastSpinId||'';
    el('cwRound').textContent=el('wheelRound').textContent;el('cwRound').title=el('wheelRound').textContent;
    el('cwSpin').textContent=root.wheelSpinning?'Turning…':'Turn';
    el('wheelCompact').classList.toggle('cwTurning',!!root.wheelSpinning);
    if(root.wheelSpinning){
      if(newId!==spinId||!plan){spinId=newId;progress=0;plan=reelPlan(root.wheelSegs||[],entry&&entry.n);paintFaces(plan.faces);}
      frame(progress);el('cwWinnerLive').textContent='Choosing a student…';
    }else{
      plan=null;paintFaces([entry?entry.n:'Ready to turn']);el('cwStrip').style.transform=reelTransform(CENTER);
      el('cwWinnerLive').textContent=entry?entry.n+' selected.':'Ready to choose a student.';
    }
  }
  function stop(){progress=0;plan=null;restore();if(mounted)el('wheelCompact').hidden=true;}
  return {refresh:refresh,frame:frame,stop:stop,fit:fit,clearFit:clearFit,reelPlan:reelPlan,offset:offset,reelTransform:reelTransform,renderAward:renderAward,pointAmount:pointAmount,scaleFor:scaleFor,defaultBox:defaultBox,BASE:BASE,MIN_W:MIN_W,MIN_H:MIN_H,K_MIN:K_MIN,K_MAX:K_MAX};
});
