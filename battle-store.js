/* One Firestore transaction per action, with durable deduplication receipts. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./battle-core.js'));
  else root.ClassroomBattleStore = factory(root.ClassroomBattleCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Core) {
  'use strict';
  function classKey(value) {
    // Encode all UTF-16 units: reversible, collision-free, slash-safe and deterministic.
    const key = Array.from(String(value), ch => Array.from({ length: ch.length }, (_, i) => ch.charCodeAt(i).toString(16).padStart(4, '0')).join('')).join('');
    if (!key || key.length > 1400) throw new Error('Choose a valid class (up to 350 characters).');
    return key;
  }
  function create({ db, teacherId, classId, canWrite, transport, onMission }) {
    if (!teacherId || /\//.test(teacherId)) throw new Error('Sign in as the teacher to open a battle.');
    const ref = db.collection('classroomBattles').doc(teacherId).collection('classes').doc(classKey(classId));
    function authorize() { if (typeof canWrite !== 'function' || !canWrite()) throw new Error('Only the signed-in teacher can change this battle.'); }
    function localBalance(student) { return student ? {student,marks:student.marks || 0,just:student._just || 0} : null; }
    function balanceSnapshot() {
      return typeof window !== 'undefined' && Array.isArray(window.rwStudents) ? new Map(window.rwStudents.map(student => [student.id,localBalance(student)])) : null;
    }
    function currentBalance(id) { return typeof window !== 'undefined' ? localBalance((window.rwStudents || []).find(student => student.id === id)) : null; }
    function balanceChanged(before,after) { return !before || !after || before.student !== after.student || before.marks !== after.marks || before.just !== after.just; }
    async function reconcileBalances(result,before,includePayout=true) {
      if (!before || !result) return result;
      const rows=Array.isArray(result.balances) ? result.balances : includePayout ? result.mission?.lastPayout?.awards || [] : [];
      const conflicting=new Set();
      for (const row of [...rows,...(result.award ? [result.award] : [])]) {
        const local=currentBalance(row.studentId);
        if (local && Number.isSafeInteger(local.marks) && local.marks !== row.marks && balanceChanged(before.get(row.studentId),local)) conflicting.add(row.studentId);
      }
      if (!conflicting.size) return result;
      const readStart=new Map([...rows,...(result.award ? [result.award] : [])].map(row=>[row.studentId,currentBalance(row.studentId)]));
      // A normal reward or correction can finish while this saved reply is in
      // flight. Read only those changed balances; never replace them with an
      // older payout/award snapshot or turn a committed award into a new retry.
      const confirmed=new Map(await Promise.all([...conflicting].map(async id => {
        const start=currentBalance(id);let marks=start.marks;
        try {
          authorize();
          const snapshot=await db.collection('students').doc(id).get({source:'server'});
          authorize();
          const now=currentBalance(id),saved=snapshot.exists && snapshot.data();
          if (now && Number.isSafeInteger(now.marks) && balanceChanged(start,now)) marks=now.marks;
          else if (saved && Number.isSafeInteger(saved.marks || 0)) marks=saved.marks || 0;
          else if (now && Number.isSafeInteger(now.marks)) marks=now.marks;
        } catch (_) {
          authorize(); // Account/lesson changes must still withhold the reply.
          const now=currentBalance(id);if (now && Number.isSafeInteger(now.marks)) marks=now.marks;
        }
        return [id,{marks,local:currentBalance(id)}];
      })));
      authorize();
      // Another student's slower read must not hide a local update that
      // arrived after this student's reconciliation already finished.
      for (const [id,saved] of confirmed) {
        const now=currentBalance(id);
        confirmed.set(id,now && Number.isSafeInteger(now.marks) && balanceChanged(saved.local,now) ? now.marks : saved.marks);
      }
      const update=row => {
        if (confirmed.has(row.studentId)) return {...row,marks:confirmed.get(row.studentId)};
        const now=currentBalance(row.studentId);
        return now && Number.isSafeInteger(now.marks) && balanceChanged(readStart.get(row.studentId),now) ? {...row,marks:now.marks} : row;
      };
      return {...result,...(rows.length || Array.isArray(result.balances) ? {balances:rows.map(update)} : {}),...(result.award ? {award:update(result.award)} : {})};
    }
    return {
      ref,
      subscribe(onState, onError) {
        authorize();
        return ref.onSnapshot(snap => {
          if (!canWrite()) return;
          onState(snap.exists ? snap.data() : null);
        }, onError);
      },
      async guests(request) {
        authorize();
        const frozen = JSON.parse(JSON.stringify(request));
        if (!['get','add','remove'].includes(frozen.command)) throw new Error('Invalid temporary student request.');
        if (frozen.command !== 'get') {
          if (!/^[a-zA-Z0-9_-]{8,100}$/.test(frozen.id || '')) throw new Error('Invalid temporary student request ID.');
          if (typeof frozen.studentId !== 'string' || !frozen.studentId || frozen.studentId.length > 200 || /\//.test(frozen.studentId)) throw new Error('Choose a valid temporary student.');
        }
        const api = transport || (typeof window !== 'undefined' && window.ClassroomHeroAPI && window.ClassroomHeroAPI.request);
        if (!api) throw new Error('Hero saving is loading. Refresh Ans Key and try again.');
        const result = await api({...frozen,type:'lessonGuests',classId},{canSend:canWrite});
        authorize();
        if (!Array.isArray(result?.guests) || result.guests.some(guest => !guest || typeof guest.studentId !== 'string' || !guest.studentId || typeof guest.name !== 'string' || !Array.isArray(guest.lessonSlots) || guest.lessonSlots.some(slot => typeof slot !== 'string')) || new Set(result.guests.map(guest => guest.studentId)).size !== result.guests.length) throw new Error('The temporary students could not be confirmed. Retry the same request.');
        return result;
      },
      async mission(request) {
        authorize();
        const frozen = JSON.parse(JSON.stringify(request));
        const api = transport || (typeof window !== 'undefined' && window.ClassroomHeroAPI && window.ClassroomHeroAPI.request);
        if (!api) throw new Error('Hero saving is loading. Refresh Ans Key and try again.');
        const before=balanceSnapshot();
        let result = await api({...frozen,type:'mission',classId},{canSend:canWrite});
        authorize();
        if (!result?.mission) throw new Error('The class mission could not be confirmed. Retry the same request.');
        result=await reconcileBalances(result,before,frozen.command!=='get');
        authorize();
        return result;
      },
      async assist(request) {
        authorize();
        const frozen = JSON.parse(JSON.stringify(request));
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(frozen.action?.id || '')) throw new Error('Invalid assist ID.');
        const api = transport || (typeof window !== 'undefined' && window.ClassroomHeroAPI && window.ClassroomHeroAPI.request);
        if (!api) throw new Error('Hero saving is loading. Refresh Ans Key and try again.');
        const before=balanceSnapshot();
        let result = await api({...frozen,type:'assist',classId},{canSend:canWrite});
        authorize();
        if (!result?.assist || !result.hero) throw new Error('The assist could not be confirmed. Retry the same assist.');
        result=await reconcileBalances(result,before);
        authorize();
        if (result.mission && onMission) onMission(result);
        return result;
      },
      async award(request) {
        authorize();
        const frozen = JSON.parse(JSON.stringify(request));
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(frozen.action?.id || '')) throw new Error('Invalid points award ID.');
        const api = transport || (typeof window !== 'undefined' && window.ClassroomHeroAPI && window.ClassroomHeroAPI.request);
        if (!api) throw new Error('Hero saving is loading. Refresh Ans Key and try again.');
        const before=balanceSnapshot();
        let result = await api({...frozen,type:'wheelAward',classId},{canSend:canWrite});
        authorize();
        if (!result?.award || (frozen.mode === 'ordinary' ? !result.mission : !result.state)) throw new Error('The points award could not be confirmed. Retry the same award.');
        result=await reconcileBalances(result,before);
        authorize();
        if (result.mission && onMission) onMission(result);
        return result;
      },
      async act(action) {
        authorize();
        const frozen = JSON.parse(JSON.stringify(action));
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(frozen.id || '')) throw new Error('Invalid battle action ID.');
        const api = transport || (typeof window !== 'undefined' && window.ClassroomHeroAPI && window.ClassroomHeroAPI.request);
        if (api) {
          const before=balanceSnapshot();
          let result = await api({type:'battle',classId,action:frozen},{canSend:canWrite});
          authorize();
          result=await reconcileBalances(result,before);
          authorize();
          if (result.mission && onMission) onMission(result);
          return result.state;
        }
        // The in-memory Node transaction harness is deliberately local. Every
        // browser write must go through the authenticated canonical hero API.
        if (typeof window !== 'undefined') throw new Error('Hero saving is loading. Refresh Ans Key and try again.');
        const receipt = ref.collection('actions').doc(frozen.id);
        return db.runTransaction(async tx => {
          authorize();
          const oldReceipt = await tx.get(receipt), snapshot = await tx.get(ref);
          const old = snapshot.exists ? snapshot.data() : null;
          if (oldReceipt.exists) return old;
          const next = Core.reduce(old, frozen);
          if (next === old) return old;
          authorize(); // A role/account change while reads were in flight cancels the write.
          const state = Object.assign({}, next, { teacherId, classId });
          tx.set(ref, state);
          // Small immutable receipt avoids both a document-size cap and replay after many lessons.
          tx.set(receipt, { encounterId: state.encounterId, revision: state.revision, type: frozen.type });
          return state;
        });
      }
    };
  }
  return { create, classKey };
});
