# OCR and photo fixtures

Six invented, non-personal photos for the photo/OCR flow (SCRUM-43, SCRUM-52). Regenerate them with
`swift scripts/make-ocr-fixtures.swift`; check text recognition with `swift scripts/check-ocr-fixtures.swift`.

| Fixture | Case | Expected outcome |
|---|---|---|
| `en-text-heavy.png` | dense English page | editable text with the title and first sentence |
| `ro-diacritics.png` | Romanian, every diacritic (ă â î ș ț) | editable Romanian text with diacritics |
| `en-rotated-exif6.jpg` | camera JPEG stored sideways, EXIF orientation 6 | text read; photo saved upright |
| `ro-low-light.jpg` | dim text on a dark, noisy background | both lines read |
| `no-text.jpg` | landscape-like image, no text | "couldn't read" message offering Keep as image; photo and draft kept |
| `en-12mp.heic` | 4032×3024 HEIC, like an iPhone library photo | text read; saved downscaled to 2048 px |

## Results, 24 October 2026

**macOS 27 Vision** (`check-ocr-fixtures.swift`; the same request expo-text-extractor makes on iOS). All six have the
expected outcome, each in under 0.4 s after the models load (the first call took about 60 s). Known
misread: "oprești" came back as "opreșți"; the result is editable, so the user can correct it. Setting
Romanian as a recognition language made no difference here, so the app keeps expo-text-extractor's
default request. Vision read the sideways JPEG correctly without being given its orientation.

**iOS 27 simulator, Release build** (iPhone 18 Pro on an Apple silicon Mac), `en-12mp.heic` shared from Files:
- Extract text: about 6 s from tap to the editable draft, text correct.
- Save (prepare + encrypt + store): about 2 s; the photo was stored at 2048×1536 and both cache copies
  were deleted.

These are simulator timings of a synthetic HEIC with simple content. They are not device latency and do
not show that the 13–115 s save measured earlier for real library HEICs on the simulator is fixed;
that needs a physical-device measurement (SCRUM-52).

## Flow behaviour covered

- Extract text appends to text already typed instead of replacing it; Keep as image keeps it too.
- While reading, Stop reading text abandons the attempt (Vision can't be interrupted; a late result is ignored).
- A failed read offers Try again or Keep as image; an empty read offers Keep as image. The photo stays attached.
- Saving shows Preparing photo… then Encrypting photo…, with elapsed seconds after 3 s. A failed save
  keeps the draft and photo and says so.
