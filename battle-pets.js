/* Equipped companions are presentation only. Resting never changes a saved build. */
(function (root) {
  'use strict';
  var resting = new Set();
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function equipped(hero) {
    var core=root.ClassroomBattleCore;
    if(!hero || !core)return null;
    var id=core.loadoutFor(hero).pet,entry=(hero.inventory || []).find(function(row){return row.id===id && row.quantity>0;}),item=entry && core.itemById(entry.itemId);
    return item && item.type==='pet' ? item : null;
  }
  function behavior(item) {
    var id=item && item.id || '';
    if(/sparrow|owl|phoenix|griffin|dragon/.test(id))return 'bird';
    if(/bumblebee|moth/.test(id))return 'flutter';
    if(/bunny|frog/.test(id))return 'hop';
    if(/serpent/.test(id))return 'slither';
    if(/koi|axolotl|otter/.test(id))return 'swim';
    if(/beetle|crab|tortoise|gecko/.test(id))return 'scuttle';
    if(/dryad|spirit-panda/.test(id))return 'float';
    if(/penguin/.test(id))return 'waddle';
    return 'walk';
  }
  function keyFor(hero,item) { return String(hero.studentId || hero.id || hero.name || 'hero')+':'+item.id; }
  function markup(hero) {
    var item=equipped(hero),display=root.ClassroomBattleDisplay;
    if(!item || !display)return '';
    var kind=behavior(item),key=keyFor(hero,item),asleep=resting.has(key) || hero.hp<=0;
    var seed=Array.from(item.id).reduce(function(n,c){return n+c.charCodeAt(0);},0),duration=(kind==='scuttle'?16:kind==='bird'?11:13)+(seed%5);
    return '<span class="cbPet cbPet-'+kind+(asleep?' cbPetResting':'')+'" data-pet-key="'+esc(key)+'" data-pet-item="'+esc(item.id)+'" aria-hidden="true" style="--pet-duration:'+duration+'s;--pet-cadence:'+(0.65+(seed%6)*.12)+'s"><span class="cbPetMover"><span class="cbPetBody">'+display.itemIcon(item)+'</span></span><span class="cbPetSleep">z</span></span>';
  }
  function attach(hero,html) {
    var pet=markup(hero);
    return pet ? html.replace(/<\/span>$/,pet+'</span>') : html;
  }
  function control(hero) {
    var item=equipped(hero);if(!item)return '';
    var key=keyFor(hero,item),asleep=resting.has(key),perch=['bird','flutter'].includes(behavior(item));
    return '<button type="button" class="cbPetToggle" data-pet-rest-key="'+esc(key)+'" aria-pressed="'+asleep+'" aria-label="'+esc((asleep?'Let ':'Rest ')+item.name+(asleep?' roam':''))+'">'+(asleep?'Let pet roam':perch?'Rest on shoulder':'Rest pet')+'</button>';
  }
  function toggle(key) {
    if(resting.has(key))resting.delete(key);else resting.add(key);
    if(!root.document)return;
    root.document.querySelectorAll('[data-pet-key]').forEach(function(node){if(node.dataset.petKey===key)node.classList.toggle('cbPetResting',resting.has(key) || !!node.closest('.cbaDormant'));});
    root.document.querySelectorAll('[data-pet-rest-key]').forEach(function(button){
      if(button.dataset.petRestKey!==key)return;
      var asleep=resting.has(key),item=root.ClassroomBattleCore.itemById(key.slice(key.lastIndexOf(':')+1)),perch=item && ['bird','flutter'].includes(behavior(item));
      button.setAttribute('aria-pressed',String(asleep));button.setAttribute('aria-label',(asleep?'Let ':'Rest ')+(item?item.name:'pet')+(asleep?' roam':''));button.textContent=asleep?'Let pet roam':perch?'Rest on shoulder':'Rest pet';
    });
  }
  if(root.document)root.document.addEventListener('click',function(event){var button=event.target.closest && event.target.closest('[data-pet-rest-key]');if(button){event.preventDefault();toggle(button.dataset.petRestKey);}});
  root.ClassroomBattlePets={equipped:equipped,behavior:behavior,markup:markup,attach:attach,control:control,toggle:toggle};
})(typeof window!=='undefined'?window:globalThis);
