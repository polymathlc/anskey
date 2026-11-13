/* 🧙 The quest on the worksheet (v1.193.0)

   The wheel quest's characters and enemies step out of the wheel window and
   stand on the worksheet itself, with no card or background behind them, so
   the battle looks as if it is happening on the page. The teacher drags them
   anywhere and resizes them from a corner; the box, its size and the options
   are remembered on this device.

   It is the SAME duel, not a copy: #wheelQuickDuel (painted by quick-battle.js
   and animated by battle-animation.js) is moved into the stage while the stage
   is on, so every hit, heal, HP bar and treasure chest keeps playing live, and
   every canonical handler stays attached. When the stage is turned off, the
   wheel closes, Quick fight is turned off or the manual Battle screen opens,
   the duel goes back to the wheel exactly where it lived before.

   Nothing here picks a student, resolves combat or awards points. The stage is
   presentation only, like the compact window (compact-wheel.js), and it never
   becomes an annotation: no undo, no save, no print.

   The pure helpers (box clamping, the corner-resize projection, the saved
   settings) are exported for tools/quest-stage-tests.mjs; the browser check is
   tools/quest-stage-browser-check.mjs. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(null);
  else root.QuestStage=factory(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  /* ---- Numbers ----
     BASE_W is the width, in CSS pixels, at which the duel is laid out before
     it is scaled; the stage's on-screen width is BASE_W × k. The height is the
     duel's own natural height at that width, times k. K_MIN / K_MAX bound the
     scale so the characters can neither vanish nor swallow the page. KEEP is
     how much of the stage must stay on screen when the window shrinks. */
  var STORE='polymath.questStage.v1';
  var BASE_W=460,K_MIN=0.35,K_MAX=3,K_DEFAULT=1,KEEP=48,NUDGE=10,NUDGE_BIG=40,K_STEP=0.1,HIDE_TOOLS_MS=3200,DRAG_SLOP=4;

  /* ---- Pure: numbers and settings ---- */
  function finite(value,fallback){var n=Number(value);return Number.isFinite(n)?n:fallback;}
  function clampK(k){return Math.min(K_MAX,Math.max(K_MIN,finite(k,K_DEFAULT)));}
  function roundK(k){return Math.round(clampK(k)*1000)/1000;}

  /* The saved settings, cleaned. Anything unreadable falls back to the
     defaults one field at a time, so one bad value never loses the rest. */
  function defaults(){return {v:1,on:false,x:null,y:null,k:K_DEFAULT,labels:true,flip:false,faint:false};}
  function cleanSettings(raw){
    var out=defaults();
    if(!raw||typeof raw!=='object')return out;
    out.on=raw.on===true;
    out.x=raw.x===null||raw.x===undefined||!Number.isFinite(Number(raw.x))?null:Math.round(Number(raw.x));
    out.y=raw.y===null||raw.y===undefined||!Number.isFinite(Number(raw.y))?null:Math.round(Number(raw.y));
    if(out.x===null||out.y===null){out.x=null;out.y=null;}
    out.k=roundK(raw.k);
    out.labels=raw.labels!==false;
    out.flip=raw.flip===true;
    out.faint=raw.faint===true;
    return out;
  }
  function parseSettings(text){
    if(typeof text!=='string'||!text)return defaults();
    try{return cleanSettings(JSON.parse(text));}catch(_){return defaults();}
  }

  /* Where a stage with no saved place first lands: the lower right of the
     viewport, clear of the toolbar and the edges, at the default scale (made
     smaller if the screen cannot hold it). */
  function defaultBox(vw,vh,naturalH){
    vw=Math.max(1,finite(vw,1024));vh=Math.max(1,finite(vh,768));
    var h0=Math.max(1,finite(naturalH,260));
    var k=clampK(Math.min(K_DEFAULT,(vw*0.6)/BASE_W,(vh*0.55)/h0));
    var w=BASE_W*k,h=h0*k;
    return {x:Math.round(Math.max(0,vw-w-24)),y:Math.round(Math.max(0,vh-h-24)),k:roundK(k)};
  }

  /* Keep the stage on screen. The scale is first brought down until the box
     fits the viewport (never below K_MIN), then the box is moved so all of it
     is inside; if even K_MIN is too big, at least KEEP pixels stay reachable
     so the teacher can always grab it back. */
  function clampBox(box,vw,vh,naturalH){
    vw=Math.max(1,finite(vw,1024));vh=Math.max(1,finite(vh,768));
    var h0=Math.max(1,finite(naturalH,260));
    var k=clampK(box&&box.k);
    var fit=Math.min(vw/BASE_W,vh/h0);
    if(k>fit)k=clampK(fit);
    var w=BASE_W*k,h=h0*k;
    var x=finite(box&&box.x,vw-w-24),y=finite(box&&box.y,vh-h-24);
    if(w<=vw)x=Math.min(Math.max(0,x),vw-w);else x=Math.min(Math.max(KEEP-w,x),vw-KEEP);
    if(h<=vh)y=Math.min(Math.max(0,y),vh-h);else y=Math.min(Math.max(KEEP-h,y),vh-KEEP);
    return {x:Math.round(x),y:Math.round(y),k:roundK(k)};
  }

  /* A corner drag keeps the characters' proportions: the pointer's movement
     is projected onto the box's own diagonal, so dragging right, down or
     diagonally all grow it, and no direction is dead. */
  function resizeK(startK,startW,startH,dx,dy){
    var w=Math.max(1,finite(startW,BASE_W)),h=Math.max(1,finite(startH,260));
    var t=(finite(dx,0)*w+finite(dy,0)*h)/(w*w+h*h);
    return roundK(clampK(startK)*(1+t));
  }

  /* A keyboard nudge for the focused stage: arrows move, Shift moves further,
     + / - resize, 0 resets the size. Returns null for any other key. */
  function keyStep(key,shift,box){
    var step=shift?NUDGE_BIG:NUDGE,b={x:box.x,y:box.y,k:box.k};
    if(key==='ArrowLeft')b.x-=step;
    else if(key==='ArrowRight')b.x+=step;
    else if(key==='ArrowUp')b.y-=step;
    else if(key==='ArrowDown')b.y+=step;
    else if(key==='+'||key==='=')b.k=roundK(b.k+K_STEP);
    else if(key==='-'||key==='_')b.k=roundK(b.k-K_STEP);
    else if(key==='0')b.k=K_DEFAULT;
    else return null;
    return b;
  }

  /* Whether the stage should be holding the duel right now. Pure so the
     rules are tested on their own: the option is on, the wheel is open, Quick
     fight is on (the duel is showing) and the manual Battle screen, which has
     its own arena, is not open. */
  function shouldHold(s){
    return !!(s&&s.on&&s.wheelOpen&&s.quickOn&&!s.manual&&s.hasDuel);
  }

  var pure={STORE:STORE,BASE_W:BASE_W,K_MIN:K_MIN,K_MAX:K_MAX,K_DEFAULT:K_DEFAULT,KEEP:KEEP,
    defaults:defaults,cleanSettings:cleanSettings,parseSettings:parseSettings,defaultBox:defaultBox,
    clampBox:clampBox,resizeK:resizeK,keyStep:keyStep,shouldHold:shouldHold,clampK:clampK};
  if(!root)return pure;

  /* ================= The page ================= */
  var doc=root.document,settings=defaults(),stage=null,body=null,inner=null,note=null,holding=false,naturalH=0,toolsTimer=0,observer=null,sizeObserver=null,drag=null;
  try{settings=parseSettings(root.localStorage.getItem(STORE));}catch(_){settings=defaults();}

  function el(id){return doc.getElementById(id);}
  function save(){try{root.localStorage.setItem(STORE,JSON.stringify(settings));}catch(_){/* blocked storage: the stage still works for this visit */}}
  function say(text){if(typeof root.toast==='function')root.toast(text);}
  function viewport(){
    var vw=root.innerWidth||doc.documentElement.clientWidth||1024;
    var vh=typeof root.floatWinViewportH==='function'?root.floatWinViewportH():(root.innerHeight||doc.documentElement.clientHeight||768);
    return {w:vw,h:vh};
  }
  function teacher(){return typeof root.wheelTeacher==='function'?!!root.wheelTeacher():true;}
  function wheelOpen(){return typeof root.wheelIsOpen==='function'?!!root.wheelIsOpen():!!(el('wheelModal')&&el('wheelModal').classList.contains('open'));}
  function manual(){return !!(root.ClassroomBattle&&root.ClassroomBattle.isOpen&&root.ClassroomBattle.isOpen());}
  function quickOn(){var duel=el('wheelQuickDuel');return !!duel&&!duel.hidden;}

  /* ---- Building the stage (once) ---- */
  function build(){
    if(stage||!doc.body)return;
    stage=doc.createElement('section');
    stage.id='questStage';stage.className='qsStage';stage.hidden=true;stage.tabIndex=0;
    stage.setAttribute('aria-label','Quest on the worksheet. Drag to move, drag the corner to resize, arrow keys move, plus and minus resize.');
    stage.innerHTML=
      '<div class="qsTools" role="toolbar" aria-label="Quest on the worksheet">'+
        '<button type="button" class="qsTool qsMove" data-qs="move" title="Drag to move the quest" aria-label="Move">⠿</button>'+
        '<button type="button" class="qsTool" data-qs="labels" title="Show or hide names and HP" aria-label="Names and HP" aria-pressed="true">🏷</button>'+
        '<button type="button" class="qsTool" data-qs="flip" title="Swap sides: heroes on the right" aria-label="Swap sides" aria-pressed="false">⇋</button>'+
        '<button type="button" class="qsTool" data-qs="faint" title="Make the quest faint so the worksheet shows through" aria-label="Faint" aria-pressed="false">👻</button>'+
        '<button type="button" class="qsTool" data-qs="smaller" title="Smaller (−)" aria-label="Smaller">−</button>'+
        '<button type="button" class="qsTool" data-qs="bigger" title="Bigger (+)" aria-label="Bigger">+</button>'+
        '<button type="button" class="qsTool" data-qs="reset" title="Put it back in the corner at its normal size" aria-label="Reset size and place">↺</button>'+
        '<button type="button" class="qsTool qsHome" data-qs="home" title="Back into the wheel" aria-label="Back into the wheel">✕</button>'+
      '</div>'+
      '<div class="qsBody" id="questStageBody"><div class="qsInner" id="questStageInner" data-qs-scale="1"></div></div>'+
      '<span class="qsGrip" id="questStageGrip" title="Drag to resize" aria-hidden="true"></span>';
    doc.body.appendChild(stage);
    body=el('questStageBody');inner=el('questStageInner');
    inner.style.width=BASE_W+'px';

    stage.querySelector('.qsTools').addEventListener('click',toolClick);
    stage.addEventListener('pointerdown',pointerDown);
    stage.addEventListener('keydown',keyDown);
    stage.addEventListener('pointerenter',showTools);
    stage.addEventListener('focusin',showTools);
    root.addEventListener('resize',function(){if(holding)place();});
    if(root.ResizeObserver){
      sizeObserver=new root.ResizeObserver(function(){if(holding)measure();});
      sizeObserver.observe(inner);
    }
  }

  /* The note left in the wheel where the characters used to be. */
  function buildNote(){
    if(note)return note;
    note=doc.createElement('div');note.id='questStageNote';note.className='qsNote';note.hidden=true;
    note.innerHTML='<span class="qsNoteIcon" aria-hidden="true">🧙</span><span class="qsNoteText">The quest is on the worksheet.</span><button type="button" class="qsNoteBack">Bring it back</button>';
    note.querySelector('.qsNoteBack').addEventListener('click',function(){setOn(false);});
    return note;
  }

  /* ---- The wheel's button ---- */
  function button(){return el('wheelStageBtn');}
  function syncButton(){
    var b=button();if(!b)return;
    b.classList.toggle('active',settings.on);
    b.setAttribute('aria-pressed',settings.on?'true':'false');
    b.title=settings.on?'Bring the quest back into the wheel':'Put the characters on the worksheet (drag and resize)';
    b.setAttribute('aria-label',b.title);
  }
  function syncTools(){
    if(!stage)return;
    stage.classList.toggle('qsNoLabels',!settings.labels);
    stage.classList.toggle('qsFlip',settings.flip);
    stage.classList.toggle('qsFaint',settings.faint);
    [['labels',settings.labels],['flip',settings.flip],['faint',settings.faint]].forEach(function(row){
      var b=stage.querySelector('[data-qs="'+row[0]+'"]');if(b)b.setAttribute('aria-pressed',row[1]?'true':'false');
    });
    var smaller=stage.querySelector('[data-qs="smaller"]'),bigger=stage.querySelector('[data-qs="bigger"]');
    if(smaller)smaller.disabled=settings.k<=K_MIN+1e-9;
    if(bigger)bigger.disabled=settings.k>=K_MAX-1e-9;
  }

  /* ---- Holding and releasing the duel ---- */
  /* Where the duel lives in the wheel when the stage gives it back: the full
     wheel keeps it in #wheelQuickFight just before the status line (or the
     assist box when the status line is in the compact window); the compact
     window's own refresh then moves it on into its battle box. */
  function homeFor(duel){
    var fight=el('wheelQuickFight');if(!fight)return null;
    var status=el('wheelQuickStatus'),assist=el('wheelQuickAssist');
    if(status&&status.parentNode===fight)return {parent:fight,before:status};
    if(assist&&assist.parentNode===fight)return {parent:fight,before:assist};
    return {parent:fight,before:null};
  }
  /* Where the note goes: the compact window's battle box when the compact
     window is showing, otherwise the duel's home in the full wheel. */
  function placeNote(){
    var n=buildNote();
    var compact=el('wheelCompact'),battle=el('cwBattle');
    var target=compact&&!compact.hidden&&battle?{parent:battle,before:null}:homeFor();
    if(target&&(n.parentNode!==target.parent||(target.before&&n.nextSibling!==target.before)))target.parent.insertBefore(n,target.before);
    n.hidden=!holding;
  }

  function take(){
    var duel=el('wheelQuickDuel');if(!duel||!stage)return;
    if(duel.parentNode!==inner)inner.appendChild(duel);
    if(!holding){
      holding=true;stage.hidden=false;
      if(settings.x===null){measure(true);}else measure();
      showTools();
    }
    placeNote();
  }
  function release(){
    var duel=el('wheelQuickDuel');
    if(duel&&inner&&duel.parentNode===inner){
      var home=homeFor(duel);
      if(home)home.parent.insertBefore(duel,home.before);
    }
    holding=false;
    if(stage){stage.hidden=true;stage.classList.remove('qsShowTools','qsDragging');}
    if(note)note.hidden=true;
    endDrag();
  }

  /* quick-battle.js re-paints the duel's insides on every turn and toggles
     its hidden flag with Quick fight; the stage follows both. */
  function watchDuel(duel){
    if(!duel||!root.MutationObserver)return;
    if(observer&&observer.duel===duel)return;
    if(observer)observer.disconnect();
    observer=new root.MutationObserver(function(){
      /* Quick fight turned on or off, or the duel repainted while the stage is
         waiting for it: decide again. Otherwise only the height may change. */
      if(!holding||!quickOn()){refresh();return;}
      measure();
    });
    observer.duel=duel;
    observer.observe(duel,{attributes:true,attributeFilter:['hidden'],childList:true});
  }

  /* ---- Size and place ---- */
  function measure(first){
    if(!inner||!holding)return;
    var h=inner.scrollHeight||inner.offsetHeight||0;
    if(h>0)naturalH=h;
    if(first&&settings.x===null){
      var vp=viewport(),d=defaultBox(vp.w,vp.h,naturalH||260);
      settings.x=d.x;settings.y=d.y;settings.k=d.k;save();
    }
    place();
  }
  function place(){
    if(!stage||!holding)return;
    var vp=viewport(),box=clampBox({x:settings.x,y:settings.y,k:settings.k},vp.w,vp.h,naturalH||260);
    settings.x=box.x;settings.y=box.y;settings.k=box.k;
    paint(box);
    syncTools();
  }
  function paint(box){
    var h=Math.max(1,naturalH||260);
    stage.style.left=box.x+'px';stage.style.top=box.y+'px';
    body.style.width=Math.round(BASE_W*box.k)+'px';
    body.style.height=Math.round(h*box.k)+'px';
    inner.style.transform='scale('+box.k+')';
    inner.dataset.qsScale=String(box.k);
    stage.style.setProperty('--qs-k',String(box.k));
    /* Near the top of the screen the tools drop below the characters. */
    stage.classList.toggle('qsToolsBelow',box.y<56);
  }

  /* ---- Tools ---- */
  function showTools(){
    if(!stage)return;
    stage.classList.add('qsShowTools');
    root.clearTimeout(toolsTimer);
    toolsTimer=root.setTimeout(function(){if(stage&&!drag&&!stage.contains(doc.activeElement))stage.classList.remove('qsShowTools');},HIDE_TOOLS_MS);
  }
  function toolClick(event){
    var b=event.target.closest('[data-qs]');if(!b||b.disabled)return;
    var what=b.dataset.qs;
    showTools();
    if(what==='move')return;
    if(what==='labels'){settings.labels=!settings.labels;}
    else if(what==='flip'){settings.flip=!settings.flip;}
    else if(what==='faint'){settings.faint=!settings.faint;}
    else if(what==='smaller'){resizeAround(roundK(settings.k-K_STEP));}
    else if(what==='bigger'){resizeAround(roundK(settings.k+K_STEP));}
    else if(what==='reset'){settings.x=null;settings.y=null;settings.k=K_DEFAULT;syncTools();save();measure(true);return;}
    else if(what==='home'){setOn(false);return;}
    syncTools();save();
    /* Hiding the labels changes the duel's natural height. */
    root.requestAnimationFrame?root.requestAnimationFrame(function(){measure();}):measure();
  }
  /* Resize from the buttons or keys keeps the stage's centre still, so the
     characters grow in place rather than off towards the corner. */
  function resizeAround(k){
    var h=Math.max(1,naturalH||260),oldK=settings.k,cx=settings.x+BASE_W*oldK/2,cy=settings.y+h*oldK/2;
    settings.k=roundK(k);
    settings.x=Math.round(cx-BASE_W*settings.k/2);settings.y=Math.round(cy-h*settings.k/2);
    place();save();
  }

  /* ---- Drag to move, drag the corner to resize ----
     A press on a character (or the ⠿ handle) moves the stage once the pointer
     has travelled DRAG_SLOP pixels, so a tap on a treasure chest or a button
     in the duel still works. The corner grip resizes from the first pixel. */
  function interactive(target){
    return !!target.closest('button:not(.qsMove),input,select,textarea,a,label,[contenteditable="true"],[role="button"]');
  }
  function pointerDown(event){
    if(event.button!==undefined&&event.button!==0)return;
    var grip=event.target.closest('.qsGrip'),handle=event.target.closest('.qsMove');
    if(!grip&&!handle&&interactive(event.target))return;
    showTools();
    var h=Math.max(1,naturalH||260);
    drag={mode:grip?'resize':'move',id:event.pointerId,sx:event.clientX,sy:event.clientY,x:settings.x,y:settings.y,k:settings.k,w:BASE_W*settings.k,h:h*settings.k,live:!!grip||!!handle};
    if(drag.live)begin();
    /* The page, not the stage, follows the pointer: the stage lets presses
       through its empty parts (pointer-events: none), and quick-battle.js may
       re-paint the character under the finger in the middle of a drag. */
    doc.addEventListener('pointermove',pointerMove,true);
    doc.addEventListener('pointerup',pointerUp,true);
    doc.addEventListener('pointercancel',pointerUp,true);
    if(grip||handle)event.preventDefault();
  }
  function begin(){stage.classList.add('qsDragging');}
  function pointerMove(event){
    if(!drag||event.pointerId!==drag.id)return;
    var dx=event.clientX-drag.sx,dy=event.clientY-drag.sy;
    if(!drag.live){
      if(Math.abs(dx)<DRAG_SLOP&&Math.abs(dy)<DRAG_SLOP)return;
      drag.live=true;begin();
    }
    event.preventDefault();
    if(drag.mode==='move'){settings.x=Math.round(drag.x+dx);settings.y=Math.round(drag.y+dy);}
    else settings.k=resizeK(drag.k,drag.w,drag.h,dx,dy);
    place();
  }
  function pointerUp(event){
    if(!drag||event.pointerId!==drag.id)return;
    var moved=drag.live;
    endDrag();
    if(moved){save();showTools();}
  }
  function endDrag(){
    doc.removeEventListener('pointermove',pointerMove,true);
    doc.removeEventListener('pointerup',pointerUp,true);
    doc.removeEventListener('pointercancel',pointerUp,true);
    if(stage)stage.classList.remove('qsDragging');
    drag=null;
  }
  function keyDown(event){
    if(event.target!==stage)return;
    if(event.key==='Escape'){stage.blur();return;}
    var next=keyStep(event.key,event.shiftKey,{x:settings.x,y:settings.y,k:settings.k});
    if(!next)return;
    event.preventDefault();event.stopPropagation();
    if(next.k!==settings.k)resizeAround(next.k);
    else{settings.x=next.x;settings.y=next.y;place();save();}
    showTools();
  }

  /* ---- The one door ----
     refresh() is called by compact-wheel.js after every wheel re-render and
     mode change, and by the stage's own observers. It decides from scratch
     whether the stage holds the duel, so it is safe to call any number of
     times. */
  function refresh(){
    if(!root||!doc)return;
    build();syncButton();syncTools();
    watchDuel(el('wheelQuickDuel'));
    var hold=shouldHold({on:settings.on&&teacher(),wheelOpen:wheelOpen(),quickOn:quickOn(),manual:manual(),hasDuel:!!el('wheelQuickDuel')});
    if(hold)take();else if(holding)release();
    if(note&&!holding)note.hidden=true;
  }
  function holds(){return holding;}
  function setOn(on){
    settings.on=!!on;save();syncButton();
    var wasHolding=holding;
    refresh();
    if(settings.on&&!holding){
      if(!quickOn())say('🧙 Turn on Quick fight to put the quest on the worksheet.');
    }else if(settings.on&&holding&&!wasHolding)say('🧙 The quest is on the worksheet. Drag it, or drag its corner to resize.');
    /* Giving the duel back: let the compact window pull it into its box. */
    if(!settings.on&&root.CompactWheel&&root.CompactWheel.refresh)root.CompactWheel.refresh();
    if(holding&&stage){try{stage.focus({preventScroll:true});}catch(_){}}
  }
  function toggle(){setOn(!settings.on);}
  /* The wheel is closing: give the duel back but remember the choice, so the
     quest walks straight back onto the worksheet next time. */
  function stop(){if(holding)release();}

  function wire(){
    var b=button();
    if(b&&!b.dataset.qsWired){b.dataset.qsWired='1';b.addEventListener('click',function(event){event.stopPropagation();toggle();});}
    syncButton();
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',wire);else wire();

  var api={refresh:refresh,holds:holds,setOn:setOn,toggle:toggle,stop:stop,settings:function(){return Object.assign({},settings);},
    box:function(){return {x:settings.x,y:settings.y,k:settings.k,h:naturalH};}};
  Object.keys(pure).forEach(function(key){api[key]=pure[key];});
  return api;
});
