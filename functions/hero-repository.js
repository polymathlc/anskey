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
// Attendance expires at the next Singapore calendar day, independently of devices.
function lessonDate(clock) {return new Date(clock+8*60*60*1000).toISOString().slice(0,10);}
function absentIds(saved,roster,clock) {return saved?.absentDate===lessonDate(clock)?[...new Set(saved.absentIds || [])].filter(id=>roster.some(s=>s.id===id)):[];}
function lessonMember(student, classId, guests=[],absent=[]) { return !!student && !absent.includes(student.id) && (slots(student).includes(classId) || guests.includes(student.id)); }
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
// ---- The item ledger (v1.158.0) ----
// classroomHeroData/{teacher}/itemLedger is APPEND ONLY: one document per
// battle action that gave items, per teacher gift and per restore. Nothing
// ever edits or deletes one, so it outlives any bug in the inventory code.
const LEDGER='itemLedger';
const GIFT_TYPES=['any','equipment','pet','rune','consumable'];
const LEDGER_MAX_ROWS=400;
function inventoryGains(before,after) {
  const had=new Map((before || []).filter(e=>e && e.id).map(e=>[e.id,Number(e.quantity) || 0]));
  return (after || []).filter(e=>e && e.id && Core.itemById(e.itemId)).flatMap(e=>{
    const gain=(Number(e.quantity) || 0)-(had.get(e.id) || 0);
    return gain>0 ? [{entryId:e.id,itemId:e.itemId,quantity:gain,...(Array.isArray(e.sockets) ? {sockets:e.sockets.length} : {})}] : [];
  });
}
function dropEntry(hero,gain,source) {
  const item=Core.itemById(gain.itemId),studentId=String(hero.studentId || '');
  const guest=!studentId || /^wheel-/.test(studentId);
  return {studentId:guest?null:studentId,heroId:String(hero.id || ''),name:String(hero.name || 'Student').slice(0,100),guest,
    itemId:gain.itemId,itemName:item.name,rarity:item.rarity,type:item.type,quantity:gain.quantity,
    ...(Number.isInteger(gain.sockets) ? {sockets:gain.sockets} : {}),source:String(source || 'battle').slice(0,40)};
}
function ledgerDoc({kind,source,classId,encounterId,actionId,by,clock,entries,extraKeys=[]}) {
  return {schemaVersion:1,kind,source,classId:classId || null,encounterId:encounterId || null,actionId:actionId || null,by:by || '',createdAt:clock,
    studentIds:[...new Set([...entries.map(e=>e.guest ? 'guests' : e.studentId),...extraKeys].filter(Boolean))],
    restoreKeys:[...new Set(entries.map(e=>e.restoreOf).filter(Boolean))],entries};
}
// Teacher gifts use the ordinary drop weights for "random", or one rarity.
function giftItem({rarity,itemType:type,itemId},rarityRoll,itemRoll) {
  if (!GIFT_TYPES.includes(type || 'any')) deny('invalid_gift','Choose an item type.',400);
  if (itemId) {
    const item=Core.itemById(itemId);
    if (typeof itemId!=='string' || !item) deny('invalid_gift','Choose an item from the catalogue.',400);
    return item;
  }
  const keys=Object.keys(Core.RARITIES);
  if (rarity!=='random' && !keys.includes(rarity)) deny('invalid_gift','Choose a rarity or Random.',400);
  const fits=i=>!type || type==='any' || i.type===type;
  let chosen=rarity;
  if (rarity==='random') {
    // Only rarities that hold an item of this type can be rolled.
    const open=keys.filter(k=>Object.values(Core.ITEMS).some(i=>i.rarity===k && fits(i)));
    const total=open.reduce((n,k)=>n+Core.RARITIES[k].weight,0);let sum=0;chosen=open[open.length-1];
    for (const k of open) { sum+=Core.RARITIES[k].weight; if (rarityRoll*total<sum) { chosen=k; break; } }
  }
  const pool=Object.values(Core.ITEMS).filter(i=>i.rarity===chosen && fits(i));
  if (!pool.length) deny('invalid_gift','There is no '+String(type)+' item of '+Core.RARITIES[chosen].name+' rarity. Choose another rarity or type.',400);
  return pool[Math.min(pool.length-1,Math.floor(itemRoll*pool.length))];
}
function createHeroRepository(db, { now = Date.now, random = () => require('node:crypto').randomInt(0,0x100000000)/0x100000000 } = {}) {
  function realm(actor) {
    return { root: db.collection('classroomHeroData').doc(actor.teacherId), classes: db.collection('classroomBattles').doc(actor.teacherId).collection('classes') };
  }
  async function execute(actor, body) {
    const { root, classes } = realm(actor), profiles = root.collection('profiles'), accounts = root.collection('accounts');
    const accountRef = accounts.doc(actor.uid), clock = now();
    if (['claims','approve','reject','unlink','battle','wheelAward','assist','mission','lessonGuests','endEncounter','items'].includes(body.type)) requireTeacher(actor);
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
    if (body.type === 'items') return itemsAction(actor,body,{root,classes,profiles},clock);
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
        const appearance=['appearance','customise'].includes(body.command);
        const marketChange=['purchase','customise'].includes(body.command);let marketRef=null,marketRequest=null;
        if(marketChange){
          if(typeof body.id!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id))deny('invalid_action','Shop and avatar changes require a saved action ID.',400);
          marketRequest=body.command==='purchase'?{command:body.command,skuId:body.skuId || null}:{command:body.command,avatar:body.avatar===null?null:{outfit:body.avatar?.outfit || null,hairStyle:body.avatar?.hairStyle || null,skin:body.avatar?.skin || null,hair:body.avatar?.hair || null,eyes:body.avatar?.eyes || null,clothing:body.avatar?.clothing || null}};
          marketRef=profileRef.collection('market').doc(body.id);const receipt=docData(await tx.get(marketRef));
          if(receipt){if(receipt.uid!==actor.uid || JSON.stringify(receipt.request)!==JSON.stringify(marketRequest))deny('purchase_changed','That saved request has different details. Refresh your hero.');return {...view(profile,student),hero:cleanHero(profile.hero,student,profile),revision:profile.revision || 0,duplicate:true};}
        }
        const socketChange=body.command==='socket' || body.command==='unsocket';
        let socketRef=null,socketReceipt=null,socketRequest=null;
        if(socketChange){
          if(typeof body.id!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id))deny('invalid_action','Socket changes require a saved action ID.',400);
          socketRequest={command:body.command,itemId:body.itemId ?? null,socketIndex:body.socketIndex ?? null,runeId:body.runeId ?? null,slot:body.slot ?? null};
          socketRef=profileRef.collection('sockets').doc(body.id);socketReceipt=docData(await tx.get(socketRef));
          if(socketReceipt){
            if(socketReceipt.uid!==actor.uid || JSON.stringify(socketReceipt.request)!==JSON.stringify(socketRequest))deny('socket_changed','That socket action was already saved with different details. Refresh your hero.');
            return {...view(profile,student),hero:cleanHero(profile.hero,student,profile),revision:profile.revision || 0,duplicate:true};
          }
        }
        if (profile.activeEncounter && !appearance) deny('encounter_active','Finish or end the active encounter before changing your hero.');
        if (!['class','advance','learn','equip','appearance','socket','unsocket','purchase','customise'].includes(body.command)) deny('invalid_command','Choose a hero class, job advancement, skill, equipment or appearance.',400);
        let appearanceRef=null,appearanceReceipt=null,activeRef=null,activeState=null;
        if (appearance) {
          if (body.command==='appearance' && body.gender!=='male' && body.gender!=='female') deny('invalid_command','Choose a male or female hero appearance.',400);
          if (body.command==='appearance' && body.id!==undefined) {
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
          const visual=body.command==='customise'?{avatar:profile.hero.avatar}:{gender:profile.hero.gender};
          activeState.heroes=activeState.heroes.map(h=>matches(h)?{...h,...visual}:h);
          activeState.heroArchive=Object.fromEntries(Object.entries(activeState.heroArchive || {}).map(([key,h])=>[key,matches(h)?{...h,...visual}:h]));
          activeState.revision=(activeState.revision || 0)+1;activeState.updatedAt=clock;
          tx.set(activeRef,activeState);
        }
        if(marketRef)tx.set(marketRef,{uid:actor.uid,request:marketRequest,createdAt:clock});
        if (socketRef) tx.set(socketRef,{uid:actor.uid,request:socketRequest,createdAt:clock});
        if (appearanceRef) tx.set(appearanceRef,{uid:actor.uid,gender:body.gender,createdAt:clock});
        tx.set(profileRef,profile); return {...view(profile,student),hero:profile.hero,revision:profile.revision,...(appearance && actor.isTeacher ? {state:activeState} : {})};
      }
      deny('invalid_request','Choose a valid hero action.',400);
    });
  }
  async function lessonGuests(actor,body,refs,clock) {
    const {root,classes,profiles}=refs,classId=body.classId,encoded=key(classId),classRef=classes.doc(encoded),guestRef=root.collection('lessonGuests').doc(encoded);
    const command=body.command;
    if(!['get','add','remove','absent','restore'].includes(command))deny('invalid_guest','Choose a temporary student action.',400);
    const mutation=command!=='get',studentId=mutation?studentKey(body.studentId):null;
    if(mutation && (typeof body.id!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id)))deny('invalid_guest','Invalid temporary student action.',400);
    const receiptRef=mutation?guestRef.collection('actions').doc(body.id):null,request={command,studentId,...(['absent','restore'].includes(command)?{date:lessonDate(clock)}:{})};
    return db.runTransaction(async tx=>{
      const [guestSnap,stateSnap,rosterSnap,receiptSnap]=await Promise.all([tx.get(guestRef),tx.get(classRef),tx.get(db.collection('students')),receiptRef?tx.get(receiptRef):null]);
      const saved=docData(guestSnap),roster=docs(rosterSnap).map(s=>({...s.data(),id:s.id}));
      let ids=guestIds(saved,roster,classId),absent=absentIds(saved,roster,clock),state=docData(stateSnap);
      const attendance=()=>({absent:guestViews(absent,roster),date:lessonDate(clock),returned:saved?.absentDate && saved.absentDate!==lessonDate(clock)?(saved.absentIds || []):[]});
      // An old receipt only acknowledges its original save; it must never
      // replay membership after a later add/remove on another screen.
      if(receiptSnap?.exists){
        if(JSON.stringify(receiptSnap.data().request)!==JSON.stringify(request))deny('guest_changed','This temporary student action was already saved with different details. Refresh the list.');
        return {guests:guestViews(ids,roster),...attendance(),state,duplicate:true};
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
      if(command==='absent' || command==='restore'){
        if(!student || !lessonMember(student,classId,ids))deny('roster_changed','Choose a student in this Lesson slot.',400);
        if(command==='absent' && !absent.includes(studentId))absent.push(studentId);
        if(command==='restore')absent=absent.filter(id=>id!==studentId);
        if(command==='absent' && state?.status==='active' && state.heroes.some(h=>h.studentId===studentId)){
          const hero=state.heroes.find(h=>h.studentId===studentId);
          if(state.pending?.heroId===hero.id)deny('guest_pending','Resolve or skip this student’s answer before marking them absent.');
          profileRef=profiles.doc(studentId);profile=docData(await tx.get(profileRef));
          const heroes=state.heroes.filter(h=>h.studentId!==studentId);
          state={...state,heroes,heroArchive:{...(state.heroArchive || {}),[hero.id]:hero},revision:(state.revision || 0)+1,updatedAt:clock,...(!heroes.length?{status:'defeat',pending:null}:{})};
          if(state.teamHeroIds)state.teamHeroIds=state.teamHeroIds.filter(id=>id!==hero.id);
          if(profile?.activeEncounter?.classId===classId && profile.activeEncounter.encounterId===state.encounterId){profile.activeEncounter=null;writeProfile=true;}
        }
      } else if(command==='add'){
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
      // Returning students join an already running encounter before the teacher
      // can finish it or redeem a summon. Opening next week's lesson is enough.
      const returning=command==='restore'?[studentId]:command==='get' && saved?.absentDate && saved.absentDate!==lessonDate(clock)?(saved.absentIds || []):[];
      const returnWrites=[],returnMoves=[];
      if(state?.status==='active')for(const id of returning){
        const member=roster.find(s=>s.id===id);
        if(!lessonMember(member,classId,ids,absent) || state.heroes.some(h=>h.studentId===id))continue;
        if(state.heroes.length>=100)deny('invalid_roster','A Lesson slot can have at most 100 battle heroes.',400);
        const ref=profiles.doc(id);let restored=docData(await tx.get(ref));
        if(!restored)restored=migrateHero(member,docs(await tx.get(classes)));
        const lock=restored.activeEncounter;
        if(lock && (lock.classId!==classId || lock.encounterId!==state.encounterId)){
          const moved=await releaseLock(tx,classes,lock,id,clock);
          if(moved){
            const existing=returnMoves.find(row=>row.ref.path===moved.ref.path);
            if(existing){
              const removed=existing.state.heroes.find(h=>h.studentId===id);
              existing.state.heroes=existing.state.heroes.filter(h=>h.studentId!==id);
              if(removed){existing.state.heroArchive[removed.id]=removed;if(existing.state.pending?.heroId===removed.id)existing.state.pending=null;}
              if(!existing.state.heroes.length){existing.state.status='defeat';existing.state.pending=null;}
            }else returnMoves.push(moved);
          }
        }
        const hero=cleanHero(restored.hero,member,restored),archive={...(state.heroArchive || {})};delete archive[hero.id];
        state={...state,heroes:[...state.heroes,hero],heroArchive:archive,revision:(state.revision || 0)+1,updatedAt:clock};
        returnWrites.push({ref,profile:{...restored,hero,activeEncounter:{classId,encounterId:state.encounterId},revision:(restored.revision || 0)+1,updatedAt:clock}});
      }
      const membershipChanged=JSON.stringify(ids)!==JSON.stringify(saved?.studentIds||[]);
      if(membershipChanged || command==='absent' || command==='restore')tx.set(guestRef,{...(saved || {}),schemaVersion:1,classId,studentIds:ids,...(['absent','restore'].includes(command)?{absentDate:lessonDate(clock),absentIds:absent}:{}),revision:(saved?.revision||0)+1,updatedAt:clock});
      for(const {id,profile:stale} of staleProfiles){
        if(stale?.activeEncounter?.classId===classId && (!state || stale.activeEncounter.encounterId===state.encounterId))tx.set(profiles.doc(id),{...stale,activeEncounter:null,revision:(stale.revision||0)+1,updatedAt:clock});
      }
      for(const moved of returnMoves)tx.set(moved.ref,moved.state);
      for(const restored of returnWrites)tx.set(restored.ref,restored.profile);
      if(writeProfile){profile.revision=(profile.revision||0)+1;profile.updatedAt=clock;tx.set(profileRef,profile);}
      if(JSON.stringify(state)!==JSON.stringify(docData(stateSnap)))tx.set(classRef,state);
      if(receiptRef)tx.set(receiptRef,{request,createdAt:clock});
      return {guests:guestViews(ids,roster),...attendance(),state};
    });
  }
  function payoutMission(tx,actor,classId,before,after,roster,clock,markOverrides=new Map(),guests=[],absent=[]) {
    const payout=after?.lastPayout;
    if(!payout || payout.kind!=='points' || before?.lastPayout?.id===payout.id)return;
    const party=roster.map(s=>({...s.data(),id:s.id,original:s.data()})).filter(s=>lessonMember(s,classId,guests,absent));
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
      const guests=guestIds(docData(guestSnap),roster,classId),absent=absentIds(docData(guestSnap),roster,clock);
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
      payoutMission(tx,actor,classId,before,next,docs(rosterSnap),clock,new Map(),guests,absent);
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
      const roster=docs(rosterSnap).map(s=>({...s.data(),id:s.id})),guests=guestIds(docData(guestSnap),roster,classId),absent=absentIds(docData(guestSnap),roster,clock);
      if (!helperSnap.exists || !helpedSnap.exists || !lessonMember({...helperSnap.data(),id:studentId},classId,guests,absent) || !lessonMember({...helpedSnap.data(),id:helpedStudentId},classId,guests,absent)) deny('roster_changed','Both students must belong to this Lesson slot or be added as temporary students. Refresh the wheel.');
      const helper={...helperSnap.data(),id:studentId};
      if (!profile) profile=migrateHero(helper,docs(await tx.get(classes)));
      if (profile.activeEncounter && (profile.activeEncounter.classId!==classId || !state || profile.activeEncounter.encounterId!==state.encounterId)) deny('encounter_active','Finish this helper’s other active encounter before recording an assist.');
      if(state?.combo?.paused && state.combo.recoveryHeroId==='student:'+helpedStudentId){state=clone(state);state.combo.paused=false;state.combo.recoveryHeroId=null;}
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
      payoutMission(tx,actor,classId,beforeMission,mission,docs(rosterSnap),clock,new Map(),guests,absent);
      if(mission.revision!==beforeMission.revision){mission.updatedAt=clock;tx.set(missionRef,mission);if(state)state.missionRevision=mission.revision;}
      tx.set(profileRef,profile);tx.set(receiptRef,receipt);if(state)tx.set(classRef,state);
      return {hero:profile.hero,state,assist:receipt,mission};
    });
  }
  // Moves a hero out of an encounter in another lesson slot. Reads only, so
  // callers apply the returned write after all transaction reads are done.
  async function releaseLock(tx,classes,lock,studentId,clock) {
    const ref=classes.doc(key(lock.classId)), state=docData(await tx.get(ref));
    if (!state || state.status!=='active' || state.encounterId!==lock.encounterId) return null;
    const hero=(state.heroes||[]).find(h=>h.studentId===studentId);
    if (!hero) return null;
    const heroes=state.heroes.filter(h=>h!==hero);
    const pending=state.pending?.heroId===hero.id ? null : state.pending;
    return {ref,state:{...state,heroes,pending,heroArchive:{...(state.heroArchive||{}),[hero.id]:hero},revision:(state.revision||0)+1,updatedAt:clock,...(!heroes.length?{status:'defeat',pending:null}:{})}};
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
      // A points award also needs the school-wide bosses; read them with the
      // rest of the first batch rather than in a second round trip.
      const [oldReceipt,oldSnap,rosterSnap,missionSnap,guestSnap,bossSnap] = await Promise.all([tx.get(receiptRef),tx.get(classRef),tx.get(db.collection('students')),tx.get(missionRef),tx.get(root.collection('lessonGuests').doc(key(classId))),awardRequest ? tx.get(db.collection('bosses').where('active','==',true)) : null]);
      let old=docData(oldSnap);
      const beforeMission=Missions.clean(docData(missionSnap));let mission=Missions.clean(beforeMission);
      const roster=docs(rosterSnap).map(s=>({...s.data(),id:s.id})), rosterById=new Map(roster.map(s=>[s.id,s]));
      const guests=guestIds(docData(guestSnap),roster,classId),absent=absentIds(docData(guestSnap),roster,clock);
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
        if (!lessonMember(awardedStudent,classId,guests,absent)) deny('roster_changed','That student is no longer in this lesson slot. Refresh the wheel.',409);
        const marks=awardedStudent.marks || 0;
        if (!Number.isSafeInteger(marks) || !Number.isSafeInteger(marks+awardRequest.delta)) deny('invalid_balance','This marks balance needs to be corrected before awarding points.',409);
        award={id:action.id,studentId:awardRequest.studentId,delta:awardRequest.delta,marks:marks+awardRequest.delta};
        schoolBosses=docs(bossSnap);
      }
      const starting=action.type==='start' || (action.type==='auto' && (!old || old.status!=='active'));
      const syncing=action.type==='sync' && !action.command;
      let incoming=(starting || syncing || (action.type==='auto' && Array.isArray(action.heroes))) ? action.heroes : old?.heroes;
      if(action.type==='quest' && action.heroId){const student=rosterById.get(action.heroId.replace(/^student:/,''));if(!lessonMember(student,classId,guests,absent))deny('roster_changed','Only a student present in this lesson can make this choice.',409);}
      if(Array.isArray(incoming) && (starting || syncing || action.type==='auto'))incoming=incoming.filter(h=>!absent.includes(h.studentId || (h.id || '').replace(/^student:/,'')));
      if (!Array.isArray(incoming) || !incoming.length || incoming.length>100) deny('invalid_roster','Choose a lesson slot with 1–100 heroes.',400);
      const identities=incoming.map(h=>{
        const id=studentKey(h.studentId || (h.id || '').replace(/^student:/,'')), student=rosterById.get(id);
        if (student) {
          // A departing student can finish/end their existing encounter; new
          // encounters and roster updates must use the current lesson slot.
          if ((starting || syncing || action.type==='auto') && !lessonMember(student,classId,guests,absent)) deny('roster_changed','The lesson roster changed. Refresh the wheel.',409);
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
      const otherEncounter=new Set(), lockReleases=[];
      for (const student of identities.filter(s=>!s.guest)) {
        const profile=profileMap.get(student.id), lock=profile.activeEncounter;
        if (lock && (lock.classId!==classId || (!starting && old?.encounterId!==lock.encounterId))) {
          if(action.type==='quest')deny('encounter_active','Finish '+student.name+'’s active encounter in '+lock.classId+' before making quest choices here.');
          if (action.type==='end') { otherEncounter.add(student.id); continue; }
          if (lock.classId===classId) deny('encounter_active',student.name+' is in an active encounter in '+lock.classId+'. End it before starting another.');
          // A student may continue their quest from any lesson's wheel: the
          // hero is moved out of the other lesson's encounter (kept in its
          // archive) in this same transaction, so only one party holds them.
          const moved=await releaseLock(tx,classes,lock,student.id,clock);
          if (moved) lockReleases.push(moved);
          profile.activeEncounter=null;
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
      // What each hero owned before this action: the ledger records only gains.
      const beforeInventory=new Map(canonical.map(h=>[h.id,clone(h.inventory || [])]));
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
        if(action.type==='quest')action.eligibleHeroIds=roster.filter(s=>lessonMember(s,classId,guests,absent)).map(s=>'student:'+s.id);
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
      payoutMission(tx,actor,classId,beforeMission,mission,docs(rosterSnap),clock,new Map(award?[[award.studentId,award.marks]]:[]),guests,absent);
      if(answerRef&&!answerAlreadyCounted)tx.set(answerRef,{actionId:action.id,createdAt:clock});
      if(award&&mission.lastPayout?.id!==beforeMission.lastPayout?.id){const bonus=mission.lastPayout?.awards.find(row=>row.studentId===award.studentId);if(bonus)award.marks=bonus.marks;}
      if(mission.revision!==beforeMission.revision){mission.updatedAt=clock;tx.set(missionRef,mission);next.missionRevision=mission.revision;}
      for (const r of lockReleases) tx.set(r.ref,r.state);
      // Every item a hero gains in this action is written to the permanent
      // ledger in the same transaction, so a later bug can be repaired from it.
      const lootNow=next.status==='victory' && !!next.lootAwarded && !(old?.lootAwarded && old.encounterId===next.encounterId);
      const dropSource=lootNow?'victory':action.type==='quest'?'quest-'+String(action.command||''):String(action.type||'battle');
      const dropEntries=next.heroes.flatMap(h=>{
        const before=beforeInventory.get(h.id);
        if (!before) return [];
        return inventoryGains(before,h.inventory).map(gain=>dropEntry(h,gain,lootNow?((next.rewards||[]).find(r=>r.heroId===h.id && r.itemId===gain.itemId)?.source || 'victory'):dropSource));
      });
      if (dropEntries.length) tx.set(root.collection(LEDGER).doc('battle-'+createHash('sha256').update(actor.teacherId+'\0'+classId+'\0'+action.id).digest('hex').slice(0,40)),ledgerDoc({kind:'drop',source:dropSource,classId,encounterId:next.encounterId,actionId:action.id,by:actor.email,clock,entries:dropEntries}));
      tx.set(classRef,next); tx.set(receiptRef,{encounterId:next.encounterId,revision:next.revision,type:action.type,...(award ? {awardRequest,award} : {})});
      return {state:next,mission,...(award ? {award} : {})};
    });
  }
  // ---- Items: the ledger, teacher gifts and restores (v1.158.0) ----
  async function grantInTransaction(tx,refs,{studentId,classId,itemId,quantity,sockets}) {
    const {classes,profiles}=refs,profileRef=profiles.doc(studentId);
    const [profileSnap,studentSnap]=await Promise.all([tx.get(profileRef),tx.get(db.collection('students').doc(studentId))]);
    if (!studentSnap.exists) deny('missing_student','That student is no longer on the register.',404);
    const student={...studentSnap.data(),id:studentId};
    let profile=docData(profileSnap);
    if (!profile) profile=migrateHero(student,docs(await tx.get(classes)));
    const lock=profile.activeEncounter,lockRef=lock ? classes.doc(key(lock.classId)) : null;
    const lockState=lockRef ? docData(await tx.get(lockRef)) : null;
    const viewRef=classId ? classes.doc(key(classId)) : null;
    const viewState=viewRef && (!lockRef || viewRef.path!==lockRef.path) ? docData(await tx.get(viewRef)) : null;
    const matches=h=>h && (h.studentId===studentId || h.id==='student:'+studentId);
    const give=hero=>{Core.addInventory(hero,itemId,quantity,sockets);return hero;};
    const writes=[];
    let hero=cleanHero(profile.hero,student,profile);
    const live=lockState?.status==='active' && lockState.encounterId===lock.encounterId && lockState.heroes.find(matches);
    if (live) {
      // The encounter's hero is written back over the profile on the next
      // turn, so the item goes into BOTH or it is lost at the next answer.
      const next=clone(lockState),inParty=next.heroes.find(matches);give(inParty);hero=clone(inParty);
      next.revision=(next.revision || 0)+1;writes.push([lockRef,next]);
    } else {
      give(hero);Core.autoEquip(hero);
    }
    if (viewState && viewState.heroes?.some(matches)) {
      const next=clone(viewState);next.heroes=next.heroes.map(h=>matches(h) ? give(h) : h);
      next.revision=(next.revision || 0)+1;writes.push([viewRef,next]);
    }
    profile.hero=hero;profile.revision=(profile.revision || 0)+1;
    return {profile,profileRef,writes,hero,student,state:writes.find(([ref])=>viewRef && ref.path===viewRef.path)?.[1] || null};
  }
  async function itemsAction(actor,body,refs,clock) {
    const {root,classes}=refs,ledger=root.collection(LEDGER),command=body.command;
    if (!['history','gift','restore'].includes(command)) deny('invalid_items','Choose an item action.',400);
    if (body.classId !== undefined && body.classId !== null) key(body.classId);
    if (command==='history') {
      const guests=body.guests===true,studentId=guests ? null : studentKey(body.studentId);
      await backfillLedger(actor,refs,clock);
      const [snap,profileSnap]=await Promise.all([ledger.where('studentIds','array-contains',guests ? 'guests' : studentId).get(),guests ? null : refs.profiles.doc(studentId).get()]);
      const restored={},rows=[];
      for (const d of docs(snap)) {
        const doc=d.data();
        (doc.entries || []).forEach((e,index)=>{
          if (e.restoreOf) (restored[e.restoreOf]=restored[e.restoreOf] || []).push({at:doc.createdAt,by:doc.by,studentId:e.studentId,name:e.name});
          if (guests ? !e.guest : e.studentId!==studentId) return;
          rows.push({...e,dropId:d.id+':'+index,kind:doc.kind,classId:doc.classId,encounterId:doc.encounterId,createdAt:doc.createdAt,by:doc.by});
        });
      }
      rows.sort((a,b)=>(b.createdAt || 0)-(a.createdAt || 0) || a.dropId.localeCompare(b.dropId));
      const owned={};
      ((profileSnap && docData(profileSnap)?.hero?.inventory) || []).forEach(e=>{if (e && e.itemId) owned[e.itemId]=(owned[e.itemId] || 0)+(Number(e.quantity) || 0);});
      return {rows:rows.slice(0,LEDGER_MAX_ROWS).map(r=>({...r,restored:restored[r.dropId] || []})),total:rows.length,owned};
    }
    if (typeof body.id!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id)) deny('invalid_items','Item actions need a saved action ID.',400);
    const studentId=studentKey(body.studentId),classId=typeof body.classId==='string' ? body.classId : null;
    if (command==='gift') {
      const quantity=body.quantity===undefined ? 1 : body.quantity;
      if (!Number.isSafeInteger(quantity) || quantity<1 || quantity>20) deny('invalid_gift','Give 1 to 20 copies.',400);
      const request={command,studentId,rarity:body.itemId ? null : String(body.rarity || ''),itemType:String(body.itemType || 'any'),itemId:body.itemId || null,quantity};
      // Randomness is sampled once, outside Firestore retries, like mission rolls.
      const item=giftItem(request,random(),random()),receiptRef=ledger.doc('gift-'+body.id);
      return db.runTransaction(async tx=>{
        const receipt=docData(await tx.get(receiptRef));
        if (receipt) {
          if (JSON.stringify(receipt.request)!==JSON.stringify(request)) deny('gift_changed','This gift was already saved with different details.');
          return {entry:receipt.entries[0],hero:null,duplicate:true};
        }
        const sockets=Core.socketRoll('gift:'+body.id,item);
        const result=await grantInTransaction(tx,refs,{studentId,classId,itemId:item.id,quantity,sockets});
        const entry=dropEntry(result.hero,{itemId:item.id,quantity,...(sockets ? {sockets:sockets.length} : {})},'gift');
        result.profile.updatedAt=clock;tx.set(result.profileRef,result.profile);
        for (const [ref,state] of result.writes) tx.set(ref,{...state,updatedAt:clock});
        tx.set(receiptRef,{...ledgerDoc({kind:'gift',source:'gift',classId,actionId:body.id,by:actor.email,clock,entries:[entry]}),request});
        return {entry,hero:result.hero,state:result.state};
      });
    }
    const dropId=String(body.dropId || ''),match=/^([A-Za-z0-9_-]{1,120}):(\d{1,4})$/.exec(dropId);
    if (!match) deny('invalid_restore','Choose a saved drop to restore.',400);
    const receiptRef=ledger.doc('restore-'+body.id),sourceRef=ledger.doc(match[1]);
    const request={command,studentId,dropId,again:body.again===true};
    return db.runTransaction(async tx=>{
      const [receiptSnap,sourceSnap,earlier]=await Promise.all([tx.get(receiptRef),tx.get(sourceRef),tx.get(ledger.where('restoreKeys','array-contains',dropId))]);
      if (receiptSnap.exists) {
        if (JSON.stringify(receiptSnap.data().request)!==JSON.stringify(request)) deny('restore_changed','This restore was already saved with different details.');
        return {entry:receiptSnap.data().entries[0],hero:null,duplicate:true};
      }
      const original=docData(sourceSnap)?.entries?.[Number(match[2])];
      if (!original || !Core.itemById(original.itemId)) deny('invalid_restore','That drop is not in the ledger.',404);
      if (docs(earlier).length && !request.again) deny('already_restored','This drop was already restored once. Confirm to restore it again.');
      const sockets=Number.isInteger(original.sockets) && Core.socketable(Core.itemById(original.itemId)) ? Array(Math.min(3,Math.max(0,original.sockets))).fill(null) : undefined;
      const result=await grantInTransaction(tx,refs,{studentId,classId,itemId:original.itemId,quantity:original.quantity || 1,sockets});
      const entry={...dropEntry(result.hero,{itemId:original.itemId,quantity:original.quantity || 1,...(sockets ? {sockets:sockets.length} : {})},'restore'),restoreOf:dropId,restoredFrom:original.name};
      result.profile.updatedAt=clock;tx.set(result.profileRef,result.profile);
      for (const [ref,state] of result.writes) tx.set(ref,{...state,updatedAt:clock});
      const sourceKeys=docData(sourceSnap).studentIds || [];
      tx.set(receiptRef,{...ledgerDoc({kind:'restore',source:'restore',classId,actionId:body.id,by:actor.email,clock,entries:[entry],extraKeys:original.guest ? ['guests'] : sourceKeys.filter(k=>k===original.studentId)}),request});
      return {entry,hero:result.hero,state:result.state};
    });
  }
  // Victories saved before the ledger existed still sit on each lesson's last
  // encounter. Copy them in once (idempotent by encounter), so the most recent
  // drops can be checked and restored too.
  async function backfillLedger(actor,refs,clock) {
    const {root,classes}=refs,ledger=root.collection(LEDGER);
    const states=docs(await classes.get()).map(s=>s.data()).filter(s=>s && s.lootAwarded && s.encounterId && Array.isArray(s.rewards) && s.rewards.length);
    for (const state of states) {
      const ref=ledger.doc('backfill-'+createHash('sha256').update(actor.teacherId+'\0'+String(state.classId || '')+'\0'+state.encounterId).digest('hex').slice(0,40));
      await db.runTransaction(async tx=>{
        if ((await tx.get(ref)).exists) return;
        const heroes=[...(state.heroes || []),...Object.values(state.heroArchive || {})];
        const entries=state.rewards.filter(r=>r && Core.itemById(r.itemId)).map(r=>{
          const hero=heroes.find(h=>h.id===r.heroId) || {id:r.heroId,studentId:String(r.heroId || '').replace(/^student:/,''),name:'Student'};
          return dropEntry(hero,{itemId:r.itemId,quantity:1,...(Array.isArray(r.sockets) ? {sockets:r.sockets.length} : {})},(r.source || 'victory')+'-recovered');
        });
        if (entries.length) tx.set(ref,ledgerDoc({kind:'drop',source:'victory-recovered',classId:state.classId,encounterId:state.encounterId,by:'',clock:state.updatedAt || clock,entries}));
      });
    }
  }
  return {execute};
}
module.exports={createHeroRepository,migrateHero,slots,key,inventoryGains,giftItem,LEDGER};
