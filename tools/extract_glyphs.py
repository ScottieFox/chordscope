# Extract a handful of SMuFL glyph outlines as SVG path data in staff-space units
# (1 unit = 1 staff space, y down), so the staff can be drawn without shipping a font.
import json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font = TTFont('vendor/bravura/package/bravura.otf')
upm = font['head'].unitsPerEm
sp = upm / 4.0  # SMuFL: 1 em = 4 staff spaces
cmap = font.getBestCmap()
gs = font.getGlyphSet()
want = {
    'gClef': 0xE050, 'fClef': 0xE062, 'brace': 0xE000, 'noteheadWhole': 0xE0A2,
    'flat': 0xE260, 'natural': 0xE261, 'sharp': 0xE262, 'dsharp': 0xE263, 'dflat': 0xE264,
}
def ntos(v):
    s = ('%.3f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s
out = {}
for key, cp in want.items():
    gname = cmap[cp]
    pen = SVGPathPen(gs, ntos=ntos)
    tpen = TransformPen(pen, (1/sp, 0, 0, -1/sp, 0, 0))
    gs[gname].draw(tpen)
    out[key] = {'d': pen.getCommands(), 'adv': round(gs[gname].width / sp, 3)}
meta = json.load(open('vendor/bravura/package/metadata.json'))
bb = meta['glyphBBoxes']
names = {'gClef':'gClef','fClef':'fClef','brace':'brace','noteheadWhole':'noteheadWhole','flat':'accidentalFlat',
         'natural':'accidentalNatural','sharp':'accidentalSharp','dsharp':'accidentalDoubleSharp','dflat':'accidentalDoubleFlat'}
for k, n in names.items():
    out[k]['bbox'] = [bb[n]['bBoxSW'][0], -bb[n]['bBoxNE'][1], bb[n]['bBoxNE'][0], -bb[n]['bBoxSW'][1]]  # x0,y0(top),x1,y1(bottom) in y-down
json.dump(out, open('src/glyphs.json', 'w'), separators=(',', ':'))
print('upm', upm, {k: (len(v['d']), v['adv'], v['bbox']) for k, v in out.items()})
