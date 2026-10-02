/* Optional live transaction smoke check. Only synthetic, uniquely scoped data is
   written, then removed. Uses the existing Firebase CLI login without printing it.
   Client permissions are independently exercised by battle-rules.mjs. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = process.argv[2];
if (!root) throw new Error('Provide the installed firebase-tools directory.');
const cli = name => require(path.resolve(root, 'lib', name));
const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { getAccessToken } = cli('auth'), { logger } = cli('logger');
const serverRequire = require('node:module').createRequire(path.resolve(__dirname,'../functions/index.js'));
const { Firestore } = serverRequire('@google-cloud/firestore');
const { GoogleAuth, OAuth2Client } = serverRequire('google-auth-library');
const Core = require('../battle-core.js'), Store = require('../battle-store.js');
logger.silent = true;
new Command('battle:smoke').before(requireAuth).action(async opts => {
  const token = await getAccessToken(opts.tokens.refresh_token, opts.authScopes);
  const client = new OAuth2Client(); client.setCredentials({ access_token:token.access_token });
  const db = new Firestore({ projectId:'mathgen--app', auth:new GoogleAuth({authClient:client}) }), suffix = randomUUID();
  const config = { db, teacherId:'battle-validation-fixture', classId:'Synthetic QA ' + suffix, canWrite:() => true };
  const a = Store.create(config), b = Store.create(config);
  const party = Object.keys(Core.ROLES).map(role => Core.heroFromStudent({id:role,uid:role,name:'QA ' + role}, {battleHero:{version:1,uid:role,role,stats:{atk:30,def:10,maxHp:150,crit:5}}}));
  try {
    let state = await a.act({id:randomUUID(),type:'start',bossId:'geargrin',heroes:party});
    const eid = state.encounterId;
    state = await a.act({id:randomUUID(),type:'select',encounterId:eid,expectedRevision:state.revision,heroId:party[0].id});
    const answer = {id:randomUUID(),type:'answer',encounterId:eid,turnId:state.pending.id,outcome:'correct'};
    const duplicate = await Promise.all([a.act(answer), b.act(answer)]);
    assert.equal(duplicate[0].correctCount,1); assert.equal(duplicate[1].correctCount,1);
    state = (await Store.create(config).ref.get()).data();
    assert.equal(state.bossId,'geargrin'); assert.equal(state.correctCount,1); assert.equal(state.pending,null);
    state = await a.act({id:randomUUID(),type:'select',encounterId:eid,expectedRevision:state.revision,heroId:party[1].id});
    const competing = await Promise.allSettled(['correct','incorrect'].map(outcome => b.act({id:randomUUID(),type:'answer',encounterId:eid,turnId:state.pending.id,outcome})));
    assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
    state = (await a.ref.get()).data();
    const stale = {id:randomUUID(),type:'boss',encounterId:eid,expectedRevision:state.revision};
    state = await a.act(stale);
    await assert.rejects(b.act({...stale,id:randomUUID()}),/already changed/);
    state = await b.act({id:randomUUID(),type:'boss',encounterId:eid,expectedRevision:state.revision});
    state = await a.act({id:randomUUID(),type:'boss',encounterId:eid,expectedRevision:state.revision,ultimate:true});
    assert.equal(state.lastEvent.targets.length,4); assert.equal(state.charge,0);
    const other = Store.create({...config,classId:config.classId+' other'});
    assert.equal((await other.ref.get()).exists,false);
    console.log('PASS: live Firestore duplicate/retry concurrency, competing answers, stale boss turn, ultimate, new-client restoration, class isolation.');
  } finally {
    // Delete only the unique fixture created by this invocation.
    const receipts = await a.ref.collection('actions').get();
    const batch = db.batch(); receipts.forEach(d=>batch.delete(d.ref)); batch.delete(a.ref); await batch.commit();
    console.log('Synthetic encounter and receipts removed.');
    await db.terminate();
  }
}).runner()({project:'mathgen--app',projectId:'mathgen--app',projectNumber:'165654161198',nonInteractive:true,cwd:process.cwd()}).catch(error=>{console.error(error.message);process.exitCode=1;});
