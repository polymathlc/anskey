// Narrow migration of the live shared rules. Never replace unrelated app rules.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { BATTLE_RULE, preservedRuleTests } from './battle-rules.mjs';
export const HERO_RULE = `    // BEGIN classroom-heroes-v1
    function isClassroomHeroPath() {
      return request.path[3] == 'classroomHeroData';
    }
    // Account bindings, inventories and active-encounter locks belong to the
    // authenticated server; neither students nor browser teachers write them.
    match /classroomHeroData/{document=**} {
      allow read, write: if false;
    }
    // END classroom-heroes-v1

`;
export const AUTHORITATIVE_BATTLE_RULE = `    // BEGIN classroom-battles-v2
    function isClassroomBattlePath() {
      return request.path[3] == 'classroomBattles';
    }
    function isClassroomTeacher(teacherUid) {
      return request.auth != null && request.auth.uid == teacherUid
        && request.auth.token.email == 'chungzhikai@gmail.com'
        && request.auth.token.email_verified == true
        && request.auth.token.firebase.sign_in_provider == 'google.com';
    }
    match /classroomBattles/{teacherUid}/classes/{classKey} {
      allow read: if isClassroomTeacher(teacherUid);
      allow write: if false;
      match /actions/{actionId} {
        allow read: if isClassroomTeacher(teacherUid);
        allow write: if false;
      }
    }
    // END classroom-battles-v2

`;
export function addHeroRules(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {')) throw new Error('Unrecognized shared rules; nothing changed.');
  const catchalls=[...source.matchAll(/(allow read, write: if !isPermanentStudentHistoryPath\(\)[^;]*)(;)/g)];
  if (catchalls.length!==1 || (source.match(/match\s+\/\{\w+=\*\*\}/g)||[]).length!==1) throw new Error('Ambiguous shared catch-all; nothing changed.');
  if (source.includes(HERO_RULE) && source.includes(AUTHORITATIVE_BATTLE_RULE) && catchalls[0][1].endsWith(' && !isClassroomHeroPath()')) return source;
  if (source.includes('classroom-heroes-v1') || source.includes('isClassroomHeroPath') || !source.includes(BATTLE_RULE)) throw new Error('Existing classroom rules differ; review them first.');
  const before=catchalls[0][0],after=catchalls[0][1]+' && !isClassroomHeroPath();';
  const next=source.replace(BATTLE_RULE,AUTHORITATIVE_BATTLE_RULE+HERO_RULE).replace(before,after);
  if (next.replace(AUTHORITATIVE_BATTLE_RULE+HERO_RULE,BATTLE_RULE).replace(after,before)!==source) throw new Error('Unrelated rules would change.');
  return next;
}
function permission(path,method,expectation,identity='student') {
  const uid=identity==='teacher'?'battle-teacher':identity==='other-teacher'?'other-teacher':'battle-student';
  return {expectation,request:{path:'/databases/(default)/documents/'+path,method,
    auth:identity==='anonymous'?null:{uid,token:{email:identity==='student'?'student@example.com':'chungzhikai@gmail.com',email_verified:identity!=='unverified',firebase:{sign_in_provider:identity==='password'?'password':'google.com'}}},
    ...(['create','update'].includes(method)?{resource:{data:{studentId:'student-one',xp:999999}}}:{})},
    ...(method!=='create'?{resource:{data:{studentId:'student-one',xp:0}}}:{})};
}
export function heroRuleTests() {
  const tests=[];
  for (const identity of ['anonymous','student','teacher','other-teacher','unverified','password']) {
    for (const path of ['classroomHeroData/battle-teacher','classroomHeroData/battle-teacher/profiles/student-one','classroomHeroData/battle-teacher/accounts/battle-student','classroomHeroData/battle-teacher/arbitrary/data']) {
      for (const method of ['get','create','update','delete']) tests.push(permission(path,method,'DENY',identity));
    }
    for (const path of ['classroomBattles/battle-teacher/classes/class1','classroomBattles/battle-teacher/classes/class1/actions/abc12345']) {
      for (const method of ['get','create','update','delete']) tests.push(permission(path,method,method==='get' && identity==='teacher'?'ALLOW':'DENY',identity));
    }
  }
  tests.push(permission('classroomBattles/battle-teacher/arbitrary/data','create','DENY','teacher'));
  return tests;
}
async function validate(request,source,tests) {
  const result=await request('projects/mathgen--app:test',{method:'POST',body:{source,testSuite:{testCases:tests}}});
  const failed=(result.testResults||[]).flatMap((r,i)=>r.state==='SUCCESS'?[]:[{i,result:r}]);
  if (result.testResults?.length!==tests.length || failed.length || result.issues?.some(i=>i.severity==='ERROR')) throw new Error('Rules validation failed: '+JSON.stringify({failed,issues:result.issues}));
}
export async function publishHeroRules({request,deploy=false}) {
  const releasePath='projects/mathgen--app/releases/cloud.firestore',valid=n=>/^projects\/mathgen--app\/rulesets\/[^/]+$/.test(n);
  const previous=await request(releasePath);
  if (!valid(previous.rulesetName)) throw new Error('Unexpected shared ruleset.');
  const current=await request(previous.rulesetName),files=current.source?.files;
  if (!Array.isArray(files)||files.length!==1) throw new Error('Unexpected shared rules bundle.');
  const content=addHeroRules(files[0].content),source={files:[{...files[0],content}]};
  await validate(request,current.source,preservedRuleTests());
  const tests=[...preservedRuleTests(),...heroRuleTests()];
  await validate(request,source,tests);
  const result={validated:tests.length,changed:false,sourceSha256:createHash('sha256').update(content).digest('hex'),ruleset:previous.rulesetName};
  if (!deploy || content===files[0].content) return result;
  const candidate=await request('projects/mathgen--app/rulesets',{method:'POST',body:{source}});
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest=await request(releasePath);
  if (latest.rulesetName!==previous.rulesetName || latest.updateTime!==previous.updateTime) throw new Error('Shared rules changed while validating. Retry.');
  await request(releasePath,{method:'PATCH',body:{release:{name:releasePath,rulesetName:candidate.name},updateMask:'rulesetName'}});
  if ((await request(releasePath)).rulesetName!==candidate.name) throw new Error('Could not verify hero rules deployment.');
  return {...result,changed:true,ruleset:candidate.name,previousRuleset:previous.rulesetName};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2),index=args.indexOf('--firebase-tools'),root=index>=0?args.splice(index,2)[1]:null;
  if (!root || args.some(a=>a!=='--apply')) throw new Error('Use --firebase-tools <installed-package-directory> [--apply].');
  const require=createRequire(import.meta.url),cli=name=>require(resolve(root,'lib',name));
  const {Command}=cli('command'),{requireAuth}=cli('requireAuth'),{Client}=cli('apiv2'),{logger}=cli('logger');
  logger.silent=true;
  await new Command('hero:rules').before(requireAuth).action(async()=>{
    const client=new Client({urlPrefix:'https://firebaserules.googleapis.com',apiVersion:'v1'});
    const request=async(path,opts={})=>(await client.request({method:opts.method||'GET',path,...(opts.body?{body:opts.body}:{}),skipLog:{reqHeaders:true,reqBody:true,resHeaders:true,resBody:true}})).body;
    console.log(JSON.stringify(await publishHeroRules({request,deploy:args.includes('--apply')}),null,2));
  }).runner()({project:'mathgen--app',projectId:'mathgen--app',projectNumber:'165654161198',nonInteractive:true,cwd:process.cwd()});
}
