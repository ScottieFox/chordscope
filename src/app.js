/* ───────────────────────── CHORD//SCOPE · app ─────────────────────────
   Web MIDI in → chord engine → LCD (grand staff + chord name) + keyboard.
   SHOW builds chords from menus; SCORE writes what you play onto manuscript;
   the transport records sessions (export MusicXML / MIDI / PDF), runs the
   metronome, and plays imported MIDI / MusicXML files on the keys (ROLL);
   PIANO plays sampled grand-piano notes.                                   */
(() => {
  'use strict';
  const E = window.ChordEngine;
  const GL = window.CS_GLYPHS;
  const $ = (id) => document.getElementById(id);
  const mod12 = (x) => ((x % 12) + 12) % 12;
  const WHITE = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
  const isWhite = (m) => WHITE[mod12(m)] === 1;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ───────── settings (persisted) ─────────
  const STORE_KEY = 'chordscope.v1';
  const DEF = {
    inName: '__all__', thruName: '', channel: 'omni', mode: 'live', piano: false, volume: 0.75, reverb: 0.25,
    spelling: 'auto', range: 88, pedalHold: false, holdLast: true, labels: true, qwerty: true, qOct: 3,
    show: { root: 'C', type: 'm', mods: [], inversion: 0, bass: '' },
    score: { view: 'page', grid: 2, symbols: true, idle: true },
    metro: { bpm: 90, beats: 4, click: true },
    keys: { live: true, show: true, score: true, roll: true },
    rollSpeed: 1,
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const S = Object.assign({}, DEF, saved);
  S.show = Object.assign({}, DEF.show, saved.show || {});
  S.score = Object.assign({}, DEF.score, saved.score || {});
  S.metro = Object.assign({}, DEF.metro, saved.metro || {});
  if (!saved.metro && saved.score) { // tempo and metre used to live with the score
    if (saved.score.bpm) S.metro.bpm = saved.score.bpm;
    if (saved.score.beats) S.metro.beats = saved.score.beats;
  }
  delete S.score.bpm; delete S.score.beats; delete S.score.click;
  S.keys = Object.assign({}, DEF.keys, saved.keys || {});
  if (saved.keysV !== 2) S.keys = Object.assign({}, DEF.keys); // on-screen piano now shows in every mode by default
  S.keysV = 2;
  if (!['page', 'scroll'].includes(S.score.view)) S.score.view = 'page';
  S.metro.bpm = clamp(Math.round(+S.metro.bpm) || 90, 30, 240);
  S.metro.beats = [2, 3, 4].includes(+S.metro.beats) ? +S.metro.beats : 4;
  if (![0.5, 0.75, 1, 1.25].includes(+S.rollSpeed)) S.rollSpeed = 1;
  if (![1, 2].includes(+S.score.grid)) S.score.grid = 2;
  if (!E.TYPE_BY_ID[S.show.type]) S.show.type = 'm';
  if (!E.ROOTS.includes(S.show.root)) S.show.root = 'C';
  if (!Array.isArray(S.show.mods)) S.show.mods = [];
  if (![88, 76, 61, 49].includes(+S.range)) S.range = 88;
  if (!['auto', 'sharp', 'flat'].includes(S.spelling)) S.spelling = 'auto';
  if (!['live', 'show', 'score', 'roll'].includes(S.mode)) S.mode = 'live';
  let saveTimer = 0;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }, 150);
  };

  // ───────── piano: Salamander Grand Piano samples (additive synth only as a fallback) ─────────
  // 30 recorded notes, one every minor third, are embedded in the page (#piano-samples) and decoded
  // once. Each key plays its nearest recording, re-pitched by at most a semitone. Soft notes close a
  // low-pass filter so they get darker as well as quieter, the way a real hammer does.
  class Piano {
    constructor() { this.ctx = null; this.voices = new Map(); this.pedal = false; this.buffers = null; this.ready = null; this.mode = 'off'; }
    init(ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const c = (this.ctx = ctx || new AC({ latencyHint: 'interactive' }));
      this.sbus = c.createGain(); // sampled voices: straight to the room
      this.bus = c.createGain(); // fallback synth voices: through a little EQ
      const low = c.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 220; low.gain.value = 2.5;
      const high = c.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 5200; high.gain.value = -3;
      this.dry = c.createGain(); this.wet = c.createGain();
      this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.6);
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -10; this.comp.knee.value = 8; this.comp.ratio.value = 4;
      this.comp.attack.value = 0.003; this.comp.release.value = 0.22;
      this.master = c.createGain();
      this.bus.connect(low); low.connect(high); high.connect(this.dry); high.connect(this.verb);
      this.sbus.connect(this.dry); this.sbus.connect(this.verb);
      this.verb.connect(this.wet);
      this.dry.connect(this.comp); this.wet.connect(this.comp); this.comp.connect(this.master); this.master.connect(c.destination);
      this.setVolume(S.volume); this.setReverb(S.reverb);
      this.mode = 'loading';
      this.ready = this.loadSamples();
      return this;
    }
    loadSamples() {
      let data = null;
      try { const el = document.getElementById('piano-samples'); data = el ? JSON.parse(el.textContent) : null; } catch (e) { data = null; }
      if (!data || !data.samples) return Promise.resolve(this.useSynth());
      const jobs = Object.keys(data.samples).map((k) => {
        const bin = atob(data.samples[k]), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return this.ctx.decodeAudioData(u8.buffer).then((buf) => [+k, buf]);
      });
      return Promise.all(jobs).then((list) => {
        this.buffers = new Map(list);
        this.sampleKeys = list.map((x) => x[0]).sort((a, b) => a - b);
        this.mode = 'sampled';
        return true;
      }).catch(() => this.useSynth());
    }
    whenReady() { return this.ready || Promise.resolve(false); }
    useSynth() { // no samples (or this browser can't decode them): build the additive synth instead
      const c = this.ctx;
      const nb = c.createBuffer(1, Math.floor(c.sampleRate * 0.2), c.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      this.noise = nb;
      this.phases = Array.from({ length: 8 }, (_, i) => {
        const ph = (i / 8) * Math.PI * 2;
        return c.createPeriodicWave(new Float32Array([0, Math.sin(ph)]), new Float32Array([0, Math.cos(ph)]), { disableNormalization: true });
      });
      this.mode = 'synth';
      return false;
    }
    setVolume(v) { if (this.master) this.master.gain.setTargetAtTime(v * v * 1.6, this.ctx.currentTime, 0.02); }
    setReverb(r) {
      if (!this.wet) return;
      this.wet.gain.setTargetAtTime(r * 0.9, this.ctx.currentTime, 0.02);
      this.dry.gain.setTargetAtTime(1 - r * 0.35, this.ctx.currentTime, 0.02);
    }
    impulse(sec) {
      const c = this.ctx, rate = c.sampleRate, len = Math.floor(rate * sec), pre = Math.floor(rate * 0.012);
      const buf = c.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / rate, x = i / len;
          lp += (Math.random() * 2 - 1 - lp) * (0.62 - 0.55 * x); // darker as it decays
          d[i] = lp * Math.exp(-t * 3.1) * (1 - x) * Math.min(1, t / 0.006);
        }
        for (const [ms, g] of [[9, 0.5], [17, 0.32], [23, 0.26], [31, 0.2], [43, 0.14]]) {
          const k = pre + Math.floor(((ms + ch * 1.7) * rate) / 1000);
          if (k < len) d[k] += g * (ch ? -1 : 1);
        }
      }
      return buf;
    }
    // when: AudioContext time to start (the player schedules ahead); returns the voice
    noteOn(m, vel, when) {
      if (!this.ctx) return null;
      if (this.mode === 'sampled') return this.sampleOn(m, vel, when);
      if (this.mode === 'synth') return this.synthOn(m, vel, when);
      return null; // 'loading': the recordings are still being decoded (a moment after start-up)
    }
    start(m, when) { // retire the key's previous voice and make room for the new one
      const t = Math.max(this.ctx.currentTime + 0.003, when || 0);
      const prev = this.voices.get(m);
      if (prev) this.fade(prev, t, 0.03);
      if (this.voices.size >= 64) this.fade(this.voices.values().next().value, this.ctx.currentTime, 0.04);
      return t;
    }
    sampleOn(m, vel, when) {
      const c = this.ctx, t = this.start(m, when);
      const v = clamp(vel, 0.04, 1);
      let s = this.sampleKeys[0];
      for (const k of this.sampleKeys) if (Math.abs(k - m) < Math.abs(s - m)) s = k;
      const src = c.createBufferSource();
      src.buffer = this.buffers.get(s);
      src.playbackRate.value = Math.pow(2, (m - s) / 12);
      // the recordings are mezzo-forte: softer playing closes the filter (darker), harder opens it fully
      const f0 = 440 * Math.pow(2, (m - 69) / 12);
      const open = clamp((v - 0.12) / 0.6, 0, 1);
      const tone = c.createBiquadFilter();
      tone.type = 'lowpass'; tone.Q.value = 0.5;
      tone.frequency.value = Math.min(20000, Math.max(f0 * 3, 650) * Math.pow(2, 4.6 * open));
      const out = c.createGain();
      out.gain.value = 0.03 + 0.72 * Math.pow(v, 1.6);
      src.connect(tone); tone.connect(out); out.connect(this.sbus);
      const voice = { m, out, nodes: [src], sustain: false, done: false, t0: t };
      src.onended = () => { try { out.disconnect(); } catch (e) { /* already gone */ } if (this.voices.get(m) === voice) this.voices.delete(m); };
      src.start(t);
      this.voices.set(m, voice);
      return voice;
    }
    synthOn(m, vel, when) {
      const c = this.ctx, t = this.start(m, when);
      const v = clamp(vel, 0.04, 1);
      const f0 = 440 * Math.pow(2, (m - 69) / 12);
      const reg = clamp((m - 21) / 87, 0, 1);
      const out = c.createGain();
      const tone = c.createBiquadFilter();
      tone.type = 'lowpass'; tone.Q.value = 0.2;
      tone.frequency.value = Math.min(16000, 700 + f0 * (3 + 16 * v * v));
      out.connect(tone);
      let tail = tone;
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp((m - 62) / 52, -0.55, 0.55); tone.connect(p); tail = p; }
      tail.connect(this.bus);
      const B = 0.00012 * Math.pow(2, (m - 60) / 18) + (m < 40 ? 0.00012 : 0); // string stiffness → stretched partials
      const T60 = clamp(24 * Math.pow(2, -(m - 21) / 24), 1.2, 24);
      const nMax = m < 33 ? 42 : m < 40 ? 34 : m < 48 ? 26 : m < 60 ? 20 : m < 72 ? 15 : m < 84 ? 10 : 6;
      const fMax = Math.min(c.sampleRate * 0.45, 7000 + 9000 * v);
      const strike = 0.12 + 0.02 * reg, tilt = 1.15 - 0.45 * v;
      const parts = [];
      for (let k = 1; k <= nMax; k++) {
        const fk = k * f0 * Math.sqrt(1 + B * k * k);
        if (fk > fMax) break;
        let a = Math.abs(Math.sin(Math.PI * k * strike)) / Math.pow(k, tilt);
        if (k === 1 && m < 40) a *= 0.55;
        if (a > 0.004) parts.push([k, fk, a]);
      }
      const norm = 1 / Math.sqrt(parts.reduce((s, p) => s + p[2] * p[2], 0) || 1);
      const amp = 0.12 * Math.pow(v, 1.8) * (1 + 0.5 * Math.max(0, (52 - m) / 31)) * (1 - 0.3 * Math.max(0, (m - 84) / 24));
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(amp * norm, t + 0.0025);
      const tau1 = 0.06 + 0.4 * Math.pow(1 - reg, 1.5);
      const oscs = [];
      for (const [k, fk, a] of parts) {
        const g = c.createGain();
        const Tk = T60 / (1 + 0.35 * (k - 1) * (0.5 + reg));
        const tau2 = Tk / 6.9, tFast = Math.min(tau1, tau2);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a, t + 0.002);
        g.gain.setTargetAtTime(a * (0.45 + 0.2 * (1 - reg)), t + 0.003, tFast);
        g.gain.setTargetAtTime(0, t + 0.003 + 2 * tFast, tau2);
        g.connect(out);
        const o = c.createOscillator();
        o.setPeriodicWave(this.phases[(k * 3 + m) % 8]);
        o.frequency.value = fk;
        if (k <= 3) {
          const g1 = c.createGain(); g1.gain.value = 0.78; o.connect(g1); g1.connect(g);
          const o2 = c.createOscillator(), g2 = c.createGain();
          o2.setPeriodicWave(this.phases[(k * 5 + m + 3) % 8]);
          o2.frequency.value = fk + (0.3 + 0.12 * k) * (k % 2 ? 1 : -1);
          g2.gain.value = 0.22; o2.connect(g2); g2.connect(g); o2.start(t); oscs.push(o2);
        } else o.connect(g);
        o.start(t); oscs.push(o);
      }
      const ns = c.createBufferSource(); ns.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7; bp.frequency.value = Math.min(5000, 900 + f0 * 1.8);
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.25 * v * v / norm, t);
      ng.gain.setTargetAtTime(0, t, 0.008 + 0.01 * (1 - reg));
      ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + 0.12);
      const voice = { m, out, nodes: oscs, sustain: false, done: false, t0: t };
      const end = t + T60 * 1.15;
      for (const o of oscs) o.stop(end);
      if (oscs.length) oscs[oscs.length - 1].onended = () => { try { out.disconnect(); } catch (e) { /* already gone */ } if (this.voices.get(m) === voice) this.voices.delete(m); };
      this.voices.set(m, voice);
      return voice;
    }
    fade(voice, t, tau) {
      if (voice.done) return;
      voice.done = true;
      const g = voice.out.gain;
      if (voice.t0 != null && t < voice.t0 - 0.001) { // scheduled but not started yet: make sure it never sounds
        g.cancelScheduledValues(0);
        g.setValueAtTime(0, this.ctx.currentTime);
        for (const n of voice.nodes) { try { n.stop(voice.t0); } catch (e) { /* stopped */ } }
      } else {
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
        g.setTargetAtTime(0, t, tau);
        for (const n of voice.nodes) { try { n.stop(t + tau * 9); } catch (e) { /* stopped */ } }
      }
      if (this.voices.get(voice.m) === voice) this.voices.delete(voice.m);
    }
    noteOff(m) {
      const v = this.voices.get(m);
      if (v) this.release(v);
    }
    release(v, quick) { // let one voice go: the damper falls (or it waits for the pedal)
      if (!v || v.done) return;
      if (quick) { this.fade(v, this.ctx.currentTime, 0.03); return; }
      if (this.pedal) { v.sustain = true; return; }
      // dampers: the top strings have none and ring on; bass dampers take a little longer to settle
      this.fade(v, this.ctx.currentTime, v.m >= 89 ? 0.9 : v.m < 40 ? 0.16 : 0.085);
    }
    ctxTime(ms) { return this.ctx.currentTime + (ms - performance.now()) / 1000; }
    setPedal(down) {
      this.pedal = down;
      if (down || !this.ctx) return;
      for (const v of [...this.voices.values()]) if (v.sustain && !isHeld(v.m)) this.release(v);
    }
    allOff() { if (this.ctx) for (const v of [...this.voices.values()]) this.fade(v, this.ctx.currentTime, 0.05); }
  }
  const piano = new Piano();
  function ensureAudio() {
    try {
      if (!piano.ctx) { piano.init(); piano.whenReady().then(() => frame()); }
      if (piano.ctx.state !== 'running') piano.ctx.resume().then(() => frame());
      return true;
    } catch (e) { return false; }
  }

  // ───────── accidental glyphs inline in text ─────────
  const CHAR_KEY = { '♭': 'flat', '♯': 'sharp', '𝄫': 'dflat', '𝄪': 'dsharp' };
  function accInline(key) {
    const [x0, y0, x1, y1] = GL[key].bbox, EM = 0.27;
    const lift = 0.4 - y1 * EM;
    return `<svg class="acc" viewBox="${x0} ${y0} ${(x1 - x0).toFixed(3)} ${(y1 - y0).toFixed(3)}" style="width:${((x1 - x0) * EM).toFixed(3)}em;height:${((y1 - y0) * EM).toFixed(3)}em;vertical-align:${lift.toFixed(3)}em"><use href="#g-${key}"/></svg>`;
  }
  const accHTML = (s) => esc(s).replace(/𝄫|𝄪|♭|♯/gu, (ch) => accInline(CHAR_KEY[ch]));

  // ───────── grand staff ─────────
  // units: 1 = one staff space. Diatonic step = octave*7 + letter (C4 = 28).
  const ST = { T: 5, GAP: 4.5, W: 12.8, H: 22.5, NW: 1.688, COL: 1.72 };
  const BASS_TOP = ST.T + 4 + ST.GAP;
  const yT = (s) => ST.T + (38 - s) / 2;
  const yB = (s) => BASS_TOP + (26 - s) / 2;
  const ACC_KEY = { '-2': 'dflat', '-1': 'flat', '1': 'sharp', '2': 'dsharp' };
  const staffSvg = $('staff');

  function initStaff() {
    const defs = ['gClef', 'fClef', 'brace', 'noteheadWhole', 'flat', 'natural', 'sharp', 'dsharp', 'dflat'].map((k) => `<path id="g-${k}" d="${GL[k].d}"/>`).join('');
    let s = `<defs>${defs}<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="0.22" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
    const x1 = 0.95, x2 = ST.W - 0.3;
    for (let i = 0; i < 5; i++) for (const y of [ST.T + i, BASS_TOP + i]) s += `<line class="sl" x1="${x1}" x2="${x2}" y1="${y}" y2="${y}"/>`;
    s += `<line class="sys" x1="${x1}" x2="${x1}" y1="${ST.T}" y2="${BASS_TOP + 4}"/>`;
    s += `<use href="#g-brace" class="gl" transform="translate(0.12 ${BASS_TOP + 4}) scale(1.9 ${((BASS_TOP + 4 - ST.T) / 3.988).toFixed(4)})"/>`;
    s += `<use href="#g-gClef" class="gl" x="1.45" y="${ST.T + 3}"/>`;
    s += `<use href="#g-fClef" class="gl" x="1.45" y="${BASS_TOP + 1}"/>`;
    s += '<g id="staffNotes"></g>';
    staffSvg.innerHTML = s;
    setStaffBox(0, ST.H);
  }
  let staffBox = '';
  function setStaffBox(y0, y1) {
    const key = y0 + ':' + y1;
    if (key === staffBox) return;
    staffBox = key;
    staffSvg.setAttribute('viewBox', `0 ${y0} ${ST.W} ${y1 - y0}`);
    staffSvg.style.aspectRatio = `${ST.W} / ${y1 - y0}`;
  }

  function layoutGroup(notes, treble) {
    const L = { treble, ns: notes.map((n) => ({ step: n.step, a: n.a, d: n.step, col: 0, acc: null, accCol: 0 })), k: 0, colW: [], accW: 0, maxCol: 0 };
    if (!L.ns.length) return L;
    const steps = L.ns.map((n) => n.step), max = Math.max(...steps), min = Math.min(...steps);
    // beyond ~3 ledger lines, shift by octaves (8va / 15ma) as long as the chord still sits sensibly
    if (treble) { while (L.k < 2 && max - 7 * L.k > 45 && min - 7 * (L.k + 1) >= 28) L.k++; for (const n of L.ns) n.d = n.step - 7 * L.k; }
    else { while (L.k < 2 && min + 7 * L.k < 11 && max + 7 * (L.k + 1) <= 27) L.k++; for (const n of L.ns) n.d = n.step + 7 * L.k; }
    L.ns.sort((p, q) => p.d - q.d || p.a - q.a);
    const last = [];
    for (const n of L.ns) { // seconds and unisons sit on alternate sides
      let c = 0;
      while (last[c] !== undefined && n.d - last[c] <= 1) c++;
      n.col = c; last[c] = n.d;
    }
    for (const n of L.ns) {
      if (n.a !== 0) n.acc = ACC_KEY[n.a];
      else if (L.ns.some((o) => o !== n && o.d === n.d && o.a !== 0)) n.acc = 'natural';
    }
    const cols = [];
    for (const n of L.ns.filter((x) => x.acc).sort((p, q) => q.d - p.d)) {
      let c = 0;
      while ((cols[c] || []).some((o) => Math.abs(o.d - n.d) < 6)) c++;
      (cols[c] = cols[c] || []).push(n); n.accCol = c;
    }
    L.colW = cols.map((items) => Math.max(...items.map((n) => GL[n.acc].bbox[2])) + 0.2);
    L.accW = L.colW.reduce((s, w) => s + w, 0);
    L.maxCol = Math.max(0, ...L.ns.map((n) => n.col));
    return L;
  }

  function drawGroup(L, nx0, box) {
    if (!L.ns.length) return '';
    const y = L.treble ? yT : yB;
    const ds = L.ns.map((n) => n.d), max = Math.max(...ds), min = Math.min(...ds);
    let s = '';
    const ledger = (st, sel) => {
      const cs = L.ns.filter(sel).map((n) => n.col);
      if (!cs.length) return '';
      const xa = nx0 + Math.min(...cs) * ST.COL - 0.42, xb = nx0 + Math.max(...cs) * ST.COL + ST.NW + 0.42;
      return `<line class="lg" x1="${xa.toFixed(3)}" x2="${xb.toFixed(3)}" y1="${y(st)}" y2="${y(st)}"/>`;
    };
    const top = L.treble ? 38 : 26, bot = L.treble ? 30 : 18;
    for (let st = bot - 2; st >= min; st -= 2) s += ledger(st, (n) => n.d <= st);
    for (let st = top + 2; st <= max; st += 2) s += ledger(st, (n) => n.d >= st);
    for (const n of L.ns) s += `<use href="#g-noteheadWhole" x="${(nx0 + n.col * ST.COL).toFixed(3)}" y="${y(n.d)}"/>`;
    for (const n of L.ns) {
      if (!n.acc) continue;
      let right = nx0 - 0.2;
      for (let c = 0; c < n.accCol; c++) right -= L.colW[c];
      s += `<use href="#g-${n.acc}" x="${(right - GL[n.acc].bbox[2]).toFixed(3)}" y="${y(n.d)}"/>`;
    }
    let lo = y(max) - 2, hi = y(min) + 2;
    if (L.k) {
      const label = L.treble ? (L.k === 1 ? '8va' : '15ma') : (L.k === 1 ? '8vb' : '15mb');
      const yy = L.treble ? Math.min(y(max) - 1.5, ST.T - 1.1) : Math.max(y(min) + 2.1, BASS_TOP + 5.6);
      s += `<text class="ott" x="${(nx0 - 0.3).toFixed(2)}" y="${yy.toFixed(2)}">${label}</text>`;
      lo = Math.min(lo, yy - 1.2); hi = Math.max(hi, yy + 0.6);
    }
    box.min = Math.min(box.min, lo); box.max = Math.max(box.max, hi);
    return s;
  }

  function renderStaff(notes, cls) {
    const tre = layoutGroup(notes.filter((n) => n.midi >= 60), true);
    const bas = layoutGroup(notes.filter((n) => n.midi < 60), false);
    const accW = Math.max(tre.accW, bas.accW);
    const colsW = ST.NW + Math.max(tre.maxCol, bas.maxCol) * ST.COL;
    const areaL = 4.7, areaR = ST.W - 0.5, lead = accW ? accW + 0.2 : 0;
    const nx0 = areaL + Math.max(0, (areaR - areaL - lead - colsW) / 2) + lead;
    const box = { min: 0, max: ST.H };
    const body = drawGroup(tre, nx0, box) + drawGroup(bas, nx0, box);
    $('staffNotes').innerHTML = body ? `<g class="notes ${cls}" filter="url(#glow)">${body}</g>` : '';
    setStaffBox(Math.min(0, Math.floor(box.min)), Math.max(ST.H, Math.ceil(box.max)));
  }

  // ───────── on-screen keyboard: three.js 3D keys, flat SVG fallback ─────────
  // Both implement build(range) · paint(held, sus, target, labels, showLabels) · keyAt(x, y) → {m, vel}
  // · keyCenter(m) · state(). The 3D keys need a GPU; without one (or with ?flat in the URL) the flat
  // keyboard is used. ?3d forces the 3D keys even on a software renderer.
  const RANGES = { 88: [21, 108], 76: [28, 103], 61: [36, 96], 49: [36, 84] };
  const keysHost = $('keys');
  let kRange = RANGES[88];
  let kbd = null;
  const gpu = window.CSKeyboard3D ? window.CSKeyboard3D.probe() : { webgl: false };
  if (!/[?&]flat\b/.test(location.search) && gpu.webgl && (!gpu.software || /[?&]3d\b/.test(location.search))) {
    try { kbd = window.CSKeyboard3D.create(keysHost, { maxHeight: () => clamp(innerHeight * 0.27, 96, 240) }); } catch (e) { kbd = null; keysHost.textContent = ''; }
  }
  if (!kbd) kbd = flatKeyboard(keysHost);
  keysHost.classList.add(kbd.is3D ? 'is3d' : 'isflat');

  function flatKeyboard(host) {
    const KW = 24, KH = 120, BW = 14.4, BH = 76;
    const BOFF = { 1: -0.11, 3: 0.11, 6: -0.13, 8: 0, 10: 0.13 };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'kflat');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Keyboard');
    host.appendChild(svg);
    let els = new Map(), geo = new Map();
    function build([lo, hi]) {
      const wxOf = {};
      let wx = 0;
      for (let m = lo; m <= hi; m++) if (isWhite(m)) wxOf[m] = (wx++) * KW;
      const width = wx * KW;
      let s = '<defs><linearGradient id="wkg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9ecee"/><stop offset=".86" stop-color="#d3d8dc"/><stop offset="1" stop-color="#b6bdc2"/></linearGradient>' +
        '<linearGradient id="bkg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23292d"/><stop offset=".9" stop-color="#111417"/><stop offset="1" stop-color="#2c3337"/></linearGradient></defs>';
      for (let m = lo; m <= hi; m++) if (isWhite(m)) s += `<rect class="wk" data-m="${m}" x="${wxOf[m] + 0.5}" y="0" width="${KW - 1}" height="${KH}"/>`;
      for (let m = lo; m <= hi; m++) if (isWhite(m) && m % 12 === 0) s += `<text class="cl${m === 60 ? ' mid' : ''}" x="${wxOf[m] + KW / 2}" y="${KH - 7}">C${m / 12 - 1}</text>`;
      for (let m = lo; m <= hi; m++) {
        if (isWhite(m) || wxOf[m + 1] === undefined) continue;
        const cx = wxOf[m + 1] + BOFF[mod12(m)] * KW;
        s += `<rect class="bk" data-m="${m}" x="${(cx - BW / 2).toFixed(2)}" y="0" width="${BW}" height="${BH}"/>`;
      }
      s += `<rect class="felt" x="0" y="0" width="${width}" height="3" pointer-events="none"/><g class="klabels"></g>`;
      svg.innerHTML = s;
      svg.setAttribute('viewBox', `0 0 ${width} ${KH}`);
      els = new Map(); geo = new Map();
      svg.querySelectorAll('rect[data-m]').forEach((el) => {
        const m = +el.dataset.m;
        els.set(m, el);
        geo.set(m, { x: +el.getAttribute('x'), w: +el.getAttribute('width'), white: isWhite(m) });
      });
    }
    let auto = new Set();
    function paint(held, sus, tgt, labels, showLabels, autoSet) {
      auto = autoSet || new Set();
      for (const [m, el] of els) {
        const cl = el.classList;
        cl.toggle('held', held.has(m));
        cl.toggle('sus', !held.has(m) && sus.has(m));
        cl.toggle('tgt', tgt.has(m) || auto.has(m));
      }
      let s = '';
      if (showLabels) {
        for (const [m, name] of labels) {
          const g = geo.get(m);
          if (!g) continue;
          const x = (g.x + g.w / 2).toFixed(1);
          s += g.white ? `<text class="kl" x="${x}" y="${KH - 22}">${esc(name)}</text>` : `<text class="kl bkl" x="${x}" y="${BH - 9}">${esc(name)}</text>`;
        }
      }
      svg.querySelector('.klabels').innerHTML = s;
    }
    function keyAt(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el || !el.dataset || el.dataset.m == null || !svg.contains(el)) return null;
      const r = el.getBoundingClientRect();
      return { m: +el.dataset.m, vel: clamp(0.3 + 0.65 * ((y - r.top) / Math.max(1, r.height)), 0.2, 1) };
    }
    function keyCenter(m) {
      const el = els.get(m);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.78 };
    }
    function state() {
      return [...els].map(([m, el]) => ({ m, held: el.classList.contains('held'), sus: el.classList.contains('sus'), tgt: el.classList.contains('tgt') && !auto.has(m), auto: auto.has(m) }));
    }
    function keyLayout() {
      if (!els.size || !svg.getBoundingClientRect().width) return null;
      return [...els].map(([m, el]) => { const r = el.getBoundingClientRect(); return { m, white: isWhite(m), x0: r.left, x1: r.right }; }).sort((a, b) => a.m - b.m);
    }
    return { el: svg, build, paint, keyAt, keyCenter, keyLayout, state, fit() {}, is3D: false };
  }
  function buildKeys() {
    kRange = RANGES[S.range] || RANGES[88];
    kbd.build(kRange);
  }
  function paintKeys(held, sus, tgt, labels, auto) {
    kbd.paint(held, sus, tgt, labels, S.labels, auto);
    const [lo, hi] = kRange;
    const all = [...held, ...sus, ...tgt, ...auto];
    $('edgeL').classList.toggle('lit', all.some((m) => m < lo));
    $('edgeR').classList.toggle('lit', all.some((m) => m > hi));
  }

  // ───────── note state ─────────
  // sources: your MIDI keyboard, mouse, computer keys, latched keys — and 'play', the player piano
  const src = { midi: new Map(), ui: new Map(), key: new Map(), latch: new Map(), play: new Map() };
  const USER = ['midi', 'ui', 'key', 'latch'];
  const sustained = new Set();
  const userVoices = new Map(); // key → the piano voice your note started (released by handle, never by key)
  let pedal = false; // the piano's pedal: yours or the player's
  let pedalUser = false, pedalUserFrom = null, pedalPlay = false;
  function isUserHeld(m) { return src.midi.has(m) || src.ui.has(m) || src.key.has(m) || src.latch.has(m); }
  function isHeld(m) { return isUserHeld(m) || src.play.has(m); }
  function heldSet() { const s = new Set(); for (const k of USER) for (const m of src[k].keys()) s.add(m); return s; }
  // what the chord display reads: what you hold, or else what the player piano is playing
  function displayNotes() {
    const s = heldSet();
    if (S.pedalHold) for (const m of sustained) s.add(m);
    if (!s.size) for (const m of src.play.keys()) s.add(m);
    return [...s].sort((a, b) => a - b);
  }
  // notes go into the score in SCORE mode, and in every mode while a session records (never the player's)
  function scoring(from, t) {
    if (from === 'play') return false;
    if (session.state === 'countin') return t >= session.startMs - scoreModel.grid * scoreModel.tickMs * 0.5;
    return S.mode === 'score' || session.state === 'rec';
  }
  const thruCh = () => (S.channel === 'omni' ? 0 : +S.channel);

  function noteOn(m, vel, from, t) {
    if (m < 0 || m > 127) return;
    t = t || performance.now();
    if (scoring(from, t)) { scoreModel.noteOn(m, vel, t); scoreView.follow(); startTransportLoop(); if (session.state === 'idle') syncTransport(); }
    src[from].set(m, vel);
    if (from !== 'play') {
      sustained.delete(m);
      if (S.piano && ensureAudio()) { const v = piano.noteOn(m, vel); if (v) userVoices.set(m, v); }
      if (from !== 'midi') thruSend([0x90 | thruCh(), m, clamp(Math.round(vel * 127), 1, 127)]);
    }
    changed(true);
  }
  function noteOff(m, from, t) {
    if (!src[from].has(m)) return;
    src[from].delete(m);
    if (from === 'play') { changed(false); return; } // the player releases its own voices and THRU notes
    if (from !== 'midi') thruSend([0x80 | thruCh(), m, 0]);
    if (!isUserHeld(m)) {
      scoreModel.noteOff(m, t || performance.now());
      if (pedal) sustained.add(m);
      const v = userVoices.get(m);
      if (v) { piano.release(v); userVoices.delete(m); }
    }
    changed(false);
  }
  // Your pedal (MIDI or Space) and the player piano's pedal are tracked apart: either one holds the
  // piano's dampers, only yours goes into the score, and neither can lift the other.
  function setPedal(down, from) {
    if (from === 'play') {
      if (pedalPlay === down) return;
      pedalPlay = down;
    } else if (from === 'panic') {
      pedalUser = false; pedalUserFrom = null; pedalPlay = false;
    } else {
      if (pedalUser === down) return;
      if (!down && pedalUserFrom && from !== pedalUserFrom) return;
      pedalUser = down; pedalUserFrom = down ? from : null;
      scoreModel.pedal(down, performance.now());
      if (from !== 'midi') thruSend([0xb0 | thruCh(), 64, down ? 127 : 0]);
    }
    const now = pedalUser || pedalPlay;
    if (now !== pedal) {
      pedal = now;
      piano.setPedal(now);
      if (!now) sustained.clear();
    }
    changed(false);
  }
  function releaseSource(name) { for (const m of [...src[name].keys()]) noteOff(m, name); }
  function panic() {
    for (const k of ['ui', 'key', 'latch', 'midi']) releaseSource(k);
    if (player.playing) player.pause();
    qDown.clear(); ptr.clear();
    setPedal(false, 'panic');
    sustained.clear();
    piano.allOff();
    userVoices.clear();
    thruSend([0xb0 | thruCh(), 64, 0]); thruSend([0xb0 | thruCh(), 123, 0]); // nothing left hanging downstream
    lastLive = null;
    changed(true);
  }

  // ───────── rendering loop ─────────
  let rafId = 0, readoutDirty = true, keysDirty = true, releaseTimer = 0;
  let lastLive = null, liveGhost = false, showRes = null;
  function frame() { if (!rafId) rafId = requestAnimationFrame(render); }
  function changed(isOn) {
    keysDirty = true;
    if (S.mode === 'show' || isOn) {
      clearTimeout(releaseTimer); releaseTimer = 0;
      readoutDirty = true;
    } else {
      // a released chord's notes rarely lift together: wait a beat so the full chord stays up
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => { releaseTimer = 0; readoutDirty = true; frame(); }, 110);
    }
    frame();
  }
  function render() {
    rafId = 0;
    if (readoutDirty) { readoutDirty = false; if (S.mode === 'show') renderShow(); else if (S.mode === 'live') renderLive(); else if (S.mode === 'score') renderScoreChord(); else renderRollChord(); keysDirty = true; }
    if (keysDirty) { keysDirty = false; renderKeys(); }
    renderTags(); renderStatus();
  }

  function renderLive() {
    const notes = displayNotes();
    if (!notes.length) {
      liveGhost = !!(S.holdLast && lastLive);
      if (liveGhost) { setReadout(lastLive, 'ghost'); renderStaff(lastLive.notes || [], 'ghost'); }
      else { lastLive = null; setReadout(null, 'live'); renderStaff([], ''); }
      $('alts').innerHTML = ''; $('match').textContent = '';
      return;
    }
    liveGhost = false;
    const r = E.analyze(notes, { spelling: S.spelling });
    lastLive = r;
    setReadout(r, 'live');
    renderStaff(r.notes || [], '');
    $('alts').innerHTML = r.alternates && r.alternates.length ? 'also ' + r.alternates.map((a) => `<span>${accHTML(a)}</span>`).join(' · ') : '';
    $('match').textContent = '';
  }

  function renderShow() {
    showRes = E.build(S.show, { spelling: S.spelling });
    setReadout(showRes, 'show');
    renderStaff(showRes.notes, 'show');
    fillInversions();
    $('alts').innerHTML = showRes.aka ? `same notes as <span>${accHTML(showRes.aka)}</span>` : '';
    const held = displayNotes(), mt = $('match');
    if (!held.length) { mt.className = 'match'; mt.textContent = 'play it on the gold keys'; return; }
    const tgt = new Set(showRes.notes.map((n) => mod12(n.midi)));
    const hp = new Set(held.map(mod12));
    const nameOf = (pc) => { const n = showRes.notes.find((x) => mod12(x.midi) === pc); return n ? n.name : E.nameNote(pc, S.spelling); };
    const missing = [...tgt].filter((p) => !hp.has(p)).map(nameOf);
    const extra = [...hp].filter((p) => !tgt.has(p)).map(nameOf);
    const you = E.analyze(held, { spelling: S.spelling });
    const youTxt = you.text ? 'you: ' + you.text : '';
    if (!missing.length && !extra.length) {
      const wantBass = mod12(showRes.notes[0].midi);
      if (mod12(held[0]) === wantBass) { mt.className = 'match ok'; mt.textContent = '✓ MATCH'; }
      else { mt.className = 'match no'; mt.textContent = `${youTxt} · right notes, put ${showRes.notes[0].name} in the bass`; }
    } else {
      mt.className = 'match no';
      mt.textContent = [youTxt, missing.length ? 'missing ' + missing.join(' ') : '', extra.length ? 'extra ' + extra.join(' ') : ''].filter(Boolean).join(' · ');
    }
  }

  function renderKeys() {
    const held = heldSet();
    const auto = new Set(src.play.keys());
    const sus = new Set(S.pedalHold || pedal ? sustained : []);
    const labels = new Map();
    let tgt = new Set();
    if (S.mode === 'show' && showRes) {
      tgt = new Set(showRes.notes.map((n) => n.midi));
      for (const n of showRes.notes) labels.set(n.midi, n.name);
    }
    const live = [...new Set([...held, ...sus, ...auto])];
    if (live.length) {
      const r = live.length <= E.MAX_NOTES ? E.analyze(live, { spelling: S.spelling }) : null;
      const names = r && r.notes ? r.notes : live.map((m) => ({ midi: m, name: E.nameNote(mod12(m), S.spelling) }));
      for (const n of names) if (!labels.has(n.midi)) labels.set(n.midi, n.name);
    }
    paintKeys(held, sus, tgt, labels, auto);
  }

  function setReadout(r, mode) {
    const symEl = $('sym'), longEl = $('long'), tonesEl = $('tones');
    symEl.className = 'sym' + (mode === 'show' ? ' show' : mode === 'ghost' ? ' ghost' : '');
    longEl.className = 'long' + (mode === 'ghost' ? ' ghost' : '') + (mode === 'show' ? ' showc' : '');
    tonesEl.className = 'tones' + (mode === 'ghost' ? ' ghost' : '');
    if (!r || r.kind === 'none') {
      symEl.innerHTML = '<span class="ph">—</span>';
      symEl.dataset.text = '';
      longEl.textContent = 'play a chord';
      tonesEl.innerHTML = '';
    } else if (r.kind === 'toomany') {
      symEl.innerHTML = `<span class="ph">${r.count}</span>`;
      symEl.dataset.text = String(r.count);
      longEl.textContent = r.long;
      tonesEl.innerHTML = '';
    } else {
      const s = r.symbol;
      let h = `<span class="r">${accHTML(s.root)}</span>`;
      if (s.upper) h += `<span class="dash">–</span><span class="r">${accHTML(s.upper)}</span>`;
      if (s.suffix) h += `<span class="q">${accHTML(s.suffix)}</span>`;
      if (s.bass) h += `<span class="sl">/</span><span class="b">${accHTML(s.bass)}</span>`;
      if (r.confidence === 'low') h += '<span class="unsure" title="Unusual cluster — best guess">?</span>';
      symEl.innerHTML = h;
      symEl.dataset.text = r.text;
      symEl.setAttribute('aria-label', r.text);
      longEl.innerHTML = esc(r.long) + (r.inversion ? `<span class="inv">${esc(r.inversion)}</span>` : '');
      tonesEl.innerHTML = (r.tones || []).map((t) => `<span class="t${t.label === 'bass' ? ' bass' : ''}" data-name="${esc(t.name)}"><b>${accHTML(t.name)}</b><i>${esc(t.label)}</i></span>`).join('');
    }
    fitSym();
  }
  function fitSym() {
    const el = $('sym');
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize), n = 0;
    while (el.scrollWidth > el.clientWidth + 1 && size > 20 && n++ < 30) { size *= 0.93; el.style.fontSize = size.toFixed(1) + 'px'; }
  }

  function renderTags() {
    const tm = $('tagMode'), th = $('tagHold'), tp = $('tagPedal');
    tm.textContent = S.mode === 'show' ? 'SHOW' : 'LIVE';
    tm.className = 'tag ' + (S.mode === 'show' ? 'gold' : 'lit');
    const n = heldSet().size;
    th.textContent = S.mode === 'live' && !n && liveGhost ? 'LAST' : 'HELD';
    th.className = 'tag' + (n ? ' lit' : '');
    tp.className = 'tag' + (pedal ? ' lit' : '');
  }

  // ───────── MIDI ─────────
  let access = null, thruOut = null;
  const busy = new Set(); // ports another app (e.g. FL Studio) holds exclusively
  let midiState = { level: '', msg: 'MIDI: starting…' };
  const inSel = $('inSel'), chSel = $('chSel'), thruSel = $('thruSel');
  function thruSend(bytes) { if (thruOut) { try { thruOut.send(bytes); } catch (e) { /* port went away */ } } }

  async function initMIDI() {
    if (!navigator.requestMIDIAccess) {
      midiState = { level: 'err', msg: 'No Web MIDI in this browser — open CHORD//SCOPE in Edge or Chrome' };
      fillPorts(); frame(); return;
    }
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      midiState = { level: 'err', msg: 'MIDI permission blocked — allow MIDI for this page, then reload' };
      fillPorts(); frame(); return;
    }
    access.onstatechange = () => { fillPorts(); bindPorts(); };
    fillPorts(); bindPorts();
  }
  function livePorts(map) { return map ? [...map.values()].filter((p) => p.state !== 'disconnected') : []; }
  const portNote = (name) => (busy.has(name) ? ' — busy' : '');
  function fillPorts() {
    const ins = livePorts(access && access.inputs), outs = livePorts(access && access.outputs);
    const inNames = [...new Set(ins.map((p) => p.name))];
    let h = `<option value="__all__">All inputs${ins.length ? ` (${ins.length})` : ''}</option>`;
    for (const n of inNames) h += `<option value="${esc(n)}">${esc(n)}${portNote(n)}</option>`;
    if (S.inName !== '__all__' && !inNames.includes(S.inName)) h += `<option value="${esc(S.inName)}">${esc(S.inName)} — not connected</option>`;
    inSel.innerHTML = h; inSel.value = S.inName;
    const outNames = [...new Set(outs.map((p) => p.name))];
    let t = '<option value="">Off</option>';
    for (const n of outNames) t += `<option value="${esc(n)}">${esc(n)}</option>`;
    if (S.thruName && !outNames.includes(S.thruName)) t += `<option value="${esc(S.thruName)}">${esc(S.thruName)} — not connected</option>`;
    thruSel.innerHTML = t; thruSel.value = S.thruName;
  }
  function bindPorts() {
    if (!access) return;
    const ins = livePorts(access.inputs);
    let bound = 0;
    const loop = S.thruName && S.inName === S.thruName;
    for (const p of [...access.inputs.values()]) {
      const want = !loop && p.state !== 'disconnected' && (S.inName === '__all__' ? p.name !== S.thruName : p.name === S.inName);
      if (want) {
        if (p.onmidimessage !== onMIDI) {
          p.onmidimessage = onMIDI;
          const name = p.name;
          Promise.resolve(p.open && p.open()).then(() => { if (busy.delete(name)) { fillPorts(); bindPorts(); } })
            .catch(() => { if (!busy.has(name)) { busy.add(name); fillPorts(); bindPorts(); } });
        }
        if (!busy.has(p.name)) bound++;
      }
      else if (p.onmidimessage) { p.onmidimessage = null; try { p.close(); } catch (e) { /* ignore */ } }
    }
    thruOut = !loop && S.thruName ? livePorts(access.outputs).find((o) => o.name === S.thruName) || null : null;
    if (thruOut) { try { thruOut.open(); } catch (e) { /* opens on first send */ } }
    if (loop) midiState = { level: 'err', msg: 'IN and THRU are the same port — that would loop' };
    else if (!ins.length) midiState = { level: 'warn', msg: 'MIDI: no input devices found' };
    else if (S.inName !== '__all__' && busy.has(S.inName)) midiState = { level: 'err', msg: `MIDI: “${S.inName}” is busy — another app (FL Studio?) has it open. Disable it there, or route it through THRU.` };
    else if (!bound) midiState = { level: 'warn', msg: S.inName === '__all__' ? 'MIDI: every input is busy in another app' : `MIDI: “${S.inName}” is not connected` };
    else midiState = { level: busy.size ? 'warn' : 'ok', msg: (S.inName === '__all__' ? `MIDI: listening to ${bound} input${bound > 1 ? 's' : ''}` : 'MIDI: ' + S.inName) + (busy.size && S.inName === '__all__' ? ` · ${busy.size} busy in another app` : '') };
    frame();
  }
  // force every input to be re-opened (after a device change or when a busy port may be free again)
  function rebind() {
    if (access) for (const p of access.inputs.values()) p.onmidimessage = null;
    busy.clear();
    fillPorts(); bindPorts();
  }
  // while a port is held by another app, quietly try again every few seconds
  setInterval(() => {
    if (!access || !busy.size) return;
    for (const p of access.inputs.values()) {
      if (!busy.has(p.name) || !p.open) continue;
      p.open().then(() => { busy.delete(p.name); fillPorts(); bindPorts(); }).catch(() => {});
    }
  }, 3000);
  function onMIDI(e) {
    const d = e.data;
    if (!d || !d.length) return;
    thruSend(d);
    const st = d[0] & 0xf0, ch = d[0] & 0x0f;
    if (st < 0x80 || st === 0xf0) return;
    if (S.channel !== 'omni' && ch !== +S.channel) return;
    const pn = performance.now();
    const t = e.timeStamp && Math.abs(e.timeStamp - pn) < 1000 ? e.timeStamp : pn; // event time = better rhythm
    if (st === 0x90 && d[2] > 0) noteOn(d[1], d[2] / 127, 'midi', t);
    else if (st === 0x80 || st === 0x90) noteOff(d[1], 'midi', t);
    else if (st === 0xb0) {
      if (d[1] === 64) setPedal(d[2] >= 64, 'midi');
      else if (d[1] === 120 || d[1] === 123) { releaseSource('midi'); if (d[1] === 120) piano.allOff(); }
    }
  }

  // ───────── on-screen keyboard: mouse / touch ─────────
  const ptr = new Map();
  let latch = false;
  keysHost.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const k = kbd.keyAt(e.clientX, e.clientY);
    if (!k) return;
    e.preventDefault();
    if (latch) { if (src.latch.has(k.m)) noteOff(k.m, 'latch'); else noteOn(k.m, k.vel, 'latch'); return; }
    try { keysHost.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    ptr.set(e.pointerId, k.m);
    noteOn(k.m, k.vel, 'ui');
  });
  keysHost.addEventListener('pointermove', (e) => {
    if (!ptr.has(e.pointerId)) return;
    const k = kbd.keyAt(e.clientX, e.clientY);
    const cur = ptr.get(e.pointerId), m = k ? k.m : null;
    if (m === cur) return;
    if (cur != null && ![...ptr].some(([id, n]) => id !== e.pointerId && n === cur)) noteOff(cur, 'ui');
    ptr.set(e.pointerId, m);
    if (m != null) noteOn(m, k.vel, 'ui');
  });
  const ptrEnd = (e) => {
    if (!ptr.has(e.pointerId)) return;
    const cur = ptr.get(e.pointerId);
    ptr.delete(e.pointerId);
    if (cur != null && ![...ptr.values()].includes(cur)) noteOff(cur, 'ui');
  };
  keysHost.addEventListener('pointerup', ptrEnd);
  keysHost.addEventListener('pointercancel', ptrEnd);
  keysHost.addEventListener('contextmenu', (e) => e.preventDefault());

  // ───────── computer keyboard ─────────
  const QMAP = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
    KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
  };
  const qDown = new Map();
  const typing = (t) => t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { panic(); showSettings(false); showExport(false); return; }
    if (e.key === 'Enter' && !e.repeat && !typing(e.target) && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); playToggle(); return; }
    if (!S.qwerty || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) setPedal(true, 'key'); return; }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      S.qOct = clamp(S.qOct + (e.code === 'ArrowLeft' ? -1 : 1), 0, 7); persist(); frame(); return;
    }
    const off = QMAP[e.code];
    if (off === undefined) return;
    e.preventDefault();
    if (e.repeat || qDown.has(e.code)) return;
    const m = 12 * (S.qOct + 1) + off;
    qDown.set(e.code, m);
    noteOn(m, 0.72, 'key');
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { e.preventDefault(); setPedal(false, 'key'); return; }
    const m = qDown.get(e.code);
    if (m === undefined) return;
    qDown.delete(e.code);
    if (![...qDown.values()].includes(m)) noteOff(m, 'key');
  });
  window.addEventListener('blur', () => {
    qDown.clear(); releaseSource('key');
    ptr.clear(); releaseSource('ui');
    if (pedalUserFrom === 'key') setPedal(false, 'key');
  });

  // ───────── SHOW mode controls ─────────
  const rootSel = $('rootSel'), typeSel = $('typeSel'), invSel = $('invSel'), bassSel = $('bassSel');
  const BASS_NAMES = ['C', 'C♯ / D♭', 'D', 'E♭ / D♯', 'E', 'F', 'F♯ / G♭', 'G', 'A♭ / G♯', 'A', 'B♭ / A♯', 'B'];
  const MINORISH = new Set(['m', 'm6', 'm69', 'm7', 'mmaj7', 'm7b5', 'dim', 'dim7', 'madd9', 'm9', 'm11', 'm13']);
  function initShowUI() {
    rootSel.innerHTML = E.ROOTS.map((r) => `<option value="${r}">${r}</option>`).join('');
    typeSel.innerHTML = E.TYPES.map(([g, list]) => `<optgroup label="${g}">${list.map(([id, sym, label]) => `<option value="${id}">${esc(sym || 'maj')} — ${esc(label)}</option>`).join('')}</optgroup>`).join('');
    bassSel.innerHTML = '<option value="">— none</option>' + BASS_NAMES.map((n, pc) => `<option value="${pc}">${n}</option>`).join('');
    const mods = $('mods');
    for (const [id, label] of E.MODS) {
      const b = document.createElement('button');
      b.innerHTML = accHTML(label); b.dataset.mod = id; // engraved ♭/♯ glyphs read better than the font's
      b.title = id === 'no3' ? 'Leave out the 3rd' : id === 'no5' ? 'Leave out the 5th' : id === 'b5' || id === 's5' ? 'Replace the 5th' : 'Add this tension';
      b.addEventListener('click', () => {
        const set = new Set(S.show.mods);
        if (set.has(id)) set.delete(id);
        else { set.add(id); if (id === 'b5') set.delete('s5'); if (id === 's5') set.delete('b5'); }
        S.show.mods = E.MODS.map((x) => x[0]).filter((x) => set.has(x));
        showChanged();
      });
      mods.insertBefore(b, $('modsEnd'));
    }
    const reset = document.createElement('button');
    reset.textContent = 'RESET'; reset.title = 'Clear modifiers, inversion and bass';
    reset.addEventListener('click', () => { S.show.mods = []; S.show.inversion = 0; S.show.bass = ''; showChanged(); });
    mods.insertBefore(reset, $('hearBtn'));
    rootSel.addEventListener('change', () => { S.show.root = rootSel.value; rootSel.blur(); showChanged(); });
    typeSel.addEventListener('change', () => { S.show.type = typeSel.value; S.show.inversion = 0; typeSel.blur(); showChanged(); });
    invSel.addEventListener('change', () => { S.show.inversion = +invSel.value; invSel.blur(); showChanged(); });
    bassSel.addEventListener('change', () => { S.show.bass = bassSel.value; bassSel.blur(); showChanged(); });
    const step = (dir) => {
      const p = E.parseName(S.show.root), pc = mod12(E.pcOf(p) + dir);
      const names = MINORISH.has(S.show.type) ? ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'] : ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
      S.show.root = names[pc]; showChanged();
    };
    $('rootDn').addEventListener('click', () => step(-1));
    $('rootUp').addEventListener('click', () => step(1));
    $('hearBtn').addEventListener('click', () => hear(showRes ? showRes.notes.map((n) => n.midi) : []));
    syncShowUI();
  }
  function syncShowUI() {
    rootSel.value = S.show.root; typeSel.value = S.show.type; bassSel.value = S.show.bass == null ? '' : String(S.show.bass);
    for (const b of $('mods').querySelectorAll('button[data-mod]')) b.classList.toggle('on', S.show.mods.includes(b.dataset.mod));
  }
  function fillInversions() {
    if (!showRes) return;
    const list = showRes.inversions || [];
    if (S.show.inversion >= list.length) S.show.inversion = Math.max(0, list.length - 1);
    const h = list.map((o) => `<option value="${o.index}">${esc(o.label)}</option>`).join('');
    if (invSel.dataset.h !== h) { invSel.innerHTML = h; invSel.dataset.h = h; }
    invSel.value = String(S.show.inversion);
  }
  function showChanged() { persist(); syncShowUI(); readoutDirty = true; keysDirty = true; frame(); }

  function hear(notes) {
    if (!notes.length || !ensureAudio()) return;
    piano.whenReady().then(() => {
      const vs = [];
      notes.forEach((m, i) => setTimeout(() => { const v = piano.noteOn(m, 0.62); if (v) vs.push(v); }, i * 14));
      setTimeout(() => { for (const v of vs) piano.release(v); }, 2200);
    });
  }
  const hearCurrent = () => {
    if (S.mode === 'show') hear(showRes ? showRes.notes.map((n) => n.midi) : []);
    else if (lastLive && lastLive.notes) hear(lastLive.notes.map((n) => n.midi));
  };
  $('readout').addEventListener('click', hearCurrent);
  staffSvg.addEventListener('click', hearCurrent);

  // ───────── SCORE: live transcription onto parchment ─────────
  const scoreModel = new window.ScoreModel(E, { bpm: S.metro.bpm, beats: S.metro.beats, grid: S.score.grid, idleStop: S.score.idle, spelling: S.spelling });
  const scoreView = window.CSScoreView.create({ host: $('stage'), model: scoreModel, glyphs: window.CS_SCORE_GLYPHS });
  scoreView.setMode(S.score.view);
  scoreView.setSymbols(S.score.symbols);
  let scoreRaf = 0;
  function startScoreLoop() { if (!scoreRaf) scoreRaf = requestAnimationFrame(scoreLoop); }
  function scoreLoop() {
    scoreRaf = 0;
    if (S.mode !== 'score') return;
    const ms = performance.now();
    scoreView.frame(ms);
    const pager = $('pager');
    pager.hidden = scoreView.mode !== 'page';
    if (!pager.hidden) {
      const txt = (scoreView.page() + 1) + ' / ' + scoreView.pageCount(ms);
      if ($('pgTxt').textContent !== txt) $('pgTxt').textContent = txt;
    }
    scoreRaf = requestAnimationFrame(scoreLoop);
  }
  function renderScoreChord() {
    const notes = displayNotes();
    const r = notes.length ? E.analyze(notes, { spelling: S.spelling }) : null;
    const t = r && r.kind !== 'toomany' && r.kind !== 'none' ? r.text : '';
    const el = $('scoreChord');
    if (el.dataset.text !== t) { el.dataset.text = t; el.innerHTML = accHTML(t); }
  }
  function clearScore() {
    if (session.state !== 'idle') recStop();
    scoreModel.reset(); scoreView.reset(); syncTransport();
  }
  function initScoreUI() {
    const vs = $('scoreViewSeg');
    const syncView = () => { for (const b of vs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === S.score.view); };
    for (const b of vs.querySelectorAll('button')) b.addEventListener('click', () => { S.score.view = b.dataset.v; persist(); syncView(); scoreView.setMode(S.score.view); });
    syncView();
    const gs = $('gridSeg');
    const syncGrid = () => { for (const b of gs.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === S.score.grid); };
    for (const b of gs.querySelectorAll('button')) b.addEventListener('click', () => { S.score.grid = +b.dataset.v; persist(); scoreModel.setGrid(S.score.grid); syncGrid(); });
    syncGrid();
    const sb = $('symBtn');
    setToggle(sb, S.score.symbols);
    sb.addEventListener('click', () => { S.score.symbols = !S.score.symbols; persist(); setToggle(sb, S.score.symbols); scoreView.setSymbols(S.score.symbols); });
    $('pgPrev').addEventListener('click', () => scoreView.goPage(scoreView.page() - 1, performance.now()));
    $('pgNext').addEventListener('click', () => scoreView.goPage(scoreView.page() + 1, performance.now()));
    $('scoreClear').addEventListener('click', clearScore);
  }

  // ───────── metronome ─────────
  // One clock for the clicks, the beat lights and the score: when it runs, the score's bar lines
  // follow it. Clicks are scheduled ahead on the audio clock so they don't drift or stutter.
  const metro = {
    running: false, anchorMs: 0, anchorBeat: 0, next: 0,
    beatAt(ms) { return this.anchorBeat + ((ms - this.anchorMs) * S.metro.bpm) / 60000; },
    msAt(b) { return this.anchorMs + ((b - this.anchorBeat) * 60000) / S.metro.bpm; },
  };
  scoreModel.syncAnchor = (ms) => { // the bar line a new phrase starts on (a little early still counts)
    if (!metro.running) return null;
    const beats = S.metro.beats, slack = (scoreModel.grid / 4) * 0.5;
    return metro.msAt(Math.floor((metro.beatAt(ms) + slack) / beats) * beats);
  };
  const mod = (a, n) => ((a % n) + n) % n;
  function audioAt(ms) { // AudioContext time at which a sound is heard at performance-time ms
    const c = piano.ctx, lat = (c.outputLatency || 0) + (c.baseLatency || 0);
    return Math.max(c.currentTime, piano.ctxTime(ms) - lat);
  }
  function clickAt(when, accent) {
    const c = piano.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.42 : 0.26, when + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 0.055);
    o.connect(g); g.connect(c.destination);
    o.start(when); o.stop(when + 0.07);
  }
  setInterval(() => {
    if (!metro.running) return;
    const now = performance.now();
    const audible = S.metro.click && piano.ctx && piano.ctx.state === 'running';
    for (let guard = 0; guard < 8; guard++) {
      const at = metro.msAt(metro.next);
      if (at > now + 130) break;
      if (audible && at >= now - 15) clickAt(audioAt(at), mod(metro.next, S.metro.beats) === 0);
      metro.next++;
    }
  }, 25);
  function metroStart() {
    ensureAudio();
    metro.running = true; metro.anchorMs = performance.now() + 60; metro.anchorBeat = 0; metro.next = 0;
    syncTransport(); startTransportLoop();
  }
  function metroStop() { metro.running = false; syncTransport(); startTransportLoop(); }
  function setTempo(bpm, ms) {
    bpm = clamp(Math.round(+bpm) || S.metro.bpm, 30, 240);
    ms = ms || performance.now();
    if (metro.running) { metro.anchorBeat = metro.beatAt(ms); metro.anchorMs = ms; } // beats already queued stay queued (no double click)
    S.metro.bpm = bpm; persist();
    $('bpmIn').value = bpm;
    scoreModel.setTempo(bpm, ms); scoreView.invalidate();
  }
  function setMeter(beats) {
    S.metro.beats = beats; persist();
    $('meterSel').value = String(beats);
    scoreModel.setMeter(beats); scoreView.invalidate();
  }
  function initMetroUI() {
    const bpm = $('bpmIn');
    bpm.value = S.metro.bpm;
    bpm.addEventListener('change', () => { setTempo(bpm.value); bpm.blur(); });
    bpm.addEventListener('keydown', (e) => { if (e.key === 'Enter') bpm.blur(); e.stopPropagation(); });
    const taps = [];
    $('tapBtn').addEventListener('pointerdown', () => {
      const t = performance.now();
      if (taps.length && t - taps[taps.length - 1] > 2000) taps.length = 0;
      taps.push(t);
      if (taps.length > 6) taps.shift();
      if (taps.length < 2) return;
      setTempo(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)), t);
      if (metro.running) { metro.anchorBeat = Math.round(metro.anchorBeat); metro.anchorMs = t; metro.next = Math.max(metro.next, metro.anchorBeat + 1); } // clicks land on your taps
    });
    const ms = $('meterSel');
    ms.value = String(S.metro.beats);
    ms.addEventListener('change', () => { setMeter(+ms.value); ms.blur(); });
    const cb = $('clickBtn');
    setToggle(cb, S.metro.click);
    cb.addEventListener('click', () => { S.metro.click = !S.metro.click; persist(); setToggle(cb, S.metro.click); if (S.metro.click) ensureAudio(); });
    $('metroBtn').addEventListener('click', () => (metro.running ? metroStop() : metroStart()));
  }

  // ───────── sessions: ● REC → ■ → EXPORT ─────────
  // A session is written to the score in any mode. With the metronome running it gets one bar of
  // count-in and keeps strict time (silences become rests); without it, your first note is beat 1.
  const session = { state: 'idle', startMs: 0, synced: false };
  function recStart() {
    if (session.state !== 'idle') return;
    ensureAudio();
    const now = performance.now();
    if (scoreModel.running) scoreModel.stop(now);
    scoreModel.reset(); scoreView.reset();
    session.synced = metro.running;
    scoreModel.idleStop = session.synced ? false : S.score.idle;
    if (metro.running) { // restart the bar: one bar of count-in, then bar 1
      metro.anchorMs = now + 40; metro.anchorBeat = 0; metro.next = 0;
      session.startMs = metro.msAt(S.metro.beats);
      session.state = 'countin';
      scoreModel.startAt(session.startMs);
    } else { session.state = 'rec'; session.startMs = now; }
    syncTransport(); startTransportLoop();
  }
  function recStop() {
    if (session.state === 'idle') return false;
    const now = performance.now();
    if (session.state === 'countin') { scoreModel.reset(); scoreView.reset(); } else scoreModel.stop(now);
    session.state = 'idle';
    scoreModel.idleStop = S.score.idle;
    scoreView.invalidate();
    if (!scoreModel.isEmpty()) {
      takeTrack = trackFromScore();
      setSource('take', !!(fileTrack && player.playing));
      toast(`Recorded ${scoreModel.barsWritten(now)} bar${scoreModel.barsWritten(now) === 1 ? '' : 's'}. EXPORT saves it; ▶ plays it back.`);
    }
    syncTransport();
    return true;
  }
  // the recorded score as a playable track: what you played (unquantised), on the score's timeline
  function trackFromScore() {
    const sec = 60 / (scoreModel.bpm * 4);
    const notes = scoreModel.notes.map((n) => {
      const a = Math.max(0, n.raw != null ? n.raw : n.on);
      const z = n.rawOff != null ? n.rawOff : n.off != null ? n.off : a + scoreModel.grid;
      return { m: n.midi, vel: n.vel, t: a * sec, d: Math.max(0.05, (z - a) * sec) };
    }).sort((p, q) => p.t - q.t || p.m - q.m);
    const pedals = scoreModel.pedals.map((p) => ({ t: Math.max(0, p.t) * sec, down: p.down }));
    const end = notes.reduce((a, n) => Math.max(a, n.t + n.d), 0);
    return { name: 'My take', source: 'take', notes, pedals, tempos: [{ t: 0, q: 0, bpm: scoreModel.bpm }], bpm: scoreModel.bpm, beats: scoreModel.beats, unit: 4, duration: Math.max(end, Math.min(end + 2, scoreModel.endTick * sec)) };
  }

  // ───────── player piano: imported files and your takes ─────────
  let fileTrack = null, takeTrack = null, source = null;
  function thruSendAt(bytes, at) {
    if (!thruOut) return;
    const b = bytes.slice();
    if (b[0] >= 0x80 && b[0] < 0xf0) b[0] = (b[0] & 0xf0) | thruCh();
    try { thruOut.send(b, at); } catch (e) { /* port went away */ }
  }
  const player = window.CSPlayer.create({
    now: () => performance.now(),
    noteOn: (m, vel, at) => (S.piano && piano.ctx && piano.ctx.state === 'running' && (piano.mode === 'sampled' || piano.mode === 'synth') ? piano.noteOn(m, vel, audioAt(at)) : null),
    release: (v, quick) => piano.release(v, quick),
    thru: thruSendAt,
    key: (on, m, vel) => (on ? noteOn(m, vel, 'play') : noteOff(m, 'play')),
    pedal: (down) => setPedal(down, 'play'),
    state: (ended) => {
      if (ended && chosenTrack() && player.track !== chosenTrack()) player.load(chosenTrack());
      syncTransport(); roll.request(); startTransportLoop();
    },
  });
  const chosenTrack = () => (source === 'file' ? fileTrack : source === 'take' ? takeTrack : null);
  function setSource(which, keepPlaying) {
    const tr = which === 'file' ? fileTrack : takeTrack;
    if (!tr) return;
    source = which;
    if (!keepPlaying) player.load(tr); // otherwise it's loaded when the current playback stops
    syncTransport(); roll.request();
  }
  function playToggle() {
    if (player.playing) { player.pause(); return; }
    if (chosenTrack() && player.track !== chosenTrack()) player.load(chosenTrack());
    if (!player.track) { toast('Nothing to play yet: IMPORT a MIDI or MusicXML file, or record a session with ● REC.'); return; }
    ensureAudio();
    if (!S.piano && !thruOut) { S.piano = true; persist(); setToggle($('pianoBtn'), true); }
    piano.whenReady().then(() => { if (!player.playing) player.play(); });
  }
  function haltAll() {
    if (session.state !== 'idle') recStop();
    else if (scoreModel.running) scoreModel.stop(performance.now());
    if (player.playing || player.position() > 0) player.stop();
    syncTransport(); roll.request();
  }

  // ───────── ROLL: the paper roll ─────────
  let rollChord = null;
  const roll = window.CSRollView.create({
    host: $('rollStage'),
    track: () => player.track,
    pos: () => player.position(),
    sounding: () => player.sounding,
    keys: () => ($('kbd').classList.contains('collapsed') ? null : kbd.keyLayout && kbd.keyLayout()),
    range: () => kRange,
    chord: () => rollChord,
    status: () => (player.track ? { title: player.track.name, time: fmtTime(player.position()) + ' / ' + fmtTime(player.track.duration) + '  ·  ♩=' + Math.round(player.track.bpm) + '  ' + player.track.beats + '/' + player.track.unit } : null),
  });
  function renderRollChord() { // the roll names the music on it; your own notes take over when it's quiet
    const notes = src.play.size ? [...src.play.keys()].sort((a, b) => a - b) : displayNotes();
    if (notes.length) {
      const r = E.analyze(notes, { spelling: S.spelling });
      if (r.kind !== 'none') rollChord = r.kind === 'toomany' ? { sym: String(r.count), long: 'notes' } : { sym: r.text, long: r.long };
    } else if (!player.playing) rollChord = null;
    roll.request();
  }
  function initRollUI() {
    const ss = $('speedSeg');
    const syncSpeed = () => { for (const b of ss.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === S.rollSpeed); };
    for (const b of ss.querySelectorAll('button')) b.addEventListener('click', () => { S.rollSpeed = +b.dataset.v; persist(); player.setSpeed(S.rollSpeed); syncSpeed(); });
    player.setSpeed(S.rollSpeed);
    syncSpeed();
    for (const b of $('srcSeg').querySelectorAll('button')) b.addEventListener('click', () => setSource(b.dataset.v));
    const seek = $('seek');
    let resume = false;
    seek.addEventListener('pointerdown', () => { resume = player.playing; if (resume) player.pause(); });
    seek.addEventListener('input', () => { if (player.track) { player.seek((seek.value / 1000) * player.track.duration); roll.request(); updateClock(performance.now()); } });
    const done = () => { if (resume) { resume = false; player.play(); } seek.blur(); };
    seek.addEventListener('pointerup', done);
    seek.addEventListener('pointercancel', done);
    seek.addEventListener('change', () => seek.blur());
  }
  const fmtTime = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };

  // ───────── transport bar ─────────
  let tRaf = 0, beatSig = '';
  function startTransportLoop() { if (!tRaf) tRaf = requestAnimationFrame(transportLoop); }
  function transportLoop() {
    tRaf = 0;
    const ms = performance.now();
    if (session.state === 'countin' && ms >= session.startMs) { session.state = 'rec'; syncTransport(); }
    updateBeats(ms);
    updateClock(ms);
    if (S.mode === 'roll') roll.request();
    if (metro.running || session.state !== 'idle' || player.playing || scoreModel.running) tRaf = requestAnimationFrame(transportLoop);
    else { beatSig = ''; updateBeats(ms); }
  }
  function updateBeats(ms) {
    const beats = S.metro.beats;
    let beat = -1;
    if (metro.running) { const b = metro.beatAt(ms); if (b >= 0) beat = mod(Math.floor(b), beats); }
    else if (scoreModel.running) { const t = scoreModel.nowTick(ms); if (t >= scoreModel.phraseTick) beat = Math.floor(mod(t, scoreModel.tpb) / 4); }
    const sig = beats + ':' + beat;
    if (sig === beatSig) return;
    beatSig = sig;
    $('beats').innerHTML = Array.from({ length: beats }, (_, i) => `<i class="${i === beat ? 'on' : ''}${i === 0 ? ' one' : ''}"></i>`).join('');
  }
  function updateClock(ms) {
    const el = $('clock');
    let txt, cls = 'clock';
    if (session.state === 'countin') { txt = 'in ' + Math.max(1, Math.ceil((session.startMs - ms) / (60000 / S.metro.bpm))); cls += ' count'; }
    else if (session.state === 'rec') { const t = Math.max(0, ms - session.startMs) / 1000; txt = fmtTime(t) + '.' + Math.floor((t * 10) % 10); cls += ' rec'; }
    else if (player.track) { const t = player.position(); txt = fmtTime(t) + '.' + Math.floor((t * 10) % 10); if (player.playing) cls += ' play'; }
    else txt = '0:00.0';
    if (el.textContent !== txt) el.textContent = txt;
    if (el.className !== cls) el.className = cls;
    if (player.track && S.mode === 'roll') {
      const seek = $('seek');
      if (document.activeElement !== seek) seek.value = String(Math.round((player.position() / Math.max(0.001, player.track.duration)) * 1000));
      const a = fmtTime(player.position());
      if ($('rollTime').textContent !== a) $('rollTime').textContent = a;
    }
  }
  function syncTransport() {
    const rec = $('recBtn');
    rec.classList.toggle('on', session.state === 'rec');
    rec.classList.toggle('count', session.state === 'countin');
    rec.title = session.state === 'idle' ? 'Record a session: everything you play is written to the score. With the metronome running you get a one-bar count-in.' : 'Recording… ■ stops it';
    const pb = $('playBtn');
    pb.textContent = player.playing ? '❚❚' : '▶';
    pb.classList.toggle('on', player.playing);
    pb.disabled = !player.track;
    $('exportBtn').disabled = scoreModel.isEmpty() && session.state === 'idle';
    setToggle($('metroBtn'), metro.running);
    const tn = $('trackName');
    const name = player.track ? player.track.name : '';
    if (tn.textContent !== name) { tn.textContent = name; tn.title = name; }
    const seg = $('srcSeg');
    seg.hidden = !(fileTrack && takeTrack);
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === source);
    if (fileTrack) seg.querySelector('[data-v="file"]').title = fileTrack.name;
    $('rollDur').textContent = player.track ? fmtTime(player.track.duration) : '0:00';
    $('rollTime').textContent = fmtTime(player.position());
    $('seek').disabled = !player.track;
  }
  function initTransportUI() {
    $('recBtn').addEventListener('click', () => (session.state === 'idle' ? recStart() : recStop()));
    $('playBtn').addEventListener('click', playToggle);
    $('haltBtn').addEventListener('click', haltAll);
    $('importBtn').addEventListener('click', () => $('fileIn').click());
    $('fileIn').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
    $('exportBtn').addEventListener('click', (e) => { e.stopPropagation(); showExport($('exportPop').hidden); });
    for (const b of $('exportPop').querySelectorAll('button[data-x]')) b.addEventListener('click', () => { showExport(false); exportAs(b.dataset.x); });
    document.addEventListener('pointerdown', (e) => {
      const pop = $('exportPop');
      if (!pop.hidden && !pop.contains(e.target) && e.target !== $('exportBtn')) showExport(false);
    });
    // drop a file anywhere
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('drop').hidden = false; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; $('drop').hidden = true;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importFile(f);
    });
  }

  // ───────── import ─────────
  async function importFile(file) {
    try {
      const buf = await file.arrayBuffer();
      loadBuffer(buf, file.name, await sniff(buf, file.name));
    } catch (e) { toast(`Couldn't open “${file.name}”: ${e.message}`, true); }
  }
  async function sniff(buf, name) {
    const h = new Uint8Array(buf.slice(0, 4));
    const tag = String.fromCharCode(...h);
    if (tag === 'MThd' || tag === 'RIFF' || /\.(mid|midi|kar|rmi)$/i.test(name)) return { kind: 'midi' };
    return { kind: 'xml', text: await window.CSMusicXML.readFile(buf, name) };
  }
  function loadBuffer(buf, name, how) {
    const tr = how.kind === 'midi' ? window.CSMidiFile.parse(buf, name) : window.CSMusicXML.parse(how.text, name);
    if (!tr.notes.length) throw new Error('there are no notes in it');
    fileTrack = tr;
    setSource('file');
    if (S.mode !== 'roll') setMode('roll');
    toast(`Loaded “${tr.name}”: ${fmtTime(tr.duration)}, ${tr.notes.length} notes. Press ▶ to play.`);
    return tr;
  }

  // ───────── export ─────────
  function showExport(on) {
    const pop = $('exportPop'), btn = $('exportBtn');
    if (on) {
      if (session.state !== 'idle') recStop();
      else if (scoreModel.running) scoreModel.stop(performance.now());
      const bars = scoreModel.barsWritten(performance.now());
      $('exportInfo').textContent = scoreModel.isEmpty() ? 'nothing recorded yet' : `${bars} bar${bars === 1 ? '' : 's'} · ♩=${Math.round(scoreModel.bpm)} · ${scoreModel.beats}/4`;
      for (const b of pop.querySelectorAll('button[data-x]')) b.disabled = scoreModel.isEmpty();
      const r = btn.getBoundingClientRect(), app = $('app').getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(r.left - app.left, app.width - 460)) + 'px';
      pop.style.top = (r.bottom - app.top + 6) + 'px';
    }
    pop.hidden = !on;
    btn.classList.toggle('on', on);
  }
  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  function notation() {
    const ms = performance.now(), total = Math.max(1, scoreModel.barsWritten(ms));
    const lay = scoreModel.layout(ms, 0, total - 1);
    const bars = [];
    for (let k = 0; k < total; k++) {
      const B = lay.bars.get(k);
      bars.push({
        staves: B.staves.map((list) => list.map((it) => ({
          rest: it.rest, start: it.start, value: it.value, whole: !!it.whole, tiePrev: !!it.tiePrev, tieNext: !!it.tieNext,
          notes: it.rest ? null : it.notes.map((n) => { const sp = n.sp || E.spellMidi(n.midi, S.spelling); return { l: sp.l, a: sp.a, octave: sp.octave }; }),
        }))),
        endStyle: lay.phraseEnds.includes((k + 1) * lay.tpb) ? 'double' : null,
      });
    }
    const d = new Date();
    return { title: 'CHORD//SCOPE session ' + d.toLocaleDateString(), date: d.toISOString().slice(0, 10), software: 'CHORD//SCOPE', bpm: scoreModel.bpm, beats: scoreModel.beats, tpb: lay.tpb, bars, marks: S.score.symbols ? lay.marks : [] };
  }
  function midiSong(quantized) {
    const grid = scoreModel.grid;
    const notes = scoreModel.notes.map((n) => {
      if (quantized) return { m: n.midi, vel: n.vel, on: n.on / 4, off: (n.off != null ? n.off : n.on + grid) / 4 };
      const a = Math.max(0, n.raw != null ? n.raw : n.on);
      return { m: n.midi, vel: n.vel, on: a / 4, off: (n.rawOff != null ? n.rawOff : n.off != null ? n.off : a + grid) / 4 };
    });
    const pedals = scoreModel.pedals.map((p) => ({ q: (quantized ? Math.round(p.t / grid) * grid : Math.max(0, p.t)) / 4, down: p.down }));
    return { name: 'CHORD//SCOPE session', bpm: scoreModel.bpm, beats: scoreModel.beats, unit: 4, notes, pedals };
  }
  // build an export without saving it (also used by the tests)
  function exportData(kind) {
    if (kind === 'musicxml') return { name: `chordscope-${stamp()}.musicxml`, mime: 'application/vnd.recordare.musicxml+xml', ext: 'musicxml', desc: 'MusicXML score', data: window.CSMusicXML.write(notation()) };
    if (kind === 'midi' || kind === 'midiq') return { name: `chordscope-${stamp()}${kind === 'midiq' ? '-quantized' : ''}.mid`, mime: 'audio/midi', ext: 'mid', desc: 'MIDI file', data: window.CSMidiFile.write(midiSong(kind === 'midiq')) };
    return null;
  }
  async function exportAs(kind) {
    if (scoreModel.isEmpty()) { toast('Nothing to export yet: press ● REC and play something.'); return; }
    try {
      if (kind === 'pdf') { printScore(); return; }
      const x = exportData(kind);
      const saved = await saveFile(x.name, x.data, x.mime, x.ext, x.desc);
      if (saved) toast(`Saved ${saved}`);
    } catch (e) { toast('Export failed: ' + e.message, true); }
  }
  async function saveFile(name, data, mime, ext, desc) {
    const blob = new Blob([data], { type: mime });
    if (window.__csSave) return window.__csSave(name, blob);
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: ['.' + ext] } }] });
        const w = await h.createWritable();
        await w.write(blob); await w.close();
        return h.name;
      } catch (e) { if (e && e.name === 'AbortError') return null; /* fall back to a download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return name + ' (Downloads)';
  }
  function printHTML() {
    const pp = scoreView.printPages(performance.now());
    const pages = pp.pages.map((p) => `<div class="pg"><svg class="page" viewBox="0 0 ${p.w.toFixed(2)} ${p.h.toFixed(2)}" preserveAspectRatio="xMidYMid meet">${p.body}</svg></div>`).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>CHORD//SCOPE score</title><style>' +
      '@page{size:A4 landscape;margin:8mm}html,body{margin:0;background:#fff}' +
      '.pg{height:190mm;display:flex;align-items:center;justify-content:center;break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}' +
      'svg.page{width:100%;height:100%}use,path{fill:#151515}.sl{stroke:#444;stroke-width:.1}.bl,.lg{stroke:#151515;stroke-width:.16}' +
      '.stem{stroke:#151515;stroke-width:.13;stroke-linecap:round}.hint,.cursor{display:none}' +
      `</style></head><body><svg width="0" height="0" style="position:absolute" aria-hidden="true">${pp.defs}</svg>${pages}</body></html>`;
  }
  function printScore() {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-12000px;top:0;width:1123px;height:794px;border:0'; // off screen, but laid out (A4 landscape)
    fr.srcdoc = printHTML();
    fr.onload = () => {
      try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { toast('Printing failed: ' + e.message, true); }
      setTimeout(() => fr.remove(), 1500);
    };
    document.body.appendChild(fr);
    toast('Opening the print dialog: choose “Save as PDF” to make a PDF.');
  }

  // ───────── notices ─────────
  let toastTimer = 0;
  function toast(msg, err) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, err ? 7000 : 4200);
  }

  // ───────── header & settings ─────────
  function setMode(mode) {
    if (S.mode === 'score' && mode !== 'score' && session.state === 'idle') scoreModel.stop(performance.now());
    S.mode = mode; persist();
    for (const b of $('modeSeg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === mode);
    $('showbar').hidden = mode !== 'show';
    $('lcd').hidden = mode === 'score' || mode === 'roll';
    $('score').hidden = mode !== 'score';
    $('roll').hidden = mode !== 'roll';
    applyKeys();
    if (mode === 'score') { scoreView.invalidate(); startScoreLoop(); }
    if (mode === 'roll') { syncTransport(); requestAnimationFrame(() => roll.request()); }
    readoutDirty = true; keysDirty = true; frame();
    requestAnimationFrame(fitSym);
  }
  function applyKeys() {
    const on = S.keys[S.mode] !== false;
    $('kbd').classList.toggle('collapsed', !on);
    $('keysBtn').textContent = on ? 'KEYS ▾' : 'KEYS ▴';
  }
  function setToggle(btn, on, words) {
    btn.classList.toggle('on', !!on);
    if (words) btn.firstChild.nodeValue = on ? 'ON' : 'OFF';
  }
  function showSettings(on) {
    $('settings').hidden = !on;
    $('setBtn').classList.toggle('on', on);
  }
  function initHeader() {
    chSel.innerHTML = '<option value="omni">Omni</option>' + Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}</option>`).join('');
    chSel.value = String(S.channel);
    inSel.addEventListener('change', () => { S.inName = inSel.value; persist(); releaseSource('midi'); rebind(); inSel.blur(); });
    thruSel.addEventListener('change', () => { S.thruName = thruSel.value; persist(); bindPorts(); thruSel.blur(); });
    chSel.addEventListener('change', () => { S.channel = chSel.value; persist(); releaseSource('midi'); chSel.blur(); });
    for (const b of $('modeSeg').querySelectorAll('button')) b.addEventListener('click', () => setMode(b.dataset.mode));
    const pb = $('pianoBtn');
    setToggle(pb, S.piano);
    pb.addEventListener('click', () => {
      S.piano = !S.piano; persist(); setToggle(pb, S.piano);
      if (S.piano) ensureAudio(); else piano.allOff();
      frame();
    });
    const vol = $('vol');
    vol.value = Math.round(S.volume * 100);
    vol.addEventListener('input', () => { S.volume = vol.value / 100; persist(); piano.setVolume(S.volume); });
    $('setBtn').addEventListener('click', (e) => { e.stopPropagation(); showSettings($('settings').hidden); });
    document.addEventListener('pointerdown', (e) => {
      const st = $('settings');
      if (!st.hidden && !st.contains(e.target) && e.target !== $('setBtn')) showSettings(false);
    });
    const lb = $('latchBtn');
    lb.addEventListener('click', () => {
      latch = !latch; setToggle(lb, latch);
      if (!latch) releaseSource('latch');
      frame();
    });
    $('clearBtn').addEventListener('click', panic);
    $('keysBtn').addEventListener('click', () => { S.keys[S.mode] = S.keys[S.mode] === false; persist(); applyKeys(); });
  }
  function initSettings() {
    const seg = (id, key, conv, after) => {
      const el = $(id);
      const sync = () => { for (const b of el.querySelectorAll('button')) b.classList.toggle('on', String(S[key]) === b.dataset.v); };
      for (const b of el.querySelectorAll('button')) b.addEventListener('click', () => { S[key] = conv(b.dataset.v); persist(); sync(); if (after) after(); readoutDirty = true; keysDirty = true; frame(); });
      sync();
    };
    for (const b of $('spellSeg').querySelectorAll('button')) if (b.dataset.v !== 'auto') b.innerHTML = accHTML(b.textContent);
    seg('spellSeg', 'spelling', (v) => v, () => { scoreModel.setSpelling(S.spelling); scoreView.invalidate(); });
    seg('rangeSeg', 'range', (v) => +v, buildKeys);
    const tog = (id, key, after) => {
      const b = $(id);
      setToggle(b, S[key], true);
      b.addEventListener('click', () => { S[key] = !S[key]; persist(); setToggle(b, S[key], true); if (after) after(); readoutDirty = true; keysDirty = true; frame(); });
    };
    tog('pedalHoldBtn', 'pedalHold');
    tog('holdLastBtn', 'holdLast', () => { if (!S.holdLast) lastLive = null; });
    tog('labelsBtn', 'labels');
    tog('qwertyBtn', 'qwerty', () => { if (!S.qwerty) { qDown.clear(); releaseSource('key'); } });
    const ib = $('idleBtn');
    setToggle(ib, S.score.idle, true);
    ib.addEventListener('click', () => { S.score.idle = !S.score.idle; scoreModel.idleStop = S.score.idle; persist(); setToggle(ib, S.score.idle, true); });
    const verb = $('verb');
    verb.value = Math.round(S.reverb * 100);
    verb.addEventListener('input', () => { S.reverb = verb.value / 100; persist(); piano.setReverb(S.reverb); });
  }

  function renderStatus() {
    const n = heldSet().size;
    const parts = [`<span><i class="dot ${midiState.level}"></i>${esc(midiState.msg)}</span>`];
    if (thruOut) parts.push(`<span class="hot">THRU → ${esc(S.thruName)}</span>`);
    parts.push(`<span>${n} key${n === 1 ? '' : 's'} down</span>`);
    if (S.piano && piano.mode === 'loading') parts.push('<span class="hot">loading piano…</span>');
    else if (S.piano && piano.ctx && piano.ctx.state !== 'running') parts.push('<span class="hot">click anywhere to wake the piano</span>');
    parts.push('<span class="spacer"></span>');
    if (S.qwerty) parts.push(`<span>QWERTY  Z = C${S.qOct}  Q = C${S.qOct + 1}  ← →</span>`);
    const h = parts.join('');
    const st = $('status');
    if (st.dataset.h !== h) { st.innerHTML = h; st.dataset.h = h; }
    const hint = latch ? 'LATCH ON · click keys to toggle them' : 'click or drag keys to play';
    const qh = $('qwertyHint');
    if (qh.textContent !== hint) qh.textContent = hint;
  }

  // wake audio on the first gesture if the piano was left on
  const wake = () => { if (S.piano) ensureAudio(); };
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);
  window.addEventListener('resize', () => requestAnimationFrame(fitSym));

  // ───────── boot ─────────
  initStaff();
  buildKeys();
  initHeader();
  initSettings();
  initShowUI();
  initScoreUI();
  initMetroUI();
  initTransportUI();
  initRollUI();
  syncTransport();
  setMode(S.mode);
  fillPorts();
  if (S.piano) ensureAudio();
  initMIDI();
  frame();

  // test hooks (used by the headless harness; harmless in normal use)
  window.__chordscope = {
    S, noteOn, noteOff, setPedal, panic, piano, heldSet, scoreModel, scoreView, setMode, kbd, gpu,
    metro, metroStart, metroStop, setTempo, setMeter, session, recStart, recStop, player, playToggle, haltAll, roll,
    exportData, printHTML, notation, midiSong, loadBuffer, sniff, setSource, get fileTrack() { return fileTrack; }, get takeTrack() { return takeTrack; }, get rollChord() { return rollChord; },
    get lastLive() { return lastLive; }, get showRes() { return showRes; }, get midiState() { return midiState; },
    // feed a timed performance straight into the score: [[ms, midi, on(1)/off(0)], ...] ending "now"
    scoreFeed(evts, tailMs) {
      const end = evts.reduce((a, e) => Math.max(a, e[0]), 0);
      const base = performance.now() - end - (tailMs || 0);
      for (const [t, m, on] of evts) {
        scoreModel.update(base + t);
        if (on) scoreModel.noteOn(m, 0.8, base + t); else scoreModel.noteOff(m, base + t);
      }
      scoreView.follow();
    },
  };
})();
