'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHeroRepository,migrateHero,key}=require('../hero-repository');
const C=require('../hero-game/battle-core');
const teacher={uid:'teacher',teacherId:'teacher',email:'chungzhikai@gmail.com',isTeacher:true};
const pupil=uid=>({uid,email:uid+'@example.com',teacherId:'teacher',isTeacher:false});
function database() {
  const data=new Map(),versions=new Map();let version=0;
  const snapshot=path=>({id:path.split('/').at(-1),exists:data.has(path),data:()=>structuredClone(data.get(path))});
  function ref(path,isCollection=false,filters=[]) { return {path,isCollection,filters,collection:n=>ref(path+'/'+n,true),doc:id=>ref(path+'/'+id),where:(field,op,value)=>{assert.equal(op,'==');return ref(path,true,[...filters,[field,value]]);},get:async()=>get({path,isCollection,filters})}; }
  function get(r) { if (!r.isCollection) return snapshot(r.path); const prefix=r.path+'/';return {docs:[...data.keys()].filter(p=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')&&(r.filters||[]).every(([k,v])=>data.get(p)[k]===v)).map(snapshot)}; }
  return {data,failNextCommit:false,collection:n=>ref(n,true),seed(path,value){data.set(path,structuredClone(value));versions.set(path,++version);},
    async runTransaction(callback) {
      for(let retry=0;retry<40;retry++){
        const reads=new Map(),writes=new Map();let queryVersion=null,wrote=false;
        const out=await callback({get:async r=>{assert.equal(wrote,false,'Firestore reads must precede all writes');if(r.isCollection)queryVersion=version;else reads.set(r.path,versions.get(r.path)||0);await Promise.resolve();return get(r);},
          set:(r,v)=>{wrote=true;writes.set(r.path,structuredClone(v));},delete:r=>{wrote=true;writes.set(r.path,undefined);}});
        if((queryVersion!==null&&queryVersion!==version)||[...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;
        if(this.failNextCommit){this.failNextCommit=false;throw Error('transaction commit failed');}
        for(const [p,v]of writes){if(v===undefined)data.delete(p);else data.set(p,v);versions.set(p,++version);}return out;
      }throw Error('retry limit');
    }};
}
function setup() {
  const db=database();db.seed('students/alex',{name:'Alex',slots:['Saturday','Sunday'],uid:'old-cer-uid'});db.seed('students/sam',{name:'Sam',slot:'Saturday'});
  const repo=createHeroRepository(db,{now:()=>123456789});return {db,repo,call:(who,body)=>repo.execute(who,body)};
}
const profilePath=id=>'classroomHeroData/teacher/profiles/'+id;
const classPath=slot=>'classroomBattles/teacher/classes/'+key(slot);
const heroes=[C.heroFromStudent({id:'alex',name:'Alex'}),C.heroFromStudent({id:'sam',name:'Sam'})];
let seq=0;const aid=()=> 'action-'+String(++seq).padStart(8,'0');
const battle=(call,slot,action)=>call(teacher,{type:'battle',classId:slot,action});
const missionPath=slot=>'classroomHeroData/teacher/missions/'+key(slot);
function missionSetup(objectiveRoll=0,prizeRoll=.1){
  const {db}=setup();let clock=1000,index=0;
  const repo=createHeroRepository(db,{now:()=>clock,random:()=>[objectiveRoll,prizeRoll][index++%2]});
  const call=(actor,body)=>repo.execute(actor,body);
  return {db,call,time:value=>{clock=value;},mission:(command,extra={})=>call(teacher,{type:'mission',classId:'Saturday',command,id:aid(),...extra})};
}
function wheelRequest(state=null,{id=aid(),spinId=aid(),studentId='alex',delta=1,classId='Saturday',...extra}={}) {
  return {type:'wheelAward',classId,studentId,delta,reason:'Correct answer on the wheel',action:{type:'auto',id,spinId,heroId:'student:'+studentId,heroes,bossId:'goblin',...(state ? {encounterId:state.encounterId,expectedRevision:state.revision} : {}),...extra}};
}
async function begin(call,slot='Saturday',party=heroes) {return (await battle(call,slot,{id:aid(),type:'start',bossId:'goblin',heroes:party})).state;}
async function claim(call,uid='one',studentId='alex',lessonSlot='Saturday') {await call(pupil(uid),{type:'claim',studentId,lessonSlot});await call(teacher,{type:'approve',studentId});}

const guestPath=slot=>'classroomHeroData/teacher/lessonGuests/'+key(slot);
function guestRequest(command='get',extra={}) {return {type:'lessonGuests',classId:'Saturday',command,...(command==='get'?{}:{studentId:'visitor',id:aid()}),...extra};}
function guestSetup() {
  const result=setup();result.db.seed('students/visitor',{name:'Visiting student',slot:'Tuesday',marks:7,notes:'Keep original roster'});
  return {...result,visit:(command,extra={})=>result.call(teacher,guestRequest(command,extra))};
}

test('temporary guest membership is teacher-only and rejects invalid target, source, student and receipts without writes',async()=>{
  const {call,db}=guestSetup(),before=JSON.stringify([...db.data]);
  for(const command of ['get','add','remove'])await assert.rejects(call(pupil('one'),guestRequest(command)),/teacher/);
  for(const request of [guestRequest('oops'),guestRequest('add',{id:12345678}),guestRequest('add',{id:'short'}),guestRequest('add',{studentId:'missing'}),guestRequest('add',{studentId:'sam'}),guestRequest('add',{classId:'Missing'})])await assert.rejects(call(teacher,request));
  assert.equal(JSON.stringify([...db.data]),before);
});

test('temporary guests persist by teacher and slot without editing permanent roster, claims or lesson catalogue',async()=>{
  const {call,db,visit}=guestSetup(),original=db.data.get('students/visitor');
  const result=await visit('add');assert.deepEqual(result.guests,[{studentId:'visitor',name:'Visiting student',lessonSlots:['Tuesday']}]);assert.equal(result.state,null);
  assert.deepEqual(db.data.get('students/visitor'),original);assert.equal(db.data.get(profilePath('visitor')).hero.xp,0);
  assert.deepEqual((await visit('get')).guests,result.guests);
  assert.deepEqual((await call(teacher,guestRequest('get',{classId:'Sunday'}))).guests,[]);
  const catalogue=await call(pupil('one'),{type:'catalog',lessonSlot:'Saturday'});assert.ok(!catalogue.students.some(s=>s.id==='visitor'));
  await assert.rejects(call(pupil('one'),{type:'claim',studentId:'visitor',lessonSlot:'Saturday'}),/not in this lesson/);
  await claim(call,'one','visitor','Tuesday');assert.equal((await call(pupil('one'),{type:'me'})).claim.lessonSlots[0],'Tuesday');
});

test('guest mutations and concurrent retries are idempotent; old receipts cannot undo newer membership',async()=>{
  const {call,db,visit}=guestSetup(),request=guestRequest('add');
  const responses=await Promise.all([call(teacher,request),call(teacher,request),call(teacher,request)]);assert.equal(responses.filter(r=>r.duplicate).length,2);
  assert.deepEqual(db.data.get(guestPath('Saturday')).studentIds,['visitor']);
  await visit('add');assert.equal(db.data.get(guestPath('Saturday')).revision,1);
  const remove=guestRequest('remove');await call(teacher,remove);
  assert.deepEqual((await call(teacher,request)).guests,[]);
  await visit('add');assert.equal((await call(teacher,remove)).guests.length,1);
  await assert.rejects(call(teacher,{...request,command:'remove'}),/different details/);
});

test('adding and removing a guest from an active encounter preserves enemy, pending answer and canonical progress',async()=>{
  const {call,db,visit}=guestSetup();await claim(call,'one','visitor','Tuesday');
  const configured=await call(pupil('one'),{type:'configure',command:'class',role:'mage'});
  const progress={...configured.hero,xp:300,inventory:[{id:'bag:crimson-edge',itemId:'crimson-edge',quantity:1}]};
  const progressed={...C.cleanHero(progress,progress),hp:33,mp:17};
  db.seed(profilePath('visitor'),{...db.data.get(profilePath('visitor')),hero:progressed});
  let state=await begin(call);state=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:alex',encounterId:state.encounterId,expectedRevision:state.revision})).state;
  const before=structuredClone(state),result=await visit('add');state=result.state;
  assert.deepEqual(state.pending,before.pending);assert.equal(state.bossHp,before.bossHp);assert.equal(state.bossMaxHp,before.bossMaxHp);assert.deepEqual(state.lastEvent,before.lastEvent);assert.deepEqual(state.combatLog,before.combatLog);
  const guest=state.heroes.find(h=>h.studentId==='visitor');assert.equal(guest.role,'mage');assert.equal(guest.xp,300);assert.equal(guest.hp,33);assert.equal(guest.mp,17);assert.deepEqual(guest.inventory,progressed.inventory);assert.equal(guest.uid,'one');
  assert.deepEqual(db.data.get(profilePath('visitor')).activeEncounter,{classId:'Saturday',encounterId:state.encounterId});
  const profileBefore=structuredClone(db.data.get(profilePath('visitor')).hero),removed=(await visit('remove')).state;
  assert.equal(removed.heroes.length,2);assert.deepEqual(removed.pending,before.pending);assert.equal(removed.bossHp,before.bossHp);assert.equal(db.data.get(profilePath('visitor')).activeEncounter,null);assert.deepEqual(db.data.get(profilePath('visitor')).hero,profileBefore);
});

test('selected guest cannot leave until answer is resolved; removal never clears another pending answer',async()=>{
  const {call,db,visit}=guestSetup();let state=await begin(call);state=(await visit('add')).state;
  state=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:visitor',encounterId:state.encounterId,expectedRevision:state.revision})).state;
  const before=JSON.stringify([...db.data]);await assert.rejects(visit('remove'),/Resolve or skip/);assert.equal(JSON.stringify([...db.data]),before);
  state=(await battle(call,'Saturday',{id:aid(),type:'answer',outcome:'skip',turnId:state.pending.id,encounterId:state.encounterId,expectedRevision:state.revision})).state;
  assert.equal((await visit('remove')).state.heroes.length,2);
});

test('temporary guests retain canonical cross-lesson locks and concurrent adds cannot put one hero into two fights',async()=>{
  const {call,db,visit}=guestSetup();let source=await begin(call,'Tuesday',[C.heroFromStudent({id:'visitor',name:'Visiting student'})]);
  await assert.rejects(visit('add'),/active encounter in Tuesday/);assert.ok(!db.data.has(guestPath('Saturday')));
  await battle(call,'Tuesday',{id:aid(),type:'end',encounterId:source.encounterId,expectedRevision:source.revision});
  await begin(call);
  // Sunday has a separate permanent hero so both target encounters may run.
  db.seed('students/sunday',{name:'Sunday student',slot:'Sunday'});await begin(call,'Sunday',[C.heroFromStudent({id:'sunday',name:'Sunday student'})]);
  const races=await Promise.allSettled([visit('add'),visit('add',{classId:'Sunday'})]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.match(races.find(r=>r.status==='rejected').reason.message,/active encounter/);
  const lock=db.data.get(profilePath('visitor')).activeEncounter;assert.ok(['Saturday','Sunday'].includes(lock.classId));
});

test('guest membership authorizes start, sync, marks, assists and victory loot using the same registered profile',async()=>{
  const {call,db,visit}=guestSetup();await visit('add');
  const visitor=C.heroFromStudent({id:'visitor',name:'Visiting student'}),party=[...heroes,visitor];
  let state=await begin(call,'Saturday',party);
  state=(await battle(call,'Saturday',{id:aid(),type:'sync',heroes:party,encounterId:state.encounterId,expectedRevision:state.revision})).state;
  const help=await call(teacher,{type:'assist',classId:'Saturday',studentId:'visitor',helpedStudentId:'alex',action:{id:aid(),spinId:aid()}});assert.equal(help.hero.xp,6);state=help.state;
  const award=await call(teacher,wheelRequest(state,{studentId:'visitor',delta:1,heroes:party}));assert.equal(award.award.marks,8);assert.equal(db.data.get(profilePath('visitor')).hero.xp,18);assert.equal(db.data.get('students/visitor').slot,'Tuesday');state=award.state;
  const victory=await call(teacher,wheelRequest(state,{studentId:'visitor',delta:10000,heroes:party}));assert.equal(victory.state.status,'victory');assert.equal(victory.state.rewards.length,3);assert.ok(db.data.get(profilePath('visitor')).hero.inventory.length);assert.equal(db.data.get(profilePath('visitor')).activeEncounter,null);
  const historical=structuredClone(victory.state);assert.deepEqual((await visit('remove')).state,historical);
  await assert.rejects(call(teacher,wheelRequest(null,{studentId:'visitor',heroes:party})),/no longer in this lesson/);
  await assert.rejects(call(teacher,{type:'assist',classId:'Saturday',studentId:'visitor',helpedStudentId:'alex',action:{id:aid(),spinId:aid()}}),/Both students/);
});

test('temporary guests receive class-wide mission points once without duplicate permanent members or changing slots',async()=>{
  const {db,call,mission}=missionSetup(.6,.99);db.seed('students/visitor',{name:'Visitor',slot:'Tuesday',marks:7});
  await call(teacher,guestRequest('add'));const started=await mission('turn',{expectedRevision:0});
  // Focus objective completes after the server timer; guest inclusion is read
  // in the same payout transaction, not copied from a browser roster.
  const saved=db.data.get(missionPath('Saturday'));saved.current.startedAt=0;db.seed(missionPath('Saturday'),saved);
  const repo=createHeroRepository(db,{now:()=>2000000});
  const completed=await repo.execute(teacher,{type:'mission',classId:'Saturday',command:'focus',id:aid(),missionId:started.mission.current.id});
  assert.equal(completed.mission.lastPayout.awards.length,3);assert.equal(db.data.get('students/visitor').marks,12);assert.equal(db.data.get('students/visitor').slot,'Tuesday');
  assert.equal([...db.data].filter(([p,v])=>p.startsWith('awards/')&&v.studentId==='visitor').length,1);
});

test('guest changes roll back all membership, encounter, profile and receipt writes on failed commits',async()=>{
  const {db,call,visit}=guestSetup();await begin(call);const before=JSON.stringify([...db.data]),add=guestRequest('add');
  db.failNextCommit=true;await assert.rejects(call(teacher,add),/commit failed/);assert.equal(JSON.stringify([...db.data]),before);
  const result=await call(teacher,add);assert.equal(result.state.heroes.length,3);const added=JSON.stringify([...db.data]);
  db.failNextCommit=true;await assert.rejects(visit('remove'),/commit failed/);assert.equal(JSON.stringify([...db.data]),added);assert.equal((await visit('get')).guests.length,1);
});

test('guest reads prune deleted or now-permanent members while preserving valid guests and historical battles',async()=>{
  const {db,visit}=guestSetup();await visit('add');db.seed('students/another',{name:'Another',slot:'Tuesday'});await visit('add',{studentId:'another'});
  db.seed('students/visitor',{name:'Visitor moved',slot:'Saturday'});db.data.delete('students/another');
  assert.deepEqual((await visit('get')).guests,[]);assert.deepEqual(db.data.get(guestPath('Saturday')).studentIds,[]);assert.equal(db.data.get('students/visitor').slot,'Saturday');
});

test('guest assist mission completion awards the visiting helper and selected visitor canonical XP and class bonus exactly once',async()=>{
  const {db,call,mission}=missionSetup(.9,.99);db.seed('students/visitor',{name:'Visitor',slot:'Tuesday',marks:7});
  await call(teacher,guestRequest('add'));await mission('turn',{expectedRevision:0});
  const first={type:'assist',classId:'Saturday',studentId:'sam',helpedStudentId:'visitor',action:{id:aid(),spinId:aid()}};
  await call(teacher,first);
  await call(teacher,{...first,studentId:'visitor',helpedStudentId:'alex',action:{id:aid(),spinId:aid()}});
  const last={...first,studentId:'visitor',helpedStudentId:'sam',action:{id:aid(),spinId:aid()}};
  const result=await call(teacher,last);assert.equal(result.mission.current.status,'complete');assert.equal(result.hero.xp,12);assert.equal(db.data.get('students/visitor').marks,12);assert.equal(result.mission.lastPayout.awards.length,3);
  const retry=await call(teacher,last);assert.equal(retry.duplicate,true);assert.equal(retry.hero.xp,12);assert.equal(db.data.get('students/visitor').marks,12);
});

test('visiting student wheel award and completing class bonus combine into one returned balance and retain permanent membership',async()=>{
  const {db,call,mission}=missionSetup(0,.99);db.seed('students/visitor',{name:'Visitor',slot:'Tuesday',marks:7});
  await call(teacher,guestRequest('add'));await mission('turn',{expectedRevision:0});
  const party=[...heroes,C.heroFromStudent({id:'visitor',name:'Visitor'})];
  const request=wheelRequest(null,{studentId:'visitor',delta:10000,heroes:party}),result=await call(teacher,request);
  assert.equal(result.state.status,'victory');assert.equal(result.award.marks,10012);assert.equal(result.mission.lastPayout.awards.length,3);assert.equal(db.data.get('students/visitor').slot,'Tuesday');
  assert.equal((await call(teacher,request)).award.marks,10012);assert.equal([...db.data].filter(([p,v])=>p.startsWith('awards/')&&v.studentId==='visitor').length,2);
});

test('removed guest carries progression back to the original lesson and can be removed after permanent target roster disappears',async()=>{
  const {db,call,visit}=guestSetup();await begin(call);let state=(await visit('add')).state;
  const helped=await call(teacher,{type:'assist',classId:'Saturday',studentId:'visitor',helpedStudentId:'alex',action:{id:aid(),spinId:aid()}});state=helped.state;
  db.seed('students/alex',{name:'Alex',slot:'Sunday'});db.seed('students/sam',{name:'Sam',slot:'Sunday'});
  const removed=await visit('remove');assert.equal(removed.guests.length,0);assert.equal(removed.state.bossHp,state.bossHp);assert.equal(db.data.get(profilePath('visitor')).activeEncounter,null);
  const source=await begin(call,'Tuesday',[C.heroFromStudent({id:'visitor',name:'Visitor'})]);assert.equal(source.heroes[0].xp,6);assert.equal(source.heroes[0].studentId,'visitor');
});

test('pruning a deleted or slotless guest removes hidden active heroes and releases locks without granting treasure',async()=>{
  for(const change of ['deleted','slotless']){
    const {db,call,visit}=guestSetup();await begin(call);let state=(await visit('add')).state;
    const before=structuredClone(state),hero=structuredClone(db.data.get(profilePath('visitor')).hero);
    if(change==='deleted')db.data.delete('students/visitor');else db.seed('students/visitor',{name:'Visitor',slots:[]});
    const result=await visit('get');state=result.state;
    assert.deepEqual(result.guests,[]);assert.equal(state.heroes.length,2);assert.ok(!state.heroes.some(h=>h.studentId==='visitor'));assert.equal(state.bossHp,before.bossHp);assert.equal(state.bossMaxHp,before.bossMaxHp);assert.deepEqual(state.lastEvent,before.lastEvent);assert.deepEqual(state.combatLog,before.combatLog);assert.deepEqual(state.rewards,before.rewards);
    assert.equal(db.data.get(profilePath('visitor')).activeEncounter,null);assert.deepEqual(db.data.get(profilePath('visitor')).hero,hero);assert.equal(db.data.get(guestPath('Saturday')).studentIds.length,0);
    const replay=await visit('get');assert.equal(replay.state.revision,state.revision);
    const synced=await battle(call,'Saturday',{id:aid(),type:'sync',heroes,encounterId:state.encounterId,expectedRevision:state.revision});assert.equal(synced.state.heroes.length,2);
  }
});

test('pruning a selected deleted guest requires resolving or skipping the saved answer before releasing the lock',async()=>{
  const {db,call,visit}=guestSetup();await begin(call);let state=(await visit('add')).state;
  state=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:visitor',encounterId:state.encounterId,expectedRevision:state.revision})).state;
  db.data.delete('students/visitor');const before=JSON.stringify([...db.data]);
  await assert.rejects(visit('get'),e=>e.code==='guest_pending'&&/Resolve or skip/.test(e.message));assert.equal(JSON.stringify([...db.data]),before);
  state=(await battle(call,'Saturday',{id:aid(),type:'answer',outcome:'skip',turnId:state.pending.id,encounterId:state.encounterId,expectedRevision:state.revision})).state;
  const result=await visit('get');assert.equal(result.guests.length,0);assert.equal(result.state.heroes.length,2);assert.equal(db.data.get(profilePath('visitor')).activeEncounter,null);
});

test('a temporary student moved permanently into the target keeps the existing active hero and lock after pruning the label',async()=>{
  const {db,call,visit}=guestSetup();await begin(call);const state=(await visit('add')).state,profile=structuredClone(db.data.get(profilePath('visitor')));
  db.seed('students/visitor',{name:'Visitor',slot:'Saturday'});
  const result=await visit('get');assert.deepEqual(result.guests,[]);assert.deepEqual(result.state,state);assert.deepEqual(db.data.get(profilePath('visitor')),profile);
  const removed=await visit('remove');assert.deepEqual(removed.state,state);assert.deepEqual(db.data.get(profilePath('visitor')),profile);
});

test('removing the final temporary hero ends an empty encounter and preserves enemy HP and canonical progress',async()=>{
  const {db,call,visit}=guestSetup();await visit('add');
  const state=await begin(call,'Saturday',[C.heroFromStudent({id:'visitor',name:'Visitor'})]);
  db.seed('students/alex',{name:'Alex',slot:'Sunday'});db.seed('students/sam',{name:'Sam',slot:'Sunday'});
  const before=structuredClone(db.data.get(profilePath('visitor')).hero),removed=(await visit('remove')).state;
  assert.equal(removed.status,'defeat');assert.deepEqual(removed.heroes,[]);assert.equal(removed.pending,null);assert.equal(removed.bossHp,state.bossHp);assert.equal(removed.bossMaxHp,state.bossMaxHp);assert.deepEqual(removed.rewards,state.rewards);assert.deepEqual(removed.lastEvent,state.lastEvent);
  assert.equal(db.data.get(profilePath('visitor')).activeEncounter,null);assert.deepEqual(db.data.get(profilePath('visitor')).hero,before);
  const resumed=await begin(call,'Tuesday',[C.heroFromStudent({id:'visitor',name:'Visitor'})]);assert.equal(resumed.status,'active');
});

test('contested name and one account/two names claims serialize; names never establish ownership',async()=>{
  const {call,db}=setup();const result=await Promise.allSettled(['one','two'].map(uid=>call(pupil(uid),{type:'claim',studentId:'alex',lessonSlot:'Saturday'})));
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);const winner=db.data.get(profilePath('alex')).claim.uid;
  await assert.rejects(call(pupil(winner),{type:'claim',studentId:'sam',lessonSlot:'Saturday'}),/already/);
  const catalogue=await call(pupil('three'),{type:'catalog',lessonSlot:'Saturday'});assert.equal(catalogue.students.find(s=>s.id==='alex').status,'pending');assert.ok(!JSON.stringify(catalogue).includes('@example'));
  await assert.rejects(call(pupil('three'),{type:'claim',studentId:'Alex',lessonSlot:'Saturday'}),/removed/);
});

test('approval is teacher only; pending and another account cannot configure; rejected/cancelled names reclaim',async()=>{
  const {call}=setup();await call(pupil('one'),{type:'claim',studentId:'alex',lessonSlot:'Saturday'});
  await assert.rejects(call(pupil('one'),{type:'approve',studentId:'alex'}),/teacher/);
  await assert.rejects(call(pupil('one'),{type:'configure',command:'class',role:'mage'}),/approve/);
  await call(teacher,{type:'reject',studentId:'alex'});assert.equal((await call(pupil('one'),{type:'me'})).status,'unclaimed');
  await call(pupil('two'),{type:'claim',studentId:'alex',lessonSlot:'Saturday'});await call(pupil('two'),{type:'cancelClaim'});
  await claim(call,'one');await claim(call,'two','sam');
  await assert.rejects(call(pupil('two'),{type:'configure',studentId:'alex',command:'class',role:'mage'}),/another/);
  const result=await call(pupil('one'),{type:'configure',command:'class',role:'mage',xp:999999,skillPoints:999});assert.equal(result.hero.role,'mage');assert.equal(result.hero.xp,0);assert.equal(result.hero.classChosen,true);
});

test('claim, unlink and corrected account preserve canonical progress, inventory and skills across slots',async()=>{
  const {call,db}=setup();let state=await begin(call);
  const h=state.heroes[0];h.xp=150;h.level=2;h.skillPoints=4;h.learnedSkills.push('warrior-cleave');h.inventory.push({id:'bag:crimson-edge',itemId:'crimson-edge',quantity:1});h.equipped='bag:crimson-edge';
  db.seed(profilePath('alex'),{...db.data.get(profilePath('alex')),hero:h});
  state=(await battle(call,'Saturday',{id:aid(),type:'end',encounterId:state.encounterId,expectedRevision:state.revision})).state;
  await claim(call);let me=await call(pupil('one'),{type:'me'});assert.equal(me.hero.xp,150);assert.equal(me.hero.equipped,'bag:crimson-edge');assert.equal(me.hero.uid,'one');
  await call(teacher,{type:'unlink',studentId:'alex'});assert.equal((await call(pupil('one'),{type:'me'})).status,'unclaimed');
  await claim(call,'two','alex','Sunday');me=await call(pupil('two'),{type:'me'});assert.equal(me.hero.xp,150);assert.ok(me.hero.learnedSkills.includes('warrior-cleave'));
  const sunday=await begin(call,'Sunday',[heroes[0]]);assert.equal(sunday.heroes[0].id,'student:alex');assert.equal(sunday.heroes[0].xp,150);assert.equal(sunday.heroes[0].equipped,'bag:crimson-edge');assert.equal(sunday.heroes[0].uid,'two');
});

test('deleted roster claims remain visible to the teacher and unlink preserves progress while freeing the account',async()=>{
  const {call,db}=setup();await claim(call);
  const original=db.data.get(profilePath('alex'));original.hero.xp=150;original.hero.level=2;original.hero.inventory.push({id:'bag:crimson-edge',itemId:'crimson-edge',quantity:1});original.hero.equipped='bag:crimson-edge';
  db.seed(profilePath('alex'),original);db.data.delete('students/alex');
  const result=await call(teacher,{type:'claims'}),removed=result.claims.find(c=>c.studentId==='alex');
  assert.ok(removed);assert.equal(removed.name,'Alex');assert.equal(removed.rosterMissing,true);assert.deepEqual(removed.lessonSlots,[]);
  await call(teacher,{type:'unlink',studentId:'alex'});
  const saved=db.data.get(profilePath('alex'));assert.equal(saved.hero.xp,150);assert.equal(saved.hero.equipped,'bag:crimson-edge');assert.deepEqual(saved.hero.inventory,original.hero.inventory);assert.equal(saved.claim,null);
  assert.equal((await call(pupil('one'),{type:'me'})).status,'unclaimed');
  await claim(call,'one','sam');assert.equal((await call(pupil('one'),{type:'me'})).hero.studentId,'sam');
});

test('active encounter locks configuration and cross-slot duplication, explicit end unlocks',async()=>{
  const {call}=setup();await claim(call);const s=await begin(call);
  await assert.rejects(call(pupil('one'),{type:'configure',command:'class',role:'mage'}),/active encounter/);
  await battle(call,'Saturday',{id:aid(),type:'end',encounterId:s.encounterId,expectedRevision:s.revision});
  const configured=await call(pupil('one'),{type:'configure',command:'class',role:'ranger'});assert.equal(configured.hero.role,'ranger');
  assert.equal((await begin(call,'Sunday',[heroes[0]])).heroes[0].role,'ranger');
});

test('teacher can end an unclaimed moved-slot encounter from claim administration; students cannot',async()=>{
  const {call,db}=setup();await begin(call);db.seed('students/alex',{name:'Alex',slots:['Monday']});
  const administration=await call(teacher,{type:'claims'});assert.equal(administration.claims.length,0);assert.ok(administration.activeEncounters.some(e=>e.studentId==='alex' && e.classId==='Saturday'));
  await assert.rejects(call(pupil('one'),{type:'endEncounter',studentId:'alex'}),/teacher/);
  await call(teacher,{type:'endEncounter',studentId:'alex'});assert.equal(db.data.get(profilePath('alex')).activeEncounter,null);assert.equal(db.data.get(profilePath('sam')).activeEncounter,null);
  assert.equal((await call(teacher,{type:'endEncounter',studentId:'alex'})).status,'ended');
  const moved=await begin(call,'Monday',[heroes[0]]);assert.equal(moved.heroes[0].id,'student:alex');
});

test('legacy migration preserves strongest progress but still locks an unfinished lower-XP lesson',async()=>{
  const {call,db}=setup();const stronger={...heroes[0],xp:300,level:3};
  db.seed(classPath('Sunday'),{...C.reduce(null,{type:'start',id:aid(),bossId:'goblin',heroes:[heroes[0]]}),classId:'Sunday',status:'victory',heroes:[stronger]});
  db.seed(classPath('Saturday'),{...C.reduce(null,{type:'start',id:aid(),bossId:'goblin',heroes:[heroes[0]]}),classId:'Saturday',updatedAt:9});
  await claim(call);let me=await call(pupil('one'),{type:'me'});assert.equal(me.hero.xp,300);assert.equal(me.activeEncounter.classId,'Saturday');
  await assert.rejects(call(pupil('one'),{type:'configure',command:'class',role:'mage'}),/active encounter/);
  await call(teacher,{type:'endEncounter',studentId:'alex'});me=await call(pupil('one'),{type:'me'});assert.equal(me.hero.xp,300);assert.equal(me.activeEncounter,null);
});

test('automatic wheel fights require an atomic positive marks award; old spin-only clients cannot attack',async()=>{
  const {call,db}=setup();const request=wheelRequest();
  await assert.rejects(battle(call,'Saturday',request.action),/award points/);
  assert.equal(db.data.size,2);
  const result=await call(teacher,request);assert.equal(result.state.lastEvent.type,'auto');assert.equal(result.state.heroes[0].xp,12);assert.equal(result.state.lastEvent.points,1);
  assert.deepEqual(result.award,{id:request.action.id,studentId:'alex',delta:1,marks:1});
  const repeated=await call(teacher,request);assert.equal(repeated.duplicate,true);assert.equal(repeated.state.heroes[0].xp,12);assert.equal(db.data.get(profilePath('alex')).hero.xp,12);assert.equal(db.data.get('students/alex').marks,1);
});

test('wheel award atomically preserves roster data, writes normal history and damages active school bosses',async()=>{
  const {call,db}=setup();const original={...db.data.get('students/alex'),id:'legacy-field',marks:20,notes:{subject:'Science'},otherRewards:['keep']};db.seed('students/alex',original);
  db.seed('bosses/active',{active:true,hp:8,maxHp:100,title:'School dragon',config:{keep:true}});
  db.seed('bosses/defeated',{active:true,hp:3,defeated:true});db.seed('bosses/inactive',{active:false,hp:20});db.seed('bosses/final',{active:true,hp:2,maxHp:10});
  const request=wheelRequest(null,{delta:5,points:999}),result=await call(teacher,request);
  assert.equal(result.state.lastEvent.points,5);assert.equal(result.award.marks,25);assert.deepEqual(db.data.get('students/alex'),{...original,marks:25});
  const ledger=[...db.data].filter(([path])=>path.startsWith('awards/'));assert.equal(ledger.length,1);const row=ledger[0][1];
  assert.deepEqual(Object.keys(row).sort(),['studentId','studentName','delta','reason','source','by','undone','createdAt'].sort());
  assert.equal(row.studentId,'alex');assert.equal(row.studentName,'Alex');assert.equal(row.delta,5);assert.equal(row.reason,request.reason);assert.equal(row.source,'annotator');assert.equal(row.by,teacher.email);assert.equal(row.undone,false);assert.equal(row.createdAt._seconds,123456);
  assert.deepEqual(db.data.get('bosses/active'),{active:true,hp:3,maxHp:100,title:'School dragon',config:{keep:true}});
  assert.equal(db.data.get('bosses/defeated').hp,3);assert.equal(db.data.get('bosses/inactive').hp,20);assert.equal(db.data.get('bosses/final').hp,0);assert.equal(db.data.get('bosses/final').defeated,true);assert.deepEqual(db.data.get('bosses/final').defeatedAt,row.createdAt);
});

test('wheel award validation refuses students, invalid points, mismatched hero and missing or moved roster names without writes',async()=>{
  const {call,db}=setup();const before=JSON.stringify([...db.data]);
  await assert.rejects(call(pupil('one'),wheelRequest()),/teacher/);
  for(const delta of [0,-1,1.5,'2',undefined,10001,Infinity,NaN]){
    const request=wheelRequest();request.delta=delta;await assert.rejects(call(teacher,request),/whole points/);
  }
  for(const change of [{heroId:'student:sam'},{type:'answer'},{spinId:''}])await assert.rejects(call(teacher,wheelRequest(null,change)),/Select a roster student/);
  for(const studentId of ['removed','wheel-guest'])await assert.rejects(call(teacher,wheelRequest(null,{studentId})),/no longer in this lesson slot/);
  await assert.rejects(call(teacher,wheelRequest(null,{classId:'Monday'})),/no longer in this lesson slot/);
  assert.equal(JSON.stringify([...db.data]),before);
});

test('concurrent duplicate awards commit points, history, XP and school boss damage exactly once',async()=>{
  const {call,db}=setup();db.seed('bosses/school',{active:true,hp:100});const request=wheelRequest();
  const results=await Promise.all([call(teacher,request),call(teacher,request),call(teacher,request)]);
  assert.equal(results.filter(r=>r.duplicate).length,2);assert.equal(db.data.get('students/alex').marks,1);assert.equal(db.data.get('bosses/school').hp,99);assert.equal(db.data.get(profilePath('alex')).hero.xp,12);
  assert.equal([...db.data.keys()].filter(p=>p.startsWith('awards/')).length,1);assert.equal([...db.data.keys()].filter(p=>p.includes('/actions/')).length,1);
});

test('new awards on the same spin resolve separately; retrying an earlier award returns current balance and state',async()=>{
  const {call,db}=setup();const first=wheelRequest(null,{bossId:'mossback'}),one=await call(teacher,first),second=wheelRequest(one.state,{spinId:first.action.spinId,delta:2});
  const two=await call(teacher,second);assert.equal(two.award.marks,3);assert.equal(two.state.heroes[0].xp,24);assert.equal(two.state.lastEvent.points,2);
  const retried=await call(teacher,first);assert.equal(retried.duplicate,true);assert.equal(retried.award.id,first.action.id);assert.equal(retried.award.delta,1);assert.equal(retried.award.marks,3);assert.deepEqual(retried.state,two.state);assert.equal([...db.data.keys()].filter(p=>p.startsWith('awards/')).length,2);
});

test('saved award IDs cannot be reused for changed points, student, spin or reason',async()=>{
  const {call,db}=setup();const request=wheelRequest();await call(teacher,request);const before=JSON.stringify([...db.data]);
  for(const change of [{delta:2},{studentId:'sam',action:{...request.action,heroId:'student:sam'}},{reason:'Changed reason'},{action:{...request.action,spinId:aid()}}])await assert.rejects(call(teacher,{...request,...change}),/different details/);
  assert.equal(JSON.stringify([...db.data]),before);
});

test('stale or pending battles and commit failures leave marks, history and all progress unchanged',async()=>{
  const {call,db}=setup();const state=await begin(call),request=wheelRequest(state);request.action.expectedRevision=state.revision+1;let before=JSON.stringify([...db.data]);
  await assert.rejects(call(teacher,request),/changed/);assert.equal(JSON.stringify([...db.data]),before);
  const selected=(await battle(call,'Saturday',{type:'select',id:aid(),encounterId:state.encounterId,expectedRevision:state.revision,heroId:'student:alex'})).state;
  before=JSON.stringify([...db.data]);await assert.rejects(call(teacher,wheelRequest(selected)),/manual battle answer/);assert.equal(JSON.stringify([...db.data]),before);
  const fresh=setup(),award=wheelRequest();fresh.db.seed('bosses/school',{active:true,hp:50});before=JSON.stringify([...fresh.db.data]);fresh.db.failNextCommit=true;
  await assert.rejects(fresh.call(teacher,award),/commit failed/);assert.equal(JSON.stringify([...fresh.db.data]),before);
  const saved=await fresh.call(teacher,award);assert.equal(saved.award.marks,1);assert.equal(fresh.db.data.get('bosses/school').hp,49);
});

test('adding a progressed hero to an active party preserves canonical XP, skills and equipment in sync and auto',async()=>{
  for (const type of ['sync','auto']) {
    const {call,db}=setup();const s=await begin(call,'Saturday',[heroes[0]]);
    const hero={...heroes[1],xp:300,level:3,skillPoints:6,equipped:'bag:crimson-edge',learnedSkills:['warrior-slash','warrior-cleave'],inventory:[...heroes[1].inventory,{id:'bag:crimson-edge',itemId:'crimson-edge',quantity:1}]};
    db.seed(profilePath('sam'),{schemaVersion:1,studentId:'sam',hero,claim:null,activeEncounter:null});
    const id=aid();const result=type==='auto' ? await call(teacher,wheelRequest(s,{id,studentId:'sam'})) : await battle(call,'Saturday',{type,id,encounterId:s.encounterId,expectedRevision:s.revision,heroes,heroId:'student:sam',bossId:'goblin'});
    const saved=result.state.heroes.find(h=>h.studentId==='sam');assert.ok(saved.xp>=300);assert.ok(saved.learnedSkills.includes('warrior-cleave'));assert.ok(saved.inventory.some(i=>i.itemId==='crimson-edge'));assert.equal(db.data.get(profilePath('sam')).hero.xp,saved.xp);
  }
});

test('wheel guest input cannot inject arbitrary progression into trusted prior state',async()=>{
  const {call}=setup();let s=await begin(call,'Saturday',[heroes[0]]);const guest={...heroes[0],id:'student:wheel-guest',studentId:'wheel-guest',name:'Guest',xp:90000,level:50,stats:{damage:999999}};
  const result=await battle(call,'Saturday',{type:'sync',id:aid(),encounterId:s.encounterId,expectedRevision:s.revision,heroes:[heroes[0],guest]});
  const saved=result.state.heroes.find(h=>h.studentId==='wheel-guest');assert.equal(saved.xp,0);assert.equal(saved.level,1);assert.ok(saved.stats.damage<100);
});

test('battle rollback and duplicate receipts prevent repeat XP, item consumption and reward chests',async()=>{
  const {call,db}=setup();let s=await begin(call);
  const select={id:aid(),type:'select',encounterId:s.encounterId,expectedRevision:s.revision,heroId:s.heroes[0].id};s=(await battle(call,'Saturday',select)).state;
  const before=JSON.stringify([...db.data]);await assert.rejects(battle(call,'Saturday',{id:aid(),type:'answer',encounterId:s.encounterId,turnId:s.pending.id,outcome:'correct',command:'skill',skillId:'fake'}),/Learn/);assert.equal(JSON.stringify([...db.data]),before);
  s.bossHp=1;db.seed(classPath('Saturday'),s);
  const action={id:aid(),type:'answer',encounterId:s.encounterId,turnId:s.pending.id,outcome:'correct'};
  const results=await Promise.all([battle(call,'Saturday',action),battle(call,'Saturday',action)]);assert.deepEqual(results[0],results[1]);assert.equal(results[0].state.status,'victory');
  const profile=db.data.get(profilePath('alex'));assert.equal(profile.activeEncounter,null);const total=profile.hero.inventory.reduce((sum,i)=>sum+i.quantity,0);assert.equal(total,4);
  await battle(call,'Saturday',action);assert.deepEqual(db.data.get(profilePath('alex')),profile);
  const next=await begin(call,'Sunday',[heroes[0]]);assert.equal(next.heroes[0].xp,profile.hero.xp);assert.equal(next.heroes[0].inventory.reduce((sum,i)=>sum+i.quantity,0),4);
});

test('migration selects strongest latest snapshot without duplicating loot and maps old uid to roster ID',()=>{
  const old=C.heroFromStudent({id:'alex',uid:'old-cer-uid',name:'Alex'});old.id='uid:old-cer-uid';old.xp=150;old.level=2;old.inventory[0].quantity=4;
  const snap=(id,xp,stamp,quantity)=>({id,updateTime:{toMillis:()=>stamp},data:()=>({classId:id,status:'victory',revision:1,heroes:[{...old,xp,inventory:[{id:'bag:red-potion',itemId:'red-potion',quantity}]}]})});
  const migrated=migrateHero({id:'alex',name:'Alex',uid:'old-cer-uid',slots:['Saturday','Sunday']},[snap('Saturday',150,1,4),snap('Sunday',150,2,3),snap('Other',75,3,9)]);
  assert.equal(migrated.hero.id,'student:alex');assert.equal(migrated.hero.xp,150);assert.equal(migrated.hero.inventory[0].quantity,3);assert.equal(migrated.hero.classChosen,false);assert.equal(migrated.activeEncounter,null);
});

test('student cannot run battle or forge another teacher namespace',async()=>{
  const {call,db}=setup();await assert.rejects(call(pupil('one'),{type:'battle',teacherId:'teacher',classId:'Saturday',action:{id:aid(),type:'start',heroes,bossId:'goblin'}}),/teacher/);
  assert.equal([...db.data.keys()].some(p=>p.startsWith('classroomBattles')),false);
  const result=await call(pupil('one'),{type:'me',uid:'somebody-else',teacherId:'other-teacher'});assert.equal(result.status,'unclaimed');
});

test('server and browser game artifacts are byte-for-byte identical',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const name of ['battle-core.js','battle-content.js','battle-bosses.js','mission-content.js'])assert.deepEqual(fs.readFileSync(path.resolve(__dirname,'../hero-game',name)),fs.readFileSync(path.resolve(__dirname,'../../',name)));
});


function assistRequest({studentId='sam',helpedStudentId='alex',spinId=aid(),id=aid(),classId='Saturday'}={}) {
  return {type:'assist',classId,studentId,helpedStudentId,action:{id,spinId}};
}
test('assist awards exactly 6 canonical XP without starting combat or changing marks',async()=>{
  const {call,db}=setup(),request=assistRequest();
  const result=await call(teacher,{...request,xp:99999});
  assert.equal(result.hero.xp,6);assert.equal(result.assist.xp,6);assert.equal(result.state,null);
  assert.equal(db.data.get(profilePath('sam')).hero.xp,6);assert.equal(db.data.has(classPath('Saturday')),false);
  assert.equal(db.data.get('students/sam').marks,undefined);assert.equal([...db.data.keys()].some(p=>p.startsWith('awards/')),false);
});
test('assist is teacher-only, requires two current roster students and a valid spin',async()=>{
  const {call,db}=setup(),before=JSON.stringify([...db.data]);
  await assert.rejects(call(pupil('sam'),assistRequest()),/teacher/);
  await assert.rejects(call(teacher,assistRequest({studentId:'alex'})),/another student/);
  await assert.rejects(call(teacher,assistRequest({classId:'Sunday'})),/Both students/);
  await assert.rejects(call(teacher,assistRequest({studentId:'gone'})),/Both students/);
  await assert.rejects(call(teacher,assistRequest({spinId:'bad'})),/Spin/);
  assert.equal(JSON.stringify([...db.data]),before);
});
test('same helper and question deduplicates even with distinct action IDs and concurrent requests',async()=>{
  const {call,db}=setup(),request=assistRequest();
  const results=await Promise.all([call(teacher,request),call(teacher,{...request,action:{...request.action,id:aid()}}),call(teacher,request)]);
  assert.equal(results.filter(x=>x.duplicate).length,2);assert.equal(db.data.get(profilePath('sam')).hero.xp,6);
  assert.equal([...db.data.keys()].filter(p=>p.includes('/assists/')).length,1);
  const next=await call(teacher,assistRequest());assert.equal(next.hero.xp,12);
});
test('assist in an encounter changes only helper progression, without another action or enemy reply',async()=>{
  const {call,db}=setup(),state=await begin(call),beforeSam=state.heroes.find(h=>h.studentId==='sam');
  const result=await call(teacher,assistRequest());
  assert.equal(result.state.bossHp,state.bossHp);assert.equal(result.state.bossMp,state.bossMp);assert.equal(result.state.charge,state.charge);
  assert.equal(result.state.bossTurns,state.bossTurns);assert.equal(result.state.correctCount,state.correctCount);assert.equal(result.state.actionCount,state.actionCount);
  assert.deepEqual(result.state.lastEvent,state.lastEvent);assert.equal(result.hero.hp,beforeSam.hp);assert.equal(result.hero.mp,beforeSam.mp);
  assert.equal(result.state.heroes.find(h=>h.studentId==='sam').xp,6);assert.equal(result.state.revision,state.revision+1);
  assert.deepEqual(db.data.get(profilePath('sam')).activeEncounter,{classId:'Saturday',encounterId:state.encounterId});
});
test('assist rejects a helper locked in another encounter and never drops progression on failed save',async()=>{
  const other=setup();await begin(other.call,'Sunday',[heroes[0]]);
  await assert.rejects(other.call(teacher,assistRequest({studentId:'alex',helpedStudentId:'sam'})),/other active encounter/);
  const {call,db}=setup(),request=assistRequest(),before=JSON.stringify([...db.data]);db.failNextCommit=true;
  await assert.rejects(call(teacher,request),/commit failed/);assert.equal(JSON.stringify([...db.data]),before);
  assert.equal((await call(teacher,request)).hero.xp,6);assert.equal((await call(teacher,request)).hero.xp,6);
});
test('level-15 advancement uses the approved canonical profile and stays blocked in active encounters',async()=>{
  const {call,db}=setup();await claim(call,'one','alex');
  const profile=db.data.get(profilePath('alex'));profile.hero=C.configureHero(profile.hero,{command:'class',role:'warrior'});
  profile.hero.xp=C.xpForLevel(14);db.seed(profilePath('alex'),profile);
  await assert.rejects(call(pupil('one'),{type:'configure',command:'advance',jobId:'paladin'}),/15/);
  profile.hero.xp=C.xpForLevel(15);db.seed(profilePath('alex'),profile);
  const advanced=await call(pupil('one'),{type:'configure',command:'advance',jobId:'paladin'});
  assert.equal(advanced.hero.job,'paladin');assert.equal(advanced.hero.xp,C.xpForLevel(15));
  await assert.rejects(call(pupil('two'),{type:'configure',studentId:'alex',command:'advance',jobId:'berserker'}),/another account/);
  await begin(call);await assert.rejects(call(pupil('one'),{type:'configure',command:'advance',jobId:'berserker'}),/active encounter/);
});

test('appearance requires an approved owner or teacher and ignores forged progression',async()=>{
  const {call,db}=setup();await call(pupil('one'),{type:'claim',studentId:'alex',lessonSlot:'Saturday'});
  await assert.rejects(call(pupil('one'),{type:'configure',command:'appearance',gender:'female'}),/approve/);
  await call(teacher,{type:'approve',studentId:'alex'});await claim(call,'two','sam');
  await assert.rejects(call(pupil('two'),{type:'configure',studentId:'alex',command:'appearance',gender:'female'}),/another account/);
  const before=structuredClone(db.data.get(profilePath('alex')).hero);
  const result=await call(pupil('one'),{type:'configure',command:'appearance',gender:'female',xp:999999,skillPoints:150,hp:99999});
  assert.deepEqual(result.hero,{...before,gender:'female'});assert.equal(result.state,undefined);
  const invalidBefore=structuredClone([...db.data]);
  for(const gender of ['Female',null,'',{},undefined])await assert.rejects(call(teacher,{type:'configure',studentId:'alex',command:'appearance',gender}),/male or female/);
  assert.deepEqual([...db.data],invalidBefore);
  db.seed('students/lee',{name:'Lee',slot:'Saturday'});
  const unclaimed=await call(teacher,{type:'configure',studentId:'lee',command:'appearance',gender:'female'});
  assert.equal(unclaimed.hero.gender,'female');
});

test('student cosmetic changes update the active lesson atomically, preserving pending combat and movement locks',async()=>{
  const {call,db}=setup();await claim(call);let s=await begin(call);
  s=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:alex',encounterId:s.encounterId,expectedRevision:s.revision})).state;
  const before=structuredClone(s),profileBefore=structuredClone(db.data.get(profilePath('alex')));
  // Roster moves must not redirect the update away from the already active fight.
  db.seed('students/alex',{name:'Alex',slots:['Sunday']});
  const changed=await call(pupil('one'),{type:'configure',id:aid(),command:'appearance',gender:'female'});
  assert.equal(changed.hero.gender,'female');assert.equal(changed.state,undefined,'students cannot read classmates through configure');
  const saved=db.data.get(classPath('Saturday')),expected=structuredClone(before);expected.revision++;expected.heroes[0].gender='female';
  assert.deepEqual(saved,expected);assert.deepEqual(changed.hero,{...profileBefore.hero,gender:'female'});
  assert.deepEqual(db.data.get(profilePath('alex')).activeEncounter,profileBefore.activeEncounter);
  const answered=await battle(call,'Saturday',{id:aid(),type:'answer',encounterId:saved.encounterId,turnId:saved.pending.id,outcome:'correct',command:'attack'});
  assert.equal(answered.state.heroes[0].gender,'female');assert.equal(answered.state.pending,null);
});

test('teacher battle appearance saves while an answer is pending and retries never replay or reverse it',async()=>{
  const {call,db}=setup();let s=await begin(call);
  s=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:alex',encounterId:s.encounterId,expectedRevision:s.revision})).state;
  const request={id:aid(),type:'sync',heroId:'student:alex',command:'appearance',gender:'female',encounterId:s.encounterId,expectedRevision:s.revision};
  const before=structuredClone(s),result=await battle(call,'Saturday',request),expected=structuredClone(before);
  expected.revision++;expected.heroes[0].gender='female';assert.deepEqual(result.state,expected);
  assert.equal(db.data.get(profilePath('alex')).hero.gender,'female');
  const changed=await battle(call,'Saturday',{...request,id:aid(),gender:'male',expectedRevision:result.state.revision});
  const repeated=await battle(call,'Saturday',request);assert.deepEqual(repeated.state,changed.state);assert.equal(repeated.state.heroes[0].gender,'male');
  await assert.rejects(battle(call,'Saturday',{...request,id:aid()}),/changed on another screen/);
});

test('appearance receipts protect delayed retries and failed transactions leave both copies unchanged',async()=>{
  const {call,db}=setup();await claim(call);await begin(call);
  const request={type:'configure',id:aid(),command:'appearance',gender:'female'};
  const before=structuredClone([...db.data]);db.failNextCommit=true;
  await assert.rejects(call(pupil('one'),request),/commit failed/);assert.deepEqual([...db.data],before);
  const [first,parallelRetry]=await Promise.all([call(pupil('one'),request),call(pupil('one'),request)]);
  assert.equal(first.hero.gender,'female');assert.equal(parallelRetry.hero.gender,'female');
  assert.equal([first,parallelRetry].filter(r=>r.duplicate).length,1);
  assert.equal(db.data.get(classPath('Saturday')).revision,before.find(([path])=>path===classPath('Saturday'))[1].revision+1);
  const teacherChange=await call(teacher,{type:'configure',studentId:'alex',id:aid(),command:'appearance',gender:'male'});
  assert.equal(teacherChange.state.heroes[0].gender,'male');
  const saved=structuredClone([...db.data]),retry=await call(pupil('one'),request);
  assert.equal(retry.duplicate,true);assert.equal(retry.hero.gender,'male');assert.deepEqual([...db.data],saved);
  await assert.rejects(call(pupil('one'),{...request,gender:'male'}),/different details/);
});

test('stale lesson snapshots and client roster appearances never override canonical gender',async()=>{
  const {call}=setup();let s=await begin(call);
  s=(await battle(call,'Saturday',{id:aid(),type:'end',encounterId:s.encounterId,expectedRevision:s.revision})).state;
  await call(teacher,{type:'configure',studentId:'alex',command:'appearance',gender:'female'});
  const Sunday=await begin(call,'Sunday',[{...heroes[0],gender:'male'}]);
  assert.equal(Sunday.heroes[0].gender,'female');
  const synced=await battle(call,'Sunday',{id:aid(),type:'sync',encounterId:Sunday.encounterId,expectedRevision:Sunday.revision,heroes:[{...heroes[0],gender:'male'}]});
  assert.equal(synced.state.heroes[0].gender,'female');
});

test('opening battle screens halves a legacy active enemy once and preserves the pending turn and all other data',async()=>{
  const {call,mission,db,time}=missionSetup(.6,.2);
  let state=await begin(call);
  state=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:alex',encounterId:state.encounterId,expectedRevision:state.revision})).state;
  await mission('turn',{expectedRevision:0});state=structuredClone(db.data.get(classPath('Saturday')));
  delete state.enemyHealthVersion;state.bossMaxHp=1001;state.bossHp=731;
  state.heroes[0].hp=23;state.heroes[0].mp=7;state.heroes[0].xp=432;
  state.rewards=[{heroId:'student:alex',itemId:'crimson-edge',xp:45}];
  state.combatLog=[{id:'prior-turn',type:'auto',damage:270,move:'Attack'}];
  db.seed(classPath('Saturday'),state);
  const before=structuredClone([...db.data]);time(2000);
  const responses=await Promise.all([mission('get'),mission('get'),mission('get')]);
  const expected={...state,bossMaxHp:501,bossHp:366,enemyHealthVersion:1,revision:state.revision+1,updatedAt:2000};
  for(const response of responses)assert.deepEqual(response.state,expected);
  assert.deepEqual(db.data.get(classPath('Saturday')),expected);
  assert.deepEqual([...db.data].filter(([path])=>path!==classPath('Saturday')),before.filter(([path])=>path!==classPath('Saturday')));
  const saved=structuredClone([...db.data]);time(3000);
  assert.deepEqual((await mission('get')).state,expected);assert.deepEqual([...db.data],saved);
});

test('failed enemy health migration commits leave all data unchanged and retry applies it only once',async()=>{
  const {call,mission,db}=missionSetup();const state=await begin(call);
  delete state.enemyHealthVersion;state.bossMaxHp=800;state.bossHp=600;
  db.seed(classPath('Saturday'),state);const before=structuredClone([...db.data]);
  db.failNextCommit=true;await assert.rejects(mission('get'),/commit failed/);assert.deepEqual([...db.data],before);
  const saved=(await mission('get')).state;assert.equal(saved.bossMaxHp,400);assert.equal(saved.bossHp,300);
  assert.equal(saved.revision,state.revision+1);assert.equal(saved.enemyHealthVersion,1);
  assert.deepEqual((await mission('get')).state,saved);
});

test('opening a completed or absent encounter never migrates health or creates progression',async()=>{
  const {call,mission,db}=missionSetup();const empty=structuredClone([...db.data]);
  assert.equal((await mission('get')).state,null);assert.deepEqual([...db.data],empty);
  const state=await begin(call);delete state.enemyHealthVersion;
  for(const status of ['victory','defeat']){
    const ended={...state,status,bossMaxHp:800,bossHp:status==='victory'?0:300};db.seed(classPath('Saturday'),ended);
    const before=structuredClone([...db.data]);assert.deepEqual((await mission('get')).state,ended);assert.deepEqual([...db.data],before);
  }
});

test('a direct points award migrates legacy enemy health and commits damage and rewards only once across retries',async()=>{
  const {call,db}=setup();const legacy=await begin(call);
  delete legacy.enemyHealthVersion;legacy.bossMaxHp=4000;legacy.bossHp=3000;
  db.seed(classPath('Saturday'),legacy);
  const request=wheelRequest(legacy),result=await call(teacher,request);
  assert.equal(result.state.enemyHealthVersion,1);assert.equal(result.state.bossMaxHp,2000);
  assert.equal(result.state.bossHp,1500-result.state.lastEvent.damage);
  assert.equal(result.state.status,'active');assert.equal(result.award.marks,1);
  assert.equal(result.state.heroes[0].xp,legacy.heroes[0].xp+12);
  const saved=structuredClone([...db.data]),retries=await Promise.all([call(teacher,request),call(teacher,request)]);
  for(const retry of retries){assert.equal(retry.duplicate,true);assert.deepEqual(retry.state,result.state);}
  assert.deepEqual([...db.data],saved);
});

test('missions are teacher only, private server rolls cannot be forged, and racing turns save one roll',async()=>{
  const {call,mission,db}=missionSetup(.8,0);
  await assert.rejects(call(pupil('one'),{type:'mission',classId:'Saturday',command:'get'}),/teacher/);
  const first={type:'mission',classId:'Saturday',command:'turn',id:aid(),expectedRevision:0,objectiveId:'focus',prizeId:'class-points'};
  const results=await Promise.allSettled([call(teacher,first),mission('turn',{expectedRevision:0})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const saved=results.find(r=>r.status==='fulfilled').value.mission;
  assert.equal(saved.current.objectiveId,'assists');assert.equal(saved.current.prize.id,'summon-chung');assert.equal(db.data.has(classPath('Saturday')),false);
  if(saved.current.id===first.id){const retry=await call(teacher,first);assert.equal(retry.duplicate,true);assert.deepEqual(retry.mission,saved);}
  await assert.rejects(mission('turn',{expectedRevision:saved.revision}),/cancel/);
  await assert.rejects(mission('cancel',{missionId:'wrong-id'}),/no longer active/);
  const cancelled=await mission('cancel',{missionId:saved.current.id});assert.equal(cancelled.mission.current.status,'cancelled');
  const next=await mission('turn',{expectedRevision:cancelled.mission.revision});assert.notEqual(next.mission.current.id,saved.current.id);
});

test('focus requires the server clock and an explicit confirmation; minute prizes redeem once',async()=>{
  const {mission,time,db}=missionSetup(.6,.2);const started=await mission('turn',{expectedRevision:0});
  const request={missionId:started.mission.current.id,id:aid(),now:99999999,focusReadyAt:0};
  await assert.rejects(mission('focus',request),/timer/);assert.equal(db.data.get(missionPath('Saturday')).bank.length,0);
  time(1801000);const done=await mission('focus',request);assert.equal(done.mission.current.status,'complete');assert.equal(done.mission.bank.length,1);
  assert.equal((await mission('focus',request)).duplicate,true);assert.equal((await mission('get')).mission.bank.length,1);
  const prize=done.mission.bank[0],redemption={prizeId:prize.id,id:aid()};
  const redeemed=await mission('redeem',redemption);assert.equal(redeemed.mission.bank[0].status,'redeemed');
  assert.equal((await mission('redeem',redemption)).duplicate,true);await assert.rejects(mission('redeem',{prizeId:prize.id}),/already/);
});

test('assists advance only from newly committed receipts and complete a summon reward once',async()=>{
  const {mission,call,db}=missionSetup(.8,0);const started=await mission('turn',{expectedRevision:0});
  const request={type:'assist',classId:'Saturday',studentId:'sam',helpedStudentId:'alex',action:{id:aid(),spinId:aid()}};
  await Promise.all([call(teacher,request),call(teacher,{...request,action:{...request.action,id:aid()}})]);
  assert.equal(db.data.get(missionPath('Saturday')).current.progress,1);
  for(let i=0;i<2;i++)await call(teacher,{...request,action:{id:aid(),spinId:aid()}});
  const done=(await mission('get')).mission;assert.equal(done.current.id,started.mission.current.id);assert.equal(done.current.status,'complete');assert.equal(done.summonTokens,1);
  assert.equal(db.data.get(profilePath('sam')).hero.xp,18);assert.equal(db.data.has(classPath('Saturday')),false);
});

test('manual and awarded answers share the streak; incorrect wheel receipts cannot reset a later streak twice',async()=>{
  const {mission,call,db}=missionSetup(.3,.1);let m=(await mission('turn',{expectedRevision:0})).mission;
  let s=(await call(teacher,wheelRequest())).state;assert.equal((await mission('get')).mission.current.progress,1);
  // Keep this mission fixture active through every answer and reset below.
  s.bossHp=s.bossMaxHp=100000;db.seed(classPath('Saturday'),s);
  const incorrect={missionId:m.current.id,spinId:aid(),id:aid()};s=(await mission('incorrect',incorrect)).state;
  assert.equal((await mission('get')).mission.current.progress,0);
  s=(await call(teacher,wheelRequest(s))).state;
  await mission('incorrect',{...incorrect,id:aid()});assert.equal((await mission('get')).mission.current.progress,1);
  s=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:alex',turnId:aid(),encounterId:s.encounterId,expectedRevision:s.revision})).state;
  s=(await battle(call,'Saturday',{id:aid(),type:'answer',outcome:'incorrect',turnId:s.pending.id,encounterId:s.encounterId})).state;
  assert.equal((await mission('get')).mission.current.progress,0);
  for(let i=0;i<7;i++)s=(await call(teacher,wheelRequest(s))).state;
  m=(await mission('get')).mission;assert.equal(m.current.status,'complete');assert.equal(m.bank.length,1);
});

test('bonus class points include the completing wheel award, preserve roster fields, and never attack twice',async()=>{
  const {mission,call,db}=missionSetup(0,.99);
  db.seed('students/alex',{...db.data.get('students/alex'),id:'legacy-data-id',marks:9,notes:{keep:true}});
  db.seed('students/sam',{...db.data.get('students/sam'),marks:2});db.seed('students/elsewhere',{name:'Other',slot:'Elsewhere',marks:4});
  await mission('turn',{expectedRevision:0});const request=wheelRequest(null,{delta:1000});
  const results=await Promise.all([call(teacher,request),call(teacher,request)]);const result=results[0];
  assert.equal(result.state.status,'victory');assert.equal(result.state.actionCount,1);assert.equal(result.state.combatLog.length,1);
  assert.equal(result.mission.current.status,'complete');assert.equal(result.mission.lastPayout.awards.length,2);assert.equal(result.award.marks,1014);
  assert.equal(db.data.get('students/alex').marks,1014);assert.equal(db.data.get('students/alex').id,'legacy-data-id');assert.deepEqual(db.data.get('students/alex').notes,{keep:true});
  assert.equal(db.data.get('students/sam').marks,7);assert.equal(db.data.get('students/elsewhere').marks,4);
  assert.equal([...db.data.keys()].filter(p=>p.startsWith('awards/')).length,3);
  await call(teacher,request);assert.equal(db.data.get('students/alex').marks,1014);
});

test('new roster membership at completion controls a class payout and failed commits pay nobody',async()=>{
  const {mission,time,db}=missionSetup(.6,.99);const started=await mission('turn',{expectedRevision:0});
  db.seed('students/alex',{name:'Alex',slot:'Elsewhere',marks:10});db.seed('students/newbie',{name:'New',slot:'Saturday',marks:3});time(1801000);
  db.failNextCommit=true;const completion={missionId:started.mission.current.id,id:aid()};
  await assert.rejects(mission('focus',completion),/commit failed/);assert.equal(db.data.get('students/newbie').marks,3);assert.equal(db.data.get(missionPath('Saturday')).current.status,'active');
  const done=await mission('focus',completion);assert.equal(db.data.get('students/newbie').marks,8);assert.equal(db.data.get('students/alex').marks,10);assert.equal(db.data.get('students/sam').marks,5);
  assert.equal(done.mission.lastPayout.awards.length,2);
});

test('summon token is atomically consumed once, clears pending answers, and duplicate retries preserve loot',async()=>{
  const {mission,call,time,db}=missionSetup(.6,0);const started=await mission('turn',{expectedRevision:0});time(1801000);await mission('focus',{missionId:started.mission.current.id});
  let s=await begin(call);s=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:alex',encounterId:s.encounterId,expectedRevision:s.revision})).state;
  const action={id:aid(),type:'summon',source:'reward',encounterId:s.encounterId,expectedRevision:s.revision};
  const outcomes=await Promise.all([battle(call,'Saturday',action),battle(call,'Saturday',action)]);const done=outcomes[0];
  assert.equal(done.state.status,'victory');assert.equal(done.state.pending,null);assert.equal(done.state.lastEvent.damage,s.bossHp);assert.equal(done.state.rewards.length,2);
  assert.equal(done.mission.summonTokens,0);assert.equal(db.data.get(profilePath('alex')).activeEncounter,null);assert.equal(done.state.combatLog.length,1);
  assert.deepEqual(outcomes[1].state,done.state);s=(await battle(call,'Saturday',{id:aid(),type:'start',heroes,bossId:'goblin',expectedRevision:done.state.revision})).state;
  await assert.rejects(battle(call,'Saturday',{...action,id:aid(),encounterId:s.encounterId,expectedRevision:s.revision}),/reward first/);
  const free=await battle(call,'Saturday',{id:aid(),type:'summon',source:'teacher',encounterId:s.encounterId,expectedRevision:s.revision});assert.equal(free.state.status,'victory');assert.equal(free.mission.summonTokens,0);
});

test('summon cannot bypass teacher authority, revision validation, active encounter locks or failed commits',async()=>{
  const {mission,call,time,db}=missionSetup(.6,0);const started=await mission('turn',{expectedRevision:0});time(1801000);await mission('focus',{missionId:started.mission.current.id});
  const s=await begin(call),action={id:aid(),type:'summon',source:'reward',encounterId:s.encounterId,expectedRevision:s.revision};
  await assert.rejects(call(pupil('one'),{type:'battle',classId:'Saturday',action}),/teacher/);
  await assert.rejects(battle(call,'Saturday',{...action,expectedRevision:0}),/changed/);assert.equal((await mission('get')).mission.summonTokens,1);
  db.failNextCommit=true;await assert.rejects(battle(call,'Saturday',action),/commit failed/);assert.equal((await mission('get')).mission.summonTokens,1);assert.equal(db.data.get(classPath('Saturday')).status,'active');
  const profile=db.data.get(profilePath('alex'));profile.activeEncounter={classId:'Saturday',encounterId:'different'};db.seed(profilePath('alex'),profile);
  await assert.rejects(battle(call,'Saturday',action),/active encounter/);assert.equal((await mission('get')).mission.summonTokens,1);
});

test('multiple point awards for the same called question count only once toward seven correct answers',async()=>{
  const {mission,call}=missionSetup(.3,.1);await mission('turn',{expectedRevision:0});const spinId=aid();
  let result=await call(teacher,wheelRequest(null,{spinId,delta:1}));
  result=await call(teacher,wheelRequest(result.state,{spinId,delta:2}));
  assert.equal(result.mission.current.progress,1);assert.equal(result.state.combatLog.length,2);assert.equal(result.award.marks,3);
});

test('a student locked in another lesson continues their quest here; the old party releases them atomically',async()=>{
  const {call,db}=setup();await claim(call);let s=await begin(call);
  s=(await battle(call,'Saturday',{id:aid(),type:'select',heroId:'student:alex',encounterId:s.encounterId,expectedRevision:s.revision})).state;
  db.seed('students/alex',{name:'Alex',slots:['Saturday','Sunday']});
  const moved=await begin(call,'Sunday',[heroes[0]]);assert.equal(moved.heroes[0].studentId,'alex');
  assert.equal(db.data.get(profilePath('alex')).activeEncounter.classId,'Sunday');
  const old=db.data.get(classPath('Saturday'));assert.ok(!old.heroes.some(h=>h.studentId==='alex'));assert.equal(old.pending,null);assert.ok(old.heroArchive['student:alex']);
  const result=await call(teacher,wheelRequest(moved,{classId:'Sunday',heroes:[heroes[0]]}));assert.equal(result.state.lastEvent.type,'auto');
});
