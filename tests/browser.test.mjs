// CHORD//SCOPE — browser tests. Drives the built index.html in headless Chromium with a fake
// MIDI keyboard: LIVE naming, MIDI THRU, channel filter, computer keys, mouse + latch, SHOW mode,
// the sampled piano, settings, SCORE transcription, the metronome, recorded sessions and their
// MusicXML / MIDI / PDF export, and importing files into the player piano (ROLL).
//
//   npm i --no-save playwright && npx playwright install chromium
//   npm run test:browser                  flat keyboard (headless Chromium has no GPU)
//   npm run test:browser -- --3d          force the three.js keyboard (slow on a software GPU)
//   npm run test:browser -- --shots       also save screenshots to tests/shots/
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force3D = process.argv.includes('--3d');
const shots = process.argv.includes('--shots') ? path.join(root, 'tests', 'shots') : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const url = 'file://' + path.join(root, 'index.html') + (force3D ? '?3d' : '');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript(() => {
  class Port {
    constructor(id, name, type) { Object.assign(this, { id, name, type, state: 'connected', connection: 'closed', onmidimessage: null, manufacturer: 'test' }); }
    open() { this.connection = 'open'; return Promise.resolve(this); }
    close() { this.connection = 'closed'; return Promise.resolve(this); }
    send(d) { (window.__sent = window.__sent || []).push([this.name, ...Array.from(d)]); }
  }
  const ins = new Map([['in1', new Port('in1', 'Test Keyboard', 'input')], ['in2', new Port('in2', 'loopMIDI Port', 'input')]]);
  const outs = new Map([['out1', new Port('out1', 'loopMIDI Port', 'output')]]);
  const access = { inputs: ins, outputs: outs, onstatechange: null, sysexEnabled: false };
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: () => Promise.resolve(access) });
  window.__midi = (bytes, port = 'in1') => { const p = ins.get(port); if (p.onmidimessage) p.onmidimessage({ data: new Uint8Array(bytes), target: p, timeStamp: performance.now() }); };
  window.__saved = []; // exports land here instead of a file dialog
  window.__csSave = async (name, blob) => { window.__saved.push({ name, size: blob.size, type: blob.type }); return name; };
  try { localStorage.clear(); } catch (e) { /* no storage */ }
});
await page.goto(url);
await page.waitForFunction(() => window.__chordscope && /MIDI:/.test(document.getElementById('status').textContent));

// ── helpers ──
const LET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (n) => { const m = /^([A-G])(#{0,2}|b{0,2})(-?\d)$/.exec(n); return 12 * (+m[3] + 1) + LET[m[1]] + (m[2].startsWith('#') ? m[2].length : -m[2].length); };
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const play = async (s, vel = 96) => { for (const n of s.split(' ')) await page.evaluate(([m, v]) => window.__midi([0x90, m, v]), [midi(n), vel]); await page.waitForTimeout(60); await settle(); };
const release = async (s) => { for (const n of s.split(' ')) await page.evaluate((m) => window.__midi([0x80, m, 0]), midi(n)); await page.waitForTimeout(200); await settle(); };
const sym = () => page.evaluate(() => document.getElementById('sym').dataset.text);
const keys = (pred) => page.evaluate((src) => window.__chordscope.kbd.state().filter(new Function('k', 'return ' + src)).map((k) => k.m).sort((a, b) => a - b).join(' '), pred);
const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
let pass = 0, fail = 0;
const expect = (name, got, want) => {
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${JSON.stringify(got)}${ok ? '' : '   (expected ' + JSON.stringify(want) + ')'}`);
};

// ── LIVE ──
expect('MIDI device found', await page.evaluate(() => window.__chordscope.midiState.level), 'ok');
expect('keyboard renderer', await page.evaluate(() => (window.__chordscope.kbd.is3D ? '3d' : 'flat')), force3D ? '3d' : await page.evaluate(() => (window.__chordscope.gpu.webgl && !window.__chordscope.gpu.software ? '3d' : 'flat')));
await play('C4 Eb4 G4');
expect('C minor', await sym(), 'Cm');
expect('chord tones', await page.evaluate(() => [...document.querySelectorAll('#tones .t')].map((b) => b.dataset.name).join(' ')), 'C E♭ G');
expect('keys light up', await keys('k.held'), '60 63 67');
await shot('live-cminor');
await release('C4 Eb4 G4');
expect('last chord stays, dimmed', await page.evaluate(() => document.getElementById('sym').className + ' ' + document.getElementById('sym').dataset.text), 'sym ghost Cm');
for (const [notes, want] of [['A2 F4 Ab4 C5 Eb5', 'Fm7/A'], ['C3 E4 G4 Bb4 D#5 A5', 'C13♯9'], ['G#3 B3 D4 F#4', 'G♯m7♭5'], ['D3 C4 E4 G4', 'C/D']]) {
  await play(notes);
  expect(notes, await sym(), want);
  await release(notes);
}
await play('C2 C3 D3 E3 F3 G3 A3 B3 C4 D4 E4');
expect('more than 10 notes are counted, not named', await sym(), '11');
await release('C2 C3 D3 E3 F3 G3 A3 B3 C4 D4 E4');
await play('C1 G1 C7 E7 G7');
expect('extreme registers: 15ma + 8vb', await page.evaluate(() => [...document.querySelectorAll('#staff .ott')].map((t) => t.textContent).join(' ')), '15ma 8vb');
await release('C1 G1 C7 E7 G7');
await page.evaluate(() => window.__midi([0xb0, 64, 127]));
await settle();
expect('sustain pedal tag', await page.evaluate(() => document.getElementById('tagPedal').className), 'tag lit');
await page.evaluate(() => window.__midi([0xb0, 64, 0]));

// ── MIDI THRU, loop protection, channel filter ──
await page.selectOption('#thruSel', 'loopMIDI Port');
await page.evaluate(() => { window.__sent = []; });
await play('C4');
await release('C4');
expect('THRU forwards note on/off', JSON.stringify(await page.evaluate(() => window.__sent)), JSON.stringify([['loopMIDI Port', 0x90, 60, 96], ['loopMIDI Port', 0x80, 60, 0]]));
await page.evaluate(() => { window.__sent = []; window.__midi([0x90, 64, 100], 'in2'); });
expect('the THRU port is not listened to (no feedback loop)', await page.evaluate(() => window.__sent.length), 0);
await page.selectOption('#thruSel', '');
await page.selectOption('#chSel', { value: '1' });
await page.evaluate(() => window.__midi([0x90, 60, 100]));
await settle();
expect('channel 2 filter ignores channel 1', await page.evaluate(() => window.__chordscope.heldSet().has(60)), false);
await page.selectOption('#chSel', { value: 'omni' });

// ── computer keyboard and mouse ──
await page.keyboard.down('z'); await page.keyboard.down('c'); await page.keyboard.down('b');
await settle();
expect('computer keys Z C B', await sym(), 'C');
await page.keyboard.up('z'); await page.keyboard.up('c'); await page.keyboard.up('b');
await page.click('#latchBtn');
for (const m of [62, 65, 69, 72]) {
  const c = await page.evaluate((m) => window.__chordscope.kbd.keyCenter(m), m);
  await page.mouse.click(c.x, c.y);
}
await settle();
expect('mouse + latch D F A C', await sym(), 'Dm7');
await page.click('#clearBtn');
await page.click('#latchBtn');

// ── SHOW ──
await page.click('#modeSeg button[data-mode="show"]');
await page.selectOption('#rootSel', 'C');
await page.selectOption('#typeSel', 'm');
await settle();
expect('SHOW C minor', await sym(), 'Cm');
expect('SHOW lights C4 E♭4 G4', await keys('k.tgt'), '60 63 67');
await shot('show-cminor');
await page.selectOption('#typeSel', 'm7');
await page.selectOption('#rootSel', 'F');
await page.selectOption('#bassSel', '9');
await settle();
expect('SHOW Fm7 over A', await sym(), 'Fm7/A');
await play('A2 F4 Ab4 C5 Eb5');
expect('playing it matches', await page.evaluate(() => document.getElementById('match').textContent), '✓ MATCH');
await release('A2 F4 Ab4 C5 Eb5');
await page.selectOption('#bassSel', '');
await page.selectOption('#typeSel', '7');
await page.selectOption('#rootSel', 'C');
await page.selectOption('#invSel', '1');
await settle();
expect('SHOW C7, 1st inversion', await sym(), 'C7/E');

// ── piano ──
await page.click('#pianoBtn');
expect('piano samples decoded', await page.evaluate(() => window.__chordscope.piano.whenReady().then((ok) => (ok ? window.__chordscope.piano.buffers.size : 0))), 30);
await play('C4 E4 G4', 110);
expect('three piano voices sounding', await page.evaluate(() => window.__chordscope.piano.voices.size), 3);
await release('C4 E4 G4');
await page.click('#pianoBtn');

// ── settings ──
await page.click('#modeSeg button[data-mode="live"]');
await page.click('#setBtn');
await page.click('#spellSeg button[data-v="sharp"]');
await page.keyboard.press('Escape');
await play('C4 Eb4 G4');
expect('sharp spelling', await page.evaluate(() => [...document.querySelectorAll('#tones .t')].map((b) => b.dataset.name).join(' ')), 'C D♯ G');
await release('C4 Eb4 G4');
await page.click('#setBtn');
await page.click('#spellSeg button[data-v="auto"]');
await page.keyboard.press('Escape');

// ── SCORE ──
await page.click('#modeSeg button[data-mode="score"]');
await page.fill('#bpmIn', '120');
await page.press('#bpmIn', 'Enter');
for (const m of [60, 62, 64, 65]) { // four quarter notes in real time at 120 BPM
  await page.evaluate((k) => window.__midi([0x90, k, 90]), m);
  await page.waitForTimeout(430);
  await page.evaluate((k) => window.__midi([0x80, k, 0]), m);
  await page.waitForTimeout(70);
}
expect('real-time quarter notes land on beats 1-4', await page.evaluate(() => window.__chordscope.scoreModel.notes.map((n) => n.on + '-' + n.off).join(' ')), '0-4 4-8 8-12 12-16');
await page.waitForTimeout(2600);
expect('the phrase closes after a silent bar', await page.evaluate(() => window.__chordscope.scoreModel.running), false);
await shot('score-page');
await page.click('#scoreClear');
const q = 500, ev = []; // 16 bars of quarter notes → two pages
for (let i = 0; i < 64; i++) ev.push([i * q + 30, 72 + (i % 5), 1], [i * q + 420, 72 + (i % 5), 0]);
await page.evaluate(([e]) => window.__chordscope.scoreFeed(e, 2600), [ev]);
await page.waitForTimeout(1300);
expect('16 bars fill two pages', await page.evaluate(() => document.getElementById('pgTxt').textContent), '2 / 2');
await page.click('#scoreViewSeg button[data-v="scroll"]');
await page.waitForTimeout(500);
expect('SCROLL view draws the notes', await page.evaluate(() => document.querySelectorAll('#stage use').length > 50), true);
await shot('score-scroll');
await page.click('#scoreViewSeg button[data-v="page"]');

// ── metronome ──
await page.evaluate(() => { // count the clicks it schedules
  const c = window.__chordscope; c.piano.ctx || c.piano.init();
  const ctx = c.piano.ctx, orig = ctx.createOscillator.bind(ctx);
  window.__osc = 0; ctx.createOscillator = () => { window.__osc++; return orig(); };
});
await page.click('#metroBtn');
await page.waitForTimeout(1600);
const clicks = await page.evaluate(() => window.__osc);
expect('metronome clicks at 120 BPM (about 3-4 in 1.6 s)', clicks >= 3 && clicks <= 5, true);
expect('beat lights follow it', await page.evaluate(() => document.querySelectorAll('#beats i.on').length), 1);
await page.click('#clickBtn'); // sound off: lights only
await page.evaluate(() => { window.__osc = 0; });
await page.waitForTimeout(800);
expect('CLICK off: silent, still counting', await page.evaluate(() => window.__osc === 0 && window.__chordscope.metro.running), true);
await page.click('#clickBtn');
for (let i = 0; i < 4; i++) { await page.dispatchEvent('#tapBtn', 'pointerdown'); await page.waitForTimeout(i < 3 ? 600 : 0); }
expect('TAP sets the tempo (taps 0.6 s apart → 100)', Math.abs((await page.evaluate(() => window.__chordscope.S.metro.bpm)) - 100) <= 2, true);
await page.fill('#bpmIn', '120'); await page.press('#bpmIn', 'Enter');

// ── record a session against the metronome, then export it ──
await page.click('#modeSeg button[data-mode="live"]');
await page.click('#recBtn');
expect('REC with the metronome running counts in', await page.evaluate(() => window.__chordscope.session.state), 'countin');
await page.evaluate(() => new Promise((r) => setTimeout(r, Math.max(0, window.__chordscope.session.startMs - performance.now()) + 2)));
for (const m of [60, 62, 64, 65]) { // four quarter notes from bar 1
  await page.evaluate((k) => window.__midi([0x90, k, 90]), m);
  await page.waitForTimeout(430);
  await page.evaluate((k) => window.__midi([0x80, k, 0]), m);
  await page.waitForTimeout(70);
}
await page.waitForTimeout(600); // silence: becomes rests, the session keeps going
await page.click('#haltBtn');
expect('session written on the metronome grid (in LIVE mode)', await page.evaluate(() => window.__chordscope.scoreModel.notes.map((n) => n.on).join(' ')), '0 4 8 12');
expect('the take is ready to play back', await page.evaluate(() => (window.__chordscope.takeTrack ? window.__chordscope.takeTrack.notes.length : 0)), 4);
await page.click('#metroBtn');
await page.click('#exportBtn');
expect('EXPORT menu offers 4 formats', await page.evaluate(() => [...document.querySelectorAll('#exportPop button[data-x]')].filter((b) => !b.disabled).length), 4);
await shot('export-menu');
await page.click('#exportPop button[data-x="musicxml"]');
await page.click('#exportBtn');
await page.click('#exportPop button[data-x="midi"]');
await page.waitForTimeout(150);
expect('saved a .musicxml and a .mid', await page.evaluate(() => window.__saved.map((f) => f.name.replace(/^.*\./, '.')).join(' ')), '.musicxml .mid');
const back = await page.evaluate(() => {
  const c = window.__chordscope;
  const xml = c.exportData('musicxml').data, mid = c.exportData('midi').data;
  const fromXml = window.CSMusicXML.parse(xml, 'x').notes.map((n) => n.m).join(' ');
  const fromMid = window.CSMidiFile.parse(mid.buffer, 'x').notes.map((n) => n.m).join(' ');
  return fromXml + ' | ' + fromMid;
});
expect('the exports read back (MusicXML | MIDI)', back, '60 62 64 65 | 60 62 64 65');
expect('PDF: the print view has the manuscript page', await page.evaluate(() => { const h = window.__chordscope.printHTML(); return (h.match(/<svg class="page"/g) || []).length === 1 && !/class="ink/.test(h); }), true);

// ── import a file and play it on the keys ──
const midBytes = await page.evaluate(() => Array.from(window.CSMidiFile.write({ name: 'Imported', bpm: 120, beats: 4, unit: 4, notes: [{ m: 60, vel: 0.8, on: 0, off: 2 }, { m: 64, vel: 0.8, on: 0, off: 2 }, { m: 67, vel: 0.8, on: 0, off: 2 }, { m: 65, vel: 0.8, on: 2, off: 4 }, { m: 69, vel: 0.8, on: 2, off: 4 }, { m: 72, vel: 0.8, on: 2, off: 4 }], pedals: [] })));
await page.evaluate((bytes) => { // drop the file on the window
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(bytes)], 'Imported.mid', { type: 'audio/midi' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, midBytes);
await page.waitForTimeout(400);
expect('dropping a MIDI file loads it and opens ROLL', await page.evaluate(() => window.__chordscope.S.mode + ' ' + window.__chordscope.player.track.name + ' ' + window.__chordscope.player.track.notes.length), 'roll Imported 6');
await page.click('#playBtn');
await page.waitForFunction(() => window.__chordscope.player.playing && window.__chordscope.player.position() > 0.3, null, { timeout: 8000 });
await settle();
expect('the player piano presses the keys', await keys('k.auto'), '60 64 67');
expect('and names the chord on the roll', await page.evaluate(() => (window.__chordscope.rollChord || {}).sym), 'C');
await page.evaluate(() => window.__midi([0x90, 64, 90])); // play along: your key on the player's note
await settle();
expect('playing along: your matching key turns mint', await keys('k.held && k.auto'), '64');
await page.evaluate(() => window.__midi([0x80, 64, 0]));
await shot('roll-playing');
const inked = await page.evaluate(() => { const c = document.querySelector('#rollStage canvas'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++; return n; });
expect('the paper roll is drawn', inked > 50, true);
await page.click('#haltBtn');
await settle();
expect('■ stops the player and lifts the keys', await page.evaluate(() => !window.__chordscope.player.playing) && (await keys('k.auto')) === '', true);
const mxl = await page.evaluate(async () => { // a compressed .mxl made on the spot
  const xml = new TextEncoder().encode(window.__chordscope.exportData('musicxml').data);
  const deflate = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const files = [['META-INF/container.xml', new TextEncoder().encode('<container><rootfiles><rootfile full-path="s.musicxml"/></rootfiles></container>')], ['s.musicxml', xml]];
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const comp = await deflate(data), nb = new TextEncoder().encode(name);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(20, comp.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), nb, comp); central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + comp.length;
  }
  const cdLen = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, 2, true); end.setUint16(10, 2, true); end.setUint32(12, cdLen, true); end.setUint32(16, off, true);
  const blob = new Blob(parts.concat(central, [new Uint8Array(end.buffer)]));
  const c = window.__chordscope, buf = await blob.arrayBuffer();
  const tr = c.loadBuffer(buf, 'session.mxl', await c.sniff(buf, 'session.mxl'));
  return tr.notes.map((n) => n.m).join(' ');
});
expect('importing a compressed .mxl', mxl, '60 62 64 65');

console.log(errors.length ? '\n' + errors.join('\n') : '\nno page errors');
console.log(`${pass}/${pass + fail} browser checks passed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
