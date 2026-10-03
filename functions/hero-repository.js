'use strict';

const Core = require('./hero-game/battle-core');
const Missions = require('./hero-game/mission-content');
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
function guestIds(saved, roster, classId) {
  const allowed=new Map(roster.filter(s=>slots(s).length && !slots(s).includes(classId)).map(s=>[s.id,s]));
  return [...new Set(Array.isArray(saved?.studentIds)?saved.studentIds:[])].filter(id=>allowed.has(id));
}
function lessonMember(student, classId, guests=[]) { return !!student && (slots(student).includes(classId) || guests.includes(student.id)); }
function guestViews(ids, roster) {
  return ids.map(id=>roster.find(s=>s.id===id)).filter(Boolean).map(s=>({studentId:s.id,name:String(s.name||'Student').slice(0,100),lessonSlots:slots(s)})).sort((a,b)=>a.name.localeCompare(b.name));
}
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
function createHeroRepository(db, { now = Date.now, random = () => require('node:crypto').randomInt(0,0x100000000)/0x100000000 } = {}) {
  function realm(actor) {
    return { root: db.collection('classroomHeroData').doc(actor.teacherId), classes: db.collection('classroomBattles').doc(actor.teacherId).collection('classes') };
  }
  async function execute(actor, body) {
    const { root, classes } = realm(actor), profiles = root.collection('profiles'), accounts = root.collection('accounts');
    const accountRef = accounts.doc(actor.uid), clock = now();
    if (['claims','approve','reject','unlink','battle','wheelAward','assist','mission','lessonGuests','endEncounter'].includes(body.type)) requireTeacher(actor);
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
    if (body.type === 'lessonGuests') return lessonGuests(actor,body,{root,classes,profiles},clock);
    if (body.type === 'mission') return missionAction(actor,body,{root,classes,profiles},clock);
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
        const appearance=body.command==='appearance';
        if (profile.activeEncounter && !appearance) deny('encounter_active','Finish or end the active encounter before changing your hero.');
        if (!['class','advance','learn','equip','appearance'].includes(body.command)) deny('invalid_command','Choose a hero class, job advancement, skill, equipment or appearance.',400);
        let appearanceRef=null,appearanceReceipt=null,activeRef=null,activeState=null;
        if (appearance) {
          if (body.gender!=='male' && body.gender!=='female') deny('invalid_command','Choose a male or female hero appearance.',400);
          if (body.id!==undefined) {
            if (typeof body.id!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id)) deny('invalid_action','Invalid appearance action.',400);
            appearanceRef=profileRef.collection('appearances').doc(body.id);
            appearanceReceipt=docData(await tx.get(appearanceRef));
            if (appearanceReceipt && (appearanceReceipt.gender!==body.gender || appearanceReceipt.uid!==actor.uid)) deny('appearance_changed','That appearance action was already saved with different details. Refresh your hero.');
          }
          // Cosmetics may change during a selected answer. Update only the
          // matching live snapshot, so later combat cannot restore old artwork.
          if (profile.activeEncounter) {
            const lock=profile.activeEncounter;
            activeRef=classes.doc(key(lock.classId));
            const saved=docData(await tx.get(activeRef));
            if (saved?.status==='active' && saved.encounterId===lock.encounterId) activeState=saved;
          }
          if (appearanceReceipt) return {...view(profile,student),hero:cleanHero(profile.hero,student,profile),revision:profile.revision || 0,duplicate:true,...(actor.isTeacher ? {state:activeState} : {})};
        }
        if (body.expectedRevision !== undefined && body.expectedRevision !== (profile.revision || 0)) deny('hero_changed','Your hero changed on another screen. Refresh and try again.');
        try { profile.hero = Core.configureHero(cleanHero(profile.hero,student,profile),body); }
        catch (e) { deny('invalid_command',e.message,400); }
        if (body.command === 'class') profile.hero.classChosen = true;
        profile.revision = (profile.revision||0)+1; profile.updatedAt=clock;
        if (activeState) {
          const matches=h=>h.studentId===id || h.id===profile.hero.id;
          activeState.heroes=activeState.heroes.map(h=>matches(h)?{...h,gender:body.gender}:h);
          activeState.heroArchive=Object.fromEntries(Object.entries(activeState.heroArchive || {}).map(([key,h])=>[key,matches(h)?{...h,gender:body.gender}:h]));
          activeState.revision=(activeState.revision || 0)+1;activeState.updatedAt=clock;
          tx.set(activeRef,activeState);
        }
        if (appearanceRef) tx.set(appearanceRef,{uid:actor.uid,gender:body.gender,createdAt:clock});
        tx.set(profileRef,profile); return {...view(profile,student),hero:profile.hero,revision:profile.revision,...(appearance && actor.isTeacher ? {state:activeState} : {})};
      }
      deny('invalid_request','Choose a valid hero action.',400);
    });
  }
  async function lessonGuests(actor,body,refs,clock) {
    const {root,classes,profiles}=refs,classId=body.classId,encoded=key(classId),classRef=classes.doc(encoded),guestRef=root.collection('lessonGuests').doc(encoded);
    const command=body.command;
    if(!['get','add','remove'].includes(command))deny('invalid_guest','Choose a temporary student action.',400);
    const mutation=command!=='get',studentId=mutation?studentKey(body.studentId):null;
    if(mutation && (typeof body.id!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id)))deny('invalid_guest','Invalid temporary student action.',400);
    const receiptRef=mutation?guestRef.collection('actions').doc(body.id):null,request={command,studentId};
    return db.runTransaction(async tx=>{
      const [guestSnap,stateSnap,rosterSnap,receiptSnap]=await Promise.all([tx.get(guestRef),tx.get(classRef),tx.get(db.collection('students')),receiptRef?tx.get(receiptRef):null]);
      const saved=docData(guestSnap),roster=docs(rosterSnap).map(s=>({...s.data(),id:s.id}));
      let ids=guestIds(saved,roster,classId),state=docData(stateSnap);
      // An old receipt only acknowledges its original save; it must never
      // replay membership after a later add/remove on another screen.
      if(receiptSnap?.exists){
        if(JSON.stringify(receiptSnap.data().request)!==JSON.stringify(request))deny('guest_changed','This temporary student action was already saved with different details. Refresh the list.');
        return {guests:guestViews(ids,roster),state,duplicate:true};
      }
      // A removed register entry cannot remain a hidden battle participant.
      // Becoming a permanent member only removes the temporary label; that
      // hero stays in the encounter with its existing lock.
      const staleIds=[...new Set(saved?.studentIds||[])].filter(id=>!roster.some(s=>s.id===id && slots(s).length));
      const staleHeroes=state?.status==='active'?state.heroes.filter(h=>staleIds.includes(h.studentId)):[];
      if(staleHeroes.some(h=>h.id===state.pending?.heroId))deny('guest_pending','Resolve or skip this student’s selected answer before updating temporary students.');
      const staleProfiles=await Promise.all(staleIds.map(async id=>({id,profile:docData(await tx.get(profiles.doc(id)))})));
      if(staleHeroes.length){
        const heroes=state.heroes.filter(h=>!staleIds.includes(h.studentId));
        state={...state,heroes,heroArchive:{...(state.heroArchive||{}),...Object.fromEntries(staleHeroes.map(h=>[h.id,h]))},revision:(state.revision||0)+1,updatedAt:clock,...(!heroes.length?{status:'defeat',pending:null}:{})};
      }
      if(command==='add' && !roster.some(s=>slots(s).includes(classId)))deny('roster_changed','Choose a Lesson slot with registered students.',400);
      const student=mutation?roster.find(s=>s.id===studentId):null;
      let profile=null,profileRef=null,writeProfile=false;
      if(command==='add'){
        if(!student || !slots(student).length)deny('missing_student','Choose a registered student from another Lesson slot.',404);
        if(slots(student).includes(classId))deny('already_in_slot','This student already belongs to this Lesson slot.',400);
        profileRef=profiles.doc(studentId);profile=docData(await tx.get(profileRef));
        if(!profile){profile=migrateHero(student,docs(await tx.get(classes)));writeProfile=true;}
        const lock=profile.activeEncounter;
        if(lock && (lock.classId!==classId || state?.status!=='active' || state.encounterId!==lock.encounterId))deny('encounter_active',student.name+' is in an active encounter in '+lock.classId+'. Finish or end it before adding this student.');
        if(!ids.includes(studentId))ids.push(studentId);
        if(roster.filter(s=>slots(s).includes(classId)).length+ids.length>100)deny('invalid_roster','A Lesson slot can have at most 100 battle heroes.',400);
        if(state?.status==='active' && !state.heroes.some(h=>h.studentId===studentId)){
          if(state.heroes.length>=100)deny('invalid_roster','A Lesson slot can have at most 100 battle heroes.',400);
          const hero=cleanHero(profile.hero,student,profile);
          state={...state,heroes:[...state.heroes,hero],heroArchive:{...(state.heroArchive||{}),[hero.id]:hero},revision:(state.revision||0)+1,updatedAt:clock};
          profile.hero=hero;profile.activeEncounter={classId,encounterId:state.encounterId};writeProfile=true;
        }
      } else if(command==='remove'){
        if(saved?.studentIds?.includes(studentId) && state?.status==='active' && !slots(student).includes(classId) && state.heroes.some(h=>h.studentId===studentId)){
          const hero=state.heroes.find(h=>h.studentId===studentId);
          if(state.pending?.heroId===hero.id)deny('guest_pending','Resolve or skip this student’s selected answer before removing them.');
          profileRef=profiles.doc(studentId);profile=docData(await tx.get(profileRef));
          const heroes=state.heroes.filter(h=>h.studentId!==studentId);
          state={...state,heroes,heroArchive:{...(state.heroArchive||{}),[hero.id]:hero},revision:(state.revision||0)+1,updatedAt:clock,...(!heroes.length?{status:'defeat',pending:null}:{})};
          if(profile?.activeEncounter?.classId===classId && profile.activeEncounter.encounterId===state.encounterId){profile.activeEncounter=null;writeProfile=true;}
        }
        ids=ids.filter(id=>id!==studentId);
      }
      const membershipChanged=JSON.stringify(ids)!==JSON.stringify(saved?.studentIds||[]);
      if(membershipChanged)tx.set(guestRef,{schemaVersion:1,classId,studentIds:ids,revision:(saved?.revision||0)+1,updatedAt:clock});
      for(const {id,profile:stale} of staleProfiles){
        if(stale?.activeEncounter?.classId===classId && (!state || stale.activeEncounter.encounterId===state.encounterId))tx.set(profiles.doc(id),{...stale,activeEncounter:null,revision:(stale.revision||0)+1,updatedAt:clock});
      }
      if(writeProfile){profile.revision=(profile.revision||0)+1;profile.updatedAt=clock;tx.set(profileRef,profile);}
      if(JSON.stringify(state)!==JSON.stringify(docData(stateSnap)))tx.set(classRef,state);
      if(receiptRef)tx.set(receiptRef,{request,createdAt:clock});
      return {guests:guestViews(ids,roster),state};
    });
  }
  function payoutMission(tx,actor,classId,before,after,roster,clock,markOverrides=new Map(),guests=[]) {
    const payout=after?.lastPayout;
    if(!payout || payout.kind!=='points' || before?.lastPayout?.id===payout.id)return;
    const party=roster.map(s=>({...s.data(),id:s.id,original:s.data()})).filter(s=>lessonMember(s,classId,guests));
    for(const student of party){
      const marks=markOverrides.has(student.id)?markOverrides.get(student.id):student.marks||0;
      if(!Number.isSafeInteger(marks)||!Number.isSafeInteger(marks+5))deny('invalid_balance','Correct the class marks balance before completing this mission.');
    }
    payout.awards=party.map(student=>{
      const marks=(markOverrides.has(student.id)?markOverrides.get(student.id):student.marks||0)+5;
      const id=student.id;
      tx.set(db.collection('students').doc(id),{...student.original,marks});
      const ledgerId='mission-'+createHash('sha256').update(actor.teacherId+'\0'+classId+'\0'+payout.id+'\0'+id).digest('hex');
      tx.set(db.collection('awards').doc(ledgerId),{studentId:id,studentName:student.name||'',delta:5,reason:'Class mission: '+after.current.objectiveName,source:'annotator',by:actor.email,undone:false,createdAt:Timestamp.fromMillis(clock)});
      return {studentId:id,marks,delta:5};
    });
  }
  async function missionAction(actor,body,refs,clock){
    const {root,classes}=refs,classId=body.classId,encoded=key(classId),classRef=classes.doc(encoded),missionRef=root.collection('missions').doc(encoded);
    const command=body.command;
    if(!['get','turn','cancel','focus','incorrect','redeem'].includes(command))deny('invalid_mission','Choose a mission action.',400);
    if(command==='get'){
      return db.runTransaction(async tx=>{
        const [saved,stateSnap]=await Promise.all([tx.get(missionRef),tx.get(classRef)]);
        const before=docData(stateSnap);let state=Core.rebalanceEnemyHealth(before);
        // Opening either battle screen updates a legacy encounter once. Keep
        // this isolated from hero progression, mission prizes and combat turns.
        if(state!==before){
          state={...state,revision:(before.revision||0)+1,updatedAt:clock};
          tx.set(classRef,state);
        }
        return {mission:Missions.clean(docData(saved)),state};
      });
    }
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(body.id||''))deny('invalid_mission','Invalid mission action.',400);
    if(command==='incorrect'&&!/^[A-Za-z0-9_-]{8,100}$/.test(body.spinId||''))deny('invalid_mission','Spin to call a student before recording an incorrect answer.',400);
    const receiptId=command==='incorrect'?'incorrect-'+createHash('sha256').update(String(body.missionId)+'\0'+body.spinId).digest('hex'):body.id;
    const receiptRef=missionRef.collection('actions').doc(receiptId);
    const request={command,missionId:body.missionId||null,spinId:body.spinId||null,prizeId:body.prizeId||null};
    // Randomness is private and sampled once, outside Firestore retry callbacks.
    const objectiveRoll=command==='turn'?random():0,prizeRoll=command==='turn'?random():0;
    return db.runTransaction(async tx=>{
      const [receiptSnap,missionSnap,stateSnap,rosterSnap,guestSnap]=await Promise.all([tx.get(receiptRef),tx.get(missionRef),tx.get(classRef),tx.get(db.collection('students')),tx.get(root.collection('lessonGuests').doc(encoded))]);
      const before=Missions.clean(docData(missionSnap));let next=Missions.clean(before),state=docData(stateSnap);
      if(receiptSnap.exists){
        if(JSON.stringify(receiptSnap.data().request)!==JSON.stringify(request))deny('mission_changed','This mission action was already saved with different details.');
        return {mission:before,state,duplicate:true};
      }
      const roster=docs(rosterSnap).map(s=>({...s.data(),id:s.id}));
      const guests=guestIds(docData(guestSnap),roster,classId);
      if(!roster.some(s=>slots(s).includes(classId)))deny('roster_changed','Choose a Lesson slot with students.',400);
      if(command==='turn'){
        if(body.expectedRevision!==before.revision)deny('mission_changed','The mission changed on another screen. Refresh before turning.');
        try {next=Missions.start(before,{id:body.id,now:clock,objectiveRoll,prizeRoll,encounterId:state?.status==='active'?state.encounterId:null});}
        catch(e){deny('mission_active',e.message);}
      } else if(command==='redeem'){
        const reward=next.bank.find(p=>p.id===body.prizeId);
        if(!reward||reward.kind!=='minutes')deny('invalid_mission','Choose a Blooket or Gimkit minute prize.',400);
        if(reward.status!=='available')deny('mission_changed','This class prize has already been redeemed.');
        reward.status='redeemed';reward.redeemedAt=clock;next.revision++;
      } else {
        if(!next.current||next.current.id!==body.missionId||next.current.status!=='active')deny('mission_changed','This mission is no longer active. Refresh the mission machine.');
        if(command==='cancel'){next.current.status='cancelled';next.current.cancelledAt=clock;next.revision++;}
        else if(command==='focus'){
          if(next.current.objectiveId!=='focus')deny('invalid_mission','The active mission is not a focus challenge.',400);
          try{next=Missions.progress(next,{kind:'focus',now:clock});}catch(e){deny('focus_not_ready',e.message);}
        }else next=Missions.progress(next,{kind:'incorrect',now:clock});
      }
      payoutMission(tx,actor,classId,before,next,docs(rosterSnap),clock,new Map(),guests);
      next.updatedAt=clock;tx.set(missionRef,next);tx.set(receiptRef,{request,revision:next.revision,createdAt:clock});
      if(state){state={...state,revision:(state.revision||0)+1,missionRevision:next.revision,updatedAt:clock};tx.set(classRef,state);}
      return {mission:next,state};
    });
  }
  async function assist(actor, body, refs, clock) {
    const {root,classes,profiles}=refs, classId=body.classId, classRef=classes.doc(key(classId)),missionRef=root.collection('missions').doc(key(classId));
    const studentId=studentKey(body.studentId), helpedStudentId=studentKey(body.helpedStudentId), action=body.action || {};
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(action.id || '') || !/^[A-Za-z0-9_-]{8,100}$/.test(action.spinId || '')) deny('invalid_assist','Spin to call a student before recording an assist.',400);
    if (studentId===helpedStudentId) deny('invalid_assist','Choose another student who helped with this question.',400);
    // One helper may earn this bonus once per called question, even if a client
    // retries with a new action ID or a second teacher tab clicks Assist.
    const receiptId=createHash('sha256').update(action.spinId+'\0'+studentId).digest('hex');
    const receiptRef=classRef.collection('assists').doc(receiptId), profileRef=profiles.doc(studentId);
    return db.runTransaction(async tx=>{
      const [receiptSnap,stateSnap,profileSnap,helperSnap,helpedSnap,missionSnap,rosterSnap,guestSnap]=await Promise.all([
        tx.get(receiptRef),tx.get(classRef),tx.get(profileRef),tx.get(db.collection('students').doc(studentId)),tx.get(db.collection('students').doc(helpedStudentId)),tx.get(missionRef),tx.get(db.collection('students')),tx.get(root.collection('lessonGuests').doc(key(classId)))]);
      let state=docData(stateSnap),profile=docData(profileSnap);
      const beforeMission=Missions.clean(docData(missionSnap));
      if (receiptSnap.exists) {
        const receipt=receiptSnap.data();
        if (receipt.helpedStudentId!==helpedStudentId) deny('assist_changed','This helper already received XP for this called question.');
        return {hero:profile?.hero || null,state,assist:receipt,mission:beforeMission,duplicate:true};
      }
      const guests=guestIds(docData(guestSnap),docs(rosterSnap).map(s=>({...s.data(),id:s.id})),classId);
      if (!helperSnap.exists || !helpedSnap.exists || !lessonMember({...helperSnap.data(),id:studentId},classId,guests) || !lessonMember({...helpedSnap.data(),id:helpedStudentId},classId,guests)) deny('roster_changed','Both students must belong to this Lesson slot or be added as temporary students. Refresh the wheel.');
      const helper={...helperSnap.data(),id:studentId};
      if (!profile) profile=migrateHero(helper,docs(await tx.get(classes)));
      if (profile.activeEncounter && (profile.activeEncounter.classId!==classId || !state || profile.activeEncounter.encounterId!==state.encounterId)) deny('encounter_active','Finish this helper’s other active encounter before recording an assist.');
      profile.hero=Core.grantAssistXp(cleanHero(profile.hero,helper,profile),6);
      profile.revision=(profile.revision || 0)+1;profile.updatedAt=clock;
      const receipt={id:action.id,spinId:action.spinId,studentId,helpedStudentId,xp:6,createdAt:clock};
      const mission=Missions.progress(beforeMission,{kind:'assist',now:clock});
      if (state) {
        state=clone(state);
        state.heroes=state.heroes.map(h=>h.studentId===studentId ? profile.hero : h);
        if (state.heroArchive?.[profile.hero.id]) state.heroArchive[profile.hero.id]=profile.hero;
        state.revision=(state.revision || 0)+1;state.updatedAt=clock;state.lastAssist=receipt;
      }
      payoutMission(tx,actor,classId,beforeMission,mission,docs(rosterSnap),clock,new Map(),guests);
      if(mission.revision!==beforeMission.revision){mission.updatedAt=clock;tx.set(missionRef,mission);if(state)state.missionRevision=mission.revision;}
      tx.set(profileRef,profile);tx.set(receiptRef,receipt);if(state)tx.set(classRef,state);
      return {hero:profile.hero,state,assist:receipt,mission};
    });
  }
  async function battle(actor, body, refs, clock) {
    const {root,classes,profiles} = refs, classId=body.classId, classRef=classes.doc(key(classId)),missionRef=root.collection('missions').doc(key(classId)), action=clone(body.action || {});
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
      const [oldReceipt,oldSnap,rosterSnap,missionSnap,guestSnap] = await Promise.all([tx.get(receiptRef),tx.get(classRef),tx.get(db.collection('students')),tx.get(missionRef),tx.get(root.collection('lessonGuests').doc(key(classId)))]);
      let old=docData(oldSnap);
      const beforeMission=Missions.clean(docData(missionSnap));let mission=Missions.clean(beforeMission);
      const roster=docs(rosterSnap).map(s=>({...s.data(),id:s.id})), rosterById=new Map(roster.map(s=>[s.id,s]));
      const guests=guestIds(docData(guestSnap),roster,classId);
      if (oldReceipt.exists) {
        if (!awardRequest) return {state:old,mission};
        const receipt=oldReceipt.data();
        if (JSON.stringify(receipt.awardRequest) !== JSON.stringify(awardRequest) || !receipt.award) deny('award_changed','This award was already saved with different details. Refresh the wheel.');
        const currentStudent=rosterById.get(awardRequest.studentId);
        return {state:old,mission,award:{...receipt.award,...(currentStudent ? {marks:currentStudent.marks || 0} : {})},duplicate:true};
      }
      let answerRef=null,answerAlreadyCounted=false;
      if(mission.current?.status==='active'&&mission.current.objectiveId==='correct-streak'&&(action.type==='auto'||(action.type==='answer'&&action.outcome==='correct'))){
        const questionId=action.type==='auto'?action.spinId:action.turnId;
        const answerKey=createHash('sha256').update(mission.current.id+'\0'+String(questionId)).digest('hex');
        answerRef=missionRef.collection('answers').doc(answerKey);answerAlreadyCounted=(await tx.get(answerRef)).exists;
      }
      let awardedStudent=null,award=null,schoolBosses=[];
      if (awardRequest) {
        awardedStudent=rosterById.get(awardRequest.studentId);
        if (!lessonMember(awardedStudent,classId,guests)) deny('roster_changed','That student is no longer in this lesson slot. Refresh the wheel.',409);
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
          if ((starting || syncing || action.type==='auto') && !lessonMember(student,classId,guests)) deny('roster_changed','The lesson roster changed. Refresh the wheel.',409);
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
      if(action.type==='summon'){
        if(!['teacher','reward'].includes(action.source))deny('invalid_summon','Choose teacher help or a class summon reward.',400);
        if(action.source==='reward'){
          const token=mission.bank.find(p=>p.kind==='summon'&&p.status==='available');
          if(!token)deny('summon_unavailable','Earn a Summon One-Punch Chung reward first.');
          token.status='redeemed';token.redeemedAt=clock;token.encounterId=old?.encounterId||null;
          mission.summonTokens--;mission.revision++;
        }
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
        if (!missing.length && JSON.stringify(prior)===JSON.stringify(docData(oldSnap))) return {state:old,mission};
        next={...prior,revision:prior.revision+1,lastEvent:{id:action.id,type:'sync',targets:[],healed:[]}};
      }
      if(starting)mission=Missions.progress(mission,{kind:'encounter',encounterId:next.encounterId,now:clock});
      if(!answerAlreadyCounted&&(action.type==='auto'||(action.type==='answer'&&action.outcome==='correct')))mission=Missions.progress(mission,{kind:'correct',encounterId:next.encounterId,now:clock});
      if(action.type==='answer'&&action.outcome==='incorrect')mission=Missions.progress(mission,{kind:'incorrect',now:clock});
      if(next.status==='victory'&&(old?.status!=='victory'||old?.encounterId!==next.encounterId))mission=Missions.progress(mission,{kind:'victory',encounterId:next.encounterId,now:clock});
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
      payoutMission(tx,actor,classId,beforeMission,mission,docs(rosterSnap),clock,new Map(award?[[award.studentId,award.marks]]:[]),guests);
      if(answerRef&&!answerAlreadyCounted)tx.set(answerRef,{actionId:action.id,createdAt:clock});
      if(award&&mission.lastPayout?.id!==beforeMission.lastPayout?.id){const bonus=mission.lastPayout?.awards.find(row=>row.studentId===award.studentId);if(bonus)award.marks=bonus.marks;}
      if(mission.revision!==beforeMission.revision){mission.updatedAt=clock;tx.set(missionRef,mission);next.missionRevision=mission.revision;}
      tx.set(classRef,next); tx.set(receiptRef,{encounterId:next.encounterId,revision:next.revision,type:action.type,...(award ? {awardRequest,award} : {})});
      return {state:next,mission,...(award ? {award} : {})};
    });
  }
  return {execute};
}
module.exports={createHeroRepository,migrateHero,slots,key};
