/* ───────────────────────── CHORD//SCOPE · score model ─────────────────────────
   Live transcription of what you play into bars of real notation.
   Time is counted in ticks of a 16th note (4 per quarter note).
   · The clock starts on the first note of a phrase: that note is beat 1 of a
     fresh bar. Onsets and releases snap to the quantize grid.
   · Each staff (treble ≥ middle C, bass below) becomes one line of chords and
     rests; a chord lasts until its notes are released or the next chord in
     that staff starts.
   · Events are split at barlines (tied) and into readable values: whole,
     dotted half, half, dotted quarter, quarter, dotted eighth, eighth, 16th,
     never hiding a beat or the middle of a 4/4 bar.
   · After a full bar of silence the phrase closes at its barline; the next
     note starts a new bar.
   · With a running metronome (syncAnchor) a phrase starts on the metronome's
     bar line instead, and startAt() opens a phrase before any note (a recorded
     session with count-in), so silences become rests.
   · Each note also keeps its unquantised position (raw / rawOff) and the
     sustain pedal is logged, for "as played" MIDI export and playback.        */
(function (G) {
  'use strict';
  const TPQ = 4;
  const NOTE_VALUES = [16, 12, 8, 6, 4, 3, 2, 1];
  const REST_VALUES = [8, 4, 2, 1];

  // may a note/rest of `v` ticks start `s` ticks into a bar of `beats` quarter beats?
  function fits(s, v, beats, rest) {
    const e = s + v;
    if (e > beats * TPQ) return false;
    if (v === 1) return true;
    if (v === 2) return s % 2 === 0; // an eighth stays inside its beat
    if (v === 3) return !rest && (s % 4 === 0 || s % 4 === 1);
    if (v === 4) return s % 4 === 0;
    if (s % 4 !== 0) return false; // anything longer starts on a beat
    if (v === 6) return !rest && (beats === 4 ? s === 0 || s === 8 : beats === 3 ? s === 0 || s === 4 : s === 0);
    if (v === 8) return beats === 4 ? s === 0 || s === 8 : beats === 3 ? s === 0 || s === 4 : s === 0;
    if (v === 12) return !rest && (beats === 4 ? s === 0 || s === 4 : beats === 3 && s === 0);
    if (v === 16) return beats === 4 && s === 0;
    return false;
  }
  // split [s, e) (ticks within one bar) into notatable values, largest first
  function decompose(s, e, beats, rest) {
    const out = [];
    const vals = rest ? REST_VALUES : NOTE_VALUES;
    while (s < e) {
      let v = 1;
      for (const c of vals) if (s + c <= e && fits(s, c, beats, rest)) { v = c; break; }
      out.push({ s, v });
      s += v;
    }
    return out;
  }

  class ScoreModel {
    constructor(engine, opts) {
      opts = opts || {};
      this.E = engine;
      this.bpm = opts.bpm || 90;
      this.beats = opts.beats || 4;
      this.grid = opts.grid || 2;
      this.idleStop = opts.idleStop !== false;
      this.spelling = opts.spelling || 'auto';
      this.syncAnchor = null; // (ms) → ms of the metronome bar line this phrase should start on, or null
      this.version = 0;
      this.pedalDown = false; // the physical pedal: survives reset() (you may be holding it when REC is pressed)
      this.reset();
    }
    get tpb() { return this.beats * TPQ; }
    get tickMs() { return 60000 / (this.bpm * TPQ); }
    reset() {
      this.notes = []; // {id, midi, vel, on, off|null, raw, rawOff, staff, sp}
      this.held = new Map();
      this.pedals = []; // {t (unquantised tick), down}, in time order
      this.running = false;
      this.anchorMs = 0; this.anchorTick = 0; // tempo anchor (moves when the tempo changes)
      this.phraseTick = 0; // where the current phrase starts: always on a bar line
      this.endTick = 0;
      this.lastAct = 0;
      this.phraseEnds = [];
      this.nid = 1;
      this.onsets = []; // unique onset ticks, ascending
      this.oCache = []; // per onset: {markText, shown}
      this.settled = 0; // onsets before this index are final
      this.lastShown = null;
      this.version++;
    }
    isEmpty() { return this.notes.length === 0; }
    tickAt(ms) { return this.anchorTick + (ms - this.anchorMs) / this.tickMs; }
    quant(t) { return Math.round(t / this.grid) * this.grid; }
    nowTick(ms) { return this.running ? this.tickAt(ms) : this.endTick; }

    // open a phrase at `ms` (bar 1 of a recording) without waiting for a note
    startAt(ms) {
      if (this.running) return;
      this.running = true; this.anchorMs = ms; this.anchorTick = this.endTick; this.phraseTick = this.endTick; this.lastAct = this.phraseTick;
      if (this.pedalDown) this.pedals.push({ t: this.phraseTick, down: true });
      this.version++;
    }
    noteOn(midi, vel, ms) {
      if (this.held.has(midi)) this.noteOff(midi, ms);
      if (!this.running) {
        const bar = this.syncAnchor ? this.syncAnchor(ms) : null;
        this.startAt(bar != null ? bar : ms);
      }
      const raw = this.tickAt(ms);
      const on = Math.max(this.phraseTick, this.quant(raw));
      const n = { id: this.nid++, midi, vel, on, off: null, raw: Math.max(this.phraseTick - this.grid, raw), rawOff: null, staff: midi >= 60 ? 0 : 1, sp: null };
      // keep notes ordered by onset (a late, rounded-down onset may land before an earlier one)
      let i = this.notes.length;
      while (i > 0 && this.notes[i - 1].on > on) i--;
      this.notes.splice(i, 0, n);
      this.held.set(midi, n);
      if (!this.onsets.length || this.onsets[this.onsets.length - 1] < on) this.onsets.push(on);
      else if (!this.onsets.includes(on)) { this.onsets.push(on); this.onsets.sort((a, b) => a - b); this.settled = Math.min(this.settled, this.onsets.indexOf(on)); }
      this.lastAct = Math.max(this.lastAct, on);
      this.version++;
      return n;
    }
    noteOff(midi, ms) {
      const n = this.held.get(midi);
      if (!n) return;
      this.held.delete(midi);
      const raw = this.tickAt(ms);
      n.off = Math.max(n.on + this.grid, this.quant(raw));
      n.rawOff = Math.max(n.raw + 0.25, raw);
      this.lastAct = Math.max(this.lastAct, n.off);
      this.version++;
    }
    // call every frame; returns true when a phrase just closed after a silent bar
    update(ms) {
      if (!this.running || !this.idleStop || this.held.size) return false;
      if (this.tickAt(ms) - this.lastAct < this.tpb) return false;
      this.close(ms);
      return true;
    }
    stop(ms) { // manual stop: release what's held and close the phrase
      if (!this.running) return;
      for (const m of [...this.held.keys()]) this.noteOff(m, ms);
      this.close(ms);
    }
    close(ms) {
      const tpb = this.tpb;
      const endTick = Math.max(this.phraseTick + tpb, Math.ceil(this.lastAct / tpb) * tpb);
      if (this.pedalDown) { // the pedal is still down: it's let go when the phrase ends (or when you stopped)
        const t = ms != null ? Math.min(endTick, Math.max(this.phraseTick, this.tickAt(ms))) : endTick;
        this.pedals.push({ t: Math.max(t, this.pedals.length ? this.pedals[this.pedals.length - 1].t : t), down: false });
      }
      this.running = false;
      this.endTick = endTick;
      this.phraseEnds.push(this.endTick);
      this.version++;
    }
    pedal(down, ms) { // sustain pedal, logged while a phrase runs (MIDI export / playback)
      if (down === this.pedalDown) return;
      this.pedalDown = down;
      if (!this.running) return;
      const last = this.pedals.length ? this.pedals[this.pedals.length - 1].t : -Infinity;
      this.pedals.push({ t: Math.max(this.phraseTick, last, this.tickAt(ms)), down });
    }
    // number of bars that have something written in them (cheap; no layout)
    barsWritten(ms) {
      if (!this.notes.length) return 0;
      const grid = this.grid, now = this.nowTick(ms);
      const limit = this.running ? Math.max(this.phraseTick, Math.floor(now / grid) * grid) : this.endTick;
      let maxEnd = limit;
      for (const n of this.held.values()) maxEnd = Math.max(maxEnd, n.on + grid, limit);
      return Math.max(Math.ceil(maxEnd / this.tpb), this.running ? Math.floor(now / this.tpb) + 1 : 0);
    }
    setTempo(bpm, ms) {
      if (this.running) { this.anchorTick = this.tickAt(ms); this.anchorMs = ms; }
      this.bpm = bpm; this.version++;
    }
    setMeter(beats) {
      this.beats = beats;
      if (!this.running) this.endTick = Math.ceil(this.endTick / this.tpb) * this.tpb;
      this.version++;
    }
    setGrid(grid) { this.grid = grid; this.version++; }
    setSpelling(sp) { this.spelling = sp; this.settled = 0; this.lastShown = null; this.oCache = []; this.version++; }

    // notes sounding at tick t (looks back a few bars for long holds)
    sounding(t) {
      const out = [];
      const from = t - 8 * this.tpb;
      for (let i = this.notes.length - 1; i >= 0; i--) {
        const n = this.notes[i];
        if (n.on > t) continue;
        if (n.on < from) break;
        if (n.off == null || n.off > t) out.push(n);
      }
      return out;
    }
    // decide staff, spelling and chord symbol for each onset (final once no more notes can join it)
    analyseOnsets(limit) {
      const E = this.E, opts = { spelling: this.spelling };
      let shown = this.lastShown;
      for (let i = this.settled; i < this.onsets.length; i++) {
        const t = this.onsets[i];
        const snd = this.sounding(t);
        const starting = snd.filter((n) => n.on === t);
        this.assignStaves(starting);
        const pcs = new Set(snd.map((n) => n.midi % 12));
        if (pcs.size >= 3 && snd.length <= E.MAX_NOTES) {
          const r = E.analyze(snd.map((n) => n.midi), opts);
          for (const n of starting) {
            const sp = r.notes && r.notes.find((x) => x.midi === n.midi);
            n.sp = sp || E.spellMidi(n.midi, this.spelling);
          }
        } else {
          for (const n of starting) n.sp = E.spellMidi(n.midi, this.spelling);
        }
        const h = this.harmonyAt(t, snd, starting);
        const markText = h ? h.text : null;
        const show = markText && markText !== shown ? markText : null;
        if (show) shown = show;
        this.oCache[i] = { t, show, chord: show ? h : null };
        if (t + this.grid <= limit && i === this.settled) { this.settled = i + 1; this.lastShown = shown; }
      }
    }
    // Hands: notes struck together are grouped into clusters (a gap wider than a 5th, or a span
    // too wide for one hand, separates them); each cluster goes to the staff its centre is nearest.
    assignStaves(starting) {
      if (!starting.length) return;
      const ns = starting.slice().sort((a, b) => a.midi - b.midi);
      const clusters = [[ns[0]]];
      for (let i = 1; i < ns.length; i++) {
        if (ns[i].midi - ns[i - 1].midi > 7) clusters.push([ns[i]]); else clusters[clusters.length - 1].push(ns[i]);
      }
      const out = [];
      const split = (c) => {
        if (c.length < 2 || c[c.length - 1].midi - c[0].midi <= 13) { out.push(c); return; }
        let best = 1, bestScore = -Infinity;
        for (let i = 1; i < c.length; i++) {
          const gap = c[i].midi - c[i - 1].midi, mid = (c[i].midi + c[i - 1].midi) / 2;
          const sc = gap - 0.3 * Math.abs(mid - 59.5);
          if (sc > bestScore) { bestScore = sc; best = i; }
        }
        split(c.slice(0, best)); split(c.slice(best));
      };
      clusters.forEach(split);
      for (const c of out) {
        const centre = c.reduce((a, n) => a + n.midi, 0) / c.length;
        for (const n of c) n.staff = centre >= 59.5 ? 0 : 1;
      }
    }
    // Chord symbol for an onset — only when a chord is struck (2+ right-hand notes, or a left-hand
    // chord/dyad), so melody notes passing over a held chord don't rename it. Returns the engine's
    // analysis ({text, symbol, tones}) so exports can spell the chord out, or null.
    harmonyAt(t, snd, starting) {
      const E = this.E, opts = { spelling: this.spelling };
      const rh = starting.filter((n) => n.staff === 0), lh = starting.filter((n) => n.staff === 1);
      const lhHeld = snd.filter((n) => n.staff === 1 && n.on < t);
      const pcsOf = (arr) => new Set(arr.map((n) => n.midi % 12));
      const name = (arr) => {
        if (pcsOf(arr).size < 3 || arr.length > E.MAX_NOTES) return null;
        const r = E.analyze(arr.map((n) => n.midi), opts);
        return r.kind === 'chord' && r.confidence === 'high' ? r : null;
      };
      if (rh.length >= 2) return name(starting.concat(lhHeld));
      const lp = pcsOf(lh);
      if (lp.size >= 3) return name(lh.concat(lhHeld));
      if (lp.size === 2) {
        const sorted = lh.slice().sort((a, b) => a.midi - b.midi);
        const lo = sorted[0].midi, hi = sorted.find((n) => n.midi % 12 !== lo % 12).midi;
        const iv = (((hi - lo) % 12) + 12) % 12;
        const triad = (root, ivs) => { // read a two-note left hand as the chord it implies, keeping its bass
          let r = root; while (r <= lo) r += 12;
          const res = E.analyze([lo].concat(ivs.map((x) => r + x)), opts);
          return res.text ? res : null;
        };
        if (iv === 7 || iv === 5) { // open fifth: if the melody note on top is its 3rd, that completes the triad
          const root = iv === 7 ? lo : hi;
          if (rh.length === 1) {
            const third = (((rh[0].midi - root) % 12) + 12) % 12;
            if (third === 3 || third === 4) return name(lh.concat(rh, lhHeld));
          }
          return triad(root, [0, 7]);
        }
        if (iv === 4) return triad(lo, [0, 4, 7]);
        if (iv === 8) return triad(hi, [0, 4, 7]);
        if (iv === 3) return triad(lo, [0, 3, 7]);
        if (iv === 9) return triad(hi, [0, 3, 7]);
        return name(lh.concat(rh, lhHeld));
      }
      return null;
    }

    // Build bars [fromBar, toBar] for drawing at time `ms`.
    layout(ms, fromBar, toBar) {
      const tpb = this.tpb, grid = this.grid, beats = this.beats;
      const now = this.nowTick(ms);
      const running = this.running;
      const limit = running ? Math.max(this.phraseTick, Math.floor(now / grid) * grid) : this.endTick;
      // a held note shows the time it has actually sounded (at least one grid step)
      const heldEnd = (n) => Math.max(n.on + grid, limit);
      let maxEnd = limit;
      for (const n of this.held.values()) maxEnd = Math.max(maxEnd, heldEnd(n));
      const totalBars = Math.ceil(maxEnd / tpb);
      const out = { tpb, beats, grid, now, limit, running, totalBars, bars: new Map(), marks: [], phraseEnds: this.phraseEnds };
      const b0 = Math.max(0, fromBar | 0), b1 = Math.min(toBar == null ? Infinity : toBar, totalBars - 1);
      if (b1 < b0) return out;
      this.analyseOnsets(limit);
      const t0 = b0 * tpb, t1 = (b1 + 1) * tpb;

      // candidate notes: from a few bars back (long holds) through the window, plus each staff's next onset after it
      let lo = 0, hi = this.notes.length;
      const from = t0 - 8 * tpb;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this.notes[mid].on < from) lo = mid + 1; else hi = mid; }
      const cand = [[], []], nextAfter = [null, null];
      for (let i = lo; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.on >= t1) {
          if (nextAfter[n.staff] == null) nextAfter[n.staff] = n.on;
          if (nextAfter[0] != null && nextAfter[1] != null) break;
          continue;
        }
        cand[n.staff].push(n);
      }
      const bar = (k) => {
        let B = out.bars.get(k);
        if (!B) { B = { index: k, start: k * tpb, staves: [[], []] }; out.bars.set(k, B); }
        return B;
      };
      for (let k = b0; k <= b1; k++) bar(k);

      for (let s = 0; s < 2; s++) {
        const groups = [];
        for (const n of cand[s]) {
          const g = groups[groups.length - 1];
          if (g && g.t === n.on) g.notes.push(n); else groups.push({ t: n.on, notes: [n] });
        }
        const events = [];
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          const nextT = i + 1 < groups.length ? groups[i + 1].t : nextAfter[s];
          let end = 0, open = false;
          for (const n of g.notes) { end = Math.max(end, n.off != null ? n.off : heldEnd(n)); if (n.off == null) open = true; }
          if (nextT != null && nextT < end) { end = nextT; open = false; }
          if (end <= g.t) end = g.t + grid;
          g.notes.sort((a, b) => a.midi - b.midi);
          events.push({ t: g.t, end, notes: g.notes, open, staff: s });
        }
        // walk the window: chords, and rests in the gaps up to what's been written
        const segs = [];
        let cur = t0;
        for (const ev of events) {
          if (ev.end <= t0) continue;
          if (ev.t >= t1) break;
          const a = Math.max(ev.t, t0);
          if (a > cur) segs.push({ rest: true, a: cur, b: a });
          const b = Math.min(ev.end, t1);
          segs.push({ rest: false, a, b, ev });
          cur = b;
        }
        const restEnd = Math.min(limit, t1);
        if (cur < restEnd) segs.push({ rest: true, a: cur, b: restEnd });

        for (const sg of segs) {
          let x = sg.a;
          while (x < sg.b) {
            const k = Math.floor(x / tpb), bs = k * tpb, y = Math.min(sg.b, bs + tpb);
            const list = bar(k).staves[s];
            if (sg.rest) {
              if (x === bs && y === bs + tpb) list.push({ rest: true, start: bs, value: tpb, whole: true });
              else for (const p of decompose(x - bs, y - bs, beats, true)) list.push({ rest: true, start: bs + p.s, value: p.v });
            } else {
              for (const p of decompose(x - bs, y - bs, beats, false)) {
                const st = bs + p.s;
                list.push({ rest: false, start: st, value: p.v, ev: sg.ev, notes: sg.ev.notes, tiePrev: st > sg.ev.t, tieNext: st + p.v < sg.ev.end, open: sg.ev.open && st + p.v >= sg.ev.end });
              }
            }
            x = y;
          }
        }
      }
      // link tied pieces (same event) so the renderer can draw ties across bars
      for (let s = 0; s < 2; s++) {
        let prev = null;
        for (let k = b0; k <= b1; k++) {
          for (const p of out.bars.get(k).staves[s]) {
            if (prev && !p.rest && p.tiePrev && prev.ev === p.ev) { prev.next = p; p.prev = prev; }
            prev = p.rest ? null : p;
          }
        }
      }
      for (const c of this.oCache) if (c && c.show && c.t >= t0 && c.t < t1) out.marks.push({ t: c.t, text: c.show, chord: c.chord });
      return out;
    }
  }
  ScoreModel.decompose = decompose;
  ScoreModel.TPQ = TPQ;
  G.ScoreModel = ScoreModel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
