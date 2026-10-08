// Generated art + real QuickBattle controller. The store fixture delivers a
// snapshot before each command reply, reproducing Firestore's normal race.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(runtime.startsWith('file:')?runtime:pathToFileURL(runtime).href);
const browser=await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{});
const context=await browser.newContext({viewport:{width:760,height:800},reducedMotion:'no-preference'});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const repo=path.resolve('.'), output=path.resolve(process.env.BATTLE_SCREENSHOTS || '../battle-validation');
fs.mkdirSync(output,{recursive:true});
const fixture=path.join(output,'animation-fixture.html');
fs.writeFileSync(fixture,`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${pathToFileURL(repo+path.sep).href}"><link rel="stylesheet" href="classroom-battle.css"><link rel="stylesheet" href="battle-animation.css"><link rel="stylesheet" href="mission-machine.css"><style>body{background:#102037;color:white;margin:24px;font-family:system-ui}#wheelModal{display:block;position:static;width:auto}#wheelQuickFight{max-width:620px}#samples{display:flex;gap:24px;height:140px;align-items:center}#samples .cbaHero{width:100px;height:100px}</style></head><body><div id="samples"></div><div id="wheelModal" class="open"><select id="wheelClassSelect"><option>Science</option></select><div class="whSpinRow"><button id="wheelSpinBtn">Spin</button></div><div id="wheelHeroPreview"></div></div><script src="battle-bosses.js"></script><script src="battle-content.js"></script><script src="battle-core.js"></script><script>window.ClassroomBattleStore={};</script><script src="battle-animation.js"></script><script src="battle-display.js"></script><script src="quick-battle.js"></script></body></html>`);
let checks=0, spin=0;
function check(name,condition){assert.ok(condition,name);checks++;console.log('✓ '+name);}
async function reset(role='warrior',options={}){
  await page.evaluate(({role,options})=>{
    QuickBattle.close(); sessionStorage.clear(); window.__fail=false;window.__delay=25;window.__awardError='';window.__nextBeforeReply=false;
    // Timeline/race checks need an enemy that survives even a critical starter
    // skill. Victory scenarios explicitly lower its HP to one below.
    window.__state=ClassroomBattleCore.reduce(null,{type:'start',id:'animation-start-'+Math.random().toString(36).slice(2),heroes:rwStudents.map((student,index)=>ClassroomBattleCore.configureHero(ClassroomBattleCore.heroFromStudent(student,null,index),{command:'class',role:index===0?role:'warrior'})),bossId:'lich'});
    // Boss choice is now authoritative and may select a weak enemy; timeline
    // fixtures set enough HP explicitly rather than relying on a requested ID.
    __state.bossHp=__state.bossMaxHp=100000;
    if(options.gender)__state.heroes[0].gender=options.gender;
    if(options.wounded)__state.heroes.forEach(h=>h.hp=15);
    if(options.knockout)__state.heroes[0].hp=1;
    if(options.victory)__state.bossHp=1;
    if(options.skill){__state.heroes[0].learnedSkills.push(options.skill);__state.heroes[0].cooldowns['mage-firebolt']=99;}
    document.getElementById('wheelModal').classList.add('open');QuickBattle.open('Science');
  },{role,options});
  await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
}
async function land(points=1){const id='animation-spin-'+(++spin);await page.evaluate(({id,points})=>{wheelState.lastSpinId=id;window.wheelWinnerIdx=0;QuickBattle.landed({id:'one',n:'Ari'},id);window.__awardSettled=false;window.__spinPromise=QuickBattle.award({id:'one',n:'Ari'},points,'Name wheel').then(()=>{__awardSettled=true;}).catch(error=>{window.__awardError=error.message;});},{id,points});return id;}
async function phase(value){await page.waitForFunction(value=>document.getElementById('wheelQuickDuel').dataset.cbaPhase===value,value);}
async function settle(){await page.evaluate(()=>__spinPromise);await page.waitForFunction(()=>!document.querySelector('#wheelQuickDuel.cbaPlaying'));}
try{
  await page.goto(pathToFileURL(fixture).href);
  await page.evaluate(()=>{
    window.currentUser={uid:'teacher'};window.wheelTeacher=()=>!!currentUser;window.ClassroomBattle={isOpen:()=>false};
    window.wheelClass='Science';window.wheelSpinning=false;
    window.rwStudents=[{id:'one',name:'Ari',slots:['Science'],marks:10},{id:'two',name:'Bo',slots:['Science'],marks:10}];
    window.rwStudentClasses=s=>s.slots;window.rwStudentsInClass=()=>rwStudents;window.wheelStudent=entry=>rwStudents.find(s=>s.id===entry?.id);window.wheelGiven=0;window.wheelRender=()=>QuickBattle.render();
    window.wheelState={names:rwStudents.map(s=>({id:s.id,n:s.name}))};window.__calls=0;window.__listener=null;window.__duelPlays=[];const originalPlay=ClassroomBattleAnimation.playDuel;ClassroomBattleAnimation.playDuel=function(container,options){__duelPlays.push(options.event.id);return originalPlay(container,options);};
    ClassroomBattleStore.create=()=>({subscribe(fn){__listener=fn;setTimeout(()=>{if(__listener===fn)fn(structuredClone(__state));},0);return()=>{if(__listener===fn)__listener=null;};},async award({studentId,delta,action}){
      __calls++;await new Promise(r=>setTimeout(r,__delay));if(__fail)throw new Error('Save failed for test');
      __state=ClassroomBattleCore.reduce(__state,{...action,type:'auto',points:delta});
      const student=rwStudents.find(s=>s.id===studentId),award={id:action.id,studentId,delta,marks:student.marks+delta};
      const savedReply=structuredClone(__state);if(__listener)__listener(structuredClone(__state));if(__nextBeforeReply){__state=ClassroomBattleCore.reduce(__state,{type:'start',id:'replacement-before-http-reply',expectedRevision:__state.revision,heroes:__state.heroes,bossId:ClassroomBattleCore.BOSSES.filter(b=>!b.legacy)[1].id});if(__listener)__listener(structuredClone(__state));}await new Promise(r=>setTimeout(r,25));return {state:savedReply,award};
    }});
    document.getElementById('samples').innerHTML=['warrior','ranger','mage','cleric'].map(role=>ClassroomBattleAnimation.heroMarkup(role)).join('');ClassroomBattleAnimation.mount(document.getElementById('samples'));
  });
  await page.waitForFunction(()=>document.querySelectorAll('#samples .cbaReady').length===4,{},{timeout:20000});
  check('all four paired hero sheets load with accessible appearance labels',await page.evaluate(()=>Array.from(document.querySelectorAll('#samples .cbaHero')).every(node=>node.getAttribute('role')==='img'&&node.getAttribute('aria-label')&&node.dataset.cbaGender==='male'&&node.querySelector('.cbaFallback'))));
  check('all six generated attack and healing sheets load as square four-frame atlases',await page.evaluate(async()=>{const loaded=await Promise.all(['slash','fire','ice','lightning','arrow','heal'].map(name=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>0&&image.naturalWidth===image.naturalHeight);image.onerror=()=>resolve(false);image.src='assets/battle-pixel/animations/'+name+'-sheet.png';})));return loaded.every(Boolean);}));
  const frame=await page.locator('#samples .cbaFrames').first().evaluate(node=>getComputedStyle(node).backgroundPosition);
  await page.waitForTimeout(340);
  check('idling changes the actual sprite-sheet frame',frame!==await page.locator('#samples .cbaFrames').first().evaluate(node=>getComputedStyle(node).backgroundPosition));
  await page.emulateMedia({reducedMotion:'reduce'});
  const still=await page.locator('#samples .cbaFrames').first().evaluate(node=>getComputedStyle(node).backgroundPosition);
  await page.waitForTimeout(340);
  check('reduced motion freezes idle frames',still===await page.locator('#samples .cbaFrames').first().evaluate(node=>getComputedStyle(node).backgroundPosition));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await reset();
  const prior=await page.evaluate(()=>({hp:__state.bossHp,calls:__calls}));
  await page.evaluate(()=>{wheelState.lastSpinId='animation-preview-only';window.wheelWinnerIdx=0;QuickBattle.landed({id:'one',n:'Ari'},wheelState.lastSpinId);});
  await page.waitForTimeout(400);
  check('landing leaves the avatar idling without a save or attack',await page.evaluate(prior=>__calls===prior.calls&&__state.bossHp===prior.hp&&!document.querySelector('.cbaPlaying')&&!document.querySelector('.cbaEffect'),prior));
  const firstId=await land();await phase('windup');
  check('saved point award returns immediately and leaves the wheel available during animation',await page.evaluate(()=>__awardSettled&&document.querySelector('.cbQuickHero .cbaActing')&&!document.getElementById('wheelSpinBtn').disabled&&!QuickBattle.blocksAward()));
  check('HP and the persisted damage log show final saved results during windup',await page.evaluate(()=>document.querySelector('.cbQuickEnemy').textContent.includes('HP '+__state.bossHp+'/')&&document.querySelectorAll('[data-combat-id]').length===__state.combatLog.length));
  await phase('hero-impact');
  check('warrior slash is generated over the enemy',await page.locator('.cbQuickEnemy .cbaFx-slash').count()===1);
  await page.screenshot({path:path.join(output,'animated-warrior-slash.png')});
  const saved=await page.evaluate(()=>structuredClone(__state));
  await page.evaluate(()=>{__listener(structuredClone(__state));QuickBattle.render();});
  check('listener and wheel renders cannot replace an active animation',await page.locator('.cbQuickEnemy .cbaFx-slash').count()===1);
  await phase('enemy-impact');
  check('enemy retaliation targets saved recipients',await page.evaluate(()=>{const targets=__state.lastEvent.enemy.targets.filter(t=>t.damage>0);return targets.every(target=>Array.from(document.querySelectorAll('[data-cba-hero-id]')).some(node=>node.dataset.cbaHeroId===target.heroId&&node.querySelector('.cbaFx-slash')));}));
  await settle();
  check('animation leaves authoritative damage and progression untouched',await page.evaluate(saved=>JSON.stringify(__state)===JSON.stringify(saved),saved));
  check('settled fight exposes final HP and re-enables the wheel',await page.evaluate(()=>!document.getElementById('wheelSpinBtn').disabled&&document.querySelector('.cbQuickEnemy').textContent.includes('HP '+__state.bossHp+'/')&&!document.querySelector('.cbaEffect')));
  await page.evaluate(id=>QuickBattle.landed({id:'one',n:'Ari'},id),firstId);
  check('duplicate landing does not send another command or replay',await page.evaluate(calls=>__calls===calls+1&&!document.querySelector('.cbaPlaying'),prior.calls));
  await reset();const playsBeforeReplacement=await page.evaluate(()=>__duelPlays.length);await page.evaluate(()=>__nextBeforeReply=true);await land();await page.evaluate(()=>__spinPromise);
  check('newer encounter snapshot before the HTTP reply prevents stale attack playback',await page.evaluate(count=>__duelPlays.length===count&&!document.querySelector('#wheelQuickDuel.cbaPlaying')&&__state.encounterId==='replacement-before-http-reply'&&document.querySelector('.cbQuickEnemy').textContent.includes(ClassroomBattleCore.bossById(__state.bossId).name)&&document.querySelector('.cbQuickEnemy').textContent.includes('HP '+__state.bossHp+'/')&&!QuickBattle.blocksAward(),playsBeforeReplacement));
  await reset('warrior',{knockout:true});await land();await phase('windup');
  check('a hero knocked out by the saved enemy reply still performs its earlier attack pose',await page.evaluate(()=>__state.heroes[0].hp===0&&getComputedStyle(document.querySelector('.cbQuickHero .cbaFrames')).animationName==='cbaActionFrames'));
  await settle();
  check('the knocked-out hero becomes still only when that turn settles',await page.evaluate(()=>!!document.querySelector('.cbQuickHero .cbaDormant')&&getComputedStyle(document.querySelector('.cbQuickHero .cbaFrames')).animationName==='none'));
  for(const [role,fx] of [['ranger','arrow'],['mage','fire']]){
    await reset(role);await land();await phase('hero-impact');
    check(role+' uses its generated attack effect',await page.locator('.cbQuickEnemy .cbaFx-'+fx).count()===1);await settle();
  }
  for(const [skill,fx] of [['mage-ice-lance','ice'],['mage-arcane-pulse','lightning']]){
    await reset('mage',{skill});await land();await phase('hero-impact');
    check('automatically chosen '+skill+' plays generated '+fx,await page.evaluate(({skill,fx})=>__state.lastEvent.skillId===skill&&!!document.querySelector('.cbQuickEnemy .cbaFx-'+fx),{skill,fx}));await settle();
  }
  await reset('cleric',{wounded:true});await land();await phase('hero-impact');
  check('cleric healing plays only on the recorded healed teammates',await page.evaluate(()=>{const expected=__state.lastEvent.healed.filter(e=>e.amount>0).map(e=>e.heroId);return __state.lastEvent.damage===0&&expected.length===2&&document.querySelectorAll('.cbaFx-heal').length===expected.length&&expected.every(id=>Array.from(document.querySelectorAll('[data-cba-hero-id]')).some(node=>node.dataset.cbaHeroId===id&&node.querySelector('.cbaFx-heal')))&&!document.querySelector('.cbQuickEnemy .cbaEffect');}));
  await page.screenshot({path:path.join(output,'animated-cleric-heal.png')});await settle();
  await reset('warrior',{victory:true});await land();await phase('hero-impact');
  check('victory chest and item grid appear immediately while the final hit animates',await page.locator('.cbQuickTreasure .cbReward').count()===2);await settle();
  check('settled victory reveals the saved chest and rewards once',await page.evaluate(()=>document.querySelectorAll('.cbQuickTreasure').length===1&&document.querySelectorAll('.cbQuickTreasure .cbReward').length===__state.rewards.length));
  await reset();await land();await phase('hero-impact');
  const beforeClose=await page.evaluate(()=>JSON.stringify(__state));
  await page.evaluate(()=>{QuickBattle.close();document.getElementById('wheelModal').classList.remove('open');});await settle();await page.waitForTimeout(850);
  check('closing cancels pending visuals without changing the saved fight',await page.evaluate(old=>JSON.stringify(__state)===old&&!document.querySelector('.cbaPlaying')&&!document.querySelector('.cbaEffect'),beforeClose));
  await page.evaluate(()=>{document.getElementById('wheelModal').classList.add('open');QuickBattle.open('Science');});await page.waitForTimeout(100);
  check('reopening shows saved results without historical playback',await page.locator('.cbaPlaying').count()===0);
  await reset();await page.evaluate(()=>__fail=true);await land();await settle();
  check('failed award shows an error and no invented attack',await page.evaluate(()=>document.getElementById('wheelQuickStatus').textContent.includes('Save failed')&&__awardError.includes('Save failed')&&!document.querySelector('.cbaPlaying')&&!document.querySelector('.cbaEffect')));
  await reset();await land();await phase('windup');
  await page.evaluate(()=>{__state.revision++;__state.bossHp--;__listener(structuredClone(__state));});await settle();
  check('newer snapshots cancel old playback and show the newest saved results immediately',await page.evaluate(()=>document.querySelector('.cbQuickEnemy').textContent.includes('HP '+__state.bossHp+'/')));
  await reset();await land();await phase('windup');await page.emulateMedia({reducedMotion:'reduce'});await settle();
  check('enabling reduced motion cancels visuals and settles saved health immediately',await page.evaluate(()=>!document.querySelector('.cbaPlaying')&&!document.getElementById('wheelSpinBtn').disabled));
  await reset('mage');const started=Date.now();await land();await settle();
  check('reduced-motion turns bypass the animation timeline',Date.now()-started<1000);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>document.getElementById('samples').style.display='none');await page.setViewportSize({width:375,height:760});await reset('ranger');await land();await phase('hero-impact');
  check('mobile fight remains within the viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'animated-mobile-arrow.png')});await settle();
  await page.setViewportSize({width:1100,height:820});
  await page.evaluate(()=>{
    QuickBattle.close();document.getElementById('wheelModal').style.display='none';
    const gallery=document.getElementById('samples');gallery.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);height:auto;gap:16px';
    gallery.innerHTML=Object.values(ClassroomBattleContent.JOBS).map(job=>'<div style="text-align:center">'+ClassroomBattleAnimation.heroMarkup(job.role,{job:job.id,alt:job.name})+'<p>'+job.name+'</p></div>').join('');ClassroomBattleAnimation.mount(gallery);
    const preview=document.createElement('div');preview.id='advancedPreview';preview.style.cssText='margin:24px auto;width:400px';document.body.appendChild(preview);
  });
  await page.waitForFunction(()=>document.querySelectorAll('#samples .cbaReady').length===8);
  check('all eight jobs load their distinct idle/action sprite atlases',await page.evaluate(()=>new Set(Array.from(document.querySelectorAll('#samples .cbaFrames')).map(node=>node.style.backgroundImage)).size===8));
  await page.evaluate(()=>{
    const forms=Object.keys(ClassroomBattleCore.ROLES).map(role=>({role,name:role})).concat(Object.values(ClassroomBattleContent.JOBS).map(job=>({role:job.role,job:job.id,name:job.name})));
    const gallery=document.getElementById('samples');gallery.innerHTML=forms.map(form=>['male','female'].map(gender=>'<div style="text-align:center">'+ClassroomBattleAnimation.heroMarkup(form.role,{job:form.job,gender,alt:form.name})+'<p>'+gender+' '+form.name+'</p></div>').join('')).join('');ClassroomBattleAnimation.mount(gallery);
  });
  await page.waitForFunction(()=>document.querySelectorAll('#samples .cbaReady').length===24);
  check('all 24 male and female appearances load across the twelve hero classes',await page.evaluate(()=>document.querySelectorAll('#samples [data-cba-gender="male"]').length===12&&document.querySelectorAll('#samples [data-cba-gender="female"]').length===12));
  check('female idle frames use their own third atlas row',await page.evaluate(()=>Array.from(document.querySelectorAll('#samples [data-cba-gender="female"] .cbaFrames')).every(n=>Math.abs(parseFloat(getComputedStyle(n).backgroundPositionY)-66.666667)<.01)));
  const femaleFrame=await page.locator('#samples [data-cba-gender="female"] .cbaFrames').first().evaluate(n=>getComputedStyle(n).backgroundPosition);
  await page.waitForTimeout(340);
  check('female heroes breathe through distinct idle frames',femaleFrame!==await page.locator('#samples [data-cba-gender="female"] .cbaFrames').first().evaluate(n=>getComputedStyle(n).backgroundPosition));
  const idlePortraitTransforms=await page.locator('#samples .cbaFrames').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).transform));
  await page.evaluate(()=>document.querySelectorAll('#samples .cbaHero').forEach(n=>n.classList.add('cbaActing')));
  check('all attack rows match the selected gender',await page.evaluate(()=>Array.from(document.querySelectorAll('#samples .cbaHero')).every(n=>Math.abs(parseFloat(getComputedStyle(n.querySelector('.cbaFrames')).backgroundPositionY)-(n.dataset.cbaGender==='female'?100:33.333333))<.01)));
  await page.emulateMedia({reducedMotion:'reduce'});
  check('reduced motion retains the chosen female portrait during an attack',await page.evaluate(()=>Array.from(document.querySelectorAll('#samples [data-cba-gender="female"] .cbaFrames')).every(n=>getComputedStyle(n).animationName==='none'&&Math.abs(parseFloat(getComputedStyle(n).backgroundPositionY)-66.666667)<.01)));
  check('reduced motion keeps every attacking portrait aligned to its idle ground line',await page.locator('#samples .cbaFrames').evaluateAll((nodes,before)=>nodes.every((node,index)=>getComputedStyle(node).transform===before[index]),idlePortraitTransforms));
  await page.evaluate(()=>document.querySelectorAll('#samples .cbaHero').forEach(n=>{n.classList.remove('cbaActing');n.classList.add('cbaDormant');}));
  await page.emulateMedia({reducedMotion:'no-preference'});
  check('knocked-out female avatars remain on the female idle row',await page.evaluate(()=>Array.from(document.querySelectorAll('#samples [data-cba-gender="female"] .cbaFrames')).every(n=>getComputedStyle(n).animationName==='none'&&Math.abs(parseFloat(getComputedStyle(n).backgroundPositionY)-66.666667)<.01)));
  await page.screenshot({path:path.join(output,'all-gender-appearances.png'),fullPage:true});
  await page.evaluate(()=>document.querySelectorAll('#samples .cbaHero').forEach(n=>n.classList.remove('cbaDormant')));
  for(const [skillId,family] of [['berserker-scarlet-cyclone','fury'],['beastmaster-wolf-pounce','spirit-wolf'],['beastmaster-hawk-dive','spirit-hawk'],['beastmaster-phoenix-flight','spirit-phoenix'],['archmage-frost-nova','blizzard']]){
    await page.evaluate(skillId=>{const skill=ClassroomBattleCore.skillById(skillId);window.__preview=ClassroomBattleAnimation.previewSkill(document.getElementById('advancedPreview'),{id:'preview',name:'Preview hero',role:skill.role,job:skill.job},skill);},skillId);
    await page.waitForFunction(family=>!!document.querySelector('#advancedPreview .cbaFx-'+family),family);
    check(skillId+' previews its matching generated effect',await page.locator('#advancedPreview').getAttribute('data-skill-animation')===skillId);
    await page.evaluate(()=>__preview.cancel());
  }
  await page.evaluate(()=>{const skill=ClassroomBattleCore.skillById('paladin-oath-shield');window.__preview=ClassroomBattleAnimation.previewSkill(document.getElementById('advancedPreview'),{id:'preview',name:'Preview hero',role:skill.role,job:skill.job},skill);});
  await page.waitForFunction(()=>!!document.querySelector('#advancedPreview .cbaFx-ward'));
  check('zero-damage utility preview shows a shield and no invented numeric gain',await page.locator('#advancedPreview').textContent().then(text=>text.includes('Shield')&&!text.includes('+0')));
  await page.evaluate(()=>__preview.cancel());
  await page.evaluate(()=>{
    const preview=document.getElementById('advancedPreview'),hero={id:'preview',name:'Ari',role:'mage',job:'chronomancer'};
    preview.innerHTML=ClassroomBattleAnimation.skillPreviewMarkup(ClassroomBattleCore.skillById('chronomancer-time-surge'),hero);ClassroomBattleAnimation.mount(preview);
    window.__utilityEvent={type:'auto',skillId:'chronomancer-time-surge',move:'Time Surge',damage:0,healed:[],supported:[{heroId:'preview',effect:'mana',amount:15},{heroId:'preview',effect:'shield',amount:23},{heroId:'preview',effect:'cleanse',amount:1},{heroId:'preview',effect:'haste',amount:2}],afflicted:[{effect:'weaken',amount:.2}]};window.__utilityBefore=JSON.stringify(__utilityEvent);
    window.__preview=ClassroomBattleAnimation.playDuel(preview,{hero,event:__utilityEvent});
  });
  await page.waitForFunction(()=>document.querySelector('#advancedPreview')?.dataset.cbaPhase==='hero-impact');
  check('saved mana shield cleanse haste and weakness records animate despite zero damage',await page.evaluate(()=>{const area=document.getElementById('advancedPreview');return ['ward','arcane','purify','time'].every(f=>area.querySelector('.cbaFx-'+f))&&area.textContent.includes('+15 MP')&&area.textContent.includes('Shield +23')&&JSON.stringify(__utilityEvent)===__utilityBefore;}));
  await page.screenshot({path:path.join(output,'advanced-jobs-and-support.png')});await page.evaluate(()=>__preview.cancel());
  check('cancel removes utility effects and their pending motion',await page.locator('#advancedPreview .cbaEffect').count()===0);
  const slow=await context.newPage();await slow.goto(pathToFileURL(fixture).href);
  await slow.evaluate(()=>{
    const NativeImage=Image;window.Image=class extends NativeImage{set src(value){if(value.endsWith('-advanced-sheet.png')){const ready=this.onload;this.onload=()=>setTimeout(()=>ready(),500);}super.src=value;}};
    const area=document.getElementById('samples'),skill=ClassroomBattleCore.skillById('archmage-frost-nova');window.__slowPreview=ClassroomBattleAnimation.previewSkill(area,{id:'preview',name:'Ari',role:'mage',job:'archmage'},skill);
  });
  await slow.waitForTimeout(150);
  check('a first cast waits for its generated effect pixels before the animation clock starts',await slow.locator('.cbaPlaying').count()===0);
  await slow.waitForFunction(()=>!!document.querySelector('.cbaFx-blizzard'));
  check('delayed generated pixels still receive a visible impact frame',await slow.locator('.cbaEffect').count()>0);
  await slow.evaluate(()=>{__slowPreview.cancel();const skill=ClassroomBattleCore.skillById('berserker-scarlet-cyclone');window.__cancelledLoad=ClassroomBattleAnimation.previewSkill(document.getElementById('samples'),{id:'preview',name:'Ari',role:'warrior',job:'berserker'},skill);__cancelledLoad.cancel();});
  await slow.waitForTimeout(700);
  check('cancelling while a generated sheet loads prevents late playback',await slow.locator('.cbaPlaying,.cbaEffect').count()===0);
  await slow.close();
  const fallback=await context.newPage();await fallback.goto(pathToFileURL(fixture).href);
  await fallback.evaluate(()=>{const NativeImage=Image;window.Image=class extends NativeImage{set src(value){if(value.endsWith('warrior-genders-sheet.png'))queueMicrotask(()=>this.onerror());else super.src=value;}};const samples=document.getElementById('samples');samples.innerHTML=ClassroomBattleAnimation.heroMarkup('warrior',{gender:'female'});ClassroomBattleAnimation.mount(samples);});
  await fallback.waitForTimeout(100);
  check('failed generated sheet preserves an accessible female fallback instead of showing a male sprite',await fallback.evaluate(()=>!document.querySelector('#samples .cbaReady')&&getComputedStyle(document.querySelector('#samples .cbaFallback')).visibility==='visible'&&document.querySelector('#samples .cbaHero').getAttribute('aria-label').startsWith('Female ')&&!document.querySelector('#samples img')));await fallback.close();
  check('animation browser run has no application errors',errors.length===0);
  console.log('\n'+checks+' animation browser checks passed.');
}finally{await browser.close();fs.unlinkSync(fixture);}
