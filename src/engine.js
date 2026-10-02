/* ───────────────────────── CHORD//SCOPE · chord engine ─────────────────────────
   Pure functions, no DOM. Names any set of 1–10 held notes:
     single notes, intervals/power chords, triads, 6ths, 7ths, 9/11/13ths,
     altered tensions (♭9 ♯9 ♯11 ♭13), adds, sus, no3, inversions and
     slash chords over a foreign bass — all with theory-correct spelling.
   Method: every pitch class is tried as a root; each interpretation is
   described (3rd / 5th / 7th / 6th / sus / tensions), named, and given a
   "how unusual is this name" cost. The cheapest reading wins; close
   runners-up are returned as alternates.                                       */
(function (G) {
  'use strict';

  const MAX_NOTES = 10;
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const ACC = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
  const SHARP = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
  const FLAT = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  const COMMON = [[0, 0], [0, 1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  const ROOT_PREF = ['', 'f', '', 'f', '', '', 's', '', 'f', '', 'f', '']; // tie-break: D♭ E♭ F♯ A♭ B♭

  const mod12 = (x) => ((x % 12) + 12) % 12;
  const sp = (l, a) => ({ l, a });
  const pcOf = (s) => mod12(LETTER_PC[s.l] + s.a);
  const txt = (s) => LETTERS[s.l] + ACC[s.a];
  const fromTable = (T, pc) => sp(T[pc][0], T[pc][1]);
  const octaveOf = (midi, s) => Math.round((midi - s.a - LETTER_PC[s.l]) / 12) - 1;
  const uniqSorted = (arr) => [...new Set(arr)].sort((a, b) => a - b);

  function parseName(str) {
    const m = /^([A-Ga-g])([#♯xX𝄪b♭𝄫]*)$/u.exec(String(str).trim());
    if (!m) return null;
    let a = 0;
    for (const ch of m[2]) {
      if (ch === '#' || ch === '♯') a += 1;
      else if (ch === 'x' || ch === 'X' || ch === '𝄪') a += 2;
      else if (ch === 'b' || ch === '♭') a -= 1;
      else if (ch === '𝄫') a -= 2;
    }
    if (a < -2 || a > 2) return null;
    return sp('CDEFGAB'.indexOf(m[1].toUpperCase()), a);
  }

  // degree label → [letter steps above root, semitones above root]
  const DEG = {
    '1': [0, 0], '♭9': [1, 1], '9': [1, 2], '♯9': [1, 3], '2': [1, 2],
    '♭3': [2, 3], '3': [2, 4], '4': [3, 5], '11': [3, 5], '♯11': [3, 6],
    '♭5': [4, 6], '5': [4, 7], '♯5': [4, 8], '♭13': [5, 8], '13': [5, 9], '6': [5, 9],
    '𝄫7': [6, 9], '♭7': [6, 10], '7': [6, 11],
  };
  // stacked-thirds display order for degree labels
  const DEG_ORDER = {
    '1': 0, '2': 2, '♭3': 3, '3': 3, '4': 4, '♭5': 5, '5': 5, '♯5': 5, '6': 6, '𝄫7': 7, '♭7': 7, '7': 7,
    '♭9': 9, '9': 9, '♯9': 9.5, '11': 11, '♯11': 11.5, '♭13': 13, '13': 13.5,
  };

  function spellDegree(root, label) {
    const [steps, semi] = DEG[label];
    const l = (root.l + steps) % 7;
    const target = mod12(pcOf(root) + semi);
    let a = mod12(target - LETTER_PC[l]);
    if (a > 6) a -= 12;
    if (a < -2 || a > 2) return fromTable(COMMON, target); // fall back to a plain spelling
    return sp(l, a);
  }
  const accCost = (a) => (a === 0 ? 0 : Math.abs(a) === 1 ? 1 : 4);

  function chooseRootSpelling(rootPc, labels) {
    const opts = [fromTable(SHARP, rootPc)];
    const f = fromTable(FLAT, rootPc);
    if (f.l !== opts[0].l) opts.push(f);
    let best = opts[0], bestScore = Infinity;
    for (const r of opts) {
      let s = accCost(r.a);
      for (const lab of labels) if (lab !== '1') s += accCost(spellDegree(r, lab).a);
      const kind = r.a < 0 ? 'f' : r.a > 0 ? 's' : '';
      if (kind && ROOT_PREF[rootPc] !== kind) s += 0.01;
      if (s < bestScore) { bestScore = s; best = r; }
    }
    return best;
  }

  // ───────────── describe: interval set (relative to a root) → chord anatomy ─────────────
  function describe(ivs) {
    const has = (i) => ivs.has(i);
    const deg = { 0: '1' };
    let third = null, sus = null, fifth = null, seventh = null, sixth = false, weird = 0;
    if (has(4)) { third = 4; deg[4] = '3'; }
    else if (has(3)) { third = 3; deg[3] = '♭3'; }

    if (has(7)) { fifth = 7; deg[7] = '5'; }
    else if (has(6)) { fifth = 6; deg[6] = '♭5'; }
    else if (has(8) && third !== 3) { fifth = 8; deg[8] = '♯5'; }

    if (has(10) && has(11)) { seventh = 10; deg[10] = '♭7'; deg[11] = '7'; weird += 4; }
    else if (has(11)) { seventh = 11; deg[11] = '7'; }
    else if (has(10)) { seventh = 10; deg[10] = '♭7'; }
    else if (third === 3 && fifth === 6 && has(9)) { seventh = 9; deg[9] = '𝄫7'; }

    if (seventh === null && has(9)) { sixth = true; deg[9] = '6'; }

    if (third === null) {
      if (has(5)) { sus = 4; deg[5] = '4'; }
      else if (has(2)) { sus = 2; deg[2] = '2'; }
    }
    const tens = [];
    if (has(1)) tens.push(['♭9', 1]);
    if (has(2) && sus !== 2) tens.push(['9', 2]);
    if (has(3) && third === 4) tens.push(['♯9', 3]);
    if (has(5) && sus !== 4) tens.push(['11', 5]);
    if (has(6) && fifth !== 6) tens.push(['♯11', 6]);
    if (has(8) && fifth !== 8) tens.push(['♭13', 8]);
    if (has(9) && seventh !== null && seventh !== 9) tens.push(['13', 9]);
    for (const [lab, iv] of tens) deg[iv] = lab;
    return { third, sus, fifth, seventh, sixth, tens: tens.map((t) => t[0]), deg, weird };
  }

  const ORD = { 7: '7th', 9: '9th', 11: '11th', 13: '13th' };
  const TW = { '♭9': 'flat 9', '9': '9', '♯9': 'sharp 9', '11': '11', '♯11': 'sharp 11', '♭13': 'flat 13', '13': '13' };
  const ALTERED = new Set(['♭9', '♯9', '♯11', '♭13']);
  const NATURAL_OF = { '♭9': '9', '♯9': '9', '♯11': '11', '♭13': '13' };

  // ───────────── name: anatomy → symbol suffix, long words, cost ─────────────
  function nameFrom(d) {
    const { third, sus, fifth, seventh, sixth } = d;
    const T = d.tens, tset = new Set(T);
    const major = third === 4, minor = third === 3, noThird = third === null && sus === null;
    let cost = d.weird, sym = '', long = '', powerChord = false;
    const parts = [], alts = [], adds = [];

    if (seventh !== null) {
      if (seventh === 9) {
        sym = 'dim7'; long = 'diminished 7th'; cost += 0.4;
        for (const t of T) { adds.push(t); cost += 1.0; }
      } else {
        const maj7 = seventh === 11, dom = major && seventh === 10;
        let num = 7;
        if (tset.has('13')) num = 13; else if (tset.has('11')) num = 11; else if (tset.has('9')) num = 9;
        for (const t of T) {
          if (!ALTERED.has(t)) {
            if (t === '9') cost += 0.15;
            else if (t === '11') cost += major ? 0.9 : 0.15;
            else if (t === '13') cost += minor && fifth === 6 ? 0.8 : 0.2;
            continue;
          }
          if (tset.has(NATURAL_OF[t])) { adds.push(t); cost += 1.5; } else alts.push(t);
          if (t === '♭9') cost += dom ? 0.6 : seventh === 10 && !minor ? 0.8 : 1.4;
          else if (t === '♯9') cost += dom ? 0.6 : 1.8;
          else if (t === '♯11') cost += dom || (!minor && maj7) ? 0.5 : 1.2;
          else if (t === '♭13') cost += dom ? 0.7 : 2.0;
        }
        if (minor && fifth === 6 && !maj7) {
          sym = 'm' + num + '♭5'; long = 'half-diminished ' + ORD[num]; cost += 0.4;
        } else if (minor && fifth === 6) {
          sym = 'dim(maj' + num + ')'; long = 'diminished major ' + ORD[num]; cost += 2.2;
        } else {
          if (minor) {
            sym = maj7 ? 'm(maj' + num + ')' : 'm' + num;
            long = (maj7 ? 'minor-major ' : 'minor ') + ORD[num];
            cost += maj7 ? 0.9 : 0.1;
          } else {
            sym = (maj7 ? 'maj' : '') + num;
            long = (maj7 ? 'major ' : 'dominant ') + ORD[num];
            cost += maj7 ? 0.15 : 0.1;
          }
          if (fifth === 6) { sym += '♭5'; parts.push('flat 5'); cost += maj7 ? 1.7 : 1.1; }
          else if (fifth === 8) { sym += '♯5'; parts.push('sharp 5'); cost += maj7 ? 1.05 : 0.8; }
          if (sus === 4) { sym += 'sus4'; parts.unshift('sus 4'); cost += maj7 ? 1.35 : 0.5; }
          else if (sus === 2) { sym += 'sus2'; parts.unshift('sus 2'); cost += maj7 ? 1.95 : 1.1; }
          else if (noThird) cost += maj7 ? 2.05 : 1.7;
          if ((sus || noThird) && (fifth === 6 || fifth === 8)) cost += 1.5;
        }
      }
    } else if (sixth) {
      let rest = T;
      const sixNine = tset.has('9');
      if (sixNine) rest = T.filter((t) => t !== '9');
      sym = (minor ? 'm' : '') + (sixNine ? '6/9' : '6');
      long = minor ? (sixNine ? 'minor six-nine' : 'minor 6th') : (sixNine ? 'six-nine' : 'major 6th');
      cost += (minor ? 0.7 : 0.6) + (sixNine ? 0.25 : 0);
      if (fifth === 6) { sym += '♭5'; parts.push('flat 5'); cost += 1.8; }
      else if (fifth === 8) { sym += '♯5'; parts.push('sharp 5'); cost += 2.0; }
      if (sus === 4) { sym += 'sus4'; parts.unshift('sus 4'); cost += 1.4; }
      else if (sus === 2) { sym += 'sus2'; parts.unshift('sus 2'); cost += 1.6; }
      else if (noThird) cost += 1.8;
      for (const t of rest) { adds.push(t); cost += ALTERED.has(t) ? 1.8 : 1.0; }
    } else {
      if (major) {
        if (fifth === 8) { sym = 'aug'; long = 'augmented'; cost += 0.8; }
        else if (fifth === 6) { sym = '♭5'; long = 'major'; parts.push('flat 5'); cost += 2.2; }
        else { sym = ''; long = 'major'; }
      } else if (minor) {
        if (fifth === 6) { sym = 'dim'; long = 'diminished'; cost += 0.5; }
        else { sym = 'm'; long = 'minor'; cost += 0.05; }
      } else if (sus) {
        sym = 'sus' + sus; long = sus === 4 ? 'suspended 4th' : 'suspended 2nd'; cost += sus === 4 ? 0.6 : 0.8;
        if (fifth === 6) { sym += '♭5'; parts.push('flat 5'); cost += 2.0; }
        else if (fifth === 8) { sym += '♯5'; parts.push('sharp 5'); cost += 2.0; }
      } else if (fifth === 7) {
        sym = '5'; long = 'power chord'; cost += 0.3; powerChord = true;
      } else if (fifth === 6) {
        sym = '♭5'; long = 'flat 5'; cost += 3.0;
      } else if (fifth === 8) {
        sym = 'aug'; long = 'augmented'; cost += 3.0;
      } else {
        sym = ''; long = 'cluster'; cost += 4.0;
      }
      for (const t of T) {
        adds.push(t);
        cost += { '9': 0.5, '11': minor ? 0.7 : 0.8, '♭9': 1.8, '♯9': 2.0, '♯11': 1.3, '♭13': 2.0 }[t] || 1.5;
      }
    }
    if (seventh === null) for (const t of T) if (ALTERED.has(t) && tset.has(NATURAL_OF[t])) cost += 1.5;

    if (fifth === null) {
      if (seventh !== null) cost += major || minor ? 0.3 : 0.8;
      else if (sixth) cost += 0.6;
      else cost += major || minor ? 0.6 : 0.8;
    }

    for (const t of alts) sym += t;
    if (adds.length) {
      if (sym === '' && adds.length === 1) sym = 'add' + adds[0];
      else sym += '(add' + adds.join(',') + ')';
    }
    if (noThird && !powerChord) sym += '(no3)';

    let words = long;
    if (parts.length) words += ', ' + parts.join(', ');
    for (const t of alts) words += ', ' + TW[t];
    if (adds.length) words += ', add ' + adds.map((t) => TW[t]).join(' & ');
    if (noThird && !powerChord) words += ', no 3rd';
    if (fifth === null && seventh === null && (major || minor)) words += ' (no 5th)';
    return { sym, long: words, cost };
  }

  function slashCost(label) {
    switch (label) {
      case '♭3': case '3': return 1.6;
      case '5': return 1.8;
      case '♭5': case '♯5': return 2.0;
      case '♭7': case '7': case '𝄫7': return 2.0;
      case '6': case '4': case '2': return 2.2;
      case '9': case '11': case '13': return 2.8;
      default: return 3.2;
    }
  }
  function inversionText(label) {
    switch (label) {
      case '♭3': case '3': return '1st inversion';
      case '♭5': case '5': case '♯5': return '2nd inversion';
      case '♭7': case '7': case '𝄫7': return '3rd inversion';
      case '6': return '6th in bass';
      case '4': return '4th in bass';
      case '2': return '2nd in bass';
      default: return label + ' in bass';
    }
  }
  const FOREIGN_LABELS = { 1: ['♭9'], 2: ['9'], 3: ['♭3', '♯9'], 4: ['3'], 5: ['4'], 6: ['♭5', '♯11'], 7: ['5'], 8: ['♭13', '♯5'], 9: ['6'], 10: ['♭7'], 11: ['7'] };
  function spellForeign(root, iv) {
    let best = null;
    for (const lab of FOREIGN_LABELS[iv]) {
      const s = spellDegree(root, lab);
      if (!best || Math.abs(s.a) < Math.abs(best.a)) best = s;
    }
    if (Math.abs(best.a) > 1) { // a bass note is clearer as a plain name than as B𝄫 / E𝄪
      const pc = pcOf(best);
      best = fromTable(root.a < 0 ? FLAT : root.a > 0 ? SHARP : COMMON, pc);
    }
    return best;
  }

  // ───────────── candidates ─────────────
  function candidate(rootPc, chordPcs, bassPc, foreign) {
    const ivs = new Set(chordPcs.map((p) => mod12(p - rootPc)));
    const d = describe(ivs);
    const n = nameFrom(d);
    let cost = n.cost, bassLabel = null;
    if (foreign) {
      // a plain triad over a foreign bass reads best as a slash chord (B♭/C, C/D) — how keyboard players think
      const bi = mod12(bassPc - rootPc);
      const plain = d.seventh === null && !d.sixth && d.tens.length === 0 && (d.third === 3 || d.third === 4) && d.fifth === 7;
      cost += plain ? 1.4 : 1.9;
      if ((bi === 9 || bi === 10 || bi === 11) && d.seventh === null && !d.sixth) cost += plain ? 0.8 : 0.5;
    } else if (bassPc !== rootPc) {
      bassLabel = d.deg[mod12(bassPc - rootPc)];
      cost += slashCost(bassLabel);
    }
    return { rootPc, chordPcs, bassPc, foreign, d, n, cost, bassLabel };
  }

  function nameNote(pc, spelling) {
    if (spelling === 'sharp') return fromTable(SHARP, pc);
    if (spelling === 'flat') return fromTable(FLAT, pc);
    return fromTable(COMMON, pc);
  }

  function noteObj(midi, s, label, isBass) {
    const octave = octaveOf(midi, s);
    return { midi, name: txt(s), l: s.l, a: s.a, octave, step: octave * 7 + s.l, label: label || null, isBass: !!isBass };
  }

  // turn a candidate into a fully spelled, displayable result
  function render(c, notes, opts, forcedRoot) {
    const spelling = (opts && opts.spelling) || 'auto';
    const labels = Object.values(c.d.deg);
    let root = forcedRoot || chooseRootSpelling(c.rootPc, labels);
    const plain = spelling === 'sharp' || spelling === 'flat';
    if (plain) root = nameNote(c.rootPc, spelling);
    const spellPc = (pc) => {
      if (plain) return nameNote(pc, spelling);
      const iv = mod12(pc - c.rootPc);
      const lab = c.d.deg[iv];
      if (lab) return spellDegree(root, lab);
      return spellForeign(root, iv);
    };
    const bassS = spellPc(c.bassPc);
    const out = notes.map((m, i) => {
      const pc = mod12(m), iv = mod12(pc - c.rootPc);
      const isForeignBass = c.foreign && pc === c.bassPc;
      return noteObj(m, spellPc(pc), isForeignBass ? 'bass' : c.d.deg[iv], i === 0);
    });
    const tones = c.chordPcs
      .map((pc) => ({ pc, label: c.d.deg[mod12(pc - c.rootPc)] }))
      .sort((a, b) => DEG_ORDER[a.label] - DEG_ORDER[b.label])
      .map((t) => ({ name: txt(spellPc(t.pc)), label: t.label }));
    if (c.foreign) tones.unshift({ name: txt(bassS), label: 'bass' });
    const slash = c.bassPc !== c.rootPc;
    const rootTxt = txt(root);
    const bassTxt = slash ? txt(bassS) : null;
    const text = rootTxt + c.n.sym + (slash ? '/' + bassTxt : '');
    const inv = !slash ? null : c.foreign ? 'over ' + bassTxt : inversionText(c.bassLabel);
    return {
      kind: 'chord', text, symbol: { root: rootTxt, suffix: c.n.sym, bass: bassTxt },
      long: rootTxt + ' ' + c.n.long, inversion: inv, notes: out, tones,
      cost: Math.round(c.cost * 100) / 100, confidence: c.cost >= 3.5 ? 'low' : 'high', alternates: [],
    };
  }

  const IV_NAMES = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];
  const IV_DEG = [null, '♭9', '9', '♭3', '3', '4', '♭5', '5', '♭13', '6', '♭7', '7'];
  const IV_LAB = [null, '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];

  function analyze(midiNotes, opts) {
    opts = opts || {};
    const spelling = opts.spelling || 'auto';
    const notes = uniqSorted(midiNotes || []);
    if (!notes.length) return { kind: 'none', notes: [] };
    if (notes.length > MAX_NOTES) {
      return {
        kind: 'toomany', count: notes.length, text: '', long: notes.length + ' notes — more than ' + MAX_NOTES + ', not named',
        notes: notes.map((m) => noteObj(m, nameNote(mod12(m), spelling), null, false)),
      };
    }
    const pcs = [...new Set(notes.map(mod12))];
    const bassPc = mod12(notes[0]);

    if (pcs.length === 1) {
      const s = nameNote(bassPc, spelling);
      const alt = s.a !== 0 && spelling === 'auto' ? txt(s.a > 0 ? fromTable(FLAT, bassPc) : fromTable(SHARP, bassPc)) : null;
      const ns = notes.map((m, i) => noteObj(m, s, '1', i === 0));
      const oct = ns.length > 1 ? 'octaves' : ns[0].name + ns[0].octave + (notes[0] === 60 ? ' · middle C' : '');
      return {
        kind: 'note', text: txt(s), symbol: { root: txt(s), suffix: '', bass: null },
        long: oct + (alt ? '  (= ' + alt + ')' : ''), inversion: null, notes: ns,
        tones: [{ name: txt(s), label: '1' }], alternates: [], confidence: 'high',
      };
    }

    if (pcs.length === 2) {
      const upPc = pcs.find((p) => p !== bassPc);
      const iv = mod12(upPc - bassPc);
      let b, u;
      if (spelling === 'auto') { b = chooseRootSpelling(bassPc, [IV_DEG[iv]]); u = spellDegree(b, IV_DEG[iv]); }
      else { b = nameNote(bassPc, spelling); u = nameNote(upPc, spelling); }
      const ns = notes.map((m, i) => noteObj(m, mod12(m) === bassPc ? b : u, mod12(m) === bassPc ? '1' : IV_LAB[iv], i === 0));
      const tones = [{ name: txt(b), label: '1' }, { name: txt(u), label: IV_LAB[iv] }];
      if (iv === 7) {
        return { kind: 'interval', text: txt(b) + '5', symbol: { root: txt(b), suffix: '5', bass: null },
          long: txt(b) + ' power chord (perfect 5th)', inversion: null, notes: ns, tones, alternates: [], confidence: 'high' };
      }
      if (iv === 5) {
        return { kind: 'interval', text: txt(u) + '5/' + txt(b), symbol: { root: txt(u), suffix: '5', bass: txt(b) },
          long: 'perfect 4th · ' + txt(u) + ' power chord over ' + txt(b), inversion: null, notes: ns, tones, alternates: [], confidence: 'high' };
      }
      return { kind: 'interval', text: txt(b) + '–' + txt(u), symbol: { root: txt(b), suffix: '', bass: null, upper: txt(u) },
        long: IV_NAMES[iv] + (iv === 6 ? ' (' + txt(b) + ' to ' + txt(u) + ')' : ''), inversion: null, notes: ns, tones, alternates: [], confidence: 'high' };
    }

    const cands = [];
    for (const r of pcs) cands.push(candidate(r, pcs, bassPc, false));
    const bassAlone = !notes.slice(1).some((m) => mod12(m) === bassPc);
    if (bassAlone) {
      const upper = pcs.filter((p) => p !== bassPc);
      if (upper.length >= 3) {
        for (const r of upper) {
          const bi = mod12(bassPc - r);
          const c = candidate(r, upper, bassPc, true);
          if (bi === 7) continue; // that's just the chord's own 5th
          if ((bi === 3 || bi === 4) && c.d.third === null) continue; // it would be the 3rd
          cands.push(c);
        }
      }
    }
    cands.sort((a, b) => a.cost - b.cost || (a.rootPc === bassPc ? -1 : 0) - (b.rootPc === bassPc ? -1 : 0) || a.n.sym.length - b.n.sym.length);
    const best = render(cands[0], notes, opts);
    const seen = new Set([best.text]);
    for (const c of cands.slice(1)) {
      if (best.alternates.length >= 2 || c.cost > cands[0].cost + 1.6) break;
      if (c.cost > 2.6) continue;
      const r = render(c, notes, opts);
      if (seen.has(r.text)) continue;
      seen.add(r.text);
      best.alternates.push(r.text);
    }
    return best;
  }

  // ───────────── SHOW mode: build a chord from a menu selection ─────────────
  const TYPES = [
    ['Triads', [
      ['maj', '', 'major', [0, 4, 7]], ['m', 'm', 'minor', [0, 3, 7]], ['dim', 'dim', 'diminished', [0, 3, 6]],
      ['aug', 'aug', 'augmented', [0, 4, 8]], ['sus2', 'sus2', 'suspended 2nd', [0, 2, 7]], ['sus4', 'sus4', 'suspended 4th', [0, 5, 7]],
      ['5', '5', 'power chord', [0, 7, 12]],
    ]],
    ['Sixths', [
      ['6', '6', 'major 6th', [0, 4, 7, 9]], ['m6', 'm6', 'minor 6th', [0, 3, 7, 9]],
      ['69', '6/9', 'six-nine', [0, 4, 7, 9, 14]], ['m69', 'm6/9', 'minor six-nine', [0, 3, 7, 9, 14]],
    ]],
    ['Sevenths', [
      ['7', '7', 'dominant 7th', [0, 4, 7, 10]], ['maj7', 'maj7', 'major 7th', [0, 4, 7, 11]], ['m7', 'm7', 'minor 7th', [0, 3, 7, 10]],
      ['mmaj7', 'm(maj7)', 'minor-major 7th', [0, 3, 7, 11]], ['m7b5', 'm7♭5', 'half-diminished', [0, 3, 6, 10]],
      ['dim7', 'dim7', 'diminished 7th', [0, 3, 6, 9]], ['7s5', '7♯5', 'augmented 7th', [0, 4, 8, 10]],
      ['maj7s5', 'maj7♯5', 'augmented major 7th', [0, 4, 8, 11]], ['7b5', '7♭5', 'dominant 7th flat 5', [0, 4, 6, 10]],
      ['7sus4', '7sus4', '7th suspended 4th', [0, 5, 7, 10]],
    ]],
    ['Added tones', [
      ['add9', 'add9', 'major add 9', [0, 4, 7, 14]], ['madd9', 'm(add9)', 'minor add 9', [0, 3, 7, 14]],
      ['add11', 'add11', 'major add 11', [0, 4, 7, 17]], ['sus4add9', 'sus4(add9)', 'sus 4 add 9', [0, 5, 7, 14]],
    ]],
    ['Extended', [
      ['9', '9', 'dominant 9th', [0, 4, 7, 10, 14]], ['maj9', 'maj9', 'major 9th', [0, 4, 7, 11, 14]], ['m9', 'm9', 'minor 9th', [0, 3, 7, 10, 14]],
      ['9sus4', '9sus4', '9th suspended 4th', [0, 5, 7, 10, 14]], ['11', '11', 'dominant 11th', [0, 4, 7, 10, 14, 17]],
      ['m11', 'm11', 'minor 11th', [0, 3, 7, 10, 14, 17]], ['13', '13', 'dominant 13th', [0, 4, 7, 10, 14, 21]],
      ['maj13', 'maj13', 'major 13th', [0, 4, 7, 11, 14, 21]], ['m13', 'm13', 'minor 13th', [0, 3, 7, 10, 14, 21]],
    ]],
    ['Altered', [
      ['7b9', '7♭9', 'dominant 7th flat 9', [0, 4, 7, 10, 13]], ['7s9', '7♯9', 'dominant 7th sharp 9', [0, 4, 7, 10, 15]],
      ['7s11', '7♯11', 'dominant 7th sharp 11', [0, 4, 7, 10, 18]], ['7b13', '7♭13', 'dominant 7th flat 13', [0, 4, 7, 10, 20]],
      ['maj7s11', 'maj7♯11', 'major 7th sharp 11', [0, 4, 7, 11, 18]], ['13b9', '13♭9', '13th flat 9', [0, 4, 7, 10, 13, 21]],
      ['7s5s9', '7♯5♯9', 'altered dominant', [0, 4, 8, 10, 15]],
    ]],
  ];
  const TYPE_BY_ID = {};
  for (const [, list] of TYPES) for (const [id, sym, label, ivs] of list) TYPE_BY_ID[id] = { id, sym, label, ivs };

  // modifiers: replace the fifth, add a tension (upper octave), or drop a tone
  const MODS = [
    ['b5', '♭5'], ['s5', '♯5'], ['b9', '♭9'], ['9', '9'], ['s9', '♯9'], ['11', '11'], ['s11', '♯11'], ['b13', '♭13'], ['13', '13'], ['no3', 'no3'], ['no5', 'no5'],
  ];
  function applyMods(ivs, mods) {
    let set = new Set(ivs);
    const m = new Set(mods || []);
    const isFifth = (i) => i === 6 || i === 7 || i === 8;
    if (m.has('b5') || m.has('s5')) {
      set = new Set([...set].filter((i) => !isFifth(i)));
      set.add(m.has('b5') ? 6 : 8);
    }
    const tens = { b9: 13, '9': 14, s9: 15, '11': 17, s11: 18, b13: 20, '13': 21 };
    for (const k in tens) if (m.has(k)) set.add(tens[k]);
    if (m.has('no3')) { set.delete(3); set.delete(4); }
    if (m.has('no5')) for (const i of [6, 7, 8]) set.delete(i);
    if (!set.has(0)) set.add(0);
    return [...set].sort((a, b) => a - b);
  }

  // spec: { root: 'G♯', type: 'm7b5', mods: ['9'], inversion: 0, bass: null|pc, octave: 4 }
  function build(spec, opts) {
    const root = parseName(spec.root) || sp(0, 0);
    const rpc = pcOf(root);
    const t = TYPE_BY_ID[spec.type] || TYPE_BY_ID.maj;
    const ivs = applyMods(t.ivs, spec.mods);
    const baseMidi = 12 * ((spec.octave == null ? 4 : spec.octave) + 1) + rpc;
    let notes = uniqSorted(ivs.map((i) => baseMidi + i));
    const order = [];
    for (const m of notes) if (!order.includes(mod12(m))) order.push(mod12(m));
    const inv = Math.max(0, Math.min(spec.inversion | 0, order.length - 1));
    if (inv > 0) {
      const target = notes.find((m) => mod12(m) === order[inv]);
      notes = uniqSorted(notes.map((m) => { while (m < target) m += 12; return m; }));
    }
    let bassPc = mod12(notes[0]);
    let foreign = false;
    if (spec.bass != null && spec.bass !== '' && mod12(+spec.bass) !== bassPc) {
      const bp = mod12(+spec.bass);
      let b = notes[0] - 1;
      while (mod12(b) !== bp) b--;
      notes.unshift(b);
      bassPc = bp;
      foreign = !order.includes(bp);
    }
    const c = candidate(rpc, order, bassPc, foreign);
    const res = render(c, notes, opts, root);
    const free = analyze(notes, opts);
    res.aka = free.kind === 'chord' && free.text !== res.text ? free.text : null;
    res.inversions = order.map((pc, i) => {
      const lab = c.d.deg[mod12(pc - rpc)];
      const nm = res.tones.find((tt) => tt.label === lab);
      const who = nm ? nm.name : '';
      return { index: i, label: i === 0 ? 'Root · ' + who : ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][i] + ' inv · ' + who + ' bass' };
    });
    return res;
  }

  const ROOTS = ['C', 'C♯', 'D♭', 'D', 'D♯', 'E♭', 'E', 'F', 'F♯', 'G♭', 'G', 'G♯', 'A♭', 'A', 'A♯', 'B♭', 'B'];

  G.ChordEngine = {
    MAX_NOTES, analyze, build, describe, nameFrom, parseName, spellDegree, pcOf, txt,
    TYPES, TYPE_BY_ID, MODS, ROOTS, nameNote: (pc, s) => txt(nameNote(pc, s)),
    spellMidi: (m, s) => noteObj(m, nameNote(mod12(m), s || 'auto'), null, false),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
