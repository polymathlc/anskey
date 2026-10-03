/* Temporary lesson attendance. The server owns membership and canonical heroes. */
(function () {
  'use strict';
  var g = {epoch:0,uid:'',cls:'',store:null,guests:[],loading:false,busy:false,pending:null,error:'',expanded:false};
  function el(id) { return document.getElementById(id); }
  function allowed() { return !!(window.wheelTeacher && wheelTeacher() && window.currentUser && currentUser.uid); }
  function visible() { return !!el('wheelModal') && el('wheelModal').classList.contains('open'); }
  function active() { return allowed() && visible() && currentUser.uid === g.uid && window.wheelClass === g.cls; }
  function sameLesson(cls) { return allowed() && currentUser.uid === g.uid && cls === g.cls; }
  function permanent(student, cls) { return !!student && window.rwStudentClasses && rwStudentClasses(student).includes(cls); }
  function guest(studentId, cls) { return sameLesson(cls) && g.guests.some(function (row) { return row.studentId === studentId; }); }
  function students(cls) {
    var all = window.rwStudents || [];
    return all.filter(function (student) { return permanent(student,cls) || guest(student.id,cls); });
  }
  function blocks() {
    return active() && (g.loading || g.busy || !!g.pending);
  }
  function combatBusy(retry) {
    return !!window.wheelSpinning || !!(window.ClassroomBattle && ClassroomBattle.guestChangeBlocked && ClassroomBattle.guestChangeBlocked(retry)) ||
      !!(window.QuickBattle && QuickBattle.guestChangeBlocked && QuickBattle.guestChangeBlocked(retry)) ||
      Object.values(window.rwAwarding || {}).some(Boolean);
  }
  function requestKey(uid, cls) { return 'polymath.lessonGuests.' + uid + '.' + encodeURIComponent(cls); }
  function clearRequest(uid, cls, id) {
    try {
      var saved = JSON.parse(sessionStorage.getItem(requestKey(uid,cls)) || 'null');
      if (saved && saved.id === id) sessionStorage.removeItem(requestKey(uid,cls));
    } catch (_) {}
  }
  function mount() {
    if (el('wheelGuestToggle')) return;
    var host = document.createElement('section'); host.className = 'whGuests'; host.id = 'wheelGuests';
    host.setAttribute('aria-label','Temporary lesson guests');
    host.innerHTML = '<button type="button" class="btn" id="wheelGuestToggle" aria-expanded="false" aria-controls="wheelGuestPanel">+ Add student from another slot</button>' +
      '<div id="wheelGuestPanel" hidden><p class="whGuestHint">Guests join this wheel and battle with their saved hero. Their home Lesson slot stays unchanged. Remove them here when they leave.</p>' +
      '<div class="whGuestFields"><label>From Lesson slot<select id="wheelGuestSlot"></select></label><label>Student<select id="wheelGuestStudent"></select></label>' +
      '<button type="button" class="btn" id="wheelGuestAdd">Add guest</button></div><ul id="wheelGuestList"></ul></div>' +
      '<p id="wheelGuestStatus" role="status" aria-live="polite" hidden></p><button type="button" class="btn" id="wheelGuestRetry" hidden>Retry guest list</button>';
    el('wheelClassSelect').closest('.whLesson').insertAdjacentElement('afterend',host);
    el('wheelGuestToggle').addEventListener('click',function () { g.expanded=!g.expanded;render(); });
    el('wheelGuestSlot').addEventListener('change',renderStudents);
    el('wheelGuestStudent').addEventListener('change',renderButtons);
    el('wheelGuestAdd').addEventListener('click',function () { change('add',el('wheelGuestStudent').value); });
    el('wheelGuestRetry').addEventListener('click',function () { if(g.pending)change(null,null,true);else refresh(); });
    el('wheelGuestList').addEventListener('click',function (event) { var button=event.target.closest('[data-guest-remove]');if(button)change('remove',button.dataset.guestRemove); });
  }
  function renderStudents() {
    if (!el('wheelGuestStudent')) return;
    var select=el('wheelGuestStudent'),previous=select.value,source=el('wheelGuestSlot').value;
    var pool=(window.rwStudents || []).filter(function (s) { return permanent(s,source) && !permanent(s,g.cls) && !guest(s.id,g.cls); }).sort(function (a,b) { return String(a.name).localeCompare(String(b.name)); });
    select.replaceChildren();
    pool.forEach(function (s) { var option=document.createElement('option');option.value=s.id;option.textContent=s.name;select.appendChild(option); });
    if(pool.some(function(s){return s.id===previous;}))select.value=previous;
    if(!pool.length){var option=document.createElement('option');option.value='';option.textContent='No available students in this slot';select.appendChild(option);}
    renderButtons();
  }
  function renderButtons() {
    if(!el('wheelGuestAdd'))return;
    var disabled=!active() || !g.cls || blocks() || combatBusy();
    el('wheelGuestAdd').disabled=disabled || !el('wheelGuestStudent').value;
    el('wheelGuestSlot').disabled=disabled;el('wheelGuestStudent').disabled=disabled;
    document.querySelectorAll('[data-guest-remove]').forEach(function(button){button.disabled=disabled;});
    el('wheelGuestRetry').disabled=g.loading || g.busy || combatBusy(!!g.pending);
  }
  function render() {
    mount();
    el('wheelGuests').hidden=!allowed() || !g.cls;
    el('wheelGuestToggle').textContent=g.guests.length ? 'Lesson guests · '+g.guests.length+' · add or remove' : '+ Add student from another slot';
    el('wheelGuestToggle').setAttribute('aria-expanded',String(g.expanded));
    el('wheelGuestPanel').hidden=!g.expanded;
    var select=el('wheelGuestSlot'),previous=select.value;
    var slots=[...new Set((window.rwStudents || []).flatMap(function(s){return rwStudentClasses(s);}))].filter(function(cls){return cls!==g.cls;}).sort();
    select.replaceChildren();slots.forEach(function(cls){var option=document.createElement('option');option.value=cls;option.textContent=cls;select.appendChild(option);});
    if(slots.includes(previous))select.value=previous;
    var list=el('wheelGuestList');list.replaceChildren();
    g.guests.forEach(function(row){
      var li=document.createElement('li'),label=document.createElement('span'),name=document.createElement('strong'),source=document.createElement('small'),button=document.createElement('button');
      name.textContent=row.name;source.textContent='Guest · '+row.lessonSlots.join(' / ');label.append(name,source);
      button.type='button';button.className='btn';button.dataset.guestRemove=row.studentId;button.textContent='Remove';button.setAttribute('aria-label','Remove guest '+row.name);
      li.append(label,button);list.appendChild(li);
    });
    if(!g.guests.length){var empty=document.createElement('li');empty.className='whGuestEmpty';empty.textContent='No guests in this lesson.';list.appendChild(empty);}
    var message=g.loading?'Loading lesson guests…':g.busy?'Saving lesson guests…':g.error;
    el('wheelGuestStatus').textContent=message;el('wheelGuestStatus').hidden=!message;
    el('wheelGuestStatus').classList.toggle('whGuestError',!!g.error);
    el('wheelGuestRetry').hidden=!g.error && !g.pending;
    el('wheelGuestRetry').textContent=g.pending?'Retry '+(g.pending.command==='add'?'adding':'removing')+' guest':'Retry guest list';
    renderStudents();
  }
  function notifyControls() {
    render();
    if(window.wheelRender)wheelRender();
    if(window.QuickBattle)QuickBattle.render();
    if(window.ClassroomBattle && ClassroomBattle.render)ClassroomBattle.render();
  }
  function receive(result) {
    g.guests=result.guests;
    if(window.wheelState){
      var selected=wheelState.names[window.wheelWinnerIdx],selectedId=selected && selected.id;
      wheelState.names=wheelState.names.filter(function(entry){
        if(!entry.guest)return true;
        var student=(window.rwStudents || []).find(function(s){return s.id===entry.id;});
        if(permanent(student,g.cls)){delete entry.guest;return true;}
        return guest(entry.id,g.cls);
      });
      g.guests.forEach(function(row){
        var entry=wheelState.names.find(function(n){return n.id===row.studentId;}) || wheelAddName(wheelState,row.name,row.studentId);
        if(entry){entry.n=row.name;entry.guest=true;}
      });
      if(selectedId)window.wheelWinnerIdx=wheelState.names.findIndex(function(n){return n.id===selectedId;});
      else if(selected)window.wheelWinnerIdx=wheelState.names.indexOf(selected);
      wheelSave();wheelDraw();
    }
    window.dispatchEvent(new CustomEvent('wheel-guests-changed',{detail:{classId:g.cls,state:result.state}}));
  }
  async function refresh() {
    if(!active() || !g.store || g.busy || g.pending)return;
    var stamp=g.epoch,store=g.store;g.loading=true;g.error='';notifyControls();
    try { var result=await store.guests({command:'get'});if(stamp!==g.epoch || !active())return;receive(result); }
    catch(error){if(stamp===g.epoch && active())g.error=error.message || 'Could not load lesson guests. Try again.';}
    finally{if(stamp===g.epoch){g.loading=false;notifyControls();}}
  }
  async function change(command,studentId,retry) {
    if(!active() || !g.store || g.loading || g.busy || combatBusy(!!retry))return;
    if(retry?!g.pending:!!g.pending)return;
    if(!retry){
      if(!studentId)return;
      var id='guest-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
      g.pending={command:command,studentId:studentId,id:id};
      try{sessionStorage.setItem(requestKey(g.uid,g.cls),JSON.stringify(g.pending));}
      catch(_){g.pending=null;g.error='Enable session storage so guest changes can be retried safely.';render();return;}
    }
    var request=JSON.parse(JSON.stringify(g.pending)),stamp=g.epoch,store=g.store,uid=g.uid,cls=g.cls;
    g.busy=true;g.error='';g.expanded=true;notifyControls();
    try{
      var result=await store.guests(request);clearRequest(uid,cls,request.id);
      if(stamp!==g.epoch || !active())return;
      g.pending=null;receive(result);
      if(window.toast)toast(command==='remove' || request.command==='remove'?'Guest removed. Their hero progress is saved.':'Guest added to this wheel and battle.');
    }catch(error){
      if(['invalid_request','invalid_action','invalid_guest','invalid_slot','invalid_student','missing_student','already_in_slot','roster_changed','encounter_active','battle_changed','guest_changed','guest_pending','pending_answer','invalid_roster'].includes(error.code)){
        clearRequest(uid,cls,request.id);if(stamp===g.epoch)g.pending=null;
      }
      if(stamp===g.epoch && active())g.error=(error.message || 'Could not confirm the guest change.')+(g.pending?' Retry to confirm the same change safely.':'');
    }finally{if(stamp===g.epoch){g.busy=false;notifyControls();}}
  }
  function close() {g.epoch++;g.uid='';g.cls='';g.store=null;g.guests=[];g.loading=false;g.busy=false;g.pending=null;g.error='';g.expanded=false;if(el('wheelGuests'))el('wheelGuests').hidden=true;}
  function open(cls) {
    close();mount();
    if(!allowed() || !visible() || !cls){render();return;}
    g.uid=currentUser.uid;g.cls=cls;
    var stamp=g.epoch,uid=g.uid;
    try{
      var saved=JSON.parse(sessionStorage.getItem(requestKey(uid,cls)) || 'null');
      if(saved && ['add','remove'].includes(saved.command) && /^[a-zA-Z0-9_-]{8,100}$/.test(saved.id || '') && typeof saved.studentId==='string')g.pending=saved;
      g.store=ClassroomBattleStore.create({db:window.db,teacherId:uid,classId:cls,canWrite:function(){return stamp===g.epoch && active();}});
      if(g.pending){g.expanded=true;g.error='Confirm the pending guest change using Retry.';notifyControls();}
      else refresh();
    }catch(error){g.error=error.message;render();}
  }
  window.wheelLessonStudents=students;
  window.wheelStudentInLesson=function(student,cls){return !!student && (permanent(student,cls) || guest(student.id,cls));};
  window.wheelGuestsBusy=blocks;
  window.LessonGuests={open:open,close:close,render:render,renderButtons:renderButtons,refresh:refresh,isGuest:guest,remove:function(id){return change('remove',id);},addStudent:function(id){return change('add',id);}};
})();
