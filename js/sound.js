/* Aurora — soft focus sounds.
   A very short, low-volume tick when the focus moves between selectable items,
   similar to the Apple TV. The AudioContext is created lazily on the first key
   press so the TV's autoplay policy is satisfied. */
(function (A) {
  'use strict';

  var context = null;
  var lastTick = 0;

  function enabled() {
    try {
      return !A.Config || !A.Config.get || A.Config.get().ui.navSounds !== false;
    } catch (e) {
      return true;
    }
  }

  function audio() {
    if (context) return context;
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try { context = new AudioCtor(); } catch (e) { context = null; }
    return context;
  }

  function tick(kind) {
    if (!enabled()) return;
    var now = Date.now();
    if (now - lastTick < 45) return;
    lastTick = now;

    var ctx = audio();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        var resumed = ctx.resume();
        if (resumed && resumed.catch) resumed.catch(function () {});
      } catch (e) { /* keep trying next time */ }
    }

    try {
      var start = ctx.currentTime + 0.001;
      var high = kind === 'back' ? 740 : 1180;
      var low = kind === 'back' ? 560 : 900;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(high, start);
      osc.frequency.exponentialRampToValueAtTime(low, start + 0.045);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.03, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.065);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.08);
      osc.onended = function () {
        try { osc.disconnect(); gain.disconnect(); } catch (e) { /* ignore */ }
      };
    } catch (e) { /* audio is optional */ }
  }

  A.Sound = { tick: tick };
})(window.Aurora = window.Aurora || {});
