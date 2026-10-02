import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),API=require('../hero-api.js');
test('transport includes both verified tokens and sends only after lifecycle authorization',async()=>{
  let calls=0,canSend=true;
  const user={uid:'pupil',async getIdToken(){return 'id-token';}};
  const api=API.create({getUser:()=>user,appCheckToken:async()=> 'app-token',fetch:async(url,options)=>{calls++;assert.match(url,/ansKeyHeroes$/);assert.equal(options.headers.Authorization,'Bearer id-token');assert.equal(options.headers['X-Firebase-AppCheck'],'app-token');return {ok:true,json:async()=>({status:'approved'})};}});
  assert.equal((await api.request({type:'me'},{canSend:()=>canSend})).status,'approved');
  canSend=false;await assert.rejects(api.request({type:'me'},{canSend:()=>canSend}),/lesson/);assert.equal(calls,1);
});
test('closing wheel during asynchronous token preparation cancels before dispatch',async()=>{
  let canSend=true,calls=0;
  const user={uid:'pupil',async getIdToken(){canSend=false;return 'token';}};
  const api=API.create({getUser:()=>user,appCheckToken:async()=> 'app-token',fetch:async()=>{calls++;}});
  await assert.rejects(api.request({type:'battle'},{canSend:()=>canSend}),/lesson/);assert.equal(calls,0);
});
test('changing account during token preparation cancels before dispatch',async()=>{
  let current,calls=0;const user={uid:'pupil',async getIdToken(){current={uid:'other'};return 'token';}};current=user;
  const api=API.create({getUser:()=>current,appCheckToken:async()=> 'app-token',fetch:async()=>{calls++;}});
  await assert.rejects(api.request({type:'me'}),/account changed/);assert.equal(calls,0);
});
test('server refuses propagate useful code and no successful result',async()=>{
  const user={uid:'pupil',async getIdToken(){return 'token';}};
  const api=API.create({getUser:()=>user,appCheckToken:async()=> 'app-token',fetch:async()=>({ok:false,status:409,json:async()=>({error:{code:'encounter_active',message:'Finish the encounter first.'}})})});
  await assert.rejects(api.request({type:'configure'}),e=>e.code==='encounter_active' && e.status===409);
});
