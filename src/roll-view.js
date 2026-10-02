/* ───────────────────────── CHORD//SCOPE · piano roll ─────────────────────────
   A player-piano paper roll drawn on a canvas, lined up with the keyboard underneath:
   each note is a slot punched in the paper, the paper runs down into the tracker bar,
   and a slot lights up gold while it is passing over the bar (and its key goes down).    */
(function (G) {
  'use strict';
  const SEC = 3.6; // seconds of music visible above the tracker bar
  const WHITE = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];

  function create(o) {
    // o: { host, track(), pos(), sounding(), keys() → [{m, white, x0, x1}] in client px (or null),
    //      range() → [lo, hi], chord() → {sym, long} | null, status() → {title, time} }
    const host = o.host;
    const canvas = document.createElement('canvas');
    canvas.className = 'roll-canvas';
    host.appendChild(canvas);
    const g = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, raf = 0;
    let cache = { track: null, maxD: 0 };

    function size() {
      const r = host.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
      if (w !== W || h !== H || canvas.width !== Math.round(w * dpr)) {
        W = w; H = h;
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      }
      return r;
    }
    function keyColumns(rect) {
      const list = o.keys && o.keys();
      if (list && list.length && list[list.length - 1].x1 - list[0].x0 > 50) return list.map((k) => ({ m: k.m, white: k.white, x0: k.x0 - rect.left, x1: k.x1 - rect.left }));
      // no keyboard on screen: spread the range across the width the way a keyboard would
      const [lo, hi] = o.range();
      let whites = 0;
      for (let m = lo; m <= hi; m++) if (WHITE[m % 12]) whites++;
      const ww = (W - 8) / whites, out = [];
      let x = 4;
      for (let m = lo; m <= hi; m++) {
        if (WHITE[m % 12]) { out.push({ m, white: true, x0: x, x1: x + ww }); x += ww; }
        else out.push({ m, white: false, x0: x - ww * 0.3, x1: x + ww * 0.3 });
      }
      return out;
    }
    // tempo map helpers: seconds ↔ quarter notes
    const qAt = (tr, t) => { const tm = tr.tempos; let s = tm[0]; for (let i = 1; i < tm.length && tm[i].t <= t; i++) s = tm[i]; return s.q + ((t - s.t) * s.bpm) / 60; };
    const tAt = (tr, q) => { const tm = tr.tempos; let s = tm[0]; for (let i = 1; i < tm.length && tm[i].q <= q; i++) s = tm[i]; return s.t + ((q - s.q) * 60) / s.bpm; };

    function draw() {
      raf = 0;
      const rect = size();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const cols = keyColumns(rect);
      const byM = new Map(cols.map((k) => [k.m, k]));
      const left = Math.max(0, cols[0].x0 - 3), right = Math.min(W, cols[cols.length - 1].x1 + 3);
      const tr = o.track(), pos = o.pos();
      const trackerY = H - 13;
      const pps = (trackerY - 10) / SEC;
      const yOf = (t) => trackerY - (t - pos) * pps;

      // paper margins outside the keyboard's span, and guide lines at every C
      g.fillStyle = 'rgba(70,45,20,0.16)';
      g.fillRect(0, 0, left, H); g.fillRect(right, 0, W - right, H);
      g.fillStyle = 'rgba(70,45,20,0.35)';
      g.fillRect(left, 0, 1, H); g.fillRect(right - 1, 0, 1, H);
      for (const k of cols) if (k.white && k.m % 12 === 0) { g.fillStyle = k.m === 60 ? 'rgba(90,55,25,0.22)' : 'rgba(90,55,25,0.1)'; g.fillRect(Math.round(k.x0), 0, 1, trackerY); }

      if (tr && tr.notes.length) {
        if (cache.track !== tr) cache = { track: tr, maxD: tr.notes.reduce((a, n) => Math.max(a, n.d), 0) };
        // bar lines and numbers
        const barQ = (tr.beats || 4) * 4 / (tr.unit || 4);
        const q0 = qAt(tr, Math.max(0, pos - 0.2)), q1 = qAt(tr, pos + SEC + 0.2);
        g.font = 'italic 12px Georgia, serif';
        g.textBaseline = 'bottom';
        for (let b = Math.max(0, Math.floor(q0 / barQ)), guard = 0; b * barQ <= q1 && guard < 400; b++, guard++) {
          const y = Math.round(yOf(tAt(tr, b * barQ))) + 0.5;
          if (y < 0 || y > trackerY) continue;
          g.fillStyle = 'rgba(90,55,25,0.28)';
          g.fillRect(left, y, right - left, 1);
          g.fillStyle = 'rgba(80,50,22,0.75)';
          g.fillText(String(b + 1), left + 5, y - 2);
          for (let k = 1; k < Math.min(32, tr.beats || 4); k++) {
            const yb = Math.round(yOf(tAt(tr, b * barQ + (k * 4) / (tr.unit || 4)))) + 0.5;
            if (yb > 0 && yb < trackerY) { g.fillStyle = 'rgba(90,55,25,0.09)'; g.fillRect(left, yb, right - left, 1); }
          }
        }
        // the punched notes
        const notes = tr.notes, from = pos - cache.maxD - 0.1, to = pos + SEC + 0.1;
        let lo = 0, hi = notes.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].t < from) lo = mid + 1; else hi = mid; }
        const sounding = o.sounding();
        g.save();
        g.beginPath(); g.rect(0, 0, W, trackerY); g.clip();
        const lit = [];
        for (let i = lo; i < notes.length && notes[i].t <= to; i++) {
          const n = notes[i];
          if (n.t + n.d < pos - 0.05) continue;
          const k = byM.get(n.m);
          if (!k) continue;
          const yb = yOf(n.t), yt = yOf(n.t + n.d);
          if (yb < 0) continue;
          const inset = (k.x1 - k.x0) * (k.white ? 0.2 : 0.12);
          const x = k.x0 + inset, w = Math.max(2, k.x1 - k.x0 - 2 * inset);
          if (sounding.has(n)) { lit.push([x, yt, w, yb - yt]); continue; }
          g.fillStyle = k.white ? 'rgba(38,24,12,0.86)' : 'rgba(58,30,14,0.9)';
          slot(x, yt, w, yb - yt);
        }
        g.shadowColor = 'rgba(229,185,90,0.9)'; g.shadowBlur = 12;
        g.fillStyle = '#e5b95a';
        for (const r of lit) slot(r[0], r[1], r[2], r[3]);
        g.restore();
      } else {
        g.fillStyle = 'rgba(60,38,18,0.72)';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = 'italic 21px Georgia, serif';
        g.fillText('Import a MIDI or MusicXML file, or record a session, then press ▶', W / 2, H * 0.42);
        g.font = '13px ui-monospace, Consolas, monospace';
        g.fillStyle = 'rgba(60,38,18,0.55)';
        g.fillText('IMPORT is on the bar above, or drop a file anywhere on this window', W / 2, H * 0.42 + 30);
        g.textAlign = 'left';
      }

      // the spool shadow at the top
      const fade = g.createLinearGradient(0, 0, 0, 46);
      fade.addColorStop(0, 'rgba(14,16,18,0.78)'); fade.addColorStop(1, 'rgba(14,16,18,0)');
      g.fillStyle = fade; g.fillRect(0, 0, W, 46);

      // the brass tracker bar, with a hole for every key
      const bar = g.createLinearGradient(0, trackerY, 0, H);
      bar.addColorStop(0, '#d9b768'); bar.addColorStop(0.45, '#a8823c'); bar.addColorStop(1, '#5f4720');
      g.fillStyle = bar; g.fillRect(0, trackerY, W, H - trackerY);
      g.fillStyle = 'rgba(255,240,200,0.55)'; g.fillRect(0, trackerY, W, 1);
      const on = new Set();
      for (const n of o.sounding()) on.add(n.m);
      for (const k of cols) {
        const cx = (k.x0 + k.x1) / 2, w = k.white ? 3 : 2;
        if (on.has(k.m)) { g.fillStyle = '#ffe6a6'; g.shadowColor = '#e5b95a'; g.shadowBlur = 8; g.fillRect(cx - w, trackerY + 3, w * 2, H - trackerY - 6); g.shadowBlur = 0; }
        else { g.fillStyle = 'rgba(30,20,8,0.75)'; g.fillRect(cx - w / 2, trackerY + 4, w, H - trackerY - 8); }
      }

      // chord now playing, and the track title / time
      const ch = o.chord();
      if (ch && ch.sym) {
        g.font = '400 34px Georgia, serif';
        const w1 = g.measureText(ch.sym).width;
        g.font = 'italic 15px Georgia, serif';
        const w2 = ch.long ? g.measureText(ch.long).width : 0;
        const bw = Math.max(w1, w2) + 28;
        g.fillStyle = 'rgba(239,226,196,0.9)';
        roundRect(left + 10, 14, bw, ch.long ? 70 : 50, 3); g.fill();
        g.fillStyle = '#2a1b0f'; g.textBaseline = 'alphabetic';
        g.font = '400 34px Georgia, serif'; g.fillText(ch.sym, left + 24, 50);
        if (ch.long) { g.font = 'italic 15px Georgia, serif'; g.fillStyle = 'rgba(42,27,15,0.78)'; g.fillText(ch.long, left + 24, 72); }
      }
      const st = o.status();
      if (st && st.title) {
        g.textBaseline = 'alphabetic';
        g.font = 'italic 17px Georgia, serif';
        const tw = g.measureText(st.title).width;
        g.font = '12.5px ui-monospace, Consolas, monospace';
        const bw = Math.min(right - left - 40, Math.max(tw, g.measureText(st.time).width) + 28);
        g.fillStyle = 'rgba(239,226,196,0.9)';
        roundRect(right - 10 - bw, 14, bw, 52, 3); g.fill();
        g.textAlign = 'right';
        g.font = 'italic 17px Georgia, serif'; g.fillStyle = '#2a1b0f';
        g.fillText(st.title, right - 24, 36);
        g.font = '12.5px ui-monospace, Consolas, monospace'; g.fillStyle = 'rgba(42,27,15,0.72)';
        g.fillText(st.time, right - 24, 56);
        g.textAlign = 'left';
      }
    }
    function slot(x, y, w, h) { roundRect(x, y, w, Math.max(2, h), Math.min(3, w / 2, h / 2)); g.fill(); }
    function roundRect(x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
    }
    function request() { if (!raf) raf = requestAnimationFrame(draw); }
    new ResizeObserver(request).observe(host);
    return { draw, request };
  }
  G.CSRollView = { create };
})(typeof window !== 'undefined' ? window : globalThis);
