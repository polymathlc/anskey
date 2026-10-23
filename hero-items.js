/* 🎁 Teacher item desk (v1.158.0): give a hero an item, read the permanent drop
   ledger and restore a drop. Display and requests only — the server decides the
   item, writes the ledger and keeps the profile and its encounter in step. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./battle-core.js'));
  else root.HeroItems = factory(root.ClassroomBattleCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  var TYPES = [['any', 'Any item'], ['equipment', 'Equipment'], ['pet', 'Pet'], ['rune', 'Rune'], ['consumable', 'Potion']];
  var SOURCES = {
    victory: 'Victory treasure', 'road-chest': 'Roadside chest', 'bonus-rune': 'Bonus rune', gift: 'Teacher gift', restore: 'Restored',
    'quest-treasure': 'Personal treasure', 'quest-forge': 'Forged', 'victory-recovered': 'Victory treasure (recovered)',
    'road-chest-recovered': 'Roadside chest (recovered)', 'bonus-rune-recovered': 'Bonus rune (recovered)', summon: 'Victory treasure', auto: 'Battle', answer: 'Battle'
  };
  var CACHE_MS = 60000, SHOWN_ROWS = 60;

  /* ---- pure ---- */
  function rarityKeys() { return Object.keys(Core.RARITIES); }
  function rarityName(key) { return Core.RARITIES[key] ? Core.RARITIES[key].name : String(key || ''); }
  function typeOk(item, type) { return !type || type === 'any' || item.type === type; }
  function poolFor(rarity, type) {
    if (!rarity || rarity === 'random') return [];
    return Object.values(Core.ITEMS).filter(function (item) { return item.rarity === rarity && typeOk(item, type); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function giftRequest(draft, studentId, classId, id) {
    var body = { type: 'items', command: 'gift', studentId: studentId, id: id, quantity: Math.max(1, Math.min(20, parseInt(draft.quantity, 10) || 1)), itemType: draft.itemType || 'any' };
    if (classId) body.classId = classId;
    if (draft.itemId && Core.itemById(draft.itemId)) body.itemId = draft.itemId;
    else body.rarity = draft.rarity || 'random';
    return body;
  }
  function sourceLabel(source) { return SOURCES[source] || (String(source || 'battle').replace(/-/g, ' ')); }
  function when(ms) {
    if (!Number.isFinite(ms)) return '';
    var d = new Date(ms);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function isGuestHero(hero) { var id = String(hero && hero.studentId || ''); return !id || /^wheel-/.test(id); }

  /* ---- the desk ---- */
  var cache = {}, drafts = {}, desks = {};
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() { return root().crypto && root().crypto.randomUUID ? root().crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  function root() { return typeof window !== 'undefined' ? window : globalThis; }
  function icon(item) { var d = root().ClassroomBattleDisplay; return d && item ? d.itemIcon(item) : '<span class="cbPixelIcon">◆</span>'; }
  function draftFor(studentId) { return drafts[studentId] || (drafts[studentId] = { rarity: 'random', itemType: 'any', itemId: '', quantity: 1 }); }
  function entryFor(key) { return cache[key] || (cache[key] = { rows: null, owned: {}, total: 0, at: 0, loading: false, error: '' }); }

  async function load(desk, key, force) {
    var c = entryFor(key);
    if (c.loading || (!force && c.rows && Date.now() - c.at < CACHE_MS)) return;
    c.loading = true; c.error = ''; paint(desk);
    try {
      var result = await desk.opts.request(key === 'guests' ? { type: 'items', command: 'history', guests: true } : { type: 'items', command: 'history', studentId: key });
      if (!result || !Array.isArray(result.rows)) throw new Error('The drop history could not be read. Try again.');
      c.rows = result.rows; c.owned = result.owned || {}; c.total = result.total || result.rows.length; c.at = Date.now();
    } catch (e) { c.error = e && e.message ? e.message : String(e); }
    finally { c.loading = false; if (desks[desk.opts.studentId] === desk) paint(desk); }
  }
  function rowHtml(row, desk, guestList) {
    var item = Core.itemById(row.itemId), restored = row.restored || [], owned = guestList ? null : (desk.ownedNow[row.itemId] || 0);
    var last = restored[restored.length - 1];
    var button = desk.opts.locked ? '' : guestList
      ? '<button type="button" data-hi-restore="' + esc(row.dropId) + '" data-hi-again="' + (restored.length ? '1' : '') + '">↩ Give to ' + esc(desk.opts.name) + '</button>'
      : row.kind === 'restore' ? '' : '<button type="button" data-hi-restore="' + esc(row.dropId) + '" data-hi-again="' + (restored.length ? '1' : '') + '">' + (restored.length ? '↩ Restore again' : '↩ Restore') + '</button>';
    return '<li class="hiRow cbRarity-' + esc(row.rarity) + '">' + icon(item) +
      '<div class="hiRowText"><strong>' + esc(row.itemName || (item && item.name) || row.itemId) + (row.quantity > 1 ? ' ×' + row.quantity : '') + '</strong>' +
      '<small>' + esc(rarityName(row.rarity)).toUpperCase() + ' · ' + esc(sourceLabel(row.source)) + (guestList ? ' · went to “' + esc(row.name) + '”' : '') + (row.classId ? ' · ' + esc(row.classId) : '') + ' · ' + esc(when(row.createdAt)) + '</small>' +
      (row.restoredFrom && row.restoredFrom !== desk.opts.name ? '<small>Restored from “' + esc(row.restoredFrom) + '”</small>' : '') +
      (last ? '<small class="hiDone">✓ Restored' + (restored.length > 1 ? ' ×' + restored.length : '') + (last.name ? ' to ' + esc(last.name) : '') + ' · ' + esc(when(last.at)) + '</small>' : '') +
      (owned !== null ? '<small class="hiOwned">Owns ×' + owned + ' now</small>' : '') + '</div>' + button + '</li>';
  }
  function listHtml(desk, key, guestList) {
    var c = entryFor(key);
    if (c.error) return '<p class="hiError" role="alert">' + esc(c.error) + ' <button type="button" data-hi-reload="' + esc(key) + '">Try again</button></p>';
    if (!c.rows) return '<p class="hiQuiet">' + (c.loading ? 'Reading the drop ledger…' : '') + '</p>';
    if (!c.rows.length) return '<p class="hiQuiet">' + (guestList ? 'No drops went to an unlinked wheel name.' : 'No drops are recorded yet. Every new drop, gift and restore is kept here permanently.') + '</p>';
    return '<ul class="hiRows">' + c.rows.slice(0, desk.showAll[key] ? c.rows.length : SHOWN_ROWS).map(function (row) { return rowHtml(row, desk, guestList); }).join('') + '</ul>' +
      (c.rows.length > SHOWN_ROWS && !desk.showAll[key] ? '<button type="button" class="hiMore" data-hi-more="' + esc(key) + '">Show all ' + c.rows.length + '</button>' : '') +
      (c.total > c.rows.length ? '<p class="hiQuiet">Showing the newest ' + c.rows.length + ' of ' + c.total + '.</p>' : '');
  }
  function paint(desk) {
    var node = desk.node, o = desk.opts;
    if (!node || !node.isConnected) return;
    if (o.guest) {
      node.innerHTML = '<section class="hiDesk"><h4>🎁 Items <span>Unlinked wheel name</span></h4><p class="hiQuiet">“' + esc(o.name) + '” is a wheel name that is not linked to a register student, so its treasure is not saved to anyone. Open the right student’s journal and use <b>Drops to unlinked wheel names</b> to give it to them.</p></section>';
      return;
    }
    var d = draftFor(o.studentId), pool = poolFor(d.rarity, d.itemType), locked = o.locked || desk.busy;
    if (d.itemId && !pool.some(function (item) { return item.id === d.itemId; })) d.itemId = '';
    var own = entryFor(o.studentId);
    desk.ownedNow = own.owned || {};
    node.innerHTML = '<section class="hiDesk" aria-busy="' + !!desk.busy + '">' +
      '<h4>🎁 Give an item <span>Teacher only</span></h4>' +
      '<div class="hiGift">' +
      '<label>Rarity<select data-hi-field="rarity"' + (locked ? ' disabled' : '') + '><option value="random"' + (d.rarity === 'random' ? ' selected' : '') + '>🎲 Random (drop odds)</option>' +
        rarityKeys().map(function (key) { return '<option value="' + key + '"' + (d.rarity === key ? ' selected' : '') + '>' + esc(rarityName(key)) + '</option>'; }).join('') + '</select></label>' +
      '<label>Type<select data-hi-field="itemType"' + (locked ? ' disabled' : '') + '>' + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (d.itemType === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="hiWide">Item<select data-hi-field="itemId"' + (locked || d.rarity === 'random' ? ' disabled' : '') + '><option value="">' + (d.rarity === 'random' ? 'Rolled by the server' : 'Any ' + esc(rarityName(d.rarity)).toLowerCase() + ' item (' + pool.length + ')') + '</option>' +
        pool.map(function (item) { return '<option value="' + esc(item.id) + '"' + (d.itemId === item.id ? ' selected' : '') + '>' + esc(item.name) + ' · ' + esc(item.type === 'equipment' ? (root().ClassroomBattleDisplay ? root().ClassroomBattleDisplay.slotName(Core.equipmentSlot(item)) : 'Equipment') : item.type) + '</option>'; }).join('') + '</select></label>' +
      '<label>Copies<input type="number" min="1" max="20" step="1" inputmode="numeric" data-hi-field="quantity" value="' + esc(d.quantity) + '"' + (locked ? ' disabled' : '') + '></label>' +
      '<button type="button" class="hiGive" data-hi-give' + (locked ? ' disabled' : '') + '>🎁 Give to ' + esc(o.name) + '</button>' +
      '</div>' +
      (desk.message ? '<p class="hiMessage" role="status">' + desk.message + '</p>' : '') +
      (desk.error ? '<p class="hiError" role="alert">' + esc(desk.error) + '</p>' : '') +
      '<h4>📜 Drop history <span>Permanent · ' + (own.total || 0) + ' recorded</span></h4>' +
      '<p class="hiQuiet">Every treasure drop, gift and restore is written down the moment it is saved and never erased. If an item has gone missing, restore it from here.</p>' +
      listHtml(desk, o.studentId, false) +
      '<details class="hiGuests"' + (desk.guestsOpen ? ' open' : '') + '><summary data-hi-guests>Drops to unlinked wheel names</summary>' +
      '<p class="hiQuiet">Treasure won by a wheel name that was not linked to a register student. Give a drop to ' + esc(o.name) + ' if it was theirs.</p>' +
      (desk.guestsOpen ? listHtml(desk, 'guests', true) : '') + '</details>' +
      '</section>';
  }
  async function give(desk) {
    var o = desk.opts, d = draftFor(o.studentId);
    if (o.locked || desk.busy) return;
    var id = desk.pendingGift && JSON.stringify(desk.pendingGift.draft) === JSON.stringify(d) ? desk.pendingGift.id : uuid();
    desk.pendingGift = { id: id, draft: JSON.parse(JSON.stringify(d)) };
    desk.busy = true; desk.error = ''; desk.message = 'Saving the gift…'; paint(desk);
    try {
      var result = await o.request(giftRequest(d, o.studentId, o.classId, id));
      var entry = result && result.entry; if (!entry) throw new Error('The gift could not be confirmed. Press Give again to retry the same gift.');
      desk.pendingGift = null;
      desk.message = '🎁 ' + esc(o.name) + ' received <b>' + esc(entry.itemName) + (entry.quantity > 1 ? ' ×' + entry.quantity : '') + '</b> · ' + esc(rarityName(entry.rarity)) + (result.duplicate ? ' (already saved)' : '') + '.';
      entryFor(o.studentId).at = 0; load(desk, o.studentId, true);
      if (o.onChanged) o.onChanged(result);
    } catch (e) { desk.message = ''; desk.error = e && e.message ? e.message : String(e); }
    finally { desk.busy = false; paint(desk); }
  }
  async function restore(desk, dropId, again) {
    var o = desk.opts;
    if (o.locked || desk.busy) return;
    if (again && !(root().confirm ? root().confirm('This drop was already restored. Give ' + o.name + ' another copy?') : false)) return;
    var id = desk.pendingRestore && desk.pendingRestore.dropId === dropId && desk.pendingRestore.again === !!again ? desk.pendingRestore.id : uuid();
    desk.pendingRestore = { id: id, dropId: dropId, again: !!again };
    desk.busy = true; desk.error = ''; desk.message = 'Restoring…'; paint(desk);
    try {
      var body = { type: 'items', command: 'restore', studentId: o.studentId, dropId: dropId, id: id };
      if (again) body.again = true;
      if (o.classId) body.classId = o.classId;
      var result = await o.request(body);
      if (!result || !result.entry) throw new Error('The restore could not be confirmed. Press Restore again to retry it.');
      desk.pendingRestore = null;
      desk.message = '↩ Restored <b>' + esc(result.entry.itemName) + (result.entry.quantity > 1 ? ' ×' + result.entry.quantity : '') + '</b> to ' + esc(o.name) + '.';
      entryFor(o.studentId).at = 0; entryFor('guests').at = 0; load(desk, o.studentId, true); if (desk.guestsOpen) load(desk, 'guests', true);
      if (o.onChanged) o.onChanged(result);
    } catch (e) { desk.message = ''; desk.error = e && e.message ? e.message : String(e); }
    finally { desk.busy = false; paint(desk); }
  }
  function bind(desk) {
    var node = desk.node;
    node.addEventListener('change', function (e) {
      var field = e.target.closest('[data-hi-field]'); if (!field) return;
      var d = draftFor(desk.opts.studentId), name = field.dataset.hiField;
      d[name] = name === 'quantity' ? Math.max(1, Math.min(20, parseInt(field.value, 10) || 1)) : field.value;
      if (name === 'rarity' || name === 'itemType') d.itemId = '';
      // Copies need no redraw; the rest redraw after this event, never inside
      // it (removing a focused field fires blur/change into a half-set node).
      if (name !== 'quantity') { desk.message = ''; desk.error = ''; setTimeout(function () { paint(desk); }, 0); }
    });
    node.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-hi-give]') && !t.closest('[data-hi-give]').disabled) give(desk);
      var r = t.closest('[data-hi-restore]'); if (r && !r.disabled) restore(desk, r.dataset.hiRestore, !!r.dataset.hiAgain);
      var reload = t.closest('[data-hi-reload]'); if (reload) load(desk, reload.dataset.hiReload, true);
      var more = t.closest('[data-hi-more]'); if (more) { desk.showAll[more.dataset.hiMore] = true; paint(desk); }
      if (t.closest('[data-hi-guests]')) { e.preventDefault(); desk.guestsOpen = !desk.guestsOpen; paint(desk); if (desk.guestsOpen) load(desk, 'guests'); }
    });
  }
  /* Mount into a node the host rebuilds freely. Drafts, messages and the
     fetched history survive the rebuild; only a new student refetches. */
  function mount(node, opts) {
    if (!node || !opts || !opts.request) return null;
    var guest = isGuestHero(opts.hero || { studentId: opts.studentId });
    var keyId = guest ? 'guest:' + (opts.name || '') : opts.studentId;
    var desk = desks[keyId] || { busy: false, message: '', error: '', showAll: {}, guestsOpen: false, ownedNow: {} };
    desk.node = node; desk.opts = Object.assign({}, opts, { guest: guest, studentId: guest ? '' : opts.studentId });
    desks[keyId] = desk;
    if (desk.opts.studentId) desks[desk.opts.studentId] = desk;
    bind(desk); paint(desk);
    if (!guest) { load(desk, desk.opts.studentId); if (desk.guestsOpen) load(desk, 'guests'); }
    return desk;
  }
  function reset() { cache = {}; drafts = {}; desks = {}; }
  return { mount: mount, reset: reset, pure: { rarityKeys: rarityKeys, poolFor: poolFor, giftRequest: giftRequest, sourceLabel: sourceLabel, isGuestHero: isGuestHero, TYPES: TYPES } };
});
