import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),Core=require('../battle-core.js');
const source=readFileSync(new URL('../quick-battle.js',import.meta.url),'utf8');
function fixture(){
  const students=['Ari','Bo','Cy','Dee'].map((name,i)=>({id:'student-'+i,name,slots:['P5'],marks:0})),heroes=students.map((s,i)=>Core.heroFromStudent(s,null,i)),nodes=new Map();
  function element(id){
    if(!nodes.has(id))nodes.set(id,{
      html:'',children:new Map(),textContent:'',hidden:false,
      get innerHTML(){return this.html;},set innerHTML(value){this.html=String(value);this.children.clear();},
      classList:{contains:()=>true,toggle:()=>{}},addEventListener(){},
      insertAdjacentHTML(position,html){this.html+=html;},
      querySelector(selector){if(!this.children.has(selector))this.children.set(selector,element(id+selector));return this.children.get(selector);}
    });return nodes.get(id);
  }
  let state=null,callback,sequence=0;
  const requests=[],session=new Map(),storage={getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)};
  const window={
    ClassroomBattleCore:Core,
    ClassroomBattleStore:{create:()=>({
      subscribe(cb){callback=cb;cb(state);return ()=>{};},
      async award(request){
        requests.push(structuredClone(request));const prior=state||{revision:0,heroes,heroArchive:{}};
        state=Core.reduce(prior,{...request.action,expectedRevision:prior.revision,points:request.delta});
        return {state,award:{studentId:request.studentId,delta:request.delta,marks:request.delta}};
      }
    })},
    ClassroomBattleDisplay:{enemyArt:b=>'<span>'+b.name+'</span>',rotation:()=>'',log:()=>'',treasure:()=>'<p>saved loot</p>',heroTeam:()=>'<div>team</div>',enemyTeam:s=>Core.enemiesFor(s).map(e=>'<i data-boss-id="'+e.bossId+'"></i>').join('')},
    db:{},rwStudents:students,wheelClass:'P5',wheelState:{names:students.map(s=>({id:s.id,n:s.name})),lastSpinId:''},
    currentUser:{uid:'teacher'},wheelTeacher:()=>true,rwStudentsInClass:()=>students,rwStudentClasses:()=>['P5'],wheelStudent:e=>e&&students.find(s=>s.id===e.id),addEventListener(){},wheelGiven:0
  };
  const document={getElementById:element,querySelectorAll:()=>[]};
  const context=vm.createContext({...window,window,document,localStorage:storage,sessionStorage:storage,crypto:{randomUUID:()=> 'test-uuid-'+(++sequence)}});
  Object.assign(context,window);context.window=context;vm.runInContext(source,context);context.QuickBattle.open('P5');
  const entry=context.wheelState.names[0];
  return {requests,Core,entry,get state(){return state;},
    spin(spinId){context.wheelState.lastSpinId=spinId;context.QuickBattle.landed(entry,spinId);},
    award(){return context.QuickBattle.award(entry,1,'Correct answer');},
    victory(){state=Core.reduce(state,{type:'summon',source:'teacher',id:'test-victory-'+(++sequence),encounterId:state.encounterId,expectedRevision:state.revision});callback(state);},
    reopen(){context.QuickBattle.close();context.QuickBattle.open('P5');context.QuickBattle.landed(entry,context.wheelState.lastSpinId);},
    markup(){const main=element('wheelQuickDuel');return main.innerHTML+[...main.children.values()].map(n=>n.innerHTML).join('');}
  };
}
function formationSeed(size){
  for(let i=0;i<1000;i++){const spin='formation-spin-'+i,roll=Core.randomUnit(spin+':formation'),n=roll<.15?3:roll<.4?2:1;if(n===size)return spin;}
  throw Error('No formation seed');
}
function idsFrom(markup){return [...new Set([...markup.matchAll(/data-boss-id="([^"]+)"/g)].map(m=>m[1]))];}
for(const size of [1,2,3])test('spin previews exactly production '+size+'-enemy formation before first award',async()=>{
  const f=fixture(),spin=formationSeed(size);f.spin(spin);const before=idsFrom(f.markup());
  assert.equal(before.length,size);assert.equal(f.requests.length,0);assert.equal(f.state,null);
  f.spin(spin);assert.deepEqual(idsFrom(f.markup()),before);assert.equal(f.requests.length,0);
  await f.award();assert.deepEqual(Core.enemiesFor(f.state).map(e=>e.bossId),before);assert.equal(f.state.teamSize||1,size);assert.equal(f.requests[0].action.spinId,spin);
  const saved=structuredClone(f.state);f.spin('another-spin-'+size);assert.deepEqual(f.state,saved);assert.deepEqual(idsFrom(f.markup()),before);
});
test('extra points on winning spin show next encounter before starting it',async()=>{
  const f=fixture(),spin=formationSeed(3);f.spin(spin);await f.award();f.victory();
  const victory=structuredClone(f.state),markup=f.markup();assert.match(markup,/saved loot/);assert.match(markup,/Next points award starts this encounter/);
  const next=idsFrom(markup.split('aria-label="Next encounter"')[1]);assert.ok(next.length>0);assert.deepEqual(f.state,victory);
  await f.award();assert.deepEqual(Core.enemiesFor(f.state).map(e=>e.bossId),next);assert.equal(f.requests[1].action.spinId,spin);
});
test('reopening and fresh spin preview saved rotation without consuming enemies',async()=>{
  const f=fixture();f.spin(formationSeed(2));await f.award();f.victory();f.reopen();
  let next=idsFrom(f.markup()),saved=structuredClone(f.state);assert.equal(next[0],Core.nextBoss(saved,formationSeed(2)).id);assert.deepEqual(f.state,saved);
  const spin=formationSeed(3);f.spin(spin);next=idsFrom(f.markup());assert.equal(next[0],Core.nextBoss(saved,spin).id);await f.award();assert.deepEqual(Core.enemiesFor(f.state).map(e=>e.bossId),next);
});
