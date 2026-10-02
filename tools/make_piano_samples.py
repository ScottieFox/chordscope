# Salamander Grand Piano V3 (Alexander Holm, CC BY 3.0) — velocity layer 8, one sample every
# minor third. Trim each to a register-appropriate length with a smooth tail and re-encode as
# Ogg Vorbis (~65 kbps stereo) so the whole piano fits inside the single-file app.
import soundfile as sf, numpy as np, io, base64, json, os
SRC = 'vendor/samples/v8/package/audio'
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
def midi_of(name):
    n = name.replace('v8.mp3', '')
    letter = n[:-1]; octave = int(n[-1])
    return 12 * (octave + 1) + NAMES.index(letter)
def length_for(m):
    if m < 48: return 7.0
    if m < 60: return 6.0
    if m < 72: return 5.0
    if m < 84: return 4.0
    if m < 96: return 3.0
    return 2.2
out, total, peak = {}, 0, 0
for f in sorted(os.listdir(SRC), key=midi_of):
    m = midi_of(f)
    x, sr = sf.read(os.path.join(SRC, f), dtype='float32')
    # skip leading silence (keep a 2 ms pre-roll) so the attack lines up with note-on
    env = np.abs(x).max(axis=1)
    start = max(0, int(np.argmax(env > 0.002)) - int(sr * 0.002))
    L = int(sr * length_for(m))
    seg = x[start:start + L].copy()
    fade = min(len(seg) // 3, int(sr * 0.9))
    seg[-fade:] *= (np.cos(np.linspace(0, np.pi / 2, fade)) ** 2)[:, None]
    peak = max(peak, float(np.abs(seg).max()))
    b = io.BytesIO()
    sf.write(b, seg, sr, format='OGG', subtype='VORBIS', compression_level=0.78)
    data = b.getvalue()
    total += len(data)
    out[m] = base64.b64encode(data).decode('ascii')
json.dump({'source': 'Salamander Grand Piano V3, Alexander Holm, CC BY 3.0', 'velocityLayer': 8, 'samples': out},
          open('src/piano_samples.json', 'w'), separators=(',', ':'))
print(len(out), 'samples', f'{total/1024:.0f} KB ogg', f'{os.path.getsize("src/piano_samples.json")/1024:.0f} KB json', 'peak', round(peak, 3))
print(sorted(out.keys()))
