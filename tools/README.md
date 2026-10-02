# tools/

The music glyphs and the piano are stored in `src/` as JSON so the app needs no font or audio files.
These scripts regenerate that data from the original sources. You only need them if you want to
change which glyphs or samples are embedded: the generated files are committed.

| Script | Reads (in `vendor/`) | Writes |
| --- | --- | --- |
| `fetch-vendor.sh` | npm registry | `vendor/` (fonts and piano samples; git-ignored) |
| `extract_glyphs.py` | Bravura (SIL OFL 1.1) | `src/glyphs.json`: LCD staff glyphs |
| `extract_score_glyphs.py` | Petaluma and Petaluma Script (SIL OFL 1.1) | `src/score_glyphs.json`: handwritten manuscript glyphs |
| `make_piano_samples.py` | Salamander Grand Piano V3, velocity layer 8 (CC BY 3.0) | `src/piano_samples.json`: 30 notes as Ogg Vorbis |

Run them from the repository root (WSL, Linux or macOS):

```bash
bash tools/fetch-vendor.sh
python3 -m pip install fonttools numpy soundfile
python3 tools/extract_glyphs.py
python3 tools/extract_score_glyphs.py
python3 tools/make_piano_samples.py
npm run build
```

The glyph files come out byte-for-byte identical. The piano file will differ slightly, because Ogg
Vorbis encoding is not bit-exact between runs; it sounds the same.
