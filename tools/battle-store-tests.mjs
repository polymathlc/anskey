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
