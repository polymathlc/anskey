/* Owned avatar editor and quest shop. Prices and balances are server rules. */
(function(){
  'use strict';var C=window.ClassroomBattleCore;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function title(s){return s.charAt(0).toUpperCase()+s.slice(1);}
  function mount(host,options){
    var gone=false,busy=false,pending=null,error='',draft=Object.assign({},HeroAvatar.DEFAULT,options.getHero().avatar||{});
    var storage='polymath.heroShop.'+options.key;
    try{pending=JSON.parse(sessionStorage.getItem(storage)||'null');if(pending&&(!['purchase','customise'].includes(pending.command)||!/^[a-zA-Z0-9_-]{8,100}$/.test(pending.id||'')))pending=null;}catch(_){}
    function persist(){try{if(pending)sessionStorage.setItem(storage,JSON.stringify(pending));else sessionStorage.removeItem(storage);}catch(_){} }
    function blocked(){return busy||!!pending;}
    function button(text,attrs,disabled){return '<button type="button" '+attrs+(disabled?' disabled':'')+'>'+text+'</button>';}
    function render(){
      if(gone)return;var hero=options.getHero(),points=hero.questPoints||0,owned=hero.outfits||['traveller'],disabled=blocked()||!options.canAct(),locked=options.locked();
      if(!owned.includes(draft.outfit))draft.outfit='traveller';
      var html='<section class="hsStudio" aria-label="Avatar tailor and quest shop"><header class="hsHeading"><div><small>YOUR LOOK · YOUR ADVENTURE</small><h2>Avatar tailor & quest shop</h2></div><strong class="hsBalance" aria-label="Quest point balance">✦ '+points+' quest points</strong></header><p>Earn 25 points for a boss victory, 35 for an empowered boss and 50 for a chapter guardian. These are separate from classroom marks.</p><div class="hsEditor"><div class="hsPreview">'+HeroAvatar.markup(hero.role,{job:hero.job,gender:hero.gender,avatar:draft,className:'hsAvatar',alt:'Preview of your customised avatar'})+'<span>Cosmetic only · no combat bonus</span></div><div class="hsFields">';
      function select(key,label,values){html+='<label>'+label+'<select data-avatar-field="'+key+'"'+(disabled?' disabled':'')+'>'+values.map(function(pair){return '<option value="'+esc(pair[0])+'"'+(draft[key]===pair[0]?' selected':'')+'>'+esc(pair[1])+'</option>';}).join('')+'</select></label>';}
      select('outfit','Clothing',owned.map(function(id){return [id,C.AVATAR_OUTFITS[id].name];}));select('hairStyle','Hairstyle',C.AVATAR_HAIR.map(function(id){return [id,title(id)];}));
      [['skin','Skin tone'],['hair','Hair colour'],['eyes','Eye colour'],['clothing','Clothing colour']].forEach(function(pair){select(pair[0],pair[1],Object.keys(C.AVATAR_PALETTES[pair[0]]).map(function(id){return [id,title(id)];}));});
      html+='<div class="hsSave">'+button('Save my avatar','data-studio-save',disabled)+button('Use original class artwork','data-studio-original',disabled||!hero.avatar)+'</div></div></div><p class="hsHint">Skin tones, hairstyles and colour changes are free. Unlock clothing styles with quest points. Your saved look appears in My Hero, the wheel, battles and the adventure trail.</p>';
      html+='<img class="hsShopArt" src="assets/battle-pixel/market/tailor-shop.png" alt="Lantern-lit fantasy tailor stall with colourful cloaks, shields and potions" loading="lazy"><h3>Clothing collection</h3><p>Buy each outfit once. It stays with your character when you change class.</p>';
      if(locked)html+='<p class="hsLock">Finish or end the current encounter before shopping. You can still save a different look using clothing you already own.</p>';
      html+='<div class="hsProducts">'+C.MARKET.filter(function(row){return !!row.outfitId;}).map(function(row){var have=owned.includes(row.outfitId);return '<article>'+HeroAvatar.markup(hero.role,{avatar:Object.assign({},draft,{outfit:row.outfitId}),gender:hero.gender,className:'hsOutfit',alt:row.name+' outfit preview'})+'<h4>'+esc(row.name)+'</h4><small>Cosmetic outfit · '+row.price+' points</small>'+button(have?'✓ Owned':'Unlock · '+row.price+' points','data-shop-sku="'+row.id+'"',disabled||locked||have||points<row.price)+'</article>';}).join('')+'</div><h3>Adventurer supplies</h3><p>Shop equipment is capped at rare rarity and has no sockets or granted skills. Epic, legendary, mythical and unique treasures remain drop rewards.</p><div class="hsProducts">'+C.MARKET.filter(function(row){return !!row.itemId;}).map(function(row){var item=C.itemById(row.itemId);return '<article>'+(window.ClassroomBattleDisplay?ClassroomBattleDisplay.itemIcon(item):'')+'<h4>'+esc(item.name)+'</h4><small>'+esc(item.rarity)+' · '+row.price+' points</small><p>'+esc(item.description)+'</p>'+button('Buy · '+row.price+' points','data-shop-sku="'+row.id+'"',disabled||locked||points<row.price)+'</article>';}).join('')+'</div>';
      if(error)html+='<p class="hsError" role="alert">'+esc(error)+'</p>';
      if(pending)html+='<p class="hsHint" role="status">'+(busy?'Saving your choice…':'Your request needs confirmation. Retry the same saved request.')+'</p>'+button('Confirm saved request','data-studio-retry',busy||!options.canAct());
      html+='</section>';
      var field=document.activeElement&&host.contains(document.activeElement)?document.activeElement.dataset.avatarField:null;
      host.innerHTML=html;if(field){var next=host.querySelector('[data-avatar-field="'+field+'"]');if(next)next.focus({preventScroll:true});}
    }
    async function send(action,retry){
      if(gone||busy||!options.canAct())return;
      if(!retry){if(pending)return;pending=Object.assign({id:crypto.randomUUID()},action);var revision=options.getRevision();if(revision!==undefined)pending.expectedRevision=revision;persist();}
      if(!pending)return;var request=JSON.parse(JSON.stringify(pending));busy=true;error='';render();
      try{var result=await options.dispatch(request);if(gone)return;pending=null;persist();busy=false;options.onChange(result);}
      catch(e){if(gone)return;error=e.message||'Unable to save. Confirm the same request.';if(e.status>=400&&e.status<500){pending=null;persist();}}
      finally{busy=false;if(!gone)render();}
    }
    function click(event){var button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-studio-retry'))send(null,true);
      else if(button.dataset.shopSku)send({command:'purchase',skuId:button.dataset.shopSku},false);
      else if(button.hasAttribute('data-studio-save'))send({command:'customise',avatar:JSON.parse(JSON.stringify(draft))},false);
      else if(button.hasAttribute('data-studio-original'))send({command:'customise',avatar:null},false);
    }
    function change(event){var key=event.target.dataset.avatarField;if(key&&Object.prototype.hasOwnProperty.call(draft,key)&&!blocked()){draft[key]=event.target.value;render();}}
    host.addEventListener('click',click);host.addEventListener('change',change);render();
    return {blocked:blocked,destroy:function(){gone=true;host.removeEventListener('click',click);host.removeEventListener('change',change);}};
  }
  window.HeroStudio={mount:mount};
})();
