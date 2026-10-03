import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),Store=require('../battle-store.js');
function setup(transport,canWrite=()=>true,options={}) {
  const ref={collection(){return this;},doc(){return this;}};
  const db={collection(){return ref;},runTransaction(){throw new Error('Unexpected direct Firestore write.');}};
  return Store.create({db,teacherId:'teacher-one',classId:'Saturday 11am',canWrite,transport,...options});
}
const request=()=>({studentId:'alex',studentName:'Alex',delta:5,reason:'Correct answer',action:{type:'auto',id:'award-00000001',spinId:'spin-000000001',heroId:'student:alex',heroes:[{id:'student:alex'}]}});
const response=()=>({award:{id:'award-00000001',studentId:'alex',delta:5,marks:15},state:{revision:1}});

test('wheel awards use the canonical API and bind a copied payload to the store lesson',async()=>{
  const pending=request();let sent,gate;
  const store=setup(async(body,lifecycle)=>{sent=body;gate=lifecycle.canSend;await Promise.resolve();return response();});
  const result=store.award({...pending,type:'battle',classId:'Unrelated lesson'});
  pending.action.heroes[0].id='student:changed';pending.action.id='award-mutated';
  assert.deepEqual(await result,response());
  assert.equal(sent.type,'wheelAward');assert.equal(sent.classId,'Saturday 11am');
  assert.equal(sent.action.id,'award-00000001');assert.equal(sent.action.heroes[0].id,'student:alex');
  assert.equal(typeof gate,'function');assert.equal(gate(),true);
});
test('wheel awards reject unauthorized or malformed requests before network dispatch',async()=>{
  let calls=0;const transport=async()=>{calls++;return response();};
  await assert.rejects(setup(transport,()=>false).award(request()),/Only the signed-in teacher/);
  await assert.rejects(setup(transport).award({...request(),action:{id:'bad'}}),/Invalid points award ID/);
  await assert.rejects(setup(transport).award({...request(),action:{id:'path\/invalid'}}),/Invalid points award ID/);
  assert.equal(calls,0);
});
test('account or wheel closure during save withholds the response from the stale caller',async()=>{
  let active=true,finish,sendGate;
  const store=setup((body,lifecycle)=>{sendGate=lifecycle.canSend;return new Promise(resolve=>{finish=resolve;});},()=>active);
  const pending=store.award(request());active=false;
  assert.equal(sendGate(),false);finish(response());
  await assert.rejects(pending,/Only the signed-in teacher/);
});
test('wheel awards require both the points receipt and saved encounter before acknowledgement',async()=>{
  for (const result of [null,{}, {state:{revision:1}}, {award:response().award}]) {
    await assert.rejects(setup(async()=>result).award(request()),/could not be confirmed.*Retry the same award/);
  }
});
test('ordinary wheel awards require a confirmed mission and receipt without requiring an encounter',async()=>{
  const payload={...request(),mode:'ordinary',missionId:'mission-question',missionRevision:3,action:{type:'award',id:'award-ordinary-001',spinId:'spin-ordinary-001'}};
  const saved={award:{id:payload.action.id,studentId:'alex',delta:5,marks:15},state:null,mission:{revision:4},answer:{spinId:payload.action.spinId,missionId:payload.missionId,revision:4},balances:[{studentId:'alex',marks:15}]};
  let sent;const store=setup(async body=>{sent=body;return saved;});
  assert.deepEqual(await store.award(payload),saved);
  assert.equal(sent.mode,'ordinary');assert.equal(sent.type,'wheelAward');assert.equal(sent.classId,'Saturday 11am');
  assert.deepEqual(sent.action,payload.action);assert.equal(sent.missionRevision,3);assert.equal(sent.missionId,payload.missionId);
  for (const result of [null,{}, {award:saved.award,state:null},{mission:saved.mission,state:null}]) {
    await assert.rejects(setup(async()=>result).award(payload),/could not be confirmed.*Retry the same award/);
  }
});
test('ordinary wheel retries preserve mission binding and cannot publish after account or lesson changes',async()=>{
  const payload={...request(),mode:'ordinary',missionId:'mission-original',missionRevision:2,action:{id:'award-ordinary-002',spinId:'spin-ordinary-002',type:'award'}};
  const saved={award:response().award,state:null,mission:{revision:3}};
  const sent=[];let active=true,fail=true;
  const store=setup(async body=>{sent.push(structuredClone(body));if(fail)throw Error('Reply lost');active=false;return saved;},()=>active);
  await assert.rejects(store.award(payload),/Reply lost/);fail=false;
  await assert.rejects(store.award(payload),/Only the signed-in teacher/);
  assert.deepEqual(sent[0],sent[1]);assert.equal(sent[1].missionRevision,2);assert.equal(sent[1].action.type,'award');
});
function browserBalances(t,students=[{id:'alex',marks:10},{id:'sam',marks:20}]) {
  const previous=globalThis.window;globalThis.window={rwStudents:students};
  t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
  return students;
}
function balanceDb(read) {
  function ref(path) {return {collection:name=>ref(path+'/'+name),doc:id=>ref(path+'/'+id),get:options=>read(path,options)};}
  return {collection:name=>ref(name),runTransaction(){throw Error('Unexpected direct write');}};
}
function ordinaryRequest(){return {...request(),mode:'ordinary',missionId:'mission-original',missionRevision:1,action:{id:'ordinary-balance-award',type:'award',spinId:'balance-spin-001'}};}
function balanceResponse(){return {award:{id:'ordinary-balance-award',studentId:'alex',delta:2,marks:12},mission:{revision:2},answer:{spinId:'balance-spin-001',missionId:'mission-original',revision:2},balances:[{studentId:'alex',marks:12},{studentId:'sam',marks:20}]};}
test('unchanged local marks keep saved awards on the fast path without extra reads',async t=>{
  browserBalances(t);let reads=0,seen;
  const saved=balanceResponse(),store=setup(async()=>saved,()=>true,{db:balanceDb(()=>{reads++;throw Error('Unexpected read');}),onMission:result=>{seen=result;}});
  assert.equal(await store.award(ordinaryRequest()),saved);assert.equal(seen,saved);assert.equal(reads,0);
});
test('a delayed wheel reply reconciles positive corrections and other-student balances before notification',async t=>{
  const students=browserBalances(t);let finish,seen,calls=0;const reads=[];
  const saved=balanceResponse(),store=setup(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},()=>true,{db:balanceDb(async(path,options)=>{reads.push([path,options]);return {exists:true,data:()=>({marks:path.endsWith('/alex')?17:24})};}),onMission:result=>{seen=result;}});
  const promise=store.award(ordinaryRequest());students[0].marks=17;students[0]._just=5;students[1].marks=24;students[1]._just=4;finish(saved);
  const result=await promise;
  assert.equal(result.award.marks,17);assert.deepEqual(result.balances,[{studentId:'alex',marks:17},{studentId:'sam',marks:24}]);assert.equal(seen,result);
  assert.deepEqual(reads,[['students/alex',{source:'server'}],['students/sam',{source:'server'}]]);assert.equal(calls,1);assert.equal(saved.award.marks,12);
});
test('an exact negative correction is detected even when marks equal the pre-request balance',async t=>{
  const students=browserBalances(t);let finish,reads=0;
  const store=setup(()=>new Promise(resolve=>{finish=resolve;}),()=>true,{db:balanceDb(async()=>{reads++;return {exists:true,data:()=>({marks:10})};})});
  const promise=store.award(ordinaryRequest());students[0].marks=10;students[0]._just=-2;finish(balanceResponse());
  assert.equal((await promise).award.marks,10);assert.equal(reads,1);
});
test('reconciliation preserves a newer local update arriving during any student read',async t=>{
  const students=browserBalances(t,[{id:'alex',marks:10},{id:'sam',marks:20},{id:'cy',marks:30}]);let finish,releaseSam,readSam;
  const pendingSam=new Promise(resolve=>{readSam=resolve;});
  const store=setup(()=>new Promise(resolve=>{finish=resolve;}),()=>true,{db:balanceDb(async path=>{
    if(path.endsWith('/sam')){readSam();await new Promise(resolve=>{releaseSam=resolve;});}
    return {exists:true,data:()=>({marks:path.endsWith('/alex')?17:24})};
  })});
  const promise=store.award(ordinaryRequest());students[0].marks=17;students[0]._just=5;students[1].marks=24;students[1]._just=4;
  finish({...balanceResponse(),balances:[...balanceResponse().balances,{studentId:'cy',marks:30}]});
  await pendingSam;await Promise.resolve();students[0].marks=15;students[0]._just=3;students[1].marks=23;students[1]._just=3;students[2].marks=32;students[2]._just=2;releaseSam();
  const result=await promise;assert.equal(result.award.marks,15);assert.deepEqual(result.balances,[{studentId:'alex',marks:15},{studentId:'sam',marks:23},{studentId:'cy',marks:32}]);
});
test('failed balance reads preserve local corrections without failing an already committed award',async t=>{
  const students=browserBalances(t);let finish,calls=0;
  const store=setup(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},()=>true,{db:balanceDb(async()=>{throw Error('Network unavailable');})});
  const promise=store.award(ordinaryRequest());students[0].marks=9;students[0]._just=-3;students[1].marks=24;students[1]._just=4;finish(balanceResponse());
  const result=await promise;assert.equal(result.award.marks,9);assert.deepEqual(result.balances,[{studentId:'alex',marks:9},{studentId:'sam',marks:24}]);assert.equal(calls,1);
});
test('account or lesson changes during reconciliation withhold committed replies and callbacks',async t=>{
  const students=browserBalances(t);let active=true,finish,releaseRead,readStarted,notified=0;
  const reading=new Promise(resolve=>{readStarted=resolve;});
  const store=setup(()=>new Promise(resolve=>{finish=resolve;}),()=>active,{db:balanceDb(async()=>{readStarted();await new Promise(resolve=>{releaseRead=resolve;});return {exists:true,data:()=>({marks:17})};}),onMission:()=>{notified++;}});
  const promise=store.award(ordinaryRequest());students[0].marks=17;students[0]._just=5;finish(balanceResponse());await reading;
  active=false;releaseRead();await assert.rejects(promise,/Only the signed-in teacher/);assert.equal(notified,0);
});
test('mission, assist and battle payout replies reconcile local changes without changing saved combat',async t=>{
  const students=browserBalances(t);
  for(const kind of ['mission','assist','act']) {
    students[0].marks=10;students[0]._just=0;let finish,seen,reads=0;
    const state={revision:5,lastEvent:{id:'unchanged-combat'}},mission={revision:7,lastPayout:{id:'bonus-payout',awards:[{studentId:'alex',marks:15,delta:5}]}};
    const store=setup(()=>new Promise(resolve=>{finish=resolve;}),()=>true,{db:balanceDb(async()=>{reads++;return {exists:true,data:()=>({marks:18})};}),onMission:result=>{seen=result;}});
    const promise=kind==='mission'?store.mission({command:'focus',id:'mission-bonus-001'}):kind==='assist'?store.assist({action:{id:'assist-bonus-001'}}):store.act({id:'battle-bonus-001',type:'answer'});
    students[0].marks=18;students[0]._just=3;finish({mission,state,hero:{id:'alex'},assist:{id:'assist-bonus-001'}});
    const result=await promise;
    assert.equal(reads,1);assert.equal(kind==='act'?result:result.state,state);assert.deepEqual((kind==='act'?seen:result).balances,[{studentId:'alex',marks:18,delta:5}]);assert.equal(mission.lastPayout.awards[0].marks,15);
  }
});
test('read-only mission refresh does not reconcile historical payouts that are never applied',async t=>{
  const students=browserBalances(t);let finish,reads=0;
  const store=setup(()=>new Promise(resolve=>{finish=resolve;}),()=>true,{db:balanceDb(async()=>{reads++;throw Error('Unexpected read');})});
  const promise=store.mission({command:'get'});students[0].marks=20;students[0]._just=10;
  const result={mission:{revision:3,lastPayout:{awards:[{studentId:'alex',marks:15}]}}};finish(result);
  assert.equal(await promise,result);assert.equal(reads,0);
});
test('a timeout preserves the caller request and its ID for explicit retry',async()=>{
  const original=request(),copy=structuredClone(original),sent=[];let calls=0;
  const timeout=new Error('Connection ended before confirmation.');timeout.code='network_error';
  const store=setup(async body=>{sent.push(structuredClone(body));if (++calls===1) throw timeout;return {...response(),duplicate:true};});
  await assert.rejects(store.award(original),error=>error===timeout);
  assert.deepEqual(original,copy);
  assert.equal((await store.award(original)).duplicate,true);
  assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);
});
test('wheel awards never fall back to direct Firestore writes when the API is unavailable',async()=>{
  await assert.rejects(setup().award(request()),/Hero saving is loading/);
});


test('assist uses teacher API with lesson binding and preserves receipt through retry',async()=>{
  let fail=true;const sent=[];
  const payload={studentId:'sam',helpedStudentId:'alex',action:{id:'assist-0000001',spinId:'spin-0000001'}};
  const store=setup(async body=>{sent.push(body);if(fail)throw Error('network');return {hero:{id:'student:sam',xp:6},state:null,assist:{id:body.action.id,xp:6}};});
  await assert.rejects(store.assist(payload),/network/);fail=false;
  assert.equal((await store.assist(payload)).hero.xp,6);assert.deepEqual(sent[0],sent[1]);
  assert.equal(sent[0].type,'assist');assert.equal(sent[0].classId,'Saturday 11am');
});
test('missions bind teacher and lesson, copy retry identity and require a confirmed mission',async()=>{
  let sent,active=true,finish;
  const store=setup((body)=>{sent=body;return new Promise(resolve=>{finish=resolve;});},()=>active);
  const request={command:'turn',id:'mission-unique-001',expectedRevision:2,classId:'wrong',type:'battle'};
  const promise=store.mission(request);request.id='changed';
  assert.equal(sent.id,'mission-unique-001');assert.equal(sent.classId,'Saturday 11am');assert.equal(sent.type,'mission');
  active=false;finish({mission:{revision:3}});await assert.rejects(promise,/Only the signed-in teacher/);
  await assert.rejects(setup(async()=>({state:{}})).mission({command:'get'}),/could not be confirmed/);
  await assert.rejects(setup().mission({command:'get'}),/Hero saving is loading/);
});

test('temporary students bind a copied request to the teacher lesson and preserve its retry identity',async()=>{
  const request={type:'battle',classId:'Wrong lesson',command:'add',studentId:'alex',id:'guest-00000001'};
  const sent=[];let fail=true,gate;
  const result={guests:[{studentId:'alex',name:'Alex',lessonSlots:['Sunday 2pm']}],state:{revision:2}};
  const store=setup(async(body,lifecycle)=>{sent.push(structuredClone(body));gate=lifecycle.canSend;if(fail)throw Error('Lost reply');return result;});
  await assert.rejects(store.guests(request),/Lost reply/);fail=false;
  assert.deepEqual(await store.guests(request),result);
  assert.deepEqual(sent[0],sent[1]);assert.equal(sent[0].type,'lessonGuests');assert.equal(sent[0].classId,'Saturday 11am');
  assert.equal(request.type,'battle');assert.equal(request.classId,'Wrong lesson');assert.equal(gate(),true);
});

test('temporary student validation and authorization prevent invalid network writes',async()=>{
  let calls=0;const transport=async()=>{calls++;return {guests:[],state:null};};
  await assert.rejects(setup(transport,()=>false).guests({command:'get'}),/Only the signed-in teacher/);
  for(const request of [{command:'replace'}, {command:'add',id:'bad',studentId:'alex'}, {command:'remove',id:'guest-00000001'}, {command:'add',id:'guest-00000001',studentId:'path/invalid'}]) {
    await assert.rejects(setup(transport).guests(request),/Invalid temporary|valid temporary/);
  }
  assert.equal(calls,0);
  assert.deepEqual(await setup(transport).guests({command:'get'}),{guests:[],state:null});
});

test('temporary student reads and mutations require a confirmed roster, never direct writes',async()=>{
  const guest={studentId:'alex',name:'Alex',lessonSlots:['Sunday 2pm']};
  for(const result of [null,{}, {guests:null},{guests:[{}]},{guests:[{studentId:'alex'}]},{guests:[{...guest,lessonSlots:[null]}]},{guests:[guest,guest]}]) {
    await assert.rejects(setup(async()=>result).guests({command:'get'}),/could not be confirmed.*Retry the same request/);
  }
  await assert.rejects(setup().guests({command:'get'}),/Hero saving is loading/);
});

test('temporary student responses are withheld after account or lesson changes',async()=>{
  let active=true,finish,sent;
  const store=setup(body=>{sent=body;return new Promise(resolve=>{finish=resolve;});},()=>active);
  const request={command:'remove',studentId:'alex',id:'guest-00000002'};
  const promise=store.guests(request);request.studentId='changed';
  assert.equal(sent.studentId,'alex');active=false;finish({guests:[],state:null});
  await assert.rejects(promise,/Only the signed-in teacher/);
});
