/* Class missions are independent of encounters. All mutations run on the server. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ClassroomMissionContent=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const OBJECTIVES=[
    {id:'next-enemy',name:'Defeat the next enemy',target:1},
    {id:'correct-streak',name:'7 correct answers in a row',target:7},
    {id:'focus',name:'Stay focused and quiet for 30 minutes',target:30},
    {id:'assists',name:'Assist your friends 3 times',target:3}
  ];
  const PRIZES=[
    {id:'summon-chung',name:'Summon One-Punch Chung',kind:'summon',weight:5,rare:true},
    ...['Blooket','Gimkit'].flatMap(game=>[1,2,3].map(minutes=>({id:game.toLowerCase()+'-'+minutes,name:'+'+minutes+' minute'+(minutes===1?'':'s')+' '+game,kind:'minutes',game,minutes,weight:15,rare:false}))),
    {id:'class-points',name:'+5 bonus points for all students',kind:'points',weight:5,rare:true}
  ];
  const copy=x=>JSON.parse(JSON.stringify(x));
  function empty(){return {schemaVersion:1,revision:0,current:null,bank:[],summonTokens:0,lastPayout:null};}
  function clean(input){const state=input?copy(input):empty();state.bank=state.bank||[];state.summonTokens=state.bank.filter(p=>p.kind==='summon'&&p.status==='available').length;return state;}
  function roll(objectiveRoll,prizeRoll){
    const objective=OBJECTIVES[Math.min(3,Math.floor(Math.max(0,objectiveRoll)*4))];
    let remaining=Math.min(.999999999,Math.max(0,prizeRoll))*100,prize=PRIZES.at(-1);
    for(const candidate of PRIZES){remaining-=candidate.weight;if(remaining<0){prize=candidate;break;}}
    return {objective:copy(objective),prize:copy(prize)};
  }
  function start(input,{id,now,objectiveRoll,prizeRoll,encounterId}){
    const state=clean(input),{objective,prize}=roll(objectiveRoll,prizeRoll);
    if(state.current?.status==='active')throw Error('Finish or cancel the current mission before turning again.');
    if(state.bank.filter(p=>p.status==='available').length>=200)throw Error('Redeem a class prize before turning again.');
    state.current={id,objectiveId:objective.id,objectiveName:objective.name,target:objective.target,progress:0,status:'active',startedAt:now,prize,encounterId:encounterId||null,...(objective.id==='focus'?{focusReadyAt:now+30*60*1000}:{})};
    state.revision++;return state;
  }
  function complete(state,now){
    const current=state.current;if(current.status!=='active')return state;
    current.status='complete';current.completedAt=now;current.progress=current.target;
    const reward={...current.prize,id:'prize-'+current.id,prizeId:current.prize.id,missionId:current.id,earnedAt:now,status:current.prize.kind==='points'?'redeemed':'available'};
    state.bank.push(reward);
    // Keep every unredeemed prize plus a bounded display history.
    const recent=new Set(state.bank.filter(p=>p.status!=='available').slice(-40).map(p=>p.id));
    state.bank=state.bank.filter(p=>p.status==='available'||recent.has(p.id));
    state.summonTokens=state.bank.filter(p=>p.kind==='summon'&&p.status==='available').length;
    state.lastPayout={id:reward.id,missionId:current.id,prizeId:current.prize.id,name:reward.name,kind:reward.kind,awards:[]};return state;
  }
  function progress(input,{kind,encounterId,now}){
    const state=clean(input),current=state.current;
    if(!current||current.status!=='active')return state;
    let changed=false;
    if(current.objectiveId==='next-enemy'){
      if(encounterId&&(!current.encounterId||kind==='encounter')&&current.encounterId!==encounterId){current.encounterId=encounterId;changed=true;}
      if(kind==='victory'&&current.encounterId===encounterId){current.progress=1;changed=true;}
    } else if(current.objectiveId==='correct-streak'&&(kind==='correct'||kind==='incorrect')){
      current.progress=kind==='correct'?current.progress+1:0;changed=true;
    } else if(current.objectiveId==='assists'&&kind==='assist'){current.progress++;changed=true;}
    else if(current.objectiveId==='focus'&&kind==='focus'){
      if(now<current.focusReadyAt)throw Error('The 30-minute focus timer has not finished yet.');
      current.progress=current.target;changed=true;
    }
    if(current.progress>=current.target)complete(state,now);
    if(changed)state.revision++;return state;
  }
  return {OBJECTIVES,PRIZES,empty,clean,roll,start,progress};
});
