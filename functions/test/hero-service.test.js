'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHeroService,HeroError}=require('../hero-service');
const {APP_ID,TEACHER_EMAIL}=require('../live-service');
const validUser={uid:'pupil',email:'pupil@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
function harness(overrides={}) {
  const calls=[];const deps={auth:{async verifyIdToken(token,revoked){calls.push(['auth',token,revoked]);return validUser;},async getUserByEmail(email){calls.push(['teacher',email]);return {uid:'teacher',emailVerified:true};}},
    appCheck:{async verifyToken(token){calls.push(['appCheck',token]);return {appId:APP_ID};}},repository:{async execute(actor,body){calls.push(['execute',actor,body]);return {status:'unclaimed'};}},report:code=>calls.push(['report',code])};
  for(const [k,v]of Object.entries(overrides))Object.assign(deps[k],v);
  const service=createHeroService(deps);
  async function request(body={type:'me'},opts={}) {
    const headers={origin:'https://polymathlc.github.io',authorization:'Bearer token','x-firebase-appcheck':'app-token','content-type':'application/json',...opts.headers};
    const req={body,method:opts.method||'POST',rawBody:opts.rawBody,get:n=>headers[n.toLowerCase()]};
    const res={headers:{},statusCode:200,set(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}};
    await service.handler(req,res);return res;
  }
  return {request,calls};
}
test('verified students use pinned teacher realm, never body-supplied identity',async()=>{
  const h=harness();const res=await h.request({type:'me',uid:'teacher',teacherId:'forged',isTeacher:true});assert.equal(res.statusCode,200);
  const actor=h.calls.find(x=>x[0]==='execute')[1];assert.deepEqual(actor,{uid:'pupil',teacherId:'teacher',email:'pupil@example.com',isTeacher:false});
  assert.deepEqual(h.calls[0],['auth','token',true]);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('only matched teacher UID and verified teacher email grant teacher privilege',async()=>{
  for(const uid of ['teacher','other']){
    const h=harness({auth:{async verifyIdToken(){return {...validUser,uid,email:TEACHER_EMAIL};}}});await h.request();assert.equal(h.calls.find(x=>x[0]==='execute')[1].isTeacher,uid==='teacher');
  }
});
test('wheel awards use the same authenticated, AppCheck protected repository route',async()=>{
  const h=harness({auth:{async verifyIdToken(){return {...validUser,uid:'teacher',email:TEACHER_EMAIL};}}});
  const body={type:'wheelAward',classId:'Saturday',studentId:'alex',delta:2,action:{id:'award-12345678',spinId:'spin-12345678',type:'auto'}};
  assert.equal((await h.request(body)).statusCode,200);const execute=h.calls.find(x=>x[0]==='execute');assert.equal(execute[1].isTeacher,true);assert.deepEqual(execute[2],body);assert.ok(h.calls.some(x=>x[0]==='appCheck'));
});

test('temporary lesson students use the authenticated and AppCheck protected hero route',async()=>{
  const h=harness({auth:{async verifyIdToken(){return {...validUser,uid:'teacher',email:TEACHER_EMAIL};}}});
  const body={type:'lessonGuests',classId:'Saturday',command:'add',studentId:'visitor',id:'guest-12345678'};
  assert.equal((await h.request(body)).statusCode,200);const execute=h.calls.find(x=>x[0]==='execute');
  assert.equal(execute[1].isTeacher,true);assert.deepEqual(execute[2],body);assert.ok(h.calls.some(x=>x[0]==='appCheck'));
});
test('origin, HTTP method, JSON type and body bound fail before auth',async()=>{
  const h=harness();for(const opts of [{headers:{origin:'https://evil.example'}},{method:'GET'},{headers:{'content-type':'text/plain'}},{rawBody:Buffer.alloc(240001)}])assert.ok((await h.request(undefined,opts)).statusCode>=400);
  assert.deepEqual(h.calls,[]);assert.equal((await h.request(undefined,{method:'OPTIONS'})).statusCode,204);
});
test('missing/revoked auth, unverified Google identity and wrong AppCheck do not access repository',async()=>{
  const missing=harness();assert.equal((await missing.request(undefined,{headers:{authorization:''}})).statusCode,401);
  for(const user of [null,{}, {...validUser,email_verified:false},{...validUser,firebase:{sign_in_provider:'password'}}]){
    const h=harness({auth:{async verifyIdToken(){return user;}}});assert.equal((await h.request()).statusCode,403);assert.ok(!h.calls.some(x=>x[0]==='execute'));
  }
  for(const override of [{auth:{async verifyIdToken(){throw Error('secret');}}},{appCheck:{async verifyToken(){return {appId:'other'};}}}]){
    const h=harness(override),res=await h.request();assert.ok(res.statusCode>=400);assert.ok(!h.calls.some(x=>x[0]==='execute'));assert.ok(!JSON.stringify(res).includes('secret'));
  }
});
test('validation failures are useful; unexpected failures never expose data',async()=>{
  const invalid=harness();assert.equal((await invalid.request({type:'inventXp'})).statusCode,400);
  const conflict=harness({repository:{async execute(){throw new HeroError(409,'name_unavailable','That name is already claimed.');}}});assert.equal((await conflict.request()).body.error.code,'name_unavailable');
  const failed=harness({repository:{async execute(){throw Error('private email and token');}}}),res=await failed.request();assert.equal(res.statusCode,503);assert.ok(!JSON.stringify(res).includes('private email'));assert.deepEqual(failed.calls.at(-1),['report','hero_request_failed']);
});
