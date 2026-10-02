// Mission UI with the real saved-state model, store transport and durable client outbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW||'/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(runtime.startsWith('file:')?runtime:pathToFileURL(runtime).href);
const browser=await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{});
const page=await browser.newPage({viewport:{width:960,height:900},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const output=path.resolve(process.env.BATTLE_SCREENSHOTS||'../battle-validation');fs.mkdirSync(output,{recursive:true});
const fixture=path.join(output,'mission-machine-fixture.html');
fs.writeFileSync(fixture,`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${pathToFileURL(path.resolve('.')+path.sep).href}"><link rel="stylesheet" href="mission-machine.css"><style>body{background:#0d1727;margin:18px;font-family:system-ui}#mission{max-width:620px;margin:auto}</style></head><body><div id="mission"></div><div id="loot"></div><script src="battle-bosses.js"></script><script src="battle-content.js"></script><script src="battle-core.js"></script><script src="battle-store.js"></script><script src="mission-content.js"></script><script src="battle-display.js"></script><script src="mission-machine.js"></script></body></html>`);
let checks=0;function check(name,condition){assert.ok(condition,name);checks++;console.log('✓ '+name);}
async function ready(){await page.waitForFunction(()=>!document.querySelector('.mmStatus').textContent.includes('Loading')&&!__panel.blocked());}
try {
  await page.goto(pathToFileURL(fixture).href);
  await page.evaluate(()=>{
    const Core=ClassroomBattleCore,M=ClassroomMissionContent;
    window.rwStudents=[{id:'one',name:'Ari',marks:10},{id:'two',name:'Bo',marks:10}];
    window.__missions={Science:M.empty(),Maths:M.empty()};window.__receipts={};window.__requests=[];window.__objective=.3;window.__prize=.1;window.__lose=false;window.__hold=false;window.__release=null;window.__rejection=null;window.__summons=[];window.__live=true;window.__slot='Science';window.__now=Date.now();window.__spin='mission-question-001';
    window.__state=Core.reduce(null,{type:'start',id:'mission-ui-encounter',heroes:rwStudents.map(s=>Core.heroFromStudent(s)),bossId:Core.BOSSES.find(b=>!b.legacy).id});
    const reference=()=>({collection:reference,doc:reference});
    window.__mount=function(slot='Science') {
      if(window.__panel)__panel.destroy();__live=true;__slot=slot;const boundSlot=slot;
      const store=ClassroomBattleStore.create({db:{collection:reference},teacherId:'mission-teacher',classId:slot,canWrite:()=>__live&&__slot===boundSlot,
        transport:async request=>{
          if(request.command==='get')return {mission:structuredClone(__missions[request.classId]),state:structuredClone(__state)};
          __requests.push(structuredClone(request));if(__hold)await new Promise(resolve=>{__release=resolve;});
          if(__rejection)throw Object.assign(Error('The saved mission changed.'),{code:__rejection});
          let result=__receipts[request.id||request.action?.id];
          if(!result) {
            let m=__missions[request.classId];
            if(request.type==='battle') {
              const a=request.action;
              if(a.source==='reward') {const token=m.bank.find(p=>p.kind==='summon'&&p.status==='available');if(!token)throw Object.assign(Error('No token'),{code:'summon_unavailable'});token.status='redeemed';m=M.clean(m);m.revision++;}
              __state=Core.reduce(__state,a);result={state:structuredClone(__state),mission:structuredClone(m)};
            } else {
              if(request.command==='turn')m=M.start(m,{id:request.id,now:__now,objectiveRoll:__objective,prizeRoll:__prize,encounterId:__state.encounterId});
              else if(request.command==='cancel'){m=structuredClone(m);m.current.status='cancelled';m.revision++;}
              else if(request.command==='incorrect')m=M.progress(m,{kind:'incorrect',now:__now});
              else if(request.command==='focus') {if(__now<m.current.focusReadyAt)throw Object.assign(Error('Not ready'),{code:'focus_not_ready'});m=M.progress(m,{kind:'focus',now:__now});}
              else if(request.command==='redeem'){m=structuredClone(m);m.bank.find(p=>p.id===request.prizeId).status='redeemed';m.revision++;}
              result={mission:structuredClone(m),state:structuredClone(__state)};
            }
            __missions[request.classId]=m;__receipts[request.id||request.action?.id]=structuredClone(result);
          }
          if(__lose){__lose=false;throw Error('Reply lost after save');}return structuredClone(result);
        }});
      window.__panel=ClassroomMissionMachine.mount(document.getElementById('mission'),{store,teacherId:'mission-teacher',classId:slot,canAct:()=>__live&&__slot===boundSlot,getState:()=>__state,getSpinId:()=>__spin,onChange:result=>{if(result.state)__state=result.state;},onSummon:event=>__summons.push(event.id)});
    };
    __mount();
  });
  await ready();
  check('mission machine loads an empty saved class state and enables Turn',await page.locator('[data-mm=turn]').isEnabled());
  await page.evaluate(()=>{__hold=true;});await page.click('[data-mm=turn]');await page.waitForFunction(()=>!!__release);
  check('turning animates the generated machine while waiting for a saved roll',await page.locator('.mmRolling').count()===1&&await page.locator('.mmReels').textContent().then(t=>t.includes('A new challenge awaits')));
  await page.evaluate(()=>document.querySelector('[data-mm=turn]').click());
  check('double clicks send one roll and block conflicting actions',await page.evaluate(()=>__requests.length===1&&__panel.blocked()));
  await page.evaluate(()=>{__hold=false;__release();});await ready();
  check('saved objective and class prize are shown together',await page.locator('.mmReels').textContent().then(t=>t.includes('7 correct answers')&&t.includes('Blooket')));
  check('active missions require cancel before another turn',await page.locator('[data-mm=turn]').isDisabled()&&await page.locator('[data-mm=cancel]').isEnabled());
  await page.evaluate(()=>{__missions.Science=ClassroomMissionContent.progress(__missions.Science,{kind:'correct',now:__now});__panel.refresh();});
  await page.waitForFunction(()=>document.querySelector('.mmReels').textContent.includes('1 / 7'));
  await page.click('[data-mm=incorrect]');await ready();
  check('incorrect answer sends the saved question identity and resets the shown streak',await page.evaluate(()=>__requests.at(-1).spinId===__spin&&__missions.Science.current.progress===0));
  await page.click('[data-mm=cancel]');await ready();
  await page.evaluate(()=>{__lose=true;__prize=.99;});await page.click('[data-mm=turn]');
  await page.waitForFunction(()=>!!document.querySelector('[data-mm=retry]'));
  const savedId=await page.evaluate(()=>__requests.at(-1).id);
  check('lost reply retains an immutable request and blocks rerolling',await page.evaluate(()=>__panel.blocked()&&!!sessionStorage.getItem('polymath.classMission.mission-teacher.Science'))&&await page.locator('[data-mm=turn]').isDisabled());
  await page.evaluate(()=>__mount());await page.waitForFunction(()=>!!document.querySelector('[data-mm=retry]:not([disabled])'));
  check('reopening restores the pending roll without sending it again',await page.evaluate(id=>__requests.filter(r=>r.id===id).length===1,savedId));
  await page.click('[data-mm=retry]');await ready();
  check('retry reuses the original roll identity and prize',await page.evaluate(id=>__requests.at(-1).id===id&&__missions.Science.current.prize.id==='class-points'&&!__panel.blocked(),savedId));
  check('rare whole-class point prizes are labelled rare',await page.locator('.mmRare').textContent().then(t=>t.includes('RARE')&&t.includes('+5 bonus points')));
  await page.click('[data-mm=cancel]');await ready();
  await page.evaluate(()=>{__objective=.55;__prize=.1;});await page.click('[data-mm=turn]');await ready();
  check('focus timer starts from the saved server deadline and cannot complete early',await page.locator('[data-mm=focus]').isDisabled()&&await page.locator('.mmReels').textContent().then(t=>t.includes('30 minutes remaining')));
  await page.evaluate(()=>{__missions.Science.current.focusReadyAt=Date.now()-1000;__now=Date.now();__panel.refresh();});
  await page.waitForFunction(()=>!document.querySelector('[data-mm=focus]').disabled);await page.click('[data-mm=focus]');await ready();
  check('teacher confirmation banks the class game-time prize',await page.locator('.mmBank').textContent().then(t=>t.includes('Blooket'))&&await page.evaluate(()=>__missions.Science.current.status==='complete'));
  await page.click('[data-mm=redeem]');await ready();
  check('marking a game prize used sends the exact bank ID and removes it from available prizes',await page.evaluate(()=>__requests.at(-1).prizeId===__missions.Science.bank[0].id&&__missions.Science.bank[0].status==='redeemed')&&await page.locator('[data-mm=redeem]').count()===0);
  await page.evaluate(()=>{__objective=.8;__prize=0;});await page.click('[data-mm=turn]');await ready();
  await page.evaluate(()=>{for(let i=0;i<3;i++)__missions.Science=ClassroomMissionContent.progress(__missions.Science,{kind:'assist',now:__now});__panel.refresh();});
  await page.waitForFunction(()=>!document.querySelector('[data-source=reward]').disabled);
  check('three saved assists complete the mission and enable its earned summon',await page.locator('.mmReels').textContent().then(t=>t.includes('3 / 3')&&t.includes('complete')));
  const hp=await page.evaluate(()=>__state.bossHp);await page.click('[data-source=reward]');await ready();
  check('earned summon saves a one-hit victory and consumes one token',await page.evaluate(hp=>__state.status==='victory'&&__state.lastEvent.damage===hp&&__missions.Science.summonTokens===0&&__summons.length===1,hp));
  check('victory log contains actual one-punch damage and saved rewards',await page.evaluate(()=>__state.combatLog.at(-1).actorName==='One-Punch Chung'&&__state.rewards.length===2));
  await page.evaluate(()=>{__state=ClassroomBattleCore.reduce(__state,{type:'start',id:'mission-ui-second-enemy',expectedRevision:__state.revision,heroes:__state.heroes,bossId:__state.bossId});__panel.render();});
  await page.click('[data-source=teacher]');await ready();
  check('teacher help works without an earned token and still saves personal loot',await page.evaluate(()=>__state.status==='victory'&&__state.rewards.length===2&&__requests.at(-1).action.source==='teacher'));
  await page.evaluate(()=>{__rejection='mission_changed';});await page.click('[data-mm=turn]');await ready();
  check('explicit uncommitted mission rejection clears the outbox for recovery',await page.evaluate(()=>!__panel.blocked()&&!sessionStorage.getItem('polymath.classMission.mission-teacher.Science')));
  await page.evaluate(()=>{__rejection=null;__mount('Maths');});await ready();
  check('another Lesson slot has an independent mission and prize bank',await page.locator('.mmReels').textContent().then(t=>t.includes('A new challenge awaits'))&&await page.locator('.mmBank').count()===0);
  await page.evaluate(()=>{__hold=true;});await page.click('[data-mm=turn]');await page.waitForFunction(()=>!!__release);
  await page.evaluate(()=>{__panel.destroy();__live=false;__hold=false;__release();});await page.waitForTimeout(100);
  check('closing during a save prevents late UI updates and retains a safe retry receipt',await page.evaluate(()=>!document.getElementById('mission').children.length&&!!sessionStorage.getItem('polymath.classMission.mission-teacher.Maths')));
  await page.evaluate(()=>__mount('Maths'));await page.waitForFunction(()=>!!document.querySelector('[data-mm=retry]:not([disabled])'));await page.click('[data-mm=retry]');await ready();
  check('reopening can safely confirm a save committed before closing',await page.evaluate(()=>!__panel.blocked()&&__missions.Maths.current.status==='active'));
  await page.evaluate(()=>{const m=__missions.Maths;m.revision++;m.lastPayout={id:'class-points-new',awards:[{studentId:'one',marks:15,delta:5},{studentId:'two',marks:15,delta:5}]};__panel.receive({mission:structuredClone(m)});});
  check('class bonus mutation updates all returned roster balances',await page.evaluate(()=>rwStudents.every(s=>s.marks===15)));
  await page.evaluate(async()=>{rwStudents[0].marks=20;await __panel.refresh();});
  check('background mission refresh never overwrites newer awarded marks with an old payout',await page.evaluate(()=>rwStudents[0].marks===20));
  await page.setViewportSize({width:375,height:800});await page.screenshot({path:path.join(output,'mission-machine-mobile.png'),fullPage:true});
  check('mission controls fit a phone without horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:960,height:900});await page.screenshot({path:path.join(output,'mission-machine-desktop.png'),fullPage:true});
  check('mission UI raises no application errors',errors.length===0);
  console.log('\n'+checks+' mission machine browser checks passed.');
} finally {await browser.close();fs.unlinkSync(fixture);}
