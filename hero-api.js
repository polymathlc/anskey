/* Authenticated server API. Hero ownership/progression is never client writable. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClassroomHeroAPI = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  'use strict';
  var ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/ansKeyHeroes';
  function create(options) {
    options = options || {};
    return { request: async function(body, lifecycle) {
      lifecycle = lifecycle || {};
      function canSend() { if (lifecycle.canSend && !lifecycle.canSend()) throw new Error('The lesson or signed-in account changed. Try again from the current wheel.'); }
      canSend();
      var user = options.getUser ? options.getUser() : root && root.currentUser;
      if (!user || !user.uid) throw new Error('Sign in to open My Hero.');
      var appCheck = options.appCheckToken || (root && root.liveAppCheckToken);
      if (!appCheck) throw new Error('Hero verification is loading. Try again shortly.');
      var tokens = await Promise.all([user.getIdToken(), appCheck()]);
      if ((options.getUser ? options.getUser() : root.currentUser) !== user) throw new Error('The signed-in account changed. Open My Hero again.');
      canSend();
      var response = await (options.fetch || root.fetch)(options.endpoint || ENDPOINT, {
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokens[0],'X-Firebase-AppCheck':tokens[1]},body:JSON.stringify(body),...(lifecycle.signal ? {signal:lifecycle.signal} : {})
      });
      var data;
      try { data = await response.json(); } catch (_) { throw new Error('My Hero is unavailable. Try again shortly.'); }
      if (!response.ok || data.error) {
        var error = new Error(data.error && data.error.message || 'My Hero could not save that change. Try again.');
        error.code = data.error && data.error.code; error.status = response.status; throw error;
      }
      if ((options.getUser ? options.getUser() : root.currentUser) !== user) throw new Error('The signed-in account changed. Open My Hero again.');
      return data;
    }};
  }
  return Object.assign(create(),{create:create,ENDPOINT:ENDPOINT});
});
