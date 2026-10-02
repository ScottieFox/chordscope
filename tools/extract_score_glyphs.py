# Handwritten glyph outlines for the parchment score view, as SVG path data.
#   music  (Petaluma):        staff-space units, y down (1 em = 4 staff spaces)
#   script (Petaluma Script): em units, y down, baseline at y = 0
import json
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen

def compact(rec):
    # relative commands, 2 decimals, minimal separators
    out, cx, cy, sx, sy = [], 0.0, 0.0, 0.0, 0.0
    def num(v):
        v = round(v, 2)
        s = ('%.2f' % v).rstrip('0').rstrip('.')
        if s in ('-0', ''): s = '0'
        if s.startswith('0.'): s = s[1:]
        elif s.startswith('-0.'): s = '-' + s[2:]
        return s
    def nums(vals):
        r = ''
        for v in vals:
            t = num(v)
            if r and not t.startswith('-') and not (t.startswith('.') and '.' in r.split(' ')[-1].split('-')[-1]):
                r += ' '
            r += t
        return r
    R = lambda v: round(v, 2)
    rec_value = [(op, [(R(x), R(y)) for (x, y) in pts]) for op, pts in rec.value]  # round absolutes first: no drift
    for op, pts in rec_value:
        if op == 'moveTo':
            (x, y), = pts
            out.append('m' + nums([x - cx, y - cy])); cx, cy = x, y; sx, sy = x, y
        elif op == 'lineTo':
            (x, y), = pts
            out.append('l' + nums([x - cx, y - cy])); cx, cy = x, y
        elif op == 'curveTo':
            vals = []
            for (x, y) in pts: vals += [x - cx, y - cy]
            out.append('c' + nums(vals)); cx, cy = pts[-1]
        elif op == 'qCurveTo':
            vals = []
            for (x, y) in pts: vals += [x - cx, y - cy]
            out.append('q' + nums(vals)); cx, cy = pts[-1]
        elif op in ('closePath', 'endPath'):
            out.append('z'); cx, cy = sx, sy
    return ''.join(out)

def ntos(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

def extract(font_path, items, unit):
    f = TTFont(font_path)
    cmap, gs = f.getBestCmap(), f.getGlyphSet()
    out = {}
    for key, cp in items:
        if cp not in cmap:
            continue
        g = gs[cmap[cp]]
        rec = RecordingPen()
        g.draw(TransformPen(rec, (1 / unit, 0, 0, -1 / unit, 0, 0)))
        out[key] = {'d': compact(rec), 'adv': round(g.width / unit, 3)}
    return out

music_items = [
    ('gClef', 0xE050), ('fClef', 0xE062), ('brace', 0xE000),
    ('noteheadWhole', 0xE0A2), ('noteheadHalf', 0xE0A3), ('noteheadBlack', 0xE0A4),
    ('flag8thUp', 0xE240), ('flag8thDown', 0xE241), ('flag16thUp', 0xE242), ('flag16thDown', 0xE243),
    ('restWhole', 0xE4E3), ('restHalf', 0xE4E4), ('restQuarter', 0xE4E5), ('rest8th', 0xE4E6), ('rest16th', 0xE4E7),
    ('augmentationDot', 0xE1E7),
    ('accidentalFlat', 0xE260), ('accidentalNatural', 0xE261), ('accidentalSharp', 0xE262),
    ('accidentalDoubleSharp', 0xE263), ('accidentalDoubleFlat', 0xE264),
    ('timeSigCommon', 0xE08A), ('metNoteQuarterUp', 0xE1D5),
] + [('timeSig%d' % i, 0xE080 + i) for i in range(10)]
music = extract('vendor/petaluma/package/petaluma.otf', music_items, 250.0)
meta = json.load(open('vendor/petaluma/package/metadata.json'))
bb, an = meta['glyphBBoxes'], meta.get('glyphsWithAnchors', {})
for k, v in music.items():
    b = bb[k]
    v['bbox'] = [b['bBoxSW'][0], -b['bBoxNE'][1], b['bBoxNE'][0], -b['bBoxSW'][1]]
    if k in an:
        v['anchors'] = {a: [p[0], -p[1]] for a, p in an[k].items() if a.startswith('stem')}
CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789()[],.:;/+-=\'!?#♭♯ø'
script_items = [(c, ord(c)) for c in CHARS]
script = extract('vendor/petalumascript/package/petalumascript.otf', script_items, 1000.0)
sf = TTFont('vendor/petalumascript/package/petalumascript.otf')
space = sf['hmtx']['space'][0] / 1000.0 if 'space' in sf['hmtx'].metrics else 0.3
json.dump({'music': music, 'script': script, 'space': space, 'engraving': meta['engravingDefaults']},
          open('src/score_glyphs.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(music), 'music glyphs,', len(script), 'script glyphs, space', space)
print('missing music:', [k for k, _ in music_items if k not in music])
print('missing script:', [c for c in CHARS if c not in script])
