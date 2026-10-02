'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHeroRepository,migrateHero,key}=require('../hero-repository');
const C=require('../hero-game/battle-core');
const teacher={uid:'teacher',teacherId:'teacher',email:'chungzhikai@gmail.com',isTeacher:true};
const pupil=uid=>({uid,email:uid+'@example.com',teacherId:'teacher',isTeacher:false});
function database() {
  const data=new Map(),versions=new Map();let version=0;
  const snapshot=path=>({id:path.split('/').at(-1),exists:data.has(path),data:()=>structuredClone(data.get(path))});
  function ref(path,isCollection=false) { return {path,isCollection,collection:n=>ref(path+'/'+n,true),doc:id=>ref(path+'/'+id),get:async()=>get({path,isCollection})}; }
  function get(r) { if (!r.isCollection) return snapshot(r.path); const prefix=r.path+'/';return {docs:[...data.keys()].filter(p=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(snapshot)}; }
  return {data,collection:n=>ref(n,true),seed(path,value){data.set(path,structuredClone(value));versions.set(path,++version);},
    async runTransaction(callback) {
      for(let retry=0;retry<40;retry++){
        const reads=new Map(),writes=new Map();let queryVersion=null,wrote=false;
        const out=await callback({get:async r=>{assert.equal(wrote,false,'Firestore reads must precede all writes');if(r.isCollection)queryVersion=version;else reads.set(r.path,versions.get(r.path)||0);await Promise.resolve();return get(r);},
          set:(r,v)=>{wrote=true;writes.set(r.path,structuredClone(v));},delete:r=>{wrote=true;writes.set(r.path,undefined);}});
        if((queryVersion!==null&&queryVersion!==version)||[...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;
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

test('automatic wheel turns execute server-side and repeated spin IDs do not repeat XP',async()=>{
  const {call,db}=setup();const spin=aid(),action={id:spin,spinId:spin,type:'auto',heroes,bossId:'goblin',heroId:'student:alex'};
  const result=await battle(call,'Saturday',action);assert.equal(result.state.lastEvent.type,'auto');assert.equal(result.state.heroes[0].xp,12);
  const repeated=await battle(call,'Saturday',action);assert.equal(repeated.state.heroes[0].xp,12);assert.equal(db.data.get(profilePath('alex')).hero.xp,12);
});

test('adding a progressed hero to an active party preserves canonical XP, skills and equipment in sync and auto',async()=>{
  for (const type of ['sync','auto']) {
    const {call,db}=setup();const s=await begin(call,'Saturday',[heroes[0]]);
    const hero={...heroes[1],xp:300,level:3,skillPoints:6,equipped:'bag:crimson-edge',learnedSkills:['warrior-slash','warrior-cleave'],inventory:[...heroes[1].inventory,{id:'bag:crimson-edge',itemId:'crimson-edge',quantity:1}]};
    db.seed(profilePath('sam'),{schemaVersion:1,studentId:'sam',hero,claim:null,activeEncounter:null});
    const id=aid();const result=await battle(call,'Saturday',{type,id,...(type==='auto'?{spinId:id}:{}),encounterId:s.encounterId,expectedRevision:s.revision,heroes,heroId:'student:sam',bossId:'goblin'});
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
