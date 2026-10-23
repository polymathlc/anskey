/* Owned avatar editor and quest shop. Prices and balances are server rules. */
(function(){
  'use strict';var C=window.ClassroomBattleCore;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function title(s){return s.charAt(0).toUpperCase()+s.slice(1);}
  function amount(value){return Number(value).toLocaleString('en-US');}
  var PAGE_SIZE=24,TYPES={equipment:'Equipment',consumable:'Consumables',rune:'Runes',pet:'Pets'};
  function mount(host,options){
    var gone=false,busy=false,pending=null,error='',draft=Object.assign({},HeroAvatar.DEFAULT,options.getHero().avatar||{});
    var storage='polymath.heroShop.'+options.key,viewStorage=storage+'.browse',browse={rarity:'all',type:'all',search:'',affordable:false,page:1};
    try{pending=JSON.parse(sessionStorage.getItem(storage)||'null');if(pending&&(!['purchase','customise'].includes(pending.command)||!/^[a-zA-Z0-9_-]{8,100}$/.test(pending.id||'')))pending=null;}catch(_){}
    try{var saved=JSON.parse(sessionStorage.getItem(viewStorage)||'null');if(saved){if(saved.rarity==='all'||C.RARITIES[saved.rarity])browse.rarity=saved.rarity;if(saved.type==='all'||TYPES[saved.type])browse.type=saved.type;browse.search=String(saved.search||'').slice(0,100);browse.affordable=saved.affordable===true;browse.page=Math.max(1,Math.floor(Number(saved.page)||1));}}catch(_){}
    function persist(){try{if(pending)sessionStorage.setItem(storage,JSON.stringify(pending));else sessionStorage.removeItem(storage);}catch(_){} }
    function rememberBrowse(){try{sessionStorage.setItem(viewStorage,JSON.stringify(browse));}catch(_){} }
    function blocked(){return busy||!!pending;}
    function button(text,attrs,disabled){return '<button type="button" '+attrs+(disabled?' disabled':'')+'>'+text+'</button>';}
    function render(){
      if(gone)return;var hero=options.getHero(),points=hero.questPoints||0,owned=hero.outfits||['traveller'],disabled=blocked()||!options.canAct(),locked=options.locked();
      if(!owned.includes(draft.outfit))draft.outfit='traveller';
      var html='<section class="hsStudio" aria-label="Avatar tailor and quest shop"><header class="hsHeading"><div><small>YOUR LOOK · YOUR ADVENTURE</small><h2>Avatar tailor & quest shop</h2></div><strong class="hsBalance" aria-label="Quest point balance">✦ '+amount(points)+' quest points</strong></header><p>Earn 25 points for a boss victory, 35 for an empowered boss and 50 for a chapter guardian. These are separate from classroom marks.</p><div class="hsEditor"><div class="hsPreview">'+HeroAvatar.markup(hero.role,{job:hero.job,gender:hero.gender,avatar:draft,className:'hsAvatar',alt:'Preview of your customised avatar'})+'<span>Cosmetic only · no combat bonus</span></div><div class="hsFields">';
      function select(key,label,values){html+='<label>'+label+'<select data-avatar-field="'+key+'"'+(disabled?' disabled':'')+'>'+values.map(function(pair){return '<option value="'+esc(pair[0])+'"'+(draft[key]===pair[0]?' selected':'')+'>'+esc(pair[1])+'</option>';}).join('')+'</select></label>';}
      select('outfit','Clothing',owned.map(function(id){return [id,C.AVATAR_OUTFITS[id].name];}));select('hairStyle','Hairstyle',C.AVATAR_HAIR.map(function(id){return [id,title(id)];}));
      [['skin','Skin tone'],['hair','Hair colour'],['eyes','Eye colour'],['clothing','Clothing colour']].forEach(function(pair){select(pair[0],pair[1],Object.keys(C.AVATAR_PALETTES[pair[0]]).map(function(id){return [id,title(id)];}));});
      html+='<div class="hsSave">'+button('Save my avatar','data-studio-save',disabled)+button('Use original class artwork','data-studio-original',disabled||!hero.avatar)+'</div></div></div><p class="hsHint">Skin tones, hairstyles and colour changes are free. Unlock clothing styles with quest points. Your saved look appears in My Hero, the wheel, battles and the adventure trail.</p>';
      html+='<img class="hsShopArt" src="assets/battle-pixel/market/tailor-shop.png" alt="Lantern-lit fantasy tailor stall with colourful cloaks, shields and potions" loading="lazy"><h3>Clothing collection</h3><p>Buy each outfit once. It stays with your character when you change class.</p>';
      if(locked)html+='<p class="hsLock">Finish or end the current encounter before shopping. You can still save a different look using clothing you already own.</p>';
      html+='<div class="hsProducts hsOutfits">'+C.MARKET.filter(function(row){return !!row.outfitId;}).map(function(row){var have=owned.includes(row.outfitId);return '<article>'+HeroAvatar.markup(hero.role,{avatar:Object.assign({},draft,{outfit:row.outfitId}),gender:hero.gender,className:'hsOutfit',alt:row.name+' outfit preview'})+'<h4>'+esc(row.name)+'</h4><small>Cosmetic outfit · '+amount(row.price)+' points</small>'+button(have?'✓ Owned':'Unlock · '+amount(row.price)+' points','data-shop-sku="'+esc(row.id)+'"',disabled||locked||have||points<row.price)+'</article>';}).join('')+'</div><h3>Adventurer supplies</h3><p>Explore every rarity, from everyday supplies to unique treasures. Equipment is sold with no rune sockets; its listed bonuses and granted skills still apply.</p>';
      var savings=C.MARKET_SAVINGS;
      if(savings)html+='<div class="hsSavings"><strong>A treasure to save for</strong><span>Unique items cost '+amount(savings.targetPoints)+' points: about 5 months ('+savings.weeks+' weeks) at '+savings.victoriesPerWeek+' victories a week. That assumes four ordinary bosses and one chapter guardian each week ('+amount(savings.weeklyPoints)+' points). Your pace may vary.</span></div>';
      var ranks=Object.keys(C.RARITIES),catalogue=C.MARKET.filter(function(row){return !!row.itemId&&C.itemById(row.itemId);}).sort(function(a,b){var first=C.itemById(a.itemId),second=C.itemById(b.itemId);return ranks.indexOf(first.rarity)-ranks.indexOf(second.rarity)||a.price-b.price||first.name.localeCompare(second.name);});
      var search=browse.search.trim().toLowerCase(),filtered=catalogue.filter(function(row){var item=C.itemById(row.itemId);return (browse.rarity==='all'||item.rarity===browse.rarity)&&(browse.type==='all'||item.type===browse.type)&&(!browse.affordable||row.price<=points)&&(!search||(item.name+' '+item.description+' '+item.rarity+' '+(TYPES[item.type]||item.type)).toLowerCase().includes(search));});
      var pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));browse.page=Math.min(browse.page,pages);var start=(browse.page-1)*PAGE_SIZE,shown=filtered.slice(start,start+PAGE_SIZE);
      html+='<div class="hsFilters" role="group" aria-label="Browse shop items"><label class="hsSearch">Find an item<input type="search" data-shop-search value="'+esc(browse.search)+'" maxlength="100" placeholder="Search items and bonuses"></label><label>Rarity<select data-shop-filter="rarity"><option value="all">All rarities</option>'+ranks.map(function(key){return '<option value="'+key+'"'+(browse.rarity===key?' selected':'')+'>'+esc(C.RARITIES[key].name)+' ('+catalogue.filter(function(row){return C.itemById(row.itemId).rarity===key;}).length+')</option>';}).join('')+'</select></label><label>Item type<select data-shop-filter="type"><option value="all">All item types</option>'+Object.keys(TYPES).map(function(key){return '<option value="'+key+'"'+(browse.type===key?' selected':'')+'>'+TYPES[key]+'</option>';}).join('')+'</select></label><label class="hsAffordable"><input type="checkbox" data-shop-filter="affordable"'+(browse.affordable?' checked':'')+'> Within my balance</label></div>';
      html+='<p class="hsResults" role="status">'+(filtered.length?'Showing '+amount(start+1)+'–'+amount(start+shown.length)+' of '+amount(filtered.length):'No matching items')+' · '+amount(catalogue.length)+' items in the shop</p><div class="hsProducts hsSupplies">'+shown.map(function(row){
        var item=C.itemById(row.itemId),rarity=C.RARITIES[item.rarity],quantity=(hero.inventory||[]).filter(function(entry){return entry.itemId===item.id;}).reduce(function(n,entry){return n+entry.quantity;},0),shortfall=Math.max(0,row.price-points);
        var learned=!!item.giftSkill&&(hero.giftSkills||[]).includes(item.giftSkill),giftInBag=!!item.giftSkill&&quantity>0,unavailable=learned?'Skill learned':giftInBag?'Already in bag':quantity>=999?'Bag full':'';
        return '<article data-shop-rarity="'+esc(item.rarity)+'" data-shop-type="'+esc(item.type)+'" style="--hs-rarity:'+esc(rarity.color)+'">'+(window.ClassroomBattleDisplay?ClassroomBattleDisplay.itemIcon(item):'')+'<span class="hsRarity">'+esc(rarity.name)+' · '+esc(TYPES[item.type]||item.type)+'</span><h4>'+esc(item.name)+'</h4><p>'+esc(item.description)+'</p><small class="hsOwned">'+(learned?'Gift skill already learned':quantity?'In your bag: '+amount(quantity):'Not in your bag yet')+'</small><strong class="hsPrice">✦ '+amount(row.price)+' points</strong><small class="hsShortfall">'+(shortfall?'Save '+amount(shortfall)+' more points':'Within your balance')+'</small>'+button(unavailable||'Buy · '+amount(row.price)+' points','data-shop-sku="'+esc(row.id)+'" aria-label="'+esc(unavailable?item.name+': '+unavailable:'Buy '+item.name+' for '+amount(row.price)+' quest points')+'"',disabled||locked||shortfall>0||!!unavailable)+'</article>';
      }).join('')+'</div>';
      if(!filtered.length)html+='<div class="hsEmpty"><p>Try another rarity or item type, or clear your search and balance filter.</p>'+button('Clear filters','data-shop-clear',false)+'</div>';
      if(pages>1)html+='<nav class="hsPages" aria-label="Shop item pages">'+button('← Previous','data-shop-page="'+(browse.page-1)+'"',browse.page<=1)+'<span>Page '+browse.page+' of '+pages+'</span>'+button('Next →','data-shop-page="'+(browse.page+1)+'"',browse.page>=pages)+'</nav>';
      if(error)html+='<p class="hsError" role="alert">'+esc(error)+'</p>';
      if(pending)html+='<p class="hsHint" role="status">'+(busy?'Saving your choice…':'Your request needs confirmation. Retry the same saved request.')+'</p>'+button('Confirm saved request','data-studio-retry',busy||!options.canAct());
      html+='</section>';
      var active=document.activeElement&&host.contains(document.activeElement)?document.activeElement:null,focus=active&&(active.dataset.avatarField?'[data-avatar-field="'+active.dataset.avatarField+'"]':active.dataset.shopFilter?'[data-shop-filter="'+active.dataset.shopFilter+'"]':active.hasAttribute('data-shop-search')?'[data-shop-search]':null),selection=active&&active.hasAttribute('data-shop-search')?[active.selectionStart,active.selectionEnd]:null;
      host.innerHTML=html;if(focus){var next=host.querySelector(focus);if(next){next.focus({preventScroll:true});if(selection)next.setSelectionRange(selection[0],selection[1]);}}
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
      if(button.hasAttribute('data-shop-page')){browse.page=Number(button.dataset.shopPage);rememberBrowse();render();var filters=host.querySelector('.hsFilters');if(filters)filters.scrollIntoView({block:'start'});}
      else if(button.hasAttribute('data-shop-clear')){browse={rarity:'all',type:'all',search:'',affordable:false,page:1};rememberBrowse();render();}
      else if(button.hasAttribute('data-studio-retry'))send(null,true);
      else if(button.dataset.shopSku)send({command:'purchase',skuId:button.dataset.shopSku},false);
      else if(button.hasAttribute('data-studio-save'))send({command:'customise',avatar:JSON.parse(JSON.stringify(draft))},false);
      else if(button.hasAttribute('data-studio-original'))send({command:'customise',avatar:null},false);
    }
    function change(event){var key=event.target.dataset.avatarField,filter=event.target.dataset.shopFilter;if(filter&&Object.prototype.hasOwnProperty.call(browse,filter)){browse[filter]=filter==='affordable'?event.target.checked:event.target.value;browse.page=1;rememberBrowse();render();}else if(key&&Object.prototype.hasOwnProperty.call(draft,key)&&!blocked()){draft[key]=event.target.value;render();}}
    function input(event){if(event.target.hasAttribute('data-shop-search')){browse.search=event.target.value;browse.page=1;rememberBrowse();render();}}
    host.addEventListener('click',click);host.addEventListener('change',change);host.addEventListener('input',input);render();
    return {blocked:blocked,destroy:function(){gone=true;host.removeEventListener('click',click);host.removeEventListener('change',change);host.removeEventListener('input',input);}};
  }
  window.HeroStudio={mount:mount};
})();
