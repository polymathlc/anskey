import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),Store=require('../battle-store.js');
function setup(transport,canWrite=()=>true) {
  const ref={collection(){return this;},doc(){return this;}};
  const db={collection(){return ref;},runTransaction(){throw new Error('Unexpected direct Firestore write.');}};
  return Store.create({db,teacherId:'teacher-one',classId:'Saturday 11am',canWrite,transport});
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
