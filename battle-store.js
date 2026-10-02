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
  function create({ db, teacherId, classId, canWrite, transport }) {
    if (!teacherId || /\//.test(teacherId)) throw new Error('Sign in as the teacher to open a battle.');
    const ref = db.collection('classroomBattles').doc(teacherId).collection('classes').doc(classKey(classId));
    function authorize() { if (typeof canWrite !== 'function' || !canWrite()) throw new Error('Only the signed-in teacher can change this battle.'); }
    return {
      ref,
      subscribe(onState, onError) {
        authorize();
        return ref.onSnapshot(snap => {
          if (!canWrite()) return;
          onState(snap.exists ? snap.data() : null);
        }, onError);
      },
      async award(request) {
        authorize();
        const frozen = JSON.parse(JSON.stringify(request));
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(frozen.action?.id || '')) throw new Error('Invalid points award ID.');
        const api = transport || (typeof window !== 'undefined' && window.ClassroomHeroAPI && window.ClassroomHeroAPI.request);
        if (!api) throw new Error('Hero saving is loading. Refresh Ans Key and try again.');
        const result = await api({...frozen,type:'wheelAward',classId},{canSend:canWrite});
        authorize();
        if (!result?.award || !result.state) throw new Error('The points award could not be confirmed. Retry the same award.');
        return result;
      },
      async act(action) {
        authorize();
        const frozen = JSON.parse(JSON.stringify(action));
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(frozen.id || '')) throw new Error('Invalid battle action ID.');
        const api = transport || (typeof window !== 'undefined' && window.ClassroomHeroAPI && window.ClassroomHeroAPI.request);
        if (api) {
          const result = await api({type:'battle',classId,action:frozen},{canSend:canWrite});
          authorize();
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
