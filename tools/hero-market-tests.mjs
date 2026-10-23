import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../battle-core.js'),A=require('../hero-avatar.js');
const fresh=()=>C.heroFromStudent({id:'shop-student',name:'Ari'});
const buy=(h,skuId,extra={})=>C.configureHero(h,{command:'purchase',skuId,...extra});
test('legacy heroes start with no currency and retain their original artwork',()=>{
 const h=fresh();delete h.questPoints;delete h.avatar;delete h.outfits;
 const clean=C.cleanHero(h,h);assert.equal(clean.questPoints,0);assert.equal(clean.avatar,null);assert.deepEqual(clean.outfits,['traveller']);
});
test('catalogue purchases use real prices, require funds and keep relics drop-only',()=>{
 const h={...fresh(),questPoints:1000};
 for(const row of C.MARKET){const result=buy(h,row.id,{price:0,questPoints:999999,itemId:'forged'});assert.equal(result.questPoints,1000-row.price);assert.equal(h.questPoints,1000);
 if(row.itemId){const item=C.itemById(row.itemId);assert.ok(['common','uncommon','rare'].includes(item.rarity));assert.ok(!item.giftSkill);assert.ok(['equipment','consumable'].includes(item.type));const entry=result.inventory.find(e=>e.itemId===row.itemId);assert.ok(entry);assert.ok(!(entry.sockets||[]).length);}
 else{assert.ok(result.outfits.includes(row.outfitId));assert.deepEqual(result.stats,h.stats);assert.throws(()=>buy(result,row.id),/already own/);}}
 assert.throws(()=>buy(fresh(),'item-red-potion'),/quest points/);assert.throws(()=>buy(h,'item-forged-unique'),/quest shop/);
});
test('owned avatar choices validate every palette, preserve stats, and render independent colours',()=>{
 const h=fresh(),a={...A.DEFAULT,skin:'deep',hair:'pink',eyes:'green',clothing:'gold',hairStyle:'braids'};
 const changed=C.configureHero(h,{command:'customise',avatar:a});assert.deepEqual(changed.stats,h.stats);assert.equal(changed.hp,h.hp);assert.deepEqual(changed.avatar,a);
 for(const key of ['skin','hair','eyes','clothing','hairStyle','outfit'])assert.throws(()=>C.configureHero(h,{command:'customise',avatar:{...a,[key]:'forged'}}));
 assert.throws(()=>C.configureHero(h,{command:'customise',avatar:{...a,outfit:'royal'}}),/Unlock/);
 const html=A.markup('mage',{avatar:a});for(const [key,value]of [['skin','deep'],['hair','pink'],['eyes','green'],['clothing','gold']])assert.ok(html.includes(C.AVATAR_PALETTES[key][value]));
 assert.equal(C.configureHero(changed,{command:'customise',avatar:null}).avatar,null);
});
test('victory points pay once per present hero, including chest bonuses and guardians',()=>{
 for(const [adventure,amount]of [[{kind:'enemy'},25],[{kind:'chest'},25],[{kind:'uber'},35],[{kind:'uber',chapterGuardian:true},50]]){
 let s=C.reduce(null,{type:'start',id:'market-start-'+amount,heroes:[fresh()],formation:'raid'});s.adventure=adventure;
 const action={type:'summon',source:'teacher',id:'market-win-'+amount,encounterId:s.encounterId,expectedRevision:s.revision};const won=C.reduce(s,action);
 assert.equal(won.heroes[0].questPoints,amount);assert.equal(won.rewards.filter(r=>r.questPoints).length,1);assert.equal(won.rewards[0].questPoints,amount);
 assert.throws(()=>C.reduce(won,action),/finished/);assert.equal(won.heroes[0].questPoints,amount);assert.equal(C.normalizeState(JSON.parse(JSON.stringify(won))).heroes[0].questPoints,amount);
 }
});
