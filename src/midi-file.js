/* ───────────────────────── CHORD//SCOPE · Standard MIDI Files ─────────────────────────
   parse(arrayBuffer)  any .mid (format 0/1/2, PPQ or SMPTE timing, running status) → a playable
                       track: notes in seconds, sustain pedal, tempo map, time signature. Drums
                       (channel 10) are left out: this is a piano.
   write(song)         a type-1 file: a tempo/metre track and one piano track.            */
(function (G) {
  'use strict';

  // ── reading ──
  function parse(buf, fileName) {
    const u8 = new Uint8Array(buf);
    let p = 0;
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[p + i]); return s; };
    const u32 = () => { const v = (u8[p] << 24 | u8[p + 1] << 16 | u8[p + 2] << 8 | u8[p + 3]) >>> 0; p += 4; return v; };
    const u16 = () => { const v = u8[p] << 8 | u8[p + 1]; p += 2; return v; };
    // some files carry a RIFF ("RMID") wrapper
    if (str(4) === 'RIFF') { const i = indexOf(u8, 'MThd'); if (i < 0) throw new Error('no MIDI data in this RIFF file'); p = i; }
    if (str(4) !== 'MThd') throw new Error('not a MIDI file');
    p += 4;
    const hlen = u32(), hstart = p;
    const format = u16(), ntrks = u16(), division = u16();
    p = hstart + hlen;
    const smpte = division & 0x8000;
    const ppq = smpte ? 0 : division;
    const fps = smpte ? 256 - (division >> 8) : 0; // SMPTE timing: frames per second × ticks per frame
    const ticksPerSec = smpte ? (fps === 29 ? 29.97 : fps) * (division & 0xff) : 0;

    const tempos = []; // {tick, us}
    let meter = null, name = '';
    const raw = []; // {on, off, m, vel, ch}
    const pedals = []; // {tick, down, ch}
    let maxTick = 0;
    for (let tr = 0; tr < ntrks && p + 8 <= u8.length; tr++) {
      const id = str(4); p += 4;
      const len = u32();
      const end = Math.min(u8.length, p + len);
      if (id !== 'MTrk') { p = end; tr--; continue; } // skip unknown chunks
      let tick = 0, status = 0, chStatus = 0;
      const open = new Map(); // ch*128+note → [start events]
      const vlq = () => { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
      while (p < end) {
        tick += vlq();
        const b = u8[p];
        if (b & 0x80) { p++; status = b; if (b < 0xf0) chStatus = b; } // running status: only channel messages repeat
        else { status = chStatus; if (!status) { p++; continue; } }
        if (status === 0xff) {
          const type = u8[p++], l = vlq(), d = u8.subarray(p, p + l);
          p += l;
          if (type === 0x51 && l >= 3) tempos.push({ tick, us: (d[0] << 16) | (d[1] << 8) | d[2] });
          else if (type === 0x58 && l >= 2 && !meter && d[0] >= 1 && d[0] <= 32 && d[1] <= 5) meter = { beats: d[0], unit: Math.pow(2, d[1]) };
          else if (type === 0x03 && !name) name = decodeText(d).trim();
          else if (type === 0x2f) break;
          continue;
        }
        if (status === 0xf0 || status === 0xf7) { p += vlq(); continue; }
        if (status > 0xf0) continue; // stray system message
        const hi = status & 0xf0, ch = status & 0x0f;
        const d1 = u8[p++], d2 = hi === 0xc0 || hi === 0xd0 ? 0 : u8[p++];
        if (hi === 0x90 && d2 > 0) {
          const k = ch * 128 + d1;
          if (!open.has(k)) open.set(k, []);
          open.get(k).push({ tick, vel: d2 });
        } else if (hi === 0x80 || hi === 0x90) {
          const k = ch * 128 + d1, st = open.get(k);
          if (st && st.length) { const s = st.shift(); if (ch !== 9) raw.push({ on: s.tick, off: tick, m: d1, vel: s.vel, ch }); }
        } else if (hi === 0xb0 && d1 === 64 && ch !== 9) pedals.push({ tick, down: d2 >= 64, ch });
        maxTick = Math.max(maxTick, tick);
      }
      for (const [k, st] of open) for (const s of st) if ((k >> 7) !== 9) raw.push({ on: s.tick, off: Math.max(s.tick + 1, tick), m: k & 127, vel: s.vel, ch: k >> 7 });
      maxTick = Math.max(maxTick, tick);
      p = end;
    }
    if (format > 2) throw new Error('unknown MIDI format ' + format);

    // tempo map: ticks → seconds
    tempos.sort((a, b) => a.tick - b.tick);
    const segs = [{ tick: 0, us: 500000, sec: 0 }];
    for (const t of tempos) {
      const last = segs[segs.length - 1];
      const sec = last.sec + ((t.tick - last.tick) * last.us) / 1e6 / (ppq || 1);
      if (t.tick === last.tick) { last.us = t.us; continue; }
      segs.push({ tick: t.tick, us: t.us, sec });
    }
    const secAt = (tick) => {
      if (smpte) return tick / ticksPerSec;
      let s = segs[0];
      for (let i = 1; i < segs.length && segs[i].tick <= tick; i++) s = segs[i];
      return s.sec + ((tick - s.tick) * s.us) / 1e6 / ppq;
    };
    raw.sort((a, b) => a.on - b.on || a.m - b.m);
    const notes = raw.map((n) => { const t = secAt(n.on); return { m: n.m, vel: n.vel / 127, t, d: Math.max(0.02, secAt(n.off) - t) }; });
    // one pedal stream (any channel holding it down)
    pedals.sort((a, b) => a.tick - b.tick);
    const downCh = new Set(), ped = [];
    for (const e of pedals) {
      const was = downCh.size > 0;
      if (e.down) downCh.add(e.ch); else downCh.delete(e.ch);
      const now = downCh.size > 0;
      if (now !== was) ped.push({ t: secAt(e.tick), down: now });
    }
    const tm = smpte ? [{ t: 0, q: 0, bpm: 120 }] : segs.map((s) => ({ t: s.sec, q: s.tick / ppq, bpm: 6e7 / s.us }));
    const duration = Math.max(notes.reduce((a, n) => Math.max(a, n.t + n.d), 0), secAt(maxTick) || 0);
    return {
      name: name || baseName(fileName) || 'MIDI file', source: 'midi', notes, pedals: ped,
      tempos: tm, bpm: Math.round(tm[0].bpm * 10) / 10, beats: meter ? meter.beats : 4, unit: meter ? meter.unit : 4, duration,
    };
  }
  function indexOf(u8, s) {
    outer: for (let i = 0; i + s.length <= u8.length; i++) { for (let j = 0; j < s.length; j++) if (u8[i + j] !== s.charCodeAt(j)) continue outer; return i; }
    return -1;
  }
  function decodeText(d) { try { return new TextDecoder('utf-8', { fatal: false }).decode(d); } catch (e) { return String.fromCharCode.apply(null, d); } }
  function baseName(f) { return f ? String(f).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') : ''; }

  // ── writing ──
  // song: { name, bpm, beats, unit, ppq?, notes: [{m, vel (0-1), on, off}] (in quarter notes),
  //         pedals: [{q, down}] }
  function write(song) {
    const ppq = song.ppq || 480;
    const tick = (q) => Math.max(0, Math.round(q * ppq));
    const enc = new TextEncoder();
    const meta = (type, bytes) => [0xff, type].concat(vlqBytes(bytes.length), Array.from(bytes));
    // track 0: name, tempo, metre
    const us = Math.round(6e7 / (song.bpm || 120));
    const unit = song.unit || 4;
    const t0 = [
      { t: 0, o: 0, b: meta(0x03, enc.encode(song.name || 'CHORD//SCOPE')) },
      { t: 0, o: 1, b: meta(0x58, [song.beats || 4, Math.round(Math.log2(unit)), 24, 8]) },
      { t: 0, o: 2, b: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    ];
    // track 1: the piano
    const ev = [
      { t: 0, o: 0, b: meta(0x03, enc.encode('Piano')) },
      { t: 0, o: 1, b: [0xc0, 0] },
    ];
    for (const n of song.notes) {
      const a = tick(n.on), z = Math.max(a + 1, tick(n.off));
      const v = Math.max(1, Math.min(127, Math.round((n.vel == null ? 0.7 : n.vel) * 127)));
      ev.push({ t: a, o: 5, b: [0x90, n.m & 127, v] }, { t: z, o: 2, b: [0x80, n.m & 127, 0] });
    }
    // pedal changes keep their own order (a press and release in one tick stay press → release)
    for (const pd of (song.pedals || []).slice().sort((x, y) => x.q - y.q)) ev.push({ t: tick(pd.q), o: 3, b: [0xb0, 64, pd.down ? 127 : 0] });
    const chunk = (list) => {
      list.sort((x, y) => x.t - y.t || x.o - y.o); // at one instant: note-offs, pedal, note-ons (stable sort)
      const out = [];
      let last = 0;
      for (const e of list) { out.push(...vlqBytes(e.t - last), ...e.b); last = e.t; }
      out.push(0, 0xff, 0x2f, 0);
      return [0x4d, 0x54, 0x72, 0x6b].concat(be32(out.length), out);
    };
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, (ppq >> 8) & 255, ppq & 255];
    return new Uint8Array(head.concat(chunk(t0), chunk(ev)));
  }
  function vlqBytes(v) {
    v = Math.max(0, Math.round(v));
    const out = [v & 0x7f];
    while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80);
    return out;
  }
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

  G.CSMidiFile = { parse, write };
})(typeof window !== 'undefined' ? window : globalThis);
