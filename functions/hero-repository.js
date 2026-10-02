'use strict';

const Core = require('./hero-game/battle-core');
const { HeroError } = require('./hero-service');
const { randomUUID, createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const clone = value => JSON.parse(JSON.stringify(value));
const docData = snap => snap.exists ? snap.data() : null;
const docs = snap => snap.docs || [];
const deny = (code, message, status = 409) => { throw new HeroError(status, code, message); };
function key(value) {
  if (typeof value !== 'string' || !value || value.length > 350) deny('invalid_slot', 'Choose a valid lesson slot.', 400);
  return Array.from(value, ch => Array.from({ length: ch.length }, (_, i) => ch.charCodeAt(i).toString(16).padStart(4,'0')).join('')).join('');
}
function studentKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,140}$/.test(value)) deny('invalid_student', 'Choose a roster name.', 400);
  return value;
}
function slots(student) { return [...new Set((Array.isArray(student?.slots) ? student.slots : [student?.slot]).filter(s => typeof s === 'string' && s && s.length <= 350))]; }
function canonicalIdentity(student, profile) {
  return { id: 'student:' + student.id, studentId: student.id, name: String(student.name || 'Student').slice(0,100), uid: profile?.claim?.status === 'approved' ? profile.claim.uid : null };
}
function cleanHero(hero, student, profile) {
  const identity = canonicalIdentity(student, profile);
  return Core.cleanHero({ ...hero, ...identity }, hero);
}
// Pick one legitimate prior snapshot; never add inventories/XP from duplicate
// lesson snapshots. An existing canonical profile always wins future migrations.
function migrateHero(student, classSnapshots) {
  const candidates = [];
  for (const snap of classSnapshots) {
    const state = snap.data();
    const stamp = snap.updateTime?.toMillis?.() || state.updatedAt || 0;
    for (const hero of [...(state.heroes || []), ...Object.values(state.heroArchive || {})]) {
      if (!hero || (hero.studentId !== student.id && hero.id !== 'student:' + student.id &&
          !(student.uid && !hero.studentId && hero.id === 'uid:' + student.uid))) continue;
      candidates.push({ hero, state, active: (state.heroes || []).includes(hero), stamp, path: snap.id || state.classId || '' });
    }
  }
  candidates.sort((a,b) => (Number(b.hero.xp)||0) - (Number(a.hero.xp)||0) || b.stamp-a.stamp || (b.state.revision||0)-(a.state.revision||0) || a.path.localeCompare(b.path));
  const winner = candidates[0], hero = cleanHero(winner?.hero || Core.heroFromStudent(student), student, null);
  // Even a lower-XP old lesson can still have an unfinished encounter. Lock
  // that lesson explicitly instead of letting migration create parallel fights.
  const active = candidates.filter(c=>c.active && c.state.status==='active' && c.state.classId)
    .sort((a,b)=>b.stamp-a.stamp || (b.state.revision||0)-(a.state.revision||0) || a.path.localeCompare(b.path))[0];
  hero.classChosen = !!hero.classChosen;
  return { schemaVersion: 1, studentId: student.id, hero, claim: null, activeEncounter: active ? { classId: active.state.classId, encounterId: active.state.encounterId } : null, migrated: true };
}
function publicClaim(profile, student) {
  return profile?.claim ? { ...profile.claim, studentId: profile.studentId, name: student?.name || profile.hero.name, lessonSlots: slots(student), rosterMissing: !student, activeEncounter: profile.activeEncounter || null } : null;
}
function view(profile, student) {
  if (!profile?.claim) return { status: 'unclaimed' };
  const claim = publicClaim(profile, student);
  return { status: claim.status, claim, ...(claim.status === 'approved' ? { hero: cleanHero(profile.hero, student || {id:profile.studentId,name:profile.hero.name}, profile), activeEncounter: profile.activeEncounter || null } : {}) };
}
function requireTeacher(actor) { if (!actor.isTeacher) deny('teacher_required', 'Only the teacher can approve claims or run a battle.', 403); }
function createHeroRepository(db, { now = Date.now } = {}) {
  function realm(actor) {
    return { root: db.collection('classroomHeroData').doc(actor.teacherId), classes: db.collection('classroomBattles').doc(actor.teacherId).collection('classes') };
  }
  async function execute(actor, body) {
    const { root, classes } = realm(actor), profiles = root.collection('profiles'), accounts = root.collection('accounts');
    const accountRef = accounts.doc(actor.uid), clock = now();
    if (['claims','approve','reject','unlink','battle','wheelAward','assist','endEncounter'].includes(body.type)) requireTeacher(actor);
    if (body.type === 'catalog' || body.type === 'claims') {
      const [rosterSnap, profileSnap] = await Promise.all([db.collection('students').get(), profiles.get()]);
      const roster = docs(rosterSnap).map(s => ({...s.data(),id:s.id})), byId = new Map(docs(profileSnap).map(s => [s.id,s.data()]));
      if (body.type === 'claims') return {
        claims: [...byId].map(([id,p]) => publicClaim(p,roster.find(s=>s.id===id))).filter(Boolean).sort((a,b) => (a.requestedAt||0)-(b.requestedAt||0)),
        activeEncounters:[...byId].filter(([,p])=>p.activeEncounter).map(([id,p])=>({...p.activeEncounter,studentId:id,name:roster.find(s=>s.id===id)?.name || p.hero.name}))
      };
      const lessonSlots = [...new Set(roster.flatMap(slots))].sort();
      return { slots: lessonSlots.map(id => ({id,name:id})), students: roster.filter(s => !body.lessonSlot || slots(s).includes(body.lessonSlot)).filter(s => slots(s).length).map(s => {
        const claim = byId.get(s.id)?.claim;
        return {id:s.id,name:String(s.name || 'Student').slice(0,100),lessonSlots:slots(s),status:claim?.status === 'approved' ? 'claimed' : claim ? 'pending' : 'available'};
      }).sort((a,b) => a.name.localeCompare(b.name)) };
    }
    if (body.type === 'assist') return assist(actor, body, {root,classes,profiles}, clock);
    if (body.type === 'endEncounter') {
      const studentId=studentKey(body.studentId), profile=docData(await profiles.doc(studentId).get());
      if (!profile?.activeEncounter) return {status:'ended'};
      const lock=profile.activeEncounter,state=docData(await classes.doc(key(lock.classId)).get());
      if (!state || state.encounterId!==lock.encounterId || state.status!=='active') {
        await db.runTransaction(async tx=>{
          const ref=profiles.doc(studentId),current=docData(await tx.get(ref));
          if (JSON.stringify(current?.activeEncounter)===JSON.stringify(lock)) tx.set(ref,{...current,activeEncounter:null});
        });
        return {status:'ended'};
      }
      return battle(actor,{type:'battle',classId:lock.classId,action:{type:'end',id:randomUUID(),encounterId:lock.encounterId,expectedRevision:state.revision}},{root,classes,profiles},clock);
    }
    if (body.type === 'battle' && body.action?.type === 'auto') deny('points_required','Refresh the wheel and award points for a correct answer to start the fight.',400);
    if (body.type === 'battle' || body.type === 'wheelAward') return battle(actor, body, {root,classes,profiles}, clock);
    return db.runTransaction(async tx => {
      const account = docData(await tx.get(accountRef));
      if (body.type === 'me' && !account?.studentId) return { status:'unclaimed' };
      if (body.studentId && !actor.isTeacher && body.type === 'configure' && body.studentId !== account?.studentId) deny('not_owned','This hero belongs to another account.',403);
      const id = studentKey(['claim','approve','reject','unlink'].includes(body.type) || (actor.isTeacher && body.type === 'configure' && body.studentId) ? body.studentId : account?.studentId);
      const profileRef = profiles.doc(id), studentRef = db.collection('students').doc(id);
      const [profileSnap, studentSnap] = await Promise.all([tx.get(profileRef),tx.get(studentRef)]);
      const student = studentSnap.exists ? {...studentSnap.data(),id} : null;
      let profile = docData(profileSnap);
      if (body.type === 'me') {
        if (!profile?.claim || profile.claim.uid !== actor.uid) return {status:'unclaimed'};
        return view(profile,student);
      }
      if (!student && ['claim','approve','configure'].includes(body.type)) deny('missing_student','The teacher removed this roster name. Choose your current lesson slot.',404);
      if (body.type === 'claim') {
        if (account?.studentId) {
          if (account.studentId === id && profile?.claim?.uid === actor.uid) return view(profile,student);
          deny('already_claimed','Your account already has a pending or approved hero. Ask your teacher to correct it.');
        }
        if (!slots(student).includes(body.lessonSlot)) deny('invalid_slot','That name is not in this lesson slot.',400);
        if (profile?.claim) deny('name_unavailable','That name already has a claim. Ask your teacher if it belongs to you.');
        if (!profile) profile = migrateHero(student,docs(await tx.get(classes)));
        profile.claim = {uid:actor.uid,email:actor.email,status:'pending',lessonSlot:body.lessonSlot,requestedAt:clock};
        profile.updatedAt = clock;
        tx.set(profileRef,profile); tx.set(accountRef,{studentId:id,status:'pending'});
        return view(profile,student);
      }
      if (['cancelClaim','approve','reject','unlink'].includes(body.type)) {
        if (!profile?.claim) deny('claim_missing','That claim has already been resolved. Refresh the list.');
        const claim = profile.claim, linkedRef = accounts.doc(claim.uid), linked = docData(await tx.get(linkedRef));
        if (body.type === 'cancelClaim' && (claim.uid !== actor.uid || claim.status !== 'pending')) deny('not_owned','Only your pending claim can be cancelled.',403);
        if (body.type === 'approve') {
          if (claim.status === 'approved') return {claim:publicClaim(profile,student)};
          if (linked?.studentId !== id || linked.status !== 'pending') deny('claim_changed','The student changed this claim. Refresh the list.');
          profile.claim = {...claim,status:'approved',approvedAt:clock};
          profile.hero = cleanHero(profile.hero,student,profile);
          tx.set(linkedRef,{studentId:id,status:'approved'});
        } else {
          if (body.type === 'reject' && claim.status !== 'pending') deny('claim_changed','Use Unlink to correct an approved claim.');
          profile.claim = null; profile.hero.uid = null;
          if (linked?.studentId === id) tx.delete(linkedRef);
        }
        profile.updatedAt = clock; tx.set(profileRef,profile);
        return {status:profile.claim?.status || 'unclaimed',claim:publicClaim(profile,student)};
      }
      if (body.type === 'configure') {
        if (!actor.isTeacher && (!profile?.claim || profile.claim.uid !== actor.uid || profile.claim.status !== 'approved' || account?.status !== 'approved')) deny('approval_required','Your teacher needs to approve this claim first.',403);
        if (!profile) profile = migrateHero(student,docs(await tx.get(classes)));
        if (profile.activeEncounter) deny('encounter_active','Finish or end the active encounter before changing your hero.');
        if (!['class','advance','learn','equip'].includes(body.command)) deny('invalid_command','Choose a hero class, job advancement, skill or equipment.',400);
        if (body.expectedRevision !== undefined && body.expectedRevision !== (profile.revision || 0)) deny('hero_changed','Your hero changed on another screen. Refresh and try again.');
        try { profile.hero = Core.configureHero(cleanHero(profile.hero,student,profile),body); }
        catch (e) { deny('invalid_command',e.message,400); }
        if (body.command === 'class') profile.hero.classChosen = true;
        profile.revision = (profile.revision||0)+1; profile.updatedAt=clock;
        tx.set(profileRef,profile); return {...view(profile,student),hero:profile.hero,revision:profile.revision};
      }
      deny('invalid_request','Choose a valid hero action.',400);
    });
  }
  async function assist(actor, body, refs, clock) {
    const {classes,profiles}=refs, classId=body.classId, classRef=classes.doc(key(classId));
    const studentId=studentKey(body.studentId), helpedStudentId=studentKey(body.helpedStudentId), action=body.action || {};
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(action.id || '') || !/^[A-Za-z0-9_-]{8,100}$/.test(action.spinId || '')) deny('invalid_assist','Spin to call a student before recording an assist.',400);
    if (studentId===helpedStudentId) deny('invalid_assist','Choose another student who helped with this question.',400);
    // One helper may earn this bonus once per called question, even if a client
    // retries with a new action ID or a second teacher tab clicks Assist.
    const receiptId=createHash('sha256').update(action.spinId+'\0'+studentId).digest('hex');
    const receiptRef=classRef.collection('assists').doc(receiptId), profileRef=profiles.doc(studentId);
    return db.runTransaction(async tx=>{
      const [receiptSnap,stateSnap,profileSnap,helperSnap,helpedSnap]=await Promise.all([
        tx.get(receiptRef),tx.get(classRef),tx.get(profileRef),tx.get(db.collection('students').doc(studentId)),tx.get(db.collection('students').doc(helpedStudentId))]);
      let state=docData(stateSnap),profile=docData(profileSnap);
      if (receiptSnap.exists) {
        const receipt=receiptSnap.data();
        if (receipt.helpedStudentId!==helpedStudentId) deny('assist_changed','This helper already received XP for this called question.');
        return {hero:profile?.hero || null,state,assist:receipt,duplicate:true};
      }
      if (!helperSnap.exists || !helpedSnap.exists || !slots(helperSnap.data()).includes(classId) || !slots(helpedSnap.data()).includes(classId)) deny('roster_changed','Both students must belong to this Lesson slot. Refresh the wheel.');
      const helper={...helperSnap.data(),id:studentId};
      if (!profile) profile=migrateHero(helper,docs(await tx.get(classes)));
      if (profile.activeEncounter && (profile.activeEncounter.classId!==classId || !state || profile.activeEncounter.encounterId!==state.encounterId)) deny('encounter_active','Finish this helper’s other active encounter before recording an assist.');
      profile.hero=Core.grantAssistXp(cleanHero(profile.hero,helper,profile),6);
      profile.revision=(profile.revision || 0)+1;profile.updatedAt=clock;
      const receipt={id:action.id,spinId:action.spinId,studentId,helpedStudentId,xp:6,createdAt:clock};
      if (state) {
        state=clone(state);
        state.heroes=state.heroes.map(h=>h.studentId===studentId ? profile.hero : h);
        if (state.heroArchive?.[profile.hero.id]) state.heroArchive[profile.hero.id]=profile.hero;
        state.revision=(state.revision || 0)+1;state.updatedAt=clock;state.lastAssist=receipt;
      }
      tx.set(profileRef,profile);tx.set(receiptRef,receipt);if(state)tx.set(classRef,state);
      return {hero:profile.hero,state,assist:receipt};
    });
  }
  async function battle(actor, body, refs, clock) {
    const {classes,profiles} = refs, classId=body.classId, classRef=classes.doc(key(classId)), action=clone(body.action || {});
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(action.id || '')) deny('invalid_action','Invalid battle action.',400);
    let awardRequest=null;
    if (body.type === 'wheelAward') {
      const studentId=studentKey(body.studentId);
      if (!Number.isSafeInteger(body.delta) || body.delta < 1 || body.delta > 10000) deny('invalid_points','Award 1 to 10,000 whole points for a correct answer.',400);
      if (action.type !== 'auto' || action.heroId !== 'student:'+studentId || !/^[A-Za-z0-9_-]{8,100}$/.test(action.spinId || '')) deny('invalid_award','Select a roster student on the wheel before awarding points.',400);
      if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 1000)) deny('invalid_reason','Use an award reason of at most 1,000 characters.',400);
      awardRequest={studentId,delta:body.delta,spinId:action.spinId,reason:body.reason || 'Correct answer on the name wheel'};
      // The browser can select a skill automatically, but only this atomic
      // marks award is allowed to determine its battle power.
      action.points=body.delta;
    }
    const receiptRef=classRef.collection('actions').doc(action.id);
    return db.runTransaction(async tx => {
      const [oldReceipt,oldSnap,rosterSnap] = await Promise.all([tx.get(receiptRef),tx.get(classRef),tx.get(db.collection('students'))]);
      let old=docData(oldSnap);
      const roster=docs(rosterSnap).map(s=>({...s.data(),id:s.id})), rosterById=new Map(roster.map(s=>[s.id,s]));
      if (oldReceipt.exists) {
        if (!awardRequest) return {state:old};
        const receipt=oldReceipt.data();
        if (JSON.stringify(receipt.awardRequest) !== JSON.stringify(awardRequest) || !receipt.award) deny('award_changed','This award was already saved with different details. Refresh the wheel.');
        const currentStudent=rosterById.get(awardRequest.studentId);
        return {state:old,award:{...receipt.award,...(currentStudent ? {marks:currentStudent.marks || 0} : {})},duplicate:true};
      }
      let awardedStudent=null,award=null,schoolBosses=[];
      if (awardRequest) {
        awardedStudent=rosterById.get(awardRequest.studentId);
        if (!awardedStudent || !slots(awardedStudent).includes(classId)) deny('roster_changed','That student is no longer in this lesson slot. Refresh the wheel.',409);
        const marks=awardedStudent.marks || 0;
        if (!Number.isSafeInteger(marks) || !Number.isSafeInteger(marks+awardRequest.delta)) deny('invalid_balance','This marks balance needs to be corrected before awarding points.',409);
        award={id:action.id,studentId:awardRequest.studentId,delta:awardRequest.delta,marks:marks+awardRequest.delta};
        schoolBosses=docs(await tx.get(db.collection('bosses').where('active','==',true)));
      }
      const starting=action.type==='start' || (action.type==='auto' && (!old || old.status!=='active'));
      const syncing=action.type==='sync' && !action.command;
      const incoming=(starting || syncing || (action.type==='auto' && Array.isArray(action.heroes))) ? action.heroes : old?.heroes;
      if (!Array.isArray(incoming) || !incoming.length || incoming.length>100) deny('invalid_roster','Choose a lesson slot with 1–100 heroes.',400);
      const identities=incoming.map(h=>{
        const id=studentKey(h.studentId || (h.id || '').replace(/^student:/,'')), student=rosterById.get(id);
        if (student) {
          // A departing student can finish/end their existing encounter; new
          // encounters and roster updates must use the current lesson slot.
          if ((starting || syncing || action.type==='auto') && !slots(student).includes(classId)) deny('roster_changed','The lesson roster changed. Refresh the wheel.',409);
          return student;
        }
        if (!/^wheel-[a-z0-9]+$/.test(id)) {
          if (!starting && !syncing && old?.heroes.some(x=>x.studentId===id)) return {id,name:h.name,removed:true};
          deny('missing_student','A roster name was removed. Refresh the wheel.',409);
        }
        return {id,name:String(h.name || 'Guest hero').slice(0,100),guest:true};
      });
      const oldIds=(old?.heroes || []).map(h=>h.studentId).filter(id=>rosterById.has(id));
      const ids=[...new Set([...identities.filter(s=>!s.guest).map(s=>s.id),...oldIds])];
      const snapshots=await Promise.all(ids.map(id=>tx.get(profiles.doc(id))));
      const profileMap=new Map(snapshots.map((s,i)=>[ids[i],docData(s)]));
      const missing=ids.filter(id=>!profileMap.get(id)).map(id=>identities.find(s=>s.id===id)||rosterById.get(id));
      const legacy=missing.length?docs(await tx.get(classes)):[];
      for (const student of missing) profileMap.set(student.id,migrateHero(student,legacy));
      const mapId=new Map();
      for (const h of [...(old?.heroes || []),...Object.values(old?.heroArchive || {})]) {
        const studentId=h.studentId || roster.find(s=>s.uid && h.id==='uid:'+s.uid)?.id;
        if (studentId) mapId.set(h.id,'student:'+studentId);
      }
      if (old) {
        old=clone(old); old.heroes=old.heroes.map(h=>({...h,id:mapId.get(h.id)||h.id}));
        old.heroArchive=Object.fromEntries(Object.values(old.heroArchive||{}).map(h=>{const id=mapId.get(h.id)||h.id;return [id,{...h,id}];}));
        if (old.pending) old.pending.heroId=mapId.get(old.pending.heroId)||old.pending.heroId;
        if (old.poison) old.poison.heroId=mapId.get(old.poison.heroId)||old.poison.heroId;
      }
      if (action.heroId) action.heroId=mapId.get(action.heroId)||action.heroId;
      if (action.targetId) action.targetId=mapId.get(action.targetId)||action.targetId;
      const otherEncounter=new Set();
      for (const student of identities.filter(s=>!s.guest)) {
        const profile=profileMap.get(student.id), lock=profile.activeEncounter;
        if (lock && (lock.classId!==classId || (!starting && old?.encounterId!==lock.encounterId))) {
          if (action.type==='end') otherEncounter.add(student.id);
          else deny('encounter_active',student.name+' is in an active encounter in '+lock.classId+'. End it before starting another.');
        }
      }
      const canonical=identities.map((student,i)=> {
        if (student.guest) {
          const identity={id:'student:'+student.id,studentId:student.id,uid:null,name:student.name};
          const priorGuest=old?.heroes.find(h=>h.id===identity.id) || old?.heroArchive?.[identity.id];
          return Core.cleanHero({...identity,role:incoming[i].role},priorGuest);
        }
        return cleanHero(profileMap.get(student.id).hero,student,profileMap.get(student.id));
      });
      if (starting || syncing || action.type==='auto') action.heroes=canonical;
      // A new encounter can retain progression even when this slot has never
      // hosted this student. Supplying prior canonical heroes is server-only.
      const prior=old ? {...old,heroes:old.heroes.map(h=>canonical.find(c=>c.studentId===h.studentId)||h)} : null;
      if (prior) {
        prior.heroArchive={...(prior.heroArchive || {})};
        for (const hero of canonical) {
          if (!prior.heroes.some(h=>h.id===hero.id)) prior.heroArchive[hero.id]=hero;
        }
      }
      if (starting) {
        if (prior) prior.heroes=canonical;
        else action.heroes=canonical;
      }
      let next;
      try {
        // Core deliberately distrusts client-provided progression on first
        // start. Seed its archive with trusted canonical profiles instead.
        const seeded=prior || (starting ? {revision:0,heroes:canonical,heroArchive:{}} : null);
        if (!prior && starting) action.expectedRevision=0;
        next=Core.reduce(seeded,action);
      } catch(e) { deny('battle_changed',e.message,409); }
      if (next===prior) {
        if (award) deny('award_changed','This battle action was already resolved. Refresh the wheel before awarding points.');
        if (!missing.length && JSON.stringify(prior)===JSON.stringify(docData(oldSnap))) return {state:old};
        next={...prior,revision:prior.revision+1,lastEvent:{id:action.id,type:'sync',targets:[],healed:[]}};
      }
      next={...next,teacherId:actor.teacherId,classId,updatedAt:clock};
      const activeIds=new Set(next.heroes.map(h=>h.studentId));
      for (const [id,profile] of profileMap) {
        if (otherEncounter.has(id)) continue;
        const hero=next.heroes.find(h=>h.studentId===id);
        if (hero) {
          profile.hero=hero; profile.activeEncounter=next.status==='active'?{classId,encounterId:next.encounterId}:null;
          profile.revision=(profile.revision||0)+1; profile.updatedAt=clock;
        } else if (!activeIds.has(id) && profile.activeEncounter?.classId===classId) profile.activeEncounter=null;
        tx.set(profiles.doc(id),profile);
      }
      if (award) {
        const studentId=awardedStudent.id,studentData=docs(rosterSnap).find(s=>s.id===studentId).data();
        tx.set(db.collection('students').doc(studentId),{...studentData,marks:award.marks});
        const ledgerId='wheel-'+createHash('sha256').update(actor.teacherId+'\0'+classId+'\0'+action.id).digest('hex');
        const timestamp=Timestamp.fromMillis(clock);
        tx.set(db.collection('awards').doc(ledgerId),{studentId,studentName:awardedStudent.name || '',delta:award.delta,reason:awardRequest.reason,source:'annotator',by:actor.email,undone:false,createdAt:timestamp});
        for (const snap of schoolBosses) {
          const boss=snap.data();
          if (boss.defeated || !Number.isFinite(boss.hp) || boss.hp<=0) continue;
          const hp=Math.max(0,boss.hp-award.delta);
          tx.set(db.collection('bosses').doc(snap.id),{...boss,hp,...(hp===0 ? {defeated:true,defeatedAt:timestamp} : {})});
        }
      }
      tx.set(classRef,next); tx.set(receiptRef,{encounterId:next.encounterId,revision:next.revision,type:action.type,...(award ? {awardRequest,award} : {})});
      return {state:next,...(award ? {award} : {})};
    });
  }
  return {execute};
}
module.exports={createHeroRepository,migrateHero,slots,key};
