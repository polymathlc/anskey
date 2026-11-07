// Real reveal controls and artwork on a stable local origin. No Firebase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW||'/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(runtime.startsWith('file:')?runtime:pathToFileURL(runtime).href);
const root=path.resolve('.');
const fixture='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/classroom-battle.css"><link rel="stylesheet" href="/treasure-chests.css"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#102139;color:#e2e9ff;font:14px ui-monospace,monospace}main{max-width:760px;margin:auto;min-width:0}h1{font-size:20px;line-height:1.5}</style></head><body><main><h1>Victory treasure</h1><div id="chests"></div></main><script src="/battle-bosses.js"></script><script src="/battle-content.js"></script><script src="/battle-core.js"></script><script src="/treasure-chests.js"></script><script src="/battle-display.js"></script><script>const items=Object.values(ClassroomBattleCore.ITEMS),item=items.find(i=>i.type==="equipment"),bonus=items.find(i=>i.type==="rune");window.__chestState={teacherId:"browser-teacher",classId:"Browser lesson",encounterId:new URLSearchParams(location.search).get("enc")||"chest-browser-1",status:"victory",heroes:[{id:"ari",name:"<Ari>"},{id:"bo",name:"Bo"}],rewards:[{heroId:"ari",itemId:item.id,name:item.name,rarity:item.rarity,xp:45},{heroId:"bo",itemId:item.id,name:item.name,rarity:item.rarity,xp:45},{heroId:"ari",itemId:bonus.id,name:bonus.name,rarity:bonus.rarity,xp:0,source:"bonus-rune"}]};window.__chestInitial=JSON.stringify(__chestState);window.__renderChests=()=>document.getElementById("chests").innerHTML=ClassroomBattleDisplay.treasure(__chestState);__renderChests();</script></body></html>';
const types={'.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/__treasure_fixture.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fixture);return;}
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));
  }catch(_){if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();
const url='http://127.0.0.1:'+server.address().port+'/__treasure_fixture.html';
const browser=await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{});
const context=await browser.newContext({viewport:{width:1000,height:900},reducedMotion:'no-preference'}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
let checks=0;
function check(name,condition){assert.ok(condition,name);checks++;console.log('✓ '+name);}
const output=path.resolve(process.env.BATTLE_SCREENSHOTS||'../battle-validation','treasure-chests');fs.mkdirSync(output,{recursive:true});
try{
  await page.goto(url);await page.waitForFunction(()=>!!window.__chestState&&document.querySelectorAll('.cbStudentChest').length===2);
  check('one closed chest per student groups ordinary and bonus drops',await page.evaluate(()=>document.querySelectorAll('.cbReward').length===3&&[...document.querySelectorAll('.cbChestContents')].every(n=>n.hidden)&&document.querySelector('.cbStudentChest h4').textContent==='<Ari>'));
  check('four-frame chest sheet decodes',await page.evaluate(()=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>0&&image.naturalWidth%4===0);image.onerror=()=>resolve(false);image.src='/assets/battle-pixel/chest-sheet.png';})));
  check('unopened chest animates',await page.locator('.cbTreasureSprite').first().evaluate(n=>getComputedStyle(n).animationName!=='none'));
  await page.screenshot({path:path.join(output,'closed.png'),fullPage:true});
  await page.locator('.cbChestButton').first().focus();await page.keyboard.press('Enter');
  check('keyboard opens only the focused student and bonus drop',await page.evaluate(()=>document.querySelectorAll('.cbChestRevealed').length===1&&!document.querySelectorAll('.cbChestContents')[0].hidden&&document.querySelectorAll('.cbChestContents')[1].hidden&&document.querySelectorAll('.cbChestContents')[0].querySelectorAll('.cbReward').length===2));
  await page.locator('[data-treasure-action="all"]').focus();await page.keyboard.press('Space');
  check('open all reveals every remaining chest',await page.evaluate(()=>document.querySelectorAll('.cbChestRevealed').length===2&&[...document.querySelectorAll('.cbChestContents')].every(n=>!n.hidden)&&document.querySelector('[data-treasure-action="all"]').disabled&&document.querySelector('.cbChestProgress').textContent==='2 / 2 chests opened'));
  check('revealing never mutates saved rewards or heroes',await page.evaluate(()=>JSON.stringify(__chestState)===__chestInitial));
  await page.waitForTimeout(750);await page.screenshot({path:path.join(output,'opened.png'),fullPage:true});
  await page.evaluate(()=>__renderChests());
  check('redraw preserves reveals without replay',await page.evaluate(()=>document.querySelectorAll('.cbChestRevealed').length===2&&!document.querySelector('.cbChestJustOpened')));
  await page.reload();await page.waitForFunction(()=>!!window.__chestState);
  check('reload remembers same encounter',await page.evaluate(()=>document.querySelectorAll('.cbChestRevealed').length===2));
  await page.goto(url+'?enc=chest-browser-new');await page.waitForFunction(()=>!!window.__chestState);
  check('new encounter has fresh closed chests',await page.evaluate(()=>!document.querySelector('.cbChestRevealed')&&[...document.querySelectorAll('.cbChestContents')].every(n=>n.hidden)));
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  check('reduced motion stops idle animation',await page.locator('.cbTreasureSprite').first().evaluate(n=>getComputedStyle(n).animationName==='none'));
  await page.locator('.cbChestButton').first().click();
  check('reduced motion opens directly to final sprite',await page.locator('.cbChestRevealed .cbTreasureSprite').evaluate(n=>getComputedStyle(n).animationName==='none'&&getComputedStyle(n).backgroundPositionX==='100%'));
  check('phone controls fit viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.cbStudentChest,.cbChestToolbar')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})));
  await page.screenshot({path:path.join(output,'phone.png'),fullPage:true});
  check('no browser errors',errors.length===0);console.log(checks+' chest browser checks passed.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
