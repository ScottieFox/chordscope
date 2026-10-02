/* ───────────────────────── CHORD//SCOPE · player piano ─────────────────────────
   Plays a track ({notes: [{m, vel, t, d}] in seconds, pedals: [{t, down}], duration}).
   Sound is scheduled ahead on the audio clock and MIDI THRU gets exact timestamps, so the
   timing stays tight; keys, chord names and the roll are updated when each note is due.
   Hooks (h):
     now()                     performance.now()
     noteOn(m, vel, atMs)      start a piano voice at that moment → voice handle (or null)
     release(voice, quick)     let a voice go (damper), quickly when stopping
     thru(bytes, atMs)         MIDI out
     key(on, m, vel)           show / hide a key (and feed the chord display)
     pedal(down)               sustain pedal
     state()                   called on play / pause / end                              */
(function (G) {
  'use strict';
  const LOOKAHEAD = 150; // ms of notes scheduled in advance
  const LEAD_IN = 90; // ms between pressing play and the first note

  function create(h) {
    let track = null, events = [], idx = 0, playing = false, pos = 0, speed = 1, t0 = 0, p0 = 0, timer = 0;
    const timeouts = new Set();
    const voices = new Map(); // note → piano voice
    const keyCount = new Map(); // midi → notes currently showing on that key
    const thruOn = new Map(); // midi → note-ons sent through THRU
    const sounding = new Set(); // notes currently sounding (for the roll)
    let pedalDown = false;
    let lastThruAt = 0; // the latest timestamp handed to MIDI THRU (messages queued ahead)
    const thru = (bytes, at) => { lastThruAt = Math.max(lastThruAt, at); h.thru(bytes, at); };

    function load(tr) {
      stop();
      track = tr;
      events = [];
      if (tr) {
        for (const n of tr.notes) { events.push({ t: n.t, k: 2, n }, { t: n.t + n.d, k: 0, n }); }
        for (const p of tr.pedals || []) events.push({ t: p.t, k: 1, down: p.down });
        events.sort((a, b) => a.t - b.t || a.k - b.k); // at one instant: note-offs, pedal, note-ons
      }
      pos = 0;
      h.state && h.state();
    }
    function position() { return playing ? Math.max(0, p0 + ((h.now() - t0) / 1000) * speed) : pos; }
    const later = (ms, fn) => { const id = setTimeout(() => { timeouts.delete(id); fn(); }, Math.max(0, ms)); timeouts.add(id); };

    function play() {
      if (!track || playing || !events.length) return false;
      if (pos >= track.duration - 0.02) pos = 0;
      playing = true;
      p0 = pos; t0 = h.now() + LEAD_IN;
      // first event at or after the position; carry the pedal state across a seek
      let lo = 0, hi = events.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].t < pos - 1e-6) lo = mid + 1; else hi = mid; }
      idx = lo;
      let ped = false;
      for (let i = 0; i < idx; i++) if (events[i].k === 1) ped = events[i].down;
      if (ped !== pedalDown) { pedalDown = ped; h.pedal(ped); thru([0xb0, 64, ped ? 127 : 0], h.now()); }
      timer = setInterval(tick, 20);
      tick();
      h.state && h.state();
      return true;
    }
    function tick() {
      if (!playing) return;
      const now = h.now(), horizon = now + LOOKAHEAD;
      while (idx < events.length) {
        const e = events[idx], at = t0 + ((e.t - p0) * 1000) / speed;
        if (at > horizon) break;
        idx++;
        fire(e, Math.max(at, now));
      }
      if (idx >= events.length && !sounding.size && position() >= track.duration) end();
    }
    function fire(e, at) {
      const delay = at - h.now();
      if (e.k === 2) {
        const n = e.n, v = h.noteOn(n.m, n.vel, at);
        if (v) voices.set(n, v);
        thru([0x90, n.m, Math.max(1, Math.min(127, Math.round(n.vel * 127)))], at);
        thruOn.set(n.m, (thruOn.get(n.m) || 0) + 1);
        later(delay, () => {
          sounding.add(n);
          keyCount.set(n.m, (keyCount.get(n.m) || 0) + 1);
          h.key(true, n.m, n.vel);
        });
      } else if (e.k === 0) {
        const n = e.n;
        thru([0x80, n.m, 0], at);
        const c = (thruOn.get(n.m) || 1) - 1;
        if (c > 0) thruOn.set(n.m, c); else thruOn.delete(n.m);
        later(delay, () => {
          sounding.delete(n);
          const k = (keyCount.get(n.m) || 1) - 1;
          if (k > 0) keyCount.set(n.m, k); else { keyCount.delete(n.m); h.key(false, n.m); }
          const v = voices.get(n);
          if (v) { h.release(v, false); voices.delete(n); }
        });
      } else {
        thru([0xb0, 64, e.down ? 127 : 0], at);
        later(delay, () => { pedalDown = e.down; h.pedal(e.down); });
      }
    }
    function silence() {
      clearInterval(timer); timer = 0;
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
      for (const v of voices.values()) h.release(v, true);
      voices.clear();
      // note-ons may already be queued in the MIDI output for a moment from now: the matching
      // note-offs (and pedal up) have to land after them, or the external instrument hangs
      const at = Math.max(h.now(), lastThruAt + 1);
      for (const m of thruOn.keys()) thru([0x80, m, 0], at);
      thruOn.clear();
      for (const m of keyCount.keys()) h.key(false, m);
      keyCount.clear();
      sounding.clear();
      if (pedalDown) { pedalDown = false; thru([0xb0, 64, 0], at); h.pedal(false); }
      else if (lastThruAt > h.now()) thru([0xb0, 64, 0], at); // a queued pedal-down
    }
    function pause() {
      if (!playing) return;
      pos = Math.min(track ? track.duration : 0, position());
      playing = false;
      silence();
      h.state && h.state();
    }
    function stop() {
      const was = playing;
      playing = false;
      silence();
      pos = 0;
      if (was) h.state && h.state();
    }
    function end() { playing = false; silence(); pos = 0; h.state && h.state(true); }
    function seek(t) {
      const was = playing;
      if (was) { playing = false; silence(); }
      pos = Math.max(0, Math.min(track ? track.duration : 0, t));
      if (was) play(); else h.state && h.state();
    }
    function setSpeed(s) {
      if (s === speed) return;
      const was = playing;
      if (was) { pos = position(); playing = false; silence(); }
      speed = s;
      if (was) play();
    }
    return {
      load, play, pause, stop, seek, setSpeed, position,
      toggle() { return playing ? (pause(), false) : play(); },
      get playing() { return playing; },
      get track() { return track; },
      get speed() { return speed; },
      get sounding() { return sounding; },
    };
  }
  G.CSPlayer = { create };
})(typeof window !== 'undefined' ? window : globalThis);
