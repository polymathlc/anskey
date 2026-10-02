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
function wheelRequest(state=null,{id=aid(),spinId=aid(),studentId='alex',delta=1,classId='Saturday',...extra}={}) {
  return {type:'wheelAward',classId,studentId,delta,reason:'Correct answer on the wheel',action:{type:'auto',id,spinId,heroId:'student:'+studentId,heroes,bossId:'goblin',...(state ? {encounterId:state.encounterId,expectedRevision:state.revision} : {}),...extra}};
}
async function begin(call,slot='Saturday',party=heroes) {return (await battle(call,slot,{id:aid(),type:'start',bossId:'goblin',heroes:party})).state;}
async function claim(call,uid='one',studentId='alex',lessonSlot='Saturday') {await call(pupil(uid),{type:'claim',studentId,lessonSlot});await call(teacher,{type:'approve',studentId});}

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
  await assert.rejects(begin(call,'Sunday',[heroes[0]]),/active encounter/);
  await battle(call,'Saturday',{id:aid(),type:'end',encounterId:s.encounterId,expectedRevision:s.revision});
  const configured=await call(pupil('one'),{type:'configure',command:'class',role:'ranger'});assert.equal(configured.hero.role,'ranger');
  assert.equal((await begin(call,'Sunday',[heroes[0]])).heroes[0].role,'ranger');
});

test('teacher can end an unclaimed moved-slot encounter from claim administration; students cannot',async()=>{
  const {call,db}=setup();await begin(call);db.seed('students/alex',{name:'Alex',slots:['Monday']});
  await assert.rejects(begin(call,'Monday',[heroes[0]]),/active encounter/);
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
  const {call,db}=setup();const first=wheelRequest(),one=await call(teacher,first),second=wheelRequest(one.state,{spinId:first.action.spinId,delta:2});
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
    const saved=result.state.heroes.find(h=>h.studentId==='sam');assert.ok(saved.xp>=300);assert.ok(saved.learnedSkills.includes('warrior-cleave'));assert.equal(saved.equipped,'bag:crimson-edge');assert.equal(db.data.get(profilePath('sam')).hero.xp,saved.xp);
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
  for(const name of ['battle-core.js','battle-content.js','battle-bosses.js'])assert.deepEqual(fs.readFileSync(path.resolve(__dirname,'../hero-game',name)),fs.readFileSync(path.resolve(__dirname,'../../',name)));
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
