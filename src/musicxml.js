/* ───────────────────────── CHORD//SCOPE · MusicXML ─────────────────────────
   MusicXML is the standard interchange format for sheet music (MuseScore, Sibelius, Finale,
   Dorico, Noteflight…).
   write(score)        the transcribed score → MusicXML 4.0 (partwise): one piano part on two
                       staves, ties, rests, chord symbols as <harmony>, tempo, metre, double bar
                       lines where phrases end.
   parse(text)         a .musicxml / .xml score → a playable track (all parts merged, ties joined,
                       repeats played once). readFile() also opens compressed .mxl files.     */
(function (G) {
  'use strict';
  const LETTERS = 'CDEFGAB';
  const PCS = [0, 2, 4, 5, 7, 9, 11];

  // ── a small, forgiving XML reader (no DTDs, no namespaces needed for MusicXML) ──
  function parseXML(src) {
    const root = { name: '#doc', attrs: {}, children: [], text: '' };
    const stack = [root];
    let i = 0;
    const n = src.length;
    const ent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    });
    while (i < n) {
      const lt = src.indexOf('<', i);
      if (lt < 0) break;
      if (lt > i) stack[stack.length - 1].text += ent(src.slice(i, lt));
      if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
      if (src[lt + 1] === '?') { const e = src.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
      if (src[lt + 1] === '!') { // DOCTYPE, possibly with an internal subset
        let depth = 0, j = lt + 2;
        for (; j < n; j++) { const c = src[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
        i = j + 1; continue;
      }
      const gt = findTagEnd(src, lt + 1);
      if (gt < 0) break;
      let body = src.slice(lt + 1, gt);
      i = gt + 1;
      if (body[0] === '/') { // closing tag
        const name = body.slice(1).trim().replace(/^.*:/, '');
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break; }
        continue;
      }
      const selfClose = body.endsWith('/');
      if (selfClose) body = body.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(body);
      if (!m) continue;
      const el = { name: m[1].replace(/^.*:/, ''), attrs: {}, children: [], text: '' };
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = re.exec(body.slice(m[1].length)))) el.attrs[a[1].replace(/^.*:/, '')] = ent(a[3] != null ? a[3] : a[4]);
      stack[stack.length - 1].children.push(el);
      if (!selfClose) stack.push(el);
    }
    return root;
  }
  function findTagEnd(s, i) {
    let q = null;
    for (; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return i;
    }
    return -1;
  }
  const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
  const kid = (el, name) => (el ? el.children.find((c) => c.name === name) || null : null);
  const txt = (el, name) => { const c = name ? kid(el, name) : el; return c ? c.text.trim() : ''; };
  const num = (el, name, d) => { const v = parseFloat(txt(el, name)); return Number.isFinite(v) ? v : d; };

  // ── reading ──
  function parse(text, fileName) {
    const doc = parseXML(text);
    const score = doc.children.find((c) => c.name === 'score-partwise' || c.name === 'score-timewise');
    if (!score) throw new Error('this file is not a MusicXML score');
    const parts = score.name === 'score-partwise' ? kids(score, 'part').map((p) => kids(p, 'measure')) : timewiseToPartwise(score);
    const title = txt(kid(score, 'work'), 'work-title') || txt(score, 'movement-title') || baseName(fileName) || 'MusicXML score';
    const tempoEv = []; // {q, bpm}
    let meter = null;
    const notes = []; // {m, vel, q, dq}
    parts.forEach((measures, pi) => {
      let div = 1, q = 0, lastOnset = 0, vel = 0.7;
      const ties = new Map(); // "midi:voice" → note awaiting a tie stop
      for (const meas of measures) {
        let measStart = q, measEnd = q;
        for (const el of meas.children) {
          if (el.name === 'attributes') {
            div = num(el, 'divisions', div) || div;
            const tm = kid(el, 'time');
            if (tm && !meter) meter = { beats: parseInt(txt(tm, 'beats'), 10) || 4, unit: parseInt(txt(tm, 'beat-type'), 10) || 4 };
          } else if (el.name === 'direction' || el.name === 'sound') {
            const snd = el.name === 'sound' ? el : kid(el, 'sound');
            if (snd && snd.attrs.tempo) tempoEv.push({ q: q + (el.name === 'direction' ? num(el, 'offset', 0) / div : 0), bpm: parseFloat(snd.attrs.tempo), part: pi });
            if (snd && snd.attrs.dynamics) vel = Math.max(0.05, Math.min(1, parseFloat(snd.attrs.dynamics) / 100 * 0.78));
            if (!snd || !snd.attrs.tempo) { // a metronome mark with no <sound tempo>: use it too
              const met = kid(kid(el, 'direction-type'), 'metronome');
              if (met && txt(met, 'per-minute')) {
                const unit = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[txt(met, 'beat-unit')] || 1;
                const pm = parseFloat(txt(met, 'per-minute'));
                if (pm > 0) tempoEv.push({ q, bpm: pm * unit * (kid(met, 'beat-unit-dot') ? 1.5 : 1), part: pi, weak: true });
              }
            }
          } else if (el.name === 'backup') {
            q -= num(el, 'duration', 0) / div;
          } else if (el.name === 'forward') {
            q += num(el, 'duration', 0) / div; measEnd = Math.max(measEnd, q);
          } else if (el.name === 'note') {
            if (kid(el, 'grace')) continue; // grace notes take no time
            const dq = num(el, 'duration', 0) / div;
            const isChord = !!kid(el, 'chord');
            const onset = isChord ? lastOnset : q;
            if (!isChord) { lastOnset = q; q += dq; measEnd = Math.max(measEnd, q); }
            const pitch = kid(el, 'pitch');
            if (!pitch || kid(el, 'rest') || kid(el, 'cue')) continue; // cue notes take time but aren't played
            const step = LETTERS.indexOf(txt(pitch, 'step').toUpperCase());
            if (step < 0) continue;
            const midi = Math.round((num(pitch, 'octave', 4) + 1) * 12 + PCS[step] + num(pitch, 'alter', 0));
            const voice = txt(el, 'voice') || '1';
            const tieTypes = kids(el, 'tie').map((t) => t.attrs.type);
            const tied = kids(kid(el, 'notations'), 'tied').map((t) => t.attrs.type);
            const stop = tieTypes.includes('stop') || tied.includes('stop');
            const start = tieTypes.includes('start') || tied.includes('start');
            const key = midi + ':' + voice;
            let nv = vel;
            if (el.attrs.dynamics) nv = Math.max(0.05, Math.min(1, parseFloat(el.attrs.dynamics) / 100 * 0.78));
            const prev = stop ? ties.get(key) || ties.get(midi + ':*') : null;
            if (prev && Math.abs(prev.q + prev.dq - onset) < 1e-6) {
              prev.dq += dq;
              if (!start) { ties.delete(key); ties.delete(midi + ':*'); }
              continue;
            }
            const note = { m: midi, vel: nv, q: onset, dq: Math.max(dq, 1 / 64) };
            notes.push(note);
            if (start) { ties.set(key, note); ties.set(midi + ':*', note); }
          }
        }
        q = Math.max(q, measEnd, measStart);
      }
    });
    // tempo map in quarter notes → seconds (first part that has tempo marks wins; explicit <sound> over metronome text)
    const owner = tempoEv.length ? tempoEv.reduce((a, t) => (t.weak ? a : Math.min(a, t.part)), Infinity) : Infinity;
    let tempos = tempoEv.filter((t) => (owner === Infinity ? true : t.part === owner && !t.weak)).sort((a, b) => a.q - b.q);
    if (!tempos.length || tempos[0].q > 0) tempos.unshift({ q: 0, bpm: tempos.length ? tempos[0].bpm : 120 });
    const tm = [];
    for (const t of tempos) {
      const last = tm[tm.length - 1];
      if (last && Math.abs(last.q - t.q) < 1e-9) { last.bpm = t.bpm; continue; }
      const sec = last ? last.t + ((t.q - last.q) * 60) / last.bpm : 0;
      tm.push({ t: sec, q: t.q, bpm: t.bpm });
    }
    const secAt = (q) => { let s = tm[0]; for (let i = 1; i < tm.length && tm[i].q <= q; i++) s = tm[i]; return s.t + ((q - s.q) * 60) / s.bpm; };
    notes.sort((a, b) => a.q - b.q || a.m - b.m);
    const out = notes.map((n) => { const t = secAt(n.q); return { m: n.m, vel: n.vel, t, d: Math.max(0.03, secAt(n.q + n.dq) - t) }; });
    const duration = out.reduce((a, n) => Math.max(a, n.t + n.d), 0);
    return { name: title, source: 'musicxml', notes: out, pedals: [], tempos: tm, bpm: Math.round(tm[0].bpm * 10) / 10, beats: meter ? meter.beats : 4, unit: meter ? meter.unit : 4, duration };
  }
  function timewiseToPartwise(score) {
    const byPart = new Map();
    for (const meas of kids(score, 'measure')) for (const part of kids(meas, 'part')) {
      if (!byPart.has(part.attrs.id)) byPart.set(part.attrs.id, []);
      byPart.get(part.attrs.id).push(part);
    }
    return [...byPart.values()];
  }
  function baseName(f) { return f ? String(f).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') : ''; }

  // .musicxml/.xml text, or a compressed .mxl (zip) → MusicXML text
  async function readFile(buf, fileName) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0x50 && u8[1] === 0x4b) return unzipMXL(buf);
    if ((u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff)) return new TextDecoder(u8[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(u8);
    return new TextDecoder('utf-8').decode(u8);
  }
  async function unzipMXL(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('damaged .mxl file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    const dec = new TextDecoder();
    for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { method, csize, local });
      p += 46 + nlen + xlen + clen;
    }
    const read = async (name) => {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return dec.decode(data);
      if (e.method !== 8) throw new Error('unsupported compression in .mxl');
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot open compressed .mxl files; export uncompressed MusicXML instead');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return dec.decode(await new Response(stream).arrayBuffer());
    };
    let target = null;
    const container = await read('META-INF/container.xml');
    if (container) { const m = /full-path\s*=\s*"([^"]+)"/.exec(container); if (m && entries.has(m[1])) target = m[1]; }
    if (!target) target = [...entries.keys()].find((n) => !n.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(n));
    const out = target && (await read(target));
    if (!out) throw new Error('no score inside this .mxl file');
    return out;
  }

  // ── writing ──
  // score: { title, date, bpm, beats, tpb, bars: [{ staves: [[item…], [item…]], endStyle }], marks: [{t, text, chord}] }
  // item: { rest, start, value (16ths), whole, notes: [{l, a, octave}], tiePrev, tieNext }
  const TYPES = { 16: ['whole', 0], 12: ['half', 1], 8: ['half', 0], 6: ['quarter', 1], 4: ['quarter', 0], 3: ['eighth', 1], 2: ['eighth', 0], 1: ['16th', 0] };
  const ACC = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function write(score) {
    const L = [];
    const tpb = score.tpb;
    L.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
    L.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
    L.push('<score-partwise version="4.0">');
    L.push(`  <work><work-title>${esc(score.title || 'CHORD//SCOPE session')}</work-title></work>`);
    L.push('  <identification>');
    L.push(`    <encoding><software>${esc(score.software || 'CHORD//SCOPE')}</software><encoding-date>${esc(score.date || new Date().toISOString().slice(0, 10))}</encoding-date></encoding>`);
    L.push('  </identification>');
    L.push('  <part-list><score-part id="P1"><part-name>Piano</part-name><score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list>');
    L.push('  <part id="P1">');
    const pending = new Map(); // tick → marks
    for (const mk of score.marks || []) { if (!pending.has(mk.t)) pending.set(mk.t, []); pending.get(mk.t).push(mk); }
    score.bars.forEach((bar, bi) => {
      L.push(`    <measure number="${bi + 1}">`);
      if (bi === 0) {
        L.push(`      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>${score.beats}</beats><beat-type>4</beat-type></time><staves>2</staves>` +
          '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>');
        L.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(score.bpm)}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${Math.round(score.bpm)}"/></direction>`);
      }
      for (let st = 0; st < 2; st++) {
        if (st === 1) { const back = bar.staves[0].reduce((a, it) => a + it.value, 0); if (back) L.push(`      <backup><duration>${back}</duration></backup>`); }
        const accState = new Map();
        for (const it of bar.staves[st]) {
          const h = pending.get(it.start);
          if (h) { for (const mk of h) L.push('      ' + harmony(mk)); pending.delete(it.start); }
          const voice = st === 0 ? 1 : 5;
          if (it.rest) {
            if (it.whole) L.push(`      <note><rest measure="yes"/><duration>${tpb}</duration><voice>${voice}</voice><staff>${st + 1}</staff></note>`);
            else { const [type, dot] = TYPES[it.value] || ['16th', 0]; L.push(`      <note><rest/><duration>${it.value}</duration><voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}<staff>${st + 1}</staff></note>`); }
            continue;
          }
          const [type, dot] = TYPES[it.value] || ['16th', 0];
          it.notes.forEach((n, i) => {
            const step = LETTERS[n.l], alter = n.a || 0;
            let acc = '';
            const key = n.octave * 7 + n.l;
            if (!it.tiePrev) {
              const cur = accState.has(key) ? accState.get(key) : 0;
              if (alter !== cur) { acc = `<accidental>${ACC[alter]}</accidental>`; accState.set(key, alter); }
            }
            const ties = (it.tiePrev ? '<tie type="stop"/>' : '') + (it.tieNext ? '<tie type="start"/>' : '');
            const tied = (it.tiePrev ? '<tied type="stop"/>' : '') + (it.tieNext ? '<tied type="start"/>' : '');
            L.push(`      <note>${i ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${n.octave}</octave></pitch>` +
              `<duration>${it.value}</duration>${ties}<voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}${acc}<staff>${st + 1}</staff>${tied ? `<notations>${tied}</notations>` : ''}</note>`);
          });
        }
      }
      const style = bi === score.bars.length - 1 ? 'light-heavy' : bar.endStyle === 'double' ? 'light-light' : null;
      if (style) L.push(`      <barline location="right"><bar-style>${style}</bar-style></barline>`);
      L.push('    </measure>');
    });
    L.push('  </part>');
    L.push('</score-partwise>');
    return L.join('\n') + '\n';
  }

  // chord symbol → <harmony>, spelled from the engine's chord-tone labels (1, ♭3, 5, ♭7, 9…)
  const ALTER = { '♭': -1, '♯': 1, '𝄫': -2, '𝄪': 2 };
  function pitchParts(name) {
    const m = /^([A-G])([♭♯𝄫𝄪]?)/u.exec(name || '');
    return m ? { step: m[1], alter: m[2] ? ALTER[m[2]] : 0 } : null;
  }
  function harmony(mk) {
    const c = mk.chord, sym = c && c.symbol;
    const root = pitchParts(sym ? sym.root : mk.text);
    if (!root) return '';
    const suffix = sym ? sym.suffix || '' : '';
    // a two-note "X5" reading is a power chord (its tone labels count from the bass, not the root)
    const k = c && c.kind === 'interval' ? (suffix === '5' ? { kind: 'power', degrees: [] } : { kind: 'other', degrees: [] })
      : c && c.tones && !sym.upper ? chordKind(c.tones.map((t) => t.label)) : { kind: 'other', degrees: [] };
    let s = `<harmony print-frame="no"><root><root-step>${root.step}</root-step>${root.alter ? `<root-alter>${root.alter}</root-alter>` : ''}</root>`;
    s += `<kind text="${esc(suffix)}"${k.kind === 'other' ? '' : ' use-symbols="no"'}>${k.kind}</kind>`;
    const bass = sym && sym.bass ? pitchParts(sym.bass) : null;
    if (bass) s += `<bass><bass-step>${bass.step}</bass-step>${bass.alter ? `<bass-alter>${bass.alter}</bass-alter>` : ''}</bass>`;
    for (const [value, alter, type] of k.degrees) s += `<degree print-object="no"><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree>`;
    return s + '<staff>1</staff></harmony>';
  }
  function chordKind(labels) {
    const has = (l) => labels.includes(l);
    const third = has('3') ? 'M' : has('♭3') ? 'm' : null;
    const sus = third ? null : has('4') ? 4 : has('2') ? 2 : null;
    const fifth = has('5') ? 0 : has('♭5') ? -1 : has('♯5') ? 1 : null;
    const seventh = has('7') ? 'M' : has('♭7') ? 'm' : has('𝄫7') ? 'd' : null;
    const sixth = has('6');
    const tens = { 9: has('9') ? 0 : has('♭9') ? -1 : has('♯9') ? 1 : null, 11: has('11') ? 0 : has('♯11') ? 1 : null, 13: has('13') ? 0 : has('♭13') ? -1 : null };
    let kind = 'other', implied = { 5: 0 }, ext = 7;
    if (seventh === 'd') { kind = 'diminished-seventh'; implied = { 5: -1 }; }
    else if (third === 'm' && fifth === -1 && seventh === 'm') { kind = 'half-diminished'; implied = { 5: -1 }; }
    else if (third === 'm' && fifth === -1 && !seventh && !sixth) { kind = 'diminished'; implied = { 5: -1 }; }
    else if (third === 'M' && fifth === 1 && seventh === 'm') { kind = 'augmented-seventh'; implied = { 5: 1 }; }
    else if (third === 'M' && fifth === 1 && !seventh && !sixth) { kind = 'augmented'; implied = { 5: 1 }; }
    else if (seventh) {
      const fam = third === 'm' ? (seventh === 'M' ? 'major-minor' : 'minor') : seventh === 'M' ? 'major' : 'dominant';
      if (fam === 'major-minor') kind = 'major-minor';
      else {
        // the highest unaltered tension in an unbroken stack names the chord (9 → 9th, 9+11 → 11th, 13 → 13th)
        if (tens[9] === 0 && tens[11] === 0 && tens[13] === 0) ext = 13;
        else if (tens[13] === 0 && tens[9] != null) ext = 13;
        else if (tens[9] === 0 && tens[11] === 0) ext = 11;
        else if (tens[9] === 0) ext = 9;
        const names = { dominant: ['dominant', 'dominant-ninth', 'dominant-11th', 'dominant-13th'], major: ['major-seventh', 'major-ninth', 'major-11th', 'major-13th'], minor: ['minor-seventh', 'minor-ninth', 'minor-11th', 'minor-13th'] };
        kind = names[fam][[7, 9, 11, 13].indexOf(ext)];
      }
    } else if (sixth) kind = third === 'm' ? 'minor-sixth' : 'major-sixth';
    else if (third === 'M') kind = 'major';
    else if (third === 'm') kind = 'minor';
    else if (sus === 4) kind = 'suspended-fourth';
    else if (sus === 2) kind = 'suspended-second';
    else if (fifth === 0) kind = 'power';
    if (kind === 'other') return { kind, degrees: [] };
    const degrees = [];
    // a suspended or 3rd-less seventh chord: say so
    if (seventh && !third && kind !== 'diminished-seventh' && kind !== 'half-diminished') {
      degrees.push([3, 0, 'subtract']);
      if (sus) degrees.push([sus, 0, 'add']);
    }
    if (implied[5] !== undefined && kind !== 'power') {
      if (fifth == null) degrees.push([5, 0, 'subtract']);
      else if (fifth !== implied[5]) degrees.push([5, fifth - implied[5], 'alter']);
    }
    const impliedT = ext >= 13 ? [9, 11, 13] : ext >= 11 ? [9, 11] : ext >= 9 ? [9] : [];
    for (const d of [9, 11, 13]) {
      const v = tens[d];
      if (impliedT.includes(d)) {
        if (v == null) { if (!(d === 11 && ext === 13)) degrees.push([d, 0, 'subtract']); } // 13ths usually drop the 11th
        else if (v !== 0) degrees.push([d, v, 'alter']);
      } else if (v != null) degrees.push([d, v, 'add']);
    }
    return { kind, degrees };
  }

  G.CSMusicXML = { parse, write, readFile, parseXML, chordKind };
})(typeof window !== 'undefined' ? window : globalThis);
