/* ───────────────────────── CHORD//SCOPE · score view ─────────────────────────
   Engraves the live score model onto parchment in handwritten (Petaluma) ink.
     PAGE   — 3 grand-staff systems × 4 bars; turns the page when it fills.
     SCROLL — one large system; the tape slides left so the pen stays near the
              right edge, revealing blank staff for the next notes.
   Units are staff spaces. Note x positions are proportional to time inside
   each bar, so nothing already written ever moves.                            */
(function (G) {
  'use strict';
  const GEO = { BEAT: 6.6, PADL: 1.9, PADR: 1.0, HW: 8.2, GAP: 6.0, TOP: 5.8, BOT: 3.8, TITLE: 5.4, MX: 2.6, FOOT: 2.3, FOCUS: 0.78 };
  const STEM = 0.12;
  const f = (v) => (Math.round(v * 100) / 100).toString();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function create(o) {
    const SG = o.glyphs, M = SG.music, TX = SG.script, model = o.model, host = o.host;
    let mode = 'page', follow = true, viewPage = 0, shownPage = -1, scroll = 0, lastSig = '', symbols = true;
    let turning = 0, printing = false;
    const seen = new Map();
    const dateText = (() => { const d = new Date(); return d.getDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getFullYear(); })();

    // one hidden <svg> of glyph definitions shared by every sheet
    let d = '';
    for (const [k, v] of Object.entries(M)) d += `<path id="sm-${k}" d="${v.d}"/>`;
    for (const [k, v] of Object.entries(TX)) d += `<path id="ss-${k.codePointAt(0)}" d="${v.d}"/>`;
    const defsMarkup = `<defs>${d}</defs>`;
    if (!document.getElementById('scoreDefs')) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      defs.id = 'scoreDefs';
      defs.setAttribute('aria-hidden', 'true');
      defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      defs.innerHTML = defsMarkup;
      document.body.appendChild(defs);
    }
    host.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    host.appendChild(sheet);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ink-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    sheet.appendChild(svg);

    // ── small builders ──
    const use = (k, x, y, extra) => `<use href="#sm-${k}" x="${f(x)}" y="${f(y)}"${extra || ''}/>`;
    function ink(key, kind, cx, cy) { // fresh marks get the ink-in animation (continued across re-renders)
      if (printing) return '';
      const now = performance.now();
      let t = seen.get(key);
      if (t === undefined) { t = now; seen.set(key, t); }
      const age = now - t;
      if (age > 650) return '';
      const origin = cx != null ? `;transform-origin:${f(cx)}px ${f(cy)}px` : '';
      return ` class="${kind || 'ink'}" style="animation-delay:${(-age).toFixed(0)}ms${origin}"`;
    }
    function textW(str, size) {
      let w = 0;
      for (const ch of str) w += ch === ' ' ? SG.space * size : TX[ch] ? TX[ch].adv * size : (ch === '𝄫' || ch === '𝄪') ? 0.6 * size : 0.5 * size;
      return w;
    }
    function text(str, x, y, size) {
      let s = '', cx = x;
      for (const ch of str) {
        if (ch === ' ') { cx += SG.space * size; continue; }
        if (ch === '𝄫' || ch === '𝄪') {
          const g = ch === '𝄫' ? 'accidentalDoubleFlat' : 'accidentalDoubleSharp', k = size * 0.32;
          s += `<use href="#sm-${g}" transform="translate(${f(cx)} ${f(y - size * 0.32)}) scale(${f(k)})"/>`;
          cx += 0.6 * size; continue;
        }
        if (!TX[ch]) { cx += 0.5 * size; continue; }
        s += `<use href="#ss-${ch.codePointAt(0)}" transform="translate(${f(cx)} ${f(y)}) scale(${f(size)})"/>`;
        cx += TX[ch].adv * size;
      }
      return s;
    }
    function symbolW(t, size) {
      const m = /^([A-G][♭♯𝄫𝄪]?)(.*?)(\/([A-G][♭♯𝄫𝄪]?))?$/u.exec(t);
      if (!m) return textW(t, size);
      return textW(m[1], size) + (m[2] ? 0.05 + textW(m[2], size * 0.78) : 0) + (m[3] ? 0.1 + textW(m[3], size * 0.85) : 0);
    }
    function chordSymbol(t, x, y, size) { // root full size, quality a little smaller, slash bass
      const m = /^([A-G][♭♯𝄫𝄪]?)(.*?)(\/([A-G][♭♯𝄫𝄪]?))?$/u.exec(t);
      if (!m) return text(t, x, y, size);
      let s = text(m[1], x, y, size), cx = x + textW(m[1], size);
      if (m[2]) { s += text(m[2], cx + 0.05, y, size * 0.78); cx += 0.05 + textW(m[2], size * 0.78); }
      if (m[3]) s += text(m[3], cx + 0.1, y, size * 0.85);
      return s;
    }

    // ── geometry ──
    const BW = () => model.beats * (model.grid === 1 ? 8.2 : GEO.BEAT); // 16th grids get roomier bars
    const SH = () => GEO.TOP + 4 + GEO.GAP + 4 + GEO.BOT;
    const pageSize = () => ({ w: 2 * GEO.MX + GEO.HW + 4 * BW(), h: GEO.TITLE + 3 * SH() + GEO.FOOT });
    const stripSize = () => ({ w: 1.6 + GEO.HW + 4 * BW() + 0.6, h: SH() + 1.4 });
    const sysPage = (i) => { const sy = GEO.TITLE + i * SH(); return { sx: GEO.MX, yT: sy + GEO.TOP, yB: sy + GEO.TOP + 4 + GEO.GAP, sy }; };
    const sysStrip = () => ({ sx: 1.6, yT: 0.7 + GEO.TOP, yB: 0.7 + GEO.TOP + 4 + GEO.GAP, sy: 0.7 });

    function systemFrame(sys, right, opts) { // staff lines, brace, clefs, time signature
      const x0 = sys.sx + 1.0;
      let s = '<g class="frame">';
      for (let i = 0; i < 5; i++) {
        s += `<line class="sl" x1="${f(x0)}" x2="${f(right)}" y1="${f(sys.yT + i)}" y2="${f(sys.yT + i)}"/>`;
        s += `<line class="sl" x1="${f(x0)}" x2="${f(right)}" y1="${f(sys.yB + i)}" y2="${f(sys.yB + i)}"/>`;
      }
      s += `<line class="bl" x1="${f(x0)}" x2="${f(x0)}" y1="${f(sys.yT)}" y2="${f(sys.yB + 4)}"/>`;
      const span = sys.yB + 4 - sys.yT;
      s += `<use href="#sm-brace" transform="translate(${f(sys.sx - 0.1)} ${f(sys.yB + 4)}) scale(1.7 ${f(span / 3.988)})"/>`;
      s += use('gClef', x0 + 0.5, sys.yT + 3) + use('fClef', x0 + 0.5, sys.yB + 1);
      if (opts && opts.timeSig) {
        const tx = x0 + 4.0, d = String(model.beats);
        for (const yy of [sys.yT, sys.yB]) s += use('timeSig' + d, tx, yy + 1) + use('timeSig4', tx, yy + 3);
      }
      if (opts && opts.tempo) {
        s += `<use href="#sm-metNoteQuarterUp" transform="translate(${f(x0 + 0.4)} ${f(sys.yT - 3.4)}) scale(0.7)"/>`;
        s += text('= ' + Math.round(model.bpm), x0 + 1.55, sys.yT - 3.4, 1.8);
      }
      return s + '</g>';
    }

    // ── piece geometry ──
    function chordGeom(p, x, st, pos, accState) {
      const yTop = st === 0 ? pos.yT : pos.yB, top = st === 0 ? 38 : 26, mid = st === 0 ? 34 : 22;
      const yOf = (step) => yTop + (top - step) / 2;
      const heads = p.notes.map((n) => ({ n, step: n.sp ? n.sp.step : Math.round((n.midi / 12) * 7), a: n.sp ? n.sp.a : 0 })).sort((a, b) => a.step - b.step || a.a - b.a);
      if (!p.tiePrev) {
        for (const h of heads) {
          const cur = accState.has(h.step) ? accState.get(h.step) : 0;
          if (h.a !== cur) { h.acc = { '-2': 'accidentalDoubleFlat', '-1': 'accidentalFlat', '0': 'accidentalNatural', '1': 'accidentalSharp', '2': 'accidentalDoubleSharp' }[h.a]; accState.set(h.step, h.a); }
        }
      }
      const v = p.value;
      const head = v >= 16 ? 'noteheadWhole' : v >= 8 ? 'noteheadHalf' : 'noteheadBlack';
      const lo = heads[0].step, hi = heads[heads.length - 1].step;
      const dUp = hi - mid, dDown = mid - lo;
      const g = {
        p, st, x, heads, head, hw: M[head].bbox[2], yOf, mid, top, pos,
        dots: v === 3 || v === 6 || v === 12, flags: v === 2 || v === 3 ? 1 : v === 1 ? 2 : 0, stemmed: v < 16,
        up: dDown > dUp ? true : dUp > dDown ? false : (lo + hi) / 2 < mid,
      };
      placeHeads(g);
      return g;
    }
    function placeHeads(g) {
      const hw = g.hw, stemmed = g.stemmed;
      const order = g.up || !stemmed ? g.heads.slice() : g.heads.slice().reverse();
      let prev = null, prevDisp = false;
      for (const h of order) {
        const disp = prev !== null && Math.abs(h.step - prev) <= 1 && !prevDisp;
        h.x = g.x + (disp ? (g.up || !stemmed ? hw - (stemmed ? STEM : 0) : -(hw - STEM)) : 0);
        h.y = g.yOf(h.step);
        prev = h.step; prevDisp = disp;
      }
      if (stemmed) {
        const an = M[g.head].anchors || {};
        const upA = an.stemUpSE || [hw, -0.28], dnA = an.stemDownNW || [0, 0.24];
        const yLow = g.heads[0].y, yHigh = g.heads[g.heads.length - 1].y, yMid = g.yOf(g.mid);
        if (g.up) { g.sx = g.x + upA[0] - STEM / 2; g.base = yLow + upA[1]; g.tip = Math.min(yHigh - 3.4 - (g.flags === 2 ? 0.4 : 0), yMid); }
        else { g.sx = g.x + dnA[0] + STEM / 2; g.base = yHigh + dnA[1]; g.tip = Math.max(yLow + 3.4 + (g.flags === 2 ? 0.4 : 0), yMid); }
      }
    }
    function beamGroups(geoms, barStart) {
      const out = [];
      let cur = [];
      const beat = (g) => Math.floor((g.p.start - barStart) / 4);
      for (const g of geoms) {
        const ok = !g.rest && g.p.value <= 3;
        if (ok && cur.length && beat(cur[0]) === beat(g)) cur.push(g);
        else { if (cur.length > 1) out.push(cur); cur = ok ? [g] : []; }
      }
      if (cur.length > 1) out.push(cur);
      for (const grp of out) {
        let far = -1, dir = 0;
        for (const g of grp) for (const h of g.heads) { const d = h.step - g.mid; if (Math.abs(d) > far) { far = Math.abs(d); dir = d; } }
        const up = dir < 0;
        for (const g of grp) { g.up = up; placeHeads(g); g.beamed = true; }
        const first = grp[0], last = grp[grp.length - 1];
        const ideal = (g) => (up ? g.heads[g.heads.length - 1].y - 3.4 : g.heads[0].y + 3.4);
        const dx = Math.max(0.5, last.sx - first.sx);
        let slope = clamp((ideal(last) - ideal(first)) / dx, -0.16, 0.16);
        if (Math.abs(slope * dx) > 1.2) slope = Math.sign(slope) * 1.2 / dx;
        let b = up ? Infinity : -Infinity;
        for (const g of grp) {
          const yh = up ? g.heads[g.heads.length - 1].y : g.heads[0].y;
          const min = 2.8 + (grp.some((x) => x.flags === 2) ? 0.6 : 0);
          const lim = up ? yh - min - slope * (g.sx - first.sx) : yh + min - slope * (g.sx - first.sx);
          b = up ? Math.min(b, lim) : Math.max(b, lim);
        }
        for (const g of grp) g.tip = b + slope * (g.sx - first.sx);
        grp.beam = { up, x1: first.sx, slope, b };
      }
      return out;
    }

    // ── drawing ──
    function drawChord(g, key) {
      let s = '';
      const k = 'h' + g.p.notes[0].id + '@' + g.p.start + ':' + g.st;
      // ledger lines
      const lineTop = g.top, lineBot = g.top - 8;
      const hs = g.heads;
      const ledger = (step, sel) => {
        const xs = hs.filter(sel);
        if (!xs.length) return '';
        const xa = Math.min(...xs.map((h) => h.x)) - 0.38, xb = Math.max(...xs.map((h) => h.x)) + g.hw + 0.38;
        const y = g.yOf(step);
        return `<line class="lg" x1="${f(xa)}" x2="${f(xb)}" y1="${f(y)}" y2="${f(y)}"/>`;
      };
      for (let stp = lineBot - 2; stp >= hs[0].step; stp -= 2) s += ledger(stp, (h) => h.step <= stp);
      for (let stp = lineTop + 2; stp <= hs[hs.length - 1].step; stp += 2) s += ledger(stp, (h) => h.step >= stp);
      // heads
      for (const h of hs) s += `<use href="#sm-${g.head}" x="${f(h.x)}" y="${f(h.y)}"${ink('n' + h.n.id + '@' + g.p.start, 'ink', h.x + g.hw / 2, h.y)}/>`;
      // accidentals, stacked into columns from the top
      const accs = hs.filter((h) => h.acc).sort((a, b) => b.step - a.step);
      if (accs.length) {
        const left = Math.min(...hs.map((h) => h.x));
        const cols = [];
        for (const h of accs) {
          let c = 0;
          while ((cols[c] || []).some((o) => Math.abs(o.step - h.step) < 6)) c++;
          (cols[c] = cols[c] || []).push(h); h.col = c;
        }
        const colW = cols.map((items) => Math.max(...items.map((h) => M[h.acc].bbox[2])) + 0.18);
        for (const h of accs) {
          let right = left - 0.2;
          for (let c = 0; c < h.col; c++) right -= colW[c];
          const ax = right - M[h.acc].bbox[2];
          s += `<use href="#sm-${h.acc}" x="${f(ax)}" y="${f(h.y)}"${ink('a' + h.n.id + '@' + g.p.start, 'ink', ax + M[h.acc].bbox[2] / 2, h.y)}/>`;
        }
      }
      // dots
      if (g.dots) {
        const dx = Math.max(...hs.map((h) => h.x)) + g.hw + 0.32;
        const ys = new Set();
        for (const h of hs) ys.add(f(h.step % 2 === 0 ? h.y - 0.5 : h.y));
        for (const y of ys) s += use('augmentationDot', dx, +y);
      }
      // stem + flag
      if (g.stemmed) {
        s += `<line class="stem" x1="${f(g.sx)}" x2="${f(g.sx)}" y1="${f(g.base)}" y2="${f(g.tip)}"${ink(k + 's', 'inkf')}/>`;
        if (g.flags && !g.beamed) {
          const fl = g.up ? (g.flags === 1 ? 'flag8thUp' : 'flag16thUp') : (g.flags === 1 ? 'flag8thDown' : 'flag16thDown');
          s += use(fl, g.sx - STEM / 2, g.tip, ink(k + 'f', 'inkf'));
        }
      }
      return s;
    }
    function drawBeams(grp) {
      const { up, x1, slope, b } = grp.beam;
      const th = 0.48, gap = 0.74, dirIn = up ? 1 : -1;
      const yAt = (x) => b + slope * (x - x1);
      const poly = (xa, xb, off) => {
        const ya = yAt(xa) + off * dirIn, yb = yAt(xb) + off * dirIn;
        return `<path class="beam" d="M${f(xa)} ${f(ya)}L${f(xb)} ${f(yb)}L${f(xb)} ${f(yb + th * dirIn)}L${f(xa)} ${f(ya + th * dirIn)}Z"${ink('b' + grp[0].p.notes[0].id + '@' + grp[0].p.start, 'inkf')}/>`;
      };
      let s = poly(grp[0].sx - STEM / 2, grp[grp.length - 1].sx + STEM / 2, 0);
      for (let i = 0; i < grp.length; i++) {
        if (grp[i].flags !== 2) continue;
        const nxt = grp[i + 1], prv = grp[i - 1];
        if (nxt && nxt.flags === 2) s += poly(grp[i].sx - STEM / 2, nxt.sx + STEM / 2, gap);
        else if (!(prv && prv.flags === 2)) {
          const len = 1.1;
          s += i === 0 ? poly(grp[i].sx - STEM / 2, grp[i].sx + len, gap) : poly(grp[i].sx - len, grp[i].sx + STEM / 2, gap);
        }
      }
      return s;
    }
    function drawRest(p, x, st, pos, barX) {
      const yTop = st === 0 ? pos.yT : pos.yB;
      const yMid = yTop + 2;
      if (p.whole) {
        const w = M.restWhole.bbox[2], rx = barX + BW() / 2 - w / 2;
        return use('restWhole', rx, yMid - 1, ink('r' + st + ':' + p.start, 'ink', rx + w / 2, yMid - 1.2));
      }
      const glyph = p.value >= 8 ? 'restHalf' : p.value >= 4 ? 'restQuarter' : p.value >= 2 ? 'rest8th' : 'rest16th';
      return use(glyph, x, yMid, ink('r' + st + ':' + p.start, 'ink', x + M[glyph].bbox[2] / 2, yMid));
    }
    function tiePath(xa, xb, y, dir, key) {
      const len = xb - xa;
      if (len < 0.4) return '';
      const h = clamp(0.32 + 0.05 * len, 0.45, 1.25), y0 = y + dir * 0.48, xm = (xa + xb) / 2;
      return `<path class="tie" d="M${f(xa)} ${f(y0)}Q${f(xm)} ${f(y0 + dir * h * 2)} ${f(xb)} ${f(y0)}Q${f(xm)} ${f(y0 + dir * (h * 2 - 0.36))} ${f(xa)} ${f(y0)}Z"${ink(key, 'inkf')}/>`;
    }
    function tieDir(g, h) {
      if (g.heads.length === 1) return g.up || !g.stemmed ? 1 : -1;
      const i = g.heads.indexOf(h), n = g.heads.length;
      if (n % 2 && i === (n - 1) / 2) return g.up ? 1 : -1;
      return i >= n / 2 ? -1 : 1;
    }

    // Draw bars. place(k) → {x, yT, yB, sys, right, left} or null when bar k isn't on this sheet.
    function drawBars(lay, place) {
      const tpb = lay.tpb, bw = BW(), tickW = (bw - GEO.PADL - GEO.PADR) / tpb;
      const placed = [];
      for (const [k, B] of [...lay.bars.entries()].sort((a, b) => a[0] - b[0])) {
        const pos = place(k);
        if (pos) placed.push({ k, B, pos });
      }
      const out = new Map(); // bar index → markup (diffed per bar, so only changed bars touch the DOM)
      const allGeom = [];
      const markRight = new Map();
      for (const { k, B, pos } of placed) {
        let s = '';
        const xOf = (t) => pos.x + GEO.PADL + (t - B.start) * tickW;
        for (let st = 0; st < 2; st++) {
          const acc = new Map();
          const geoms = B.staves[st].map((p) => {
            if (p.rest) return { rest: true, p };
            const g = chordGeom(p, xOf(p.start), st, pos, acc);
            g.k = k;
            p._g = g;
            allGeom.push(g);
            return g;
          });
          const groups = beamGroups(geoms, B.start);
          for (const g of geoms) s += g.rest ? drawRest(g.p, xOf(g.p.start), st, pos, pos.x) : drawChord(g);
          for (const grp of groups) s += drawBeams(grp);
        }
        // barline (double where a phrase ended)
        const xe = pos.x + bw, endT = B.start + tpb;
        const reached = endT <= lay.limit || !lay.running;
        if (reached) {
          s += `<line class="bl" x1="${f(xe)}" x2="${f(xe)}" y1="${f(pos.yT)}" y2="${f(pos.yB + 4)}"/>`;
          if (lay.phraseEnds.includes(endT)) s += `<line class="bl" x1="${f(xe - 0.5)}" x2="${f(xe - 0.5)}" y1="${f(pos.yT)}" y2="${f(pos.yB + 4)}"/>`;
        }
        if (pos.barNo && B.index > 0) s += text(String(B.index + 1), pos.barNo.x, pos.barNo.y, pos.barNo.size || 1.5);
        // chord symbols above the treble staff; a crowded one slides right rather than overprint
        if (symbols) {
          for (const mk of lay.marks) {
            if (mk.t < B.start || mk.t >= B.start + tpb) continue;
            const tp = B.staves[0].find((p) => !p.rest && p.start === mk.t);
            const topY = tp && tp._g ? tp._g.heads[tp._g.heads.length - 1].y - (tp._g.up && tp._g.stemmed ? 3.6 : 1.2) : Infinity;
            const y = Math.min(pos.yT - 2.7, topY - 1.0);
            const want = xOf(mk.t) - 0.2, prevRight = markRight.get(pos.sys);
            const x = prevRight == null ? want : Math.max(want, prevRight + 0.7);
            if (x > want + 3.5) continue;
            s += `<g${ink('c' + mk.t, 'inkc')}>${chordSymbol(mk.text, x, y, 2.1)}</g>`;
            markRight.set(pos.sys, x + symbolW(mk.text, 2.1));
          }
        }
        out.set(k, s);
      }
      const add = (k, str) => { if (str) out.set(k, (out.get(k) || '') + str); };
      // ties: within a system, or open-ended at system edges
      for (const g of allGeom) {
        const p = g.p;
        if (p.tieNext) {
          const nx = p.next && p.next._g;
          for (const h of g.heads) {
            const dir = tieDir(g, h);
            const xa = h.x + g.hw + 0.12;
            if (nx && nx.pos.sys === g.pos.sys) {
              const th = nx.heads.find((q) => q.n.midi === h.n.midi);
              if (th) add(g.k, tiePath(xa, th.x - 0.12, h.y, dir, 't' + h.n.id + '@' + p.start));
            } else add(g.k, tiePath(xa, Math.max(xa + 1.2, g.pos.right + 0.2), h.y, dir, 't' + h.n.id + '@' + p.start));
          }
        }
        if (p.tiePrev && !(p.prev && p.prev._g && p.prev._g.pos.sys === g.pos.sys)) {
          for (const h of g.heads) add(g.k, tiePath(Math.min(h.x - 1.6, g.pos.left), h.x - 0.12, h.y, tieDir(g, h), 'u' + h.n.id + '@' + p.start));
        }
      }
      for (const g of allGeom) delete g.p._g;
      return out;
    }
    function syncBars(container, map) {
      const have = new Map();
      for (const el of [...container.children]) have.set(el.getAttribute('data-k'), el);
      for (const [k, str] of map) {
        const key = String(k);
        let el = have.get(key);
        if (!el) { el = document.createElementNS('http://www.w3.org/2000/svg', 'g'); el.setAttribute('data-k', key); container.appendChild(el); }
        if (el.__s !== str) { el.innerHTML = str; el.__s = str; }
        have.delete(key);
      }
      for (const el of have.values()) el.remove();
    }

    // ── PAGE ──
    function pageOfBar(k) { return Math.floor(k / 12); }
    let pageKey = '', barsEl = null;
    function pageFrame(page) { // date, page number, the three empty systems
      const ps = pageSize(), right = GEO.MX + GEO.HW + 4 * BW();
      let s = text(dateText, ps.w - GEO.MX - textW(dateText, 1.65), 3.9, 1.65);
      const pn = String(page + 1);
      s += text(pn, ps.w / 2 - textW(pn, 1.75) / 2, ps.h - 0.7, 1.75);
      for (let i = 0; i < 3; i++) s += systemFrame(sysPage(i), right, { timeSig: i === 0 && page === 0, tempo: i === 0 && page === 0 });
      return s;
    }
    const placeOnPage = (page) => (k) => {
      if (pageOfBar(k) !== page) return null;
      const bw = BW(), right = GEO.MX + GEO.HW + 4 * bw;
      const i = Math.floor((k % 12) / 4), slot = k % 4, sys = sysPage(i);
      return { x: sys.sx + GEO.HW + slot * bw, yT: sys.yT, yB: sys.yB, sys: page * 3 + i, right, left: sys.sx + GEO.HW - 0.4, barNo: slot === 0 ? { x: sys.sx + 0.9, y: sys.yT - 2.2 } : null };
    };
    function renderPage(ms, lay, page) {
      const ps = pageSize(), bw = BW();
      setBox(ps.w, ps.h);
      const key = [page, model.beats, model.grid, Math.round(model.bpm), model.isEmpty()].join(':');
      if (key !== pageKey || !barsEl || !svg.contains(barsEl)) {
        pageKey = key;
        let s = pageFrame(page);
        if (model.isEmpty()) {
          const hint = 'play to begin', sys = sysPage(0);
          s += `<g class="hint">${text(hint, sys.sx + GEO.HW + 2 * bw - textW(hint, 2) / 2, sys.yB - 2.0, 2)}</g>`;
        }
        svg.innerHTML = s + '<g class="bars"></g><line class="cursor" x1="0" x2="0" y1="0" y2="0" visibility="hidden"/>';
        barsEl = svg.querySelector('.bars');
      }
      syncBars(barsEl, lay ? drawBars(lay, placeOnPage(page)) : new Map());
    }
    // every page of the score as standalone SVG markup, without animation (printing / PDF)
    function printPages(ms) {
      printing = true;
      try {
        const total = Math.max(1, Math.ceil(model.barsWritten(ms) / 12));
        const lay = model.isEmpty() ? null : model.layout(ms, 0, total * 12 - 1);
        const ps = pageSize(), pages = [];
        for (let page = 0; page < total; page++) {
          let s = pageFrame(page);
          if (lay) for (const str of drawBars(lay, placeOnPage(page)).values()) s += str;
          pages.push({ w: ps.w, h: ps.h, body: s });
        }
        return { defs: defsMarkup, pages };
      } finally { printing = false; }
    }

    // ── SCROLL ──
    let tapeEl = null, cursorEl = null, stripKey = '';
    function renderStrip(ms, lay, from, to) {
      const ss = stripSize(), bw = BW(), sys = sysStrip();
      setBox(ss.w, ss.h);
      const right = ss.w - 0.2;
      const key = ss.w + ':' + model.beats + ':' + model.grid + ':' + Math.round(model.bpm);
      if (stripKey !== key || !tapeEl || !svg.contains(tapeEl)) {
        stripKey = key;
        const clipX = sys.sx + GEO.HW - 0.3;
        // the tape fades out (alpha mask) where it slides under the clefs
        svg.innerHTML = `<defs><linearGradient id="tapeFade" gradientUnits="userSpaceOnUse" x1="${f(clipX)}" x2="${f(clipX + 3.4)}" y1="0" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
          `<mask id="tapeMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${f(ss.w)}" height="${f(ss.h)}"><rect x="${f(clipX)}" y="0" width="${f(ss.w - clipX)}" height="${f(ss.h)}" fill="url(#tapeFade)"/></mask></defs>` +
          '<g mask="url(#tapeMask)"><g class="tape"></g></g>' +
          systemFrame(sys, right, { timeSig: true, tempo: true }) +
          '<line class="cursor" x1="0" x2="0" y1="0" y2="0" visibility="hidden"/>';
        tapeEl = svg.querySelector('.tape');
        cursorEl = svg.querySelector('.cursor');
      }
      const map = lay ? drawBars(lay, (k) => {
        if (k < from || k > to) return null;
        const x = sys.sx + GEO.HW + k * bw;
        return { x, yT: sys.yT, yB: sys.yB, sys: 0, right: x + bw + 1.2, left: x - 1.2, barNo: { x: x + 0.3, y: sys.yT - 0.75, size: 1.3 } };
      }) : new Map();
      if (model.isEmpty()) map.set('hint', `<g class="hint">${text('play to begin', sys.sx + GEO.HW + bw * 0.6, sys.yB - 2.0, 2.2)}</g>`);
      syncBars(tapeEl, map);
      tapeEl.setAttribute('transform', `translate(${f(-scroll)} 0)`);
    }

    function setBox(w, h) {
      const vb = `0 0 ${f(w)} ${f(h)}`;
      if (svg.getAttribute('viewBox') !== vb) {
        svg.setAttribute('viewBox', vb);
        host.style.setProperty('--ar', (w / h).toFixed(4));
      }
    }

    // ── per-frame driver ──
    function currentPage(ms) {
      if (!follow) return viewPage;
      const tpb = model.tpb;
      if (model.isEmpty()) return 0;
      const t = model.running ? model.nowTick(ms) : Math.max(0, model.endTick - 1);
      return pageOfBar(Math.floor(t / tpb));
    }
    function scrollTarget(ms) {
      const bw = BW(), tpb = model.tpb;
      const focus = GEO.FOCUS * 4 * bw;
      const t = model.running ? model.nowTick(ms) : model.endTick;
      return Math.max(0, (t / tpb) * bw - focus);
    }
    let lastMs = 0;
    function frame(ms) {
      const dt = lastMs ? Math.min(0.1, (ms - lastMs) / 1000) : 0.016;
      lastMs = ms;
      const closed = model.update(ms);
      const grid = model.grid, tpb = model.tpb;
      const now = model.nowTick(ms);
      let sig;
      if (mode === 'page') {
        const page = currentPage(ms);
        if (page !== shownPage && shownPage >= 0 && follow && page > shownPage) turnPage();
        shownPage = page;
        sig = 'p' + page + ':' + model.version + ':' + (model.running ? Math.floor(now / grid) : 'x') + ':' + symbols + ':' + model.beats + ':' + grid;
        if (sig !== lastSig) {
          lastSig = sig;
          const lay = model.isEmpty() ? null : model.layout(ms, page * 12, page * 12 + 11);
          renderPage(ms, lay, page);
          o.onPage && o.onPage(page, Math.max(1, Math.ceil(model.barsWritten(ms) / 12)));
        }
        updateCursor(ms, (t) => {
          const k = Math.floor(t / tpb);
          if (pageOfBar(k) !== shownPage) return null;
          const i = Math.floor((k % 12) / 4), sys = sysPage(i), bw = BW();
          return { x: sys.sx + GEO.HW + (k % 4) * bw + GEO.PADL + (t - k * tpb) * ((bw - GEO.PADL - GEO.PADR) / tpb), y1: sys.yT - 2.6, y2: sys.yB + 5 };
        });
      } else {
        const target = scrollTarget(ms);
        if (model.running) scroll = target;
        else scroll += (target - scroll) * (1 - Math.exp(-dt / 0.22));
        if (Math.abs(target - scroll) < 0.01) scroll = target;
        const bw = BW();
        const from = Math.max(0, Math.floor(scroll / bw) - 1), to = Math.floor((scroll + 4 * bw) / bw) + 1;
        sig = 's' + from + ':' + to + ':' + model.version + ':' + (model.running ? Math.floor(now / grid) : 'x') + ':' + symbols + ':' + model.beats + ':' + grid + ':' + Math.round(model.bpm);
        if (sig !== lastSig) {
          lastSig = sig;
          const lay = model.isEmpty() ? null : model.layout(ms, from, to);
          renderStrip(ms, lay, from, to);
        } else if (tapeEl) tapeEl.setAttribute('transform', `translate(${f(-scroll)} 0)`);
        updateCursor(ms, (t) => {
          const k = Math.floor(t / tpb), sys = sysStrip();
          const x = sys.sx + GEO.HW + k * bw + GEO.PADL + (t - k * tpb) * ((bw - GEO.PADL - GEO.PADR) / tpb) - scroll;
          return { x, y1: sys.yT - 2.6, y2: sys.yB + 5 };
        });
      }
      return closed;
    }
    function updateCursor(ms, at) {
      const c = svg.querySelector('.cursor');
      if (!c) return;
      if (!model.running) { c.setAttribute('visibility', 'hidden'); return; }
      const r = at(model.nowTick(ms));
      if (!r) { c.setAttribute('visibility', 'hidden'); return; }
      c.setAttribute('visibility', 'visible');
      c.setAttribute('x1', f(r.x)); c.setAttribute('x2', f(r.x));
      c.setAttribute('y1', f(r.y1)); c.setAttribute('y2', f(r.y2));
    }
    function turnPage() {
      const ghost = sheet.cloneNode(true);
      ghost.classList.add('turning');
      host.appendChild(ghost);
      turning++;
      setTimeout(() => { ghost.remove(); turning--; }, 950);
    }
    function fadeSwap() {
      const ghost = sheet.cloneNode(true);
      ghost.classList.add('fading');
      host.appendChild(ghost);
      setTimeout(() => ghost.remove(), 400);
    }

    return {
      frame,
      setMode(m) { if (m === mode) return; mode = m; lastSig = ''; stripKey = ''; pageKey = ''; tapeEl = null; barsEl = null; sheet.className = 'sheet ' + m; scroll = scrollTarget(performance.now()); },
      get mode() { return mode; },
      setSymbols(on) { symbols = !!on; lastSig = ''; },
      printPages,
      invalidate() { lastSig = ''; stripKey = ''; pageKey = ''; },
      reset() { seen.clear(); follow = true; viewPage = 0; shownPage = -1; scroll = 0; lastSig = ''; stripKey = ''; pageKey = ''; },
      follow() { if (!follow) { follow = true; lastSig = ''; } },
      pageCount(ms) { return Math.max(1, Math.ceil(model.barsWritten(ms) / 12)); },
      page() { return shownPage < 0 ? 0 : shownPage; },
      goPage(n, ms) {
        const total = this.pageCount(ms);
        n = clamp(n, 0, total - 1);
        if (n === shownPage) return;
        fadeSwap();
        follow = n === currentPageFollow(ms);
        viewPage = n; lastSig = '';
      },
    };
    function currentPageFollow(ms) { const f0 = follow; follow = true; const p = currentPage(ms); follow = f0; return p; }
  }
  G.CSScoreView = { create, GEO };
})(typeof window !== 'undefined' ? window : globalThis);
