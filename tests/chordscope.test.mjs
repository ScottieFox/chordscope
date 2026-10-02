// CHORD//SCOPE — headless validation harness (Node only, no dependencies).
// Usage:  node tests/chordscope.test.mjs [path/to/index.html | path/to/src]      (npm test)
// Runs the exact code shipped inside the app: chord names for a table of voicings, the
// live-transcription math (note values, ties, rests, phrases, hand split, chord symbols), and
// the file formats (MIDI and MusicXML export/import, .mxl). Exit 1 on failure.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(here, '..', 'index.html');
let engineSrc, scoreSrc, midiSrc, xmlSrc, playerSrc;
if (target.endsWith('.html')) {
  const html = fs.readFileSync(target, 'utf8');
  const grab = (id) => { const m = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html); if (!m) { console.error('script #' + id + ' not found in', target); process.exit(2); } return m[1]; };
  engineSrc = grab('chord-engine');
  scoreSrc = grab('score-model');
  midiSrc = grab('midi-file');
  xmlSrc = grab('musicxml');
  playerSrc = grab('player');
} else { // a src/ directory or engine.js path while developing
  const dir = target.endsWith('.js') ? path.dirname(target) : target;
  engineSrc = fs.readFileSync(path.join(dir, 'engine.js'), 'utf8');
  scoreSrc = fs.readFileSync(path.join(dir, 'score-model.js'), 'utf8');
  midiSrc = fs.readFileSync(path.join(dir, 'midi-file.js'), 'utf8');
  xmlSrc = fs.readFileSync(path.join(dir, 'musicxml.js'), 'utf8');
  playerSrc = fs.readFileSync(path.join(dir, 'player.js'), 'utf8');
}
const ctx = { TextDecoder, TextEncoder, DecompressionStream: globalThis.DecompressionStream, Blob, Response };
vm.createContext(ctx);
vm.runInContext(engineSrc, ctx);
vm.runInContext(scoreSrc, ctx);
vm.runInContext(midiSrc, ctx);
vm.runInContext(xmlSrc, ctx);
const E = ctx.ChordEngine;
const ScoreModel = ctx.ScoreModel;

const LET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (n) => {
  const m = /^([A-G])(#{0,2}|b{0,2})(-?\d)$/.exec(n);
  if (!m) throw new Error('bad note ' + n);
  const acc = m[2].startsWith('#') ? m[2].length : -m[2].length;
  return 12 * (+m[3] + 1) + LET[m[1]] + acc;
};
const notes = (s) => s.trim().split(/\s+/).map(midi);

// [voicing (lowest note first), expected symbol]
const CASES = [
  ['C4 E4 G4', 'C'], ['E4 G4 C5', 'C/E'], ['G3 C4 E4', 'C/G'], ['C4 Eb4 G4', 'Cm'],
  ['C4 Eb4 Gb4', 'Cdim'], ['C4 E4 G#4', 'Caug'], ['E4 G#4 C5', 'Eaug'], ['C4 F4 G4', 'Csus4'],
  ['C4 D4 G4', 'Csus2'], ['C4 E4 G4 Bb4', 'C7'], ['C4 E4 G4 B4', 'Cmaj7'], ['C4 Eb4 G4 Bb4', 'Cm7'],
  ['C4 Eb4 G4 B4', 'Cm(maj7)'], ['C4 Eb4 Gb4 Bb4', 'Cm7♭5'], ['C4 Eb4 Gb4 A4', 'Cdim7'],
  ['C4 E4 G#4 Bb4', 'C7♯5'], ['C4 E4 G#4 B4', 'Cmaj7♯5'], ['C4 E4 Gb4 Bb4', 'C7♭5'],
  ['C4 F4 G4 Bb4', 'C7sus4'], ['C4 E4 G4 A4', 'C6'], ['C4 Eb4 G4 A4', 'Cm6'], ['C4 E4 G4 A4 D5', 'C6/9'],
  ['C4 Eb4 G4 A4 D5', 'Cm6/9'], ['C4 E4 G4 D5', 'Cadd9'], ['C4 Eb4 G4 D5', 'Cm(add9)'], ['C4 E4 G4 F5', 'Cadd11'],
  ['C4 E4 G4 Bb4 D5', 'C9'], ['C4 E4 G4 B4 D5', 'Cmaj9'], ['C4 Eb4 G4 Bb4 D5', 'Cm9'],
  ['C4 Eb4 G4 Bb4 D5 F5', 'Cm11'], ['C4 E4 G4 Bb4 D5 A5', 'C13'], ['C4 E4 G4 B4 D5 A5', 'Cmaj13'],
  ['C4 Eb4 G4 Bb4 D5 A5', 'Cm13'], ['C4 E4 G4 Bb4 Db5', 'C7♭9'], ['C4 E4 G4 Bb4 D#5', 'C7♯9'],
  ['C4 E4 G4 Bb4 F#5', 'C7♯11'], ['C4 E4 G4 Bb4 Ab5', 'C7♭13'], ['C4 E4 G4 B4 F#5', 'Cmaj7♯11'],
  ['C4 E4 Bb4 D5', 'C9'], ['C4 F4 G4 Bb4 D5', 'C9sus4'], ['A3 C4 E4 G4', 'Am7'], ['G3 A3 C4 E4', 'Am7/G'],
  ['E4 G4 Bb4 C5', 'C7/E'], ['Bb3 C4 E4 G4', 'C7/B♭'], ['B3 D4 F4 A4', 'Bm7♭5'], ['D4 F4 Ab4 B4', 'Ddim7'],
  ['Eb3 Gb3 Bb3 C4', 'E♭m6'], ['D3 C4 E4 G4', 'C/D'], ['C3 Bb3 D4 F4', 'B♭/C'], ['F3 C4 E4 G4', 'C/F'], ['A2 F4 Ab4 C5 Eb5', 'Fm7/A'],
  ['A2 F4 A4 C5', 'F/A'], ['Ab2 F4 Ab4 C5 Eb5', 'A♭6'], ['E3 C4 G4 B4', 'Cmaj7/E'], ['D4 G4 C5 F5', 'Dm11'],
  ['C4 E4 G4 Bb4 D5 F#5 A5', 'C13♯11'], ['C4 E4 G4 Bb4 Db5 A5', 'C13♭9'], ['C4 E4 G#4 Bb4 D#5', 'C7♯5♯9'],
  ['C4 E4 Gb4 Bb4 Db5', 'C7♭5♭9'], ['F#3 A3 C4 E4', 'F♯m7♭5'], ['G#3 B3 D4 F4', 'G♯dim7'], ['G#3 B3 D4', 'G♯dim'],
  ['G#3 B3 D4 F#4', 'G♯m7♭5'], ['Ab3 C4 Eb4', 'A♭'], ['C#4 E4 G#4', 'C♯m'], ['Db4 F4 Ab4', 'D♭'], ['Eb4 G4 Bb4 Db5', 'E♭7'],
  ['F#3 A#3 C#4 E4', 'F♯7'], ['Bb3 Db4 F4', 'B♭m'], ['D#4 F#4 A#4', 'E♭m'], ['G#3 C4 Eb4', 'A♭'],
  ['E3 G3 B3 D4', 'Em7'], ['C4 E4 G4 A4 B4', 'Cmaj13'], ['C4 G4 Bb4', 'C7(no3)'], ['C4 E4 Bb4', 'C7'],
  ['C4 Eb4 Bb4', 'Cm7'], ['C4 E4 B4', 'Cmaj7'], ['C2 C3 E4 G4 C5', 'C'], ['D3 F#3 A3 C4', 'D7'],
  ['F#3 A3 D4', 'D/F♯'], ['A3 D4 F#4', 'D/A'], ['B2 D4 G4', 'G/B'], ['C4 E4 G4 Bb4 D5 F5', 'C11'],
  ['G3 B3 D4 F4 A4 C5 E5', 'G13'], ['A3 C4 E4 G4 D5', 'Am11'], ['E3 G#3 B3 D4 F4', 'E7♭9'],
  ['C4 E4 G4 Ab4', 'Cadd♭13'], ['C4 Eb4 G4 Ab4', 'A♭maj7/C'], ['D4 F#4 A4 C5 E5', 'D9'], ['E4 G4 B4 D5 F#5', 'Em9'],
  ['B3 D4 F#4 A4 C#5', 'Bm9'], ['C4 D4 F4 G4', 'Csus4(add9)'], ['C4 E4 G4 D5 F5', 'C(add9,11)'],
  ['E4 C5', 'E–C'], ['C4 G4', 'C5'], ['G3 C4', 'C5/G'], ['C4', 'C'], ['C4 F#4', 'C–G♭'],
  ['G2 B3 F4', 'G7'], ['E3 Bb3 D4 G4', 'Em7♭5'], ['E3 Bb3 C4 D4 G4', 'C9/E'], ['C3 Bb3 E4 A4 D5', 'C13'], ['F3 A3 E4 G4 C5', 'Fmaj9'],
  ['A2 F3 C4 E4 G4', 'Fmaj9/A'], ['D3 F3 A3 C4 E4', 'Dm9'], ['C3 G3 D4 Eb4', 'Cm(add9)'],
  ['E2 B2 G3 D4', 'Em7'], ['Bb2 F3 D4 Ab4 C5', 'B♭9'], ['A2 E3 G3 C#4 F#4', 'A13'],
];

let fail = 0;
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
for (const [voicing, want] of CASES) {
  const r = E.analyze(notes(voicing));
  const ok = r.text === want;
  if (!ok) {
    fail++;
    console.log(`✗ ${pad(voicing, 26)} want ${pad(want, 12)} got ${pad(r.text, 14)} cost ${r.cost}  alts: ${(r.alternates || []).join(', ')}`);
  }
}

// structural checks
const checks = [];
const check = (name, cond) => { checks.push(name); if (!cond) { fail++; console.log('✗ ' + name); } };
const tooMany = E.analyze(notes('C3 D3 E3 F3 G3 A3 B3 C4 D4 E4 F4'));
check('11 notes are not named', tooMany.kind === 'toomany' && !tooMany.text);
check('10 notes are still named', E.analyze(notes('C3 E3 G3 C4 E4 G4 C5 E5 G5 C6')).text === 'C');
check('empty input', E.analyze([]).kind === 'none');
check('cluster flagged low-confidence', E.analyze(notes('C4 Db4 D4 Eb4')).confidence === 'low');
const cm = E.analyze(notes('C4 Eb4 G4'));
check('C minor spelled C E♭ G', cm.notes.map((n) => n.name).join(' ') === 'C E♭ G');
check('C minor sharps override → C D♯ G', E.analyze(notes('C4 Eb4 G4'), { spelling: 'sharp' }).notes.map((n) => n.name).join(' ') === 'C D♯ G');
check('Cdim7 spelled with B𝄫', E.analyze(notes('C4 Eb4 Gb4 A4')).notes.map((n) => n.name).join(' ') === 'C E♭ G♭ B𝄫');
check('C7♯9 spells D♯ not E♭', E.analyze(notes('C4 E4 G4 Bb4 D#5')).notes.map((n) => n.name).join(' ') === 'C E G B♭ D♯');
check('B♯3 octave math', (() => { const r = E.analyze(notes('G#3 C4 D#4'), {}); return r.notes.length === 3; })());
check('first inversion text', E.analyze(notes('E4 G4 C5')).inversion === '1st inversion');
check('foreign bass text', E.analyze(notes('A2 F4 Ab4 C5 Eb5')).inversion === 'over A');
check('degrees for m7♭5', E.analyze(notes('C4 Eb4 Gb4 Bb4')).tones.map((t) => t.label).join(' ') === '1 ♭3 ♭5 ♭7');
check('alternate offered for C/D voicing', E.analyze(notes('D3 C4 E4 G4')).alternates.includes('D9sus4'));
check('middle C single note', /middle C/.test(E.analyze([60]).long));

// SHOW-mode builder
const show = (spec) => E.build(spec, {});
const cmin = show({ root: 'C', type: 'm', mods: [], inversion: 0 });
check('SHOW C minor → C4 E♭4 G4', cmin.notes.map((n) => n.name + n.octave).join(' ') === 'C4 E♭4 G4' && cmin.text === 'Cm');
check('SHOW C minor midi 60 63 67', cmin.notes.map((n) => n.midi).join(',') === '60,63,67');
const gs = show({ root: 'G♯', type: 'dim', mods: [], inversion: 0 });
check('SHOW G♯dim', gs.text === 'G♯dim' && gs.notes.map((n) => n.name).join(' ') === 'G♯ B D');
const fa = show({ root: 'F', type: 'maj', mods: [], inversion: 0, bass: 9 });
check('SHOW F/A has A below the triad', fa.text === 'F/A' && fa.notes[0].name === 'A' && fa.notes[0].midi < 65);
const fm7a = show({ root: 'F', type: 'm7', mods: [], inversion: 0, bass: 9 });
check('SHOW Fm7 over A natural', fm7a.text === 'Fm7/A' && fm7a.inversion === 'over A');
const inv1 = show({ root: 'C', type: '7', mods: [], inversion: 1 });
check('SHOW C7 1st inversion → C7/E', inv1.text === 'C7/E' && inv1.notes[0].name === 'E');
const inv3 = show({ root: 'C', type: '6', mods: [], inversion: 3 });
check('SHOW C6 3rd inv keeps C6 name, aka Am7', inv3.text === 'C6/A' && inv3.aka === 'Am7');
const mod = show({ root: 'G♯', type: 'dim', mods: ['13'], inversion: 0 });
check('SHOW G♯dim + 13 modifier names something', mod.text.startsWith('G♯') && mod.notes.length === 4);
const alt = show({ root: 'C', type: '7', mods: ['b5', 'b9'], inversion: 0 });
check('SHOW C7 + ♭5 ♭9 → C7♭5♭9', alt.text === 'C7♭5♭9');
check('SHOW inversions list', show({ root: 'C', type: 'maj7', mods: [] }).inversions.length === 4);
const ab = show({ root: 'A♭', type: 'maj7', mods: [], inversion: 0 });
check('SHOW A♭maj7 spelled', ab.notes.map((n) => n.name).join(' ') === 'A♭ C E♭ G');
let allTypesOk = true;
for (const id of Object.keys(E.TYPE_BY_ID)) {
  for (const root of E.ROOTS) {
    const r = show({ root, type: id, mods: [], inversion: 0 });
    if (!r.text || !r.notes.length || r.notes.some((n) => !n.name)) { allTypesOk = false; console.log('  type/root failed', id, root, r.text); }
  }
}
check('every SHOW type × root builds and names', allTypesOk);
let forcedOk = true;
for (const id of Object.keys(E.TYPE_BY_ID)) {
  const t = E.TYPE_BY_ID[id];
  const r = show({ root: 'C', type: id, mods: [], inversion: 0 });
  const want = 'C' + t.sym;
  if (r.text !== want) { forcedOk = false; console.log(`  SHOW C ${id}: want ${want} got ${r.text}`); }
}
check('SHOW names match the menu symbol for every type (root C)', forcedOk);

// brute-force robustness: every 3–5 note set inside two octaves gets a name and spelled notes
let robust = true, count = 0;
for (let mask = 1; mask < 1 << 13; mask++) {
  const set = [];
  for (let i = 0; i < 13; i++) if (mask & (1 << i)) set.push(55 + i);
  if (set.length < 3 || set.length > 5) continue;
  count++;
  const r = E.analyze(set);
  if (!r.text || r.notes.some((n) => !n.name || Number.isNaN(n.step))) { robust = false; console.log('  robustness', set, r.text); break; }
}
check(`robustness over ${count} voicings`, robust);

const total = CASES.length + checks.length;
console.log(`${total - fail}/${total} chord-engine checks passed (${CASES.length} voicings, ${checks.length} structural)`);

// ───────── score model: live transcription into bars ─────────
let sfail = 0, stotal = 0;
const ok = (name, cond, extra = '') => { stotal++; if (!cond) { sfail++; console.log('✗', name, extra); } };
const L = LET;
const mid = (n) => { const m = /^([A-G])(#|b)?(\d)$/.exec(n); return 12 * (+m[3] + 1) + L[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };

// play(model, bpm, [[beatOn, beatsLong, 'C4 E4'], ...]) with small human timing jitter
function perform(model, events, jitterMs = 0, t0 = 1000) {
  const q = 60000 / model.bpm;
  const evs = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2 * jitterMs; };
  for (const [on, len, notes] of events) for (const n of notes.split(' ')) {
    evs.push({ t: t0 + on * q + rnd(), type: 1, m: mid(n) });
    evs.push({ t: t0 + (on + len) * q - 15 + rnd(), type: 0, m: mid(n) });
  }
  evs.sort((a, b) => a.t - b.t || a.type - b.type);
  for (const e of evs) { model.update(e.t); if (e.type) model.noteOn(e.m, 0.8, e.t); else model.noteOff(e.m, e.t); }
  return evs.length ? evs[evs.length - 1].t : t0;
}
const fresh = (o) => new ScoreModel(E, Object.assign({ bpm: 120, beats: 4, grid: 2 }, o));
const vals = (B, s) => B.staves[s].map((p) => (p.rest ? 'r' : '') + p.value + (p.tieNext ? '~' : '')).join(' ');
const sumOk = (lay) => { for (const B of lay.bars.values()) for (let s = 0; s < 2; s++) { const sum = B.staves[s].reduce((a, p) => a + p.value, 0); if (sum !== lay.tpb) return `bar ${B.index} staff ${s} sums ${sum}`; } return true; };

// decompose table
const D = (s, e, rest, beats = 4) => ScoreModel.decompose(s, e, beats, rest).map((p) => p.v).join(' ');
ok('whole', D(0, 16) === '16');
ok('dotted half + eighth', D(0, 14) === '12 2');
ok('beat-2 half → quarter+quarter', D(4, 12) === '4 4');
ok('syncopated eighth-eighth', D(2, 6) === '2 2');
ok('and-of-1 to beat 3', D(2, 8) === '2 4');
ok('dotted quarter on beat 1', D(0, 6) === '6');
ok('dotted quarter on beat 3', D(8, 14) === '6');
ok('rests: beats 2-3 split', D(4, 12, true) === '4 4');
ok('rests: no dotted rest', D(0, 6, true) === '4 2');
ok('3/4 dotted half', D(0, 12, false, 3) === '12');
ok('16th grid: dotted 8th + 16th', D(0, 3) + '|' + D(3, 4) === '3|1');

// 1) four quarter notes, then idle close
{
  const m = fresh();
  const end = perform(m, [[0, 1, 'C4'], [1, 1, 'D4'], [2, 1, 'E4'], [3, 1, 'F4']], 25);
  m.update(end + 2600);
  const lay = m.layout(end + 2600, 0, 10);
  ok('phrase closed', !m.running && m.endTick === 16, `endTick ${m.endTick}`);
  ok('four quarters', vals(lay.bars.get(0), 0) === '4 4 4 4', vals(lay.bars.get(0), 0));
  ok('bass staff whole-bar rest', lay.bars.get(0).staves[1].length === 1 && lay.bars.get(0).staves[1][0].whole);
  ok('bars sum (1)', sumOk(lay) === true, sumOk(lay));
}
// 2) held chord across the barline → tie
{
  const m = fresh();
  const end = perform(m, [[0, 2, 'C4 E4 G4'], [2, 3, 'D4 F4 A4']]);
  m.stop(end + 50);
  const lay = m.layout(end + 50, 0, 10);
  ok('tie across barline', vals(lay.bars.get(0), 0) === '8 8~' && vals(lay.bars.get(1), 0).startsWith('4'), vals(lay.bars.get(0), 0) + ' | ' + vals(lay.bars.get(1), 0));
  ok('tie linked across bars', !!lay.bars.get(0).staves[0][1].next && lay.bars.get(1).staves[0][0].prev === lay.bars.get(0).staves[0][1]);
  ok('chord marks C then Dm', lay.marks.map((x) => x.text).join(',') === 'C,Dm', lay.marks.map((x) => x.text).join(','));
  ok('bars sum (2)', sumOk(lay) === true, sumOk(lay));
}
// 3) eighth-note melody with left-hand half notes, human jitter
{
  const m = fresh({ bpm: 96 });
  const ev = [];
  const mel = 'E4 D4 C4 D4 E4 E4 E4 G4'.split(' ');
  mel.forEach((n, i) => ev.push([i * 0.5, 0.45, n]));
  ev.push([0, 2, 'C3'], [2, 2, 'G2']);
  const end = perform(m, ev, 30);
  m.stop(end + 30);
  const lay = m.layout(end + 30, 0, 4);
  ok('eighth melody', vals(lay.bars.get(0), 0) === '2 2 2 2 2 2 2 2', vals(lay.bars.get(0), 0));
  ok('left hand halves', vals(lay.bars.get(0), 1) === '8 8', vals(lay.bars.get(0), 1));
  ok('bars sum (3)', sumOk(lay) === true, sumOk(lay));
}
// 4) rests between notes, partial bar while running
{
  const m = fresh();
  const t0 = 1000;
  m.noteOn(60, 0.8, t0); m.noteOff(60, t0 + 480);           // beat 1 quarter
  m.noteOn(67, 0.8, t0 + 1500); m.noteOff(67, t0 + 1980);   // beat 4 quarter
  const lay = m.layout(t0 + 2050, 0, 3);
  ok('quarter, rest, rest, quarter', vals(lay.bars.get(0), 0) === '4 r4 r4 4', vals(lay.bars.get(0), 0));
  m.noteOn(64, 0.8, t0 + 2000);
  const lay2 = m.layout(t0 + 2600, 0, 3);
  ok('held note grows (provisional)', lay2.bars.get(1).staves[0][0].value === 4 && lay2.bars.get(1).staves[0][0].open, vals(lay2.bars.get(1), 0));
}
// 5) idle gap starts the next phrase on a fresh bar
{
  const m = fresh();
  m.noteOn(60, 0.8, 1000); m.noteOff(60, 1700);              // beat 1, ~1.5 beats
  m.update(1000 + 500 * 6);                                    // 1 bar + silence → closes
  ok('closed after silent bar', !m.running && m.endTick === 16, `${m.running} ${m.endTick}`);
  m.noteOn(62, 0.8, 9000); m.noteOff(62, 9450);
  ok('next phrase on bar 2 downbeat', m.notes[1].on === 16, `on ${m.notes[1].on}`);
  m.stop(9500);
  const lay = m.layout(9500, 0, 5);
  ok('double bar recorded', m.phraseEnds.includes(16) && m.phraseEnds.includes(32), JSON.stringify(m.phraseEnds));
  ok('bars sum (5)', sumOk(lay) === true, sumOk(lay));
}
// 6) 3/4 and 16th grid
{
  const m = fresh({ beats: 3, grid: 1, bpm: 100 });
  const end = perform(m, [[0, 0.75, 'C5'], [0.75, 0.25, 'D5'], [1, 2, 'E5']], 10);
  m.stop(end + 20);
  const lay = m.layout(end + 20, 0, 2);
  ok('3/4 dotted-8th 16th half', vals(lay.bars.get(0), 0) === '3 1 8', vals(lay.bars.get(0), 0));
  ok('bars sum (6)', sumOk(lay) === true, sumOk(lay));
}
// 7) spelling follows the harmony
{
  const m = fresh();
  perform(m, [[0, 2, 'C4 Eb4 G4']]);
  m.stop(3000);
  m.layout(3000, 0, 2);
  ok('C minor spelled E♭', m.notes.map((n) => n.sp && n.sp.name).join(' ') === 'C E♭ G', m.notes.map((n) => n.sp && n.sp.name).join(' '));
}
// 7b) chord symbols: struck chords only, not melody over a held chord
{
  const m = fresh();
  perform(m, [[0, 4, 'C3 E3 G3'], [0, 1, 'E4'], [1, 1, 'F4'], [2, 1, 'G4'], [3, 1, 'A4'], [4, 2, 'G2 B2'], [4, 1, 'D4'], [6, 2, 'Bb3 D4 F4']]);
  m.stop(6000);
  const lay = m.layout(6000, 0, 4);
  ok('marks: C, G (from LH dyad), B♭', lay.marks.map((x) => x.text).join(',') === 'C,G,B♭', lay.marks.map((x) => x.text).join(','));
  const bb = m.notes.filter((n) => [58, 62, 65].includes(n.midi) && n.on === 24);
  ok('RH chord B♭3 D4 F4 stays in treble', bb.length === 3 && bb.every((n) => n.staff === 0), bb.map((n) => n.midi + ':' + n.staff).join(' '));
  const lhc = m.notes.filter((n) => n.on === 0 && n.midi < 60);
  ok('LH chord stays in bass', lhc.every((n) => n.staff === 1));
}
// 7c) a left-hand chord crossing middle C stays together in the bass
{
  const m = fresh();
  perform(m, [[0, 2, 'F3 A3 C4'], [0, 2, 'A4']]);
  m.stop(3000); m.layout(3000, 0, 2);
  ok('F3 A3 C4 → bass, A4 → treble', m.notes.map((n) => n.midi + ':' + n.staff).join(' ') === '53:1 57:1 60:1 69:0', m.notes.map((n) => n.midi + ':' + n.staff).join(' '));
}
// 8) random stress: any stream of notes yields complete bars
{
  let seed = 3;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  for (let trial = 0; trial < 60; trial++) {
    const m = fresh({ bpm: 60 + Math.floor(rnd() * 120), beats: [2, 3, 4][trial % 3], grid: trial % 2 ? 1 : 2 });
    let t = 1000;
    const down = new Map();
    for (let i = 0; i < 80; i++) {
      t += rnd() * 700;
      m.update(t);
      if (down.size && rnd() < 0.5) { const k = [...down.keys()][Math.floor(rnd() * down.size)]; m.noteOff(k, t); down.delete(k); }
      else { const k = 36 + Math.floor(rnd() * 48); m.noteOn(k, 0.7, t); down.set(k, 1); }
    }
    m.stop(t + 100);
    const lay = m.layout(t + 100, 0, 10000);
    const r = sumOk(lay);
    if (r !== true) { ok('stress trial ' + trial, false, r); break; }
    const bad = [...lay.bars.values()].some((B) => B.staves.some((st) => st.some((p) => ![1, 2, 3, 4, 6, 8, 12, 16].includes(p.value) && !p.whole)));
    if (bad) { ok('stress values ' + trial, false); break; }
  }
  ok('stress: 60 random performances produce complete, valid bars', true);
}
console.log(`${stotal - sfail}/${stotal} score-model checks passed (rhythm, ties, rests, phrases, hand split, chord symbols, 60 random performances)`);

// ───────── file formats: MIDI and MusicXML, out and back in ─────────
const MF = ctx.CSMidiFile, MX = ctx.CSMusicXML;
let ftotal = 0, ffail = 0;
const fok = (name, cond, extra = '') => { ftotal++; if (!cond) { ffail++; console.log('✗', name, extra); } };
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
// a recorded performance, the way the app's score model holds it (120 BPM: 16th = 125 ms)
function session(opts) {
  const m = new ScoreModel(E, Object.assign({ bpm: 120, beats: 4, grid: 2 }, opts || {}));
  const ev = [];
  const add = (q, len, ns) => { for (const n of ns.split(' ')) { ev.push([q * 500 + 20, midi(n), 1]); ev.push([(q + len) * 500 - 10, midi(n), 0]); } };
  add(0, 2, 'C4 E4 G4'); add(0, 4, 'C3'); add(2, 1, 'D4 F4 A4'); add(3, 1, 'Eb4 G4 Bb4');
  add(4, 0.5, 'C5'); add(4.5, 0.5, 'D5'); add(5, 1.5, 'E5'); add(6.5, 0.5, 'C#5'); add(7, 3, 'D5'); add(4, 4, 'G2 D3');
  ev.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  m.pedal(true, 0);
  for (const [t, n, on] of ev) { m.update(t); if (on) m.noteOn(n, 0.8, t); else m.noteOff(n, t); if (t > 3900 && t < 4100 && !on) m.pedal(false, 3950); }
  m.stop(10 * 500 + 400);
  return m;
}
function notation(m) {
  const total = m.barsWritten(1e9), lay = m.layout(1e9, 0, total - 1), bars = [];
  for (let k = 0; k < total; k++) {
    const B = lay.bars.get(k);
    bars.push({ staves: B.staves.map((list) => list.map((it) => ({ rest: it.rest, start: it.start, value: it.value, whole: !!it.whole, tiePrev: !!it.tiePrev, tieNext: !!it.tieNext, notes: it.rest ? null : it.notes.map((n) => ({ l: n.sp.l, a: n.sp.a, octave: n.sp.octave })) }))), endStyle: lay.phraseEnds.includes((k + 1) * lay.tpb) ? 'double' : null });
  }
  return { title: 'Test session', date: '2026-01-01', bpm: m.bpm, beats: m.beats, tpb: lay.tpb, bars, marks: lay.marks };
}
// 1) MIDI: write → read gives the same notes, velocities, pedal, tempo and metre
{
  const song = { name: 'Round trip', bpm: 96, beats: 3, unit: 4, notes: [{ m: 60, vel: 0.8, on: 0, off: 1 }, { m: 64, vel: 0.5, on: 1, off: 2.5 }, { m: 67, vel: 1, on: 1, off: 2 }, { m: 60, vel: 0.7, on: 3, off: 6 }], pedals: [{ q: 0.5, down: true }, { q: 2.75, down: false }] };
  const tr = MF.parse(MF.write(song).buffer, 'x.mid');
  const q = 60 / 96;
  fok('MIDI round trip: name, tempo, metre', tr.name === 'Round trip' && tr.bpm === 96 && tr.beats === 3 && tr.unit === 4, JSON.stringify([tr.name, tr.bpm, tr.beats, tr.unit]));
  fok('MIDI round trip: notes', JSON.stringify(tr.notes.map((n) => [n.m, +(n.t / q).toFixed(3), +(n.d / q).toFixed(3)])) === JSON.stringify([[60, 0, 1], [64, 1, 1.5], [67, 1, 1], [60, 3, 3]]), JSON.stringify(tr.notes));
  fok('MIDI round trip: velocities', tr.notes.map((n) => Math.round(n.vel * 127)).join(' ') === '102 64 127 89', tr.notes.map((n) => Math.round(n.vel * 127)).join(' '));
  fok('MIDI round trip: pedal', JSON.stringify(tr.pedals.map((p) => [+(p.t / q).toFixed(3), p.down])) === '[[0.5,true],[2.75,false]]', JSON.stringify(tr.pedals));
}
// 2) MIDI reading: format 0, running status, note-on velocity 0 as note-off, drums skipped, a tempo change
{
  const vlq = (v) => { const o = [v & 127]; while ((v >>= 7)) o.unshift((v & 127) | 128); return o; };
  const ev = [].concat(
    vlq(0), [0xff, 0x51, 3, 0x07, 0xa1, 0x20], // 120 BPM
    vlq(0), [0x90, 60, 100], vlq(0), [64, 90], // running status: a second note-on
    vlq(0), [0x99, 36, 100], // drum (channel 10): ignored
    vlq(480), [0x90, 60, 0], vlq(0), [64, 0], // velocity 0 = note-off, running status
    vlq(0), [0x89, 36, 0],
    vlq(0), [0xff, 0x51, 3, 0x0f, 0x42, 0x40], // 60 BPM from beat 2
    vlq(0), [0x90, 67, 80], vlq(480), [0x80, 67, 0],
    vlq(0), [0xff, 0x2f, 0]);
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const bytes = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b].concat(be32(ev.length), ev));
  const tr = MF.parse(bytes.buffer, 'f0.mid');
  fok('MIDI format 0 + running status + drums skipped', tr.notes.map((n) => n.m).join(' ') === '60 64 67', tr.notes.map((n) => n.m).join(' '));
  fok('MIDI tempo change: 1 beat at 120 + 1 beat at 60', near(tr.notes[0].d, 0.5) && near(tr.notes[2].t, 0.5) && near(tr.notes[2].d, 1), JSON.stringify(tr.notes));
}
// 3) MusicXML export → import gives back exactly what was transcribed
{
  const m = session();
  const xml = MX.write(notation(m));
  const tr = MX.parse(xml, 'rt.musicxml');
  const want = m.notes.map((n) => [n.midi, n.on / 4, (n.off - n.on) / 4]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const got = tr.notes.map((n) => [n.m, +(n.t * 2).toFixed(4), +(n.d * 2).toFixed(4)]);
  fok('MusicXML round trip: every note, onset and duration (ties joined)', JSON.stringify(want) === JSON.stringify(got), '\n want ' + JSON.stringify(want) + '\n got  ' + JSON.stringify(got));
  fok('MusicXML round trip: title, tempo, metre', tr.name === 'Test session' && tr.bpm === 120 && tr.beats === 4, JSON.stringify([tr.name, tr.bpm, tr.beats]));
  const doc = MX.parseXML(xml);
  const all = (el, name, out = []) => { for (const c of el.children) { if (c.name === name) out.push(c); all(c, name, out); } return out; };
  const measures = all(doc, 'measure');
  const durOk = measures.every((meas) => {
    let pos = 0, max = 0, last = 0;
    for (const c of meas.children) {
      const d = +((c.children.find((x) => x.name === 'duration') || {}).text || 0);
      if (c.name === 'backup') pos -= d;
      else if (c.name === 'note') { if (c.children.some((x) => x.name === 'chord')) continue; pos += d; }
      max = Math.max(max, pos); last = pos;
    }
    return max === 16 && last === 16;
  });
  fok('MusicXML: every measure is exactly one 4/4 bar in both staves', durOk);
  const harm = all(doc, 'harmony').map((h) => all(h, 'root-step')[0].text + all(h, 'kind')[0].attrs.text + (all(h, 'bass-step')[0] ? '/' + all(h, 'bass-step')[0].text : '') + '=' + all(h, 'kind')[0].text);
  fok('MusicXML: chord symbols as <harmony>', harm.join(' ') === 'C=major Dm7/C=minor-seventh Cm7=minor-seventh G5=power', harm.join(' '));
  fok('MusicXML: accidentals written where needed', (xml.match(/<accidental>/g) || []).length === 3, (xml.match(/<accidental>[a-z-]+/g) || []).join(' '));
}
// 4) MusicXML reading: divisions, chords, a second staff via <backup>, ties over the bar line,
//    dotted values, a grace note (skipped), alterations, a tempo change and two parts merged
{
  const xml = `<?xml version="1.0"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><movement-title>Little &amp; tune</movement-title>
<part-list><score-part id="P1"><part-name>RH</part-name></score-part><score-part id="P2"><part-name>Bass</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type><sound tempo="120"/></direction>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice><type>quarter</type><dot/><staff>1</staff></note>
<note><grace/><pitch><step>E</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="start"/></notations></note>
<backup><duration>6</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
<note><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
</measure><measure number="2"><sound tempo="60"/>
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff></note>
<note><rest/><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
</measure></part>
<part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>B</step><alter>-1</alter><octave>1</octave></pitch><duration>3</duration><type>half</type><dot/></note></measure>
<measure number="2"><note><rest/><duration>3</duration></note></measure></part></score-partwise>`;
  const tr = MX.parse(xml, 'x.musicxml');
  const rows = tr.notes.map((n) => [n.m, +n.t.toFixed(3), +n.d.toFixed(3)]);
  // 120 BPM for bar 1 (3 beats = 1.5 s), then 60 BPM
  const want = [[34, 0, 1.5], [48, 0, 1.5], [55, 0, 1.5], [72, 0, 0.75], [74, 0.75, 0.25], [78, 1, 1.5]];
  fok('MusicXML import: chords, staves, ties, dots, grace notes, tempo change, parts merged', JSON.stringify(rows) === JSON.stringify(want), JSON.stringify(rows));
  fok('MusicXML import: title (with an entity), metre', tr.name === 'Little & tune' && tr.beats === 3 && tr.bpm === 120, JSON.stringify([tr.name, tr.beats, tr.bpm]));
  // the same score as a compressed .mxl (zip with META-INF/container.xml)
  const zlib = await import('node:zlib');
  const files = [['META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/x.musicxml"/></rootfiles></container>'], ['score/x.musicxml', xml]];
  const parts = [], central = [];
  let off = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text), comp = zlib.deflateRawSync(data), nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, comp); central.push(ch, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const zip = Buffer.concat(parts.concat([cd, end]));
  const text = await MX.readFile(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length), 'x.mxl');
  fok('MusicXML import: compressed .mxl', JSON.stringify(MX.parse(text, 'x.mxl').notes.map((n) => n.m)) === JSON.stringify(want.map((w) => w[0])));
}
// 5) chord symbols → MusicXML kinds and degrees
{
  const kind = (v) => { const r = E.analyze(notes(v), { spelling: 'auto' }); const k = MX.chordKind(r.tones.map((t) => t.label)); return r.text + ' ' + k.kind + (k.degrees.length ? ' ' + k.degrees.map((d) => d[2] + d[0] + (d[1] > 0 ? '+' : d[1] < 0 ? '-' : '')).join(',') : ''); };
  const table = [
    ['C4 E4 G4 Bb4 D5', 'C9 dominant-ninth'], ['C3 E4 G4 Bb4 D#5 A5', 'C13♯9 dominant-13th alter9+'], ['C4 Eb4 Gb4 Bb4', 'Cm7♭5 half-diminished'],
    ['C4 Eb4 Gb4 Bbb4', 'Cdim7 diminished-seventh'], ['C4 F4 G4 Bb4', 'C7sus4 dominant subtract3,add4'], ['C4 E4 G4 A4 D5', 'C6/9 major-sixth add9'],
    ['C4 E4 G#4 B4', 'Cmaj7♯5 major-seventh alter5+'], ['C4 Eb4 G4 B4', 'Cm(maj7) major-minor'], ['C4 D4 G4', 'Csus2 suspended-second'], ['C4 E4 G4 Bb4 F#5', 'C7♯11 dominant add11+'],
  ];
  const bad = table.filter(([v, w]) => kind(v) !== w);
  fok('chord symbols map to MusicXML kinds', !bad.length, bad.map(([v, w]) => kind(v) + ' (want ' + w + ')').join('; '));
}
// 6) sessions: raw timing is kept for "as played" MIDI; a session opened before its first note starts with rests
{
  const m = session();
  const e5 = m.notes.find((n) => n.midi === 76);
  // the phrase clock starts on the first note (20 ms in), so E5 played at 2520 ms sits exactly on tick 20
  fok('raw timing kept next to the quantised note', e5.on === 20 && near(e5.raw, 20) && near(e5.off, 26) && near(e5.rawOff, 26 - 30 / 125), JSON.stringify([e5.on, e5.raw, e5.off, e5.rawOff]));
  fok('sustain pedal logged', JSON.stringify(m.pedals.map((p) => [Math.round(p.t), p.down])) === '[[0,true],[31,false]]', JSON.stringify(m.pedals));
  const s = new ScoreModel(E, { bpm: 120, beats: 4, grid: 2, idleStop: false });
  s.startAt(0);
  s.noteOn(60, 0.8, 2000 + 5); s.noteOff(60, 2490); // first note on beat 1 of bar 2
  s.stop(3000);
  const lay = s.layout(3000, 0, 5);
  fok('count-in session: bar 1 is a whole rest, the note lands in bar 2', lay.totalBars === 2 && lay.bars.get(0).staves[0][0].whole && lay.bars.get(1).staves[0][0].start === 16, JSON.stringify([lay.totalBars, lay.bars.get(1).staves[0].map((p) => p.start + (p.rest ? 'r' : 'n'))]));
  const synced = new ScoreModel(E, { bpm: 120, beats: 4, grid: 2 });
  synced.syncAnchor = (ms) => Math.floor((ms + 62) / 2000) * 2000; // a metronome with bars every 2 s
  synced.noteOn(64, 0.8, 4000 + 1000 - 20); // early by 20 ms on beat 3 of the metronome's 3rd bar
  fok('metronome sync: a phrase starts on the metronome bar line', synced.anchorMs === 4000 && synced.notes[0].on === 8, JSON.stringify([synced.anchorMs, synced.notes[0].on]));
}
// 7) edge cases: pedal tapped within one tick, cue notes, namespaced tags, a power chord over another bass
{
  const tr = MF.parse(MF.write({ name: 'p', bpm: 120, beats: 4, unit: 4, notes: [{ m: 60, vel: 0.7, on: 0, off: 4 }], pedals: [{ q: 0, down: true }, { q: 0, down: false }, { q: 1, down: true }, { q: 2, down: false }] }).buffer, 'p.mid');
  fok('MIDI: a pedal pressed and released in one tick stays press → release', JSON.stringify(tr.pedals.map((p) => p.down)) === '[true,false,true,false]', JSON.stringify(tr.pedals));
  const cue = MX.parse('<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>' +
    '<note><cue/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note></measure></part></score-partwise>', 'c');
  fok('MusicXML: cue notes take time but are not played', cue.notes.length === 1 && near(cue.notes[0].t, 1), JSON.stringify(cue.notes));
  const ns = MX.parse('<mx:score-partwise xmlns:mx="x"><mx:part id="P1"><mx:measure><mx:note><mx:pitch><mx:step>G</mx:step><mx:octave>4</mx:octave></mx:pitch><mx:duration>1</mx:duration></mx:note></mx:measure></mx:part></mx:score-partwise>', 'n');
  fok('MusicXML: namespace-prefixed tags', ns.notes.length === 1 && ns.notes[0].m === 67, JSON.stringify(ns.notes));
  const r = E.analyze(notes('G2 C3'), { spelling: 'auto' });
  const h = MX.write({ title: 't', bpm: 100, beats: 4, tpb: 16, bars: [{ staves: [[{ rest: true, start: 0, value: 16, whole: true }], [{ rest: false, start: 0, value: 16, notes: [{ l: 4, a: 0, octave: 2 }, { l: 0, a: 0, octave: 3 }] }]] }], marks: [{ t: 0, text: r.text, chord: r }] });
  fok('MusicXML: a two-note "C5/G" is a C power chord over G', /<root-step>C<\/root-step>.*>power<\/kind><bass><bass-step>G/.test(h), r.text + ' ' + (h.match(/<harmony[\s\S]*?<\/harmony>/) || [''])[0]);
}
// 8) a tempo change mid-phrase keeps bar lines; the pedal is let go when you stop, and survives REC
{
  const m = new ScoreModel(E, { bpm: 120, beats: 4, grid: 2 });
  m.noteOn(60, 0.8, 0); m.noteOff(60, 1900);
  m.setTempo(100, 3700); // between the bars, on a fractional tick
  m.stop(4500);
  fok('tempo change: the phrase still ends on a bar line', m.endTick === 16, String(m.endTick));
  m.noteOn(62, 0.8, 9000);
  fok('tempo change: the next phrase starts on beat 1 of a fresh bar', m.notes[1].on === 16, String(m.notes[1].on));
  const p = new ScoreModel(E, { bpm: 120, beats: 4, grid: 2 });
  p.pedal(true, 0);
  p.reset(); // ● REC while your foot is on the pedal
  p.noteOn(60, 0.8, 0); p.noteOff(60, 500);
  p.stop(3000); // the pedal is still down when you press ■
  fok('pedal held through REC is recorded, and let go when you stop (not at the last note)', JSON.stringify(p.pedals.map((x) => [Math.round(x.t), x.down])) === '[[0,true],[16,false]]', JSON.stringify(p.pedals));
}
// 9) the player piano: MIDI THRU never sends a note-off before a note-on it already queued
{
  let now = 1000;
  const timers = [];
  const vctx = Object.assign({}, ctx, {
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, at: now + ms, fn, every: 0 }); return id; },
    setInterval: (fn, ms) => { const id = timers.length + 1; timers.push({ id, at: now + ms, fn, every: ms }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.dead = true; },
    clearInterval: (id) => { const t = timers.find((x) => x.id === id); if (t) t.dead = true; },
  });
  vm.createContext(vctx);
  vm.runInContext(playerSrc, vctx);
  const advance = (ms) => { const end = now + ms; for (;;) { const t = timers.filter((x) => !x.dead && x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!t) break; now = t.at; if (t.every) t.at += t.every; else t.dead = true; t.fn(); } now = end; };
  const sent = [];
  const pl = vctx.CSPlayer.create({ now: () => now, noteOn: () => ({}), release: () => {}, thru: (b, at) => sent.push([b[0], b[1], at]), key: () => {}, pedal: () => {}, state: () => {} });
  pl.load({ notes: [{ m: 60, vel: 0.8, t: 0.5, d: 1 }], pedals: [{ t: 0.2, down: true }], duration: 2, tempos: [{ t: 0, q: 0, bpm: 120 }] });
  pl.play();
  advance(500); // the note-on (due at ~1590) is already queued with its timestamp
  pl.pause();
  const on = sent.find((x) => x[0] === 0x90), off = sent.find((x) => x[0] === 0x80);
  fok('player: pausing sends the note-off after a note-on already queued', on && off && off[2] > on[2], JSON.stringify(sent));
  sent.length = 0;
  pl.play();
  fok('player: resuming inside a pedalled passage sends the pedal again', sent.some((x) => x[0] === 0xb0 && x[1] === 64), JSON.stringify(sent));
  pl.stop();
}
console.log(`${ftotal - ffail}/${ftotal} file-format checks passed (MIDI and MusicXML out and back in, .mxl, chord symbols, sessions, player)`);
process.exit(fail || sfail || ffail ? 1 : 0);
