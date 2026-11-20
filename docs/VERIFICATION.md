# Verification

The lens measurements use two sample edits: a night portrait on a Sony FE 20-70 mm F4 G, and a street scene on a Tamron 35-150 mm. The exported Reel review also includes outdoor and indoor portrait samples. The samples are not distributed. Run the [tests](../README.md#tests) against your own ARW + XMP + ACR.

## Lens alignment of AI masks

Sony's camera JPEG has in-camera distortion correction applied, while Lightroom stores AI mask rasters in the uncorrected sensor frame. The compiler maps raster lookups through `aux:LensDistortInfo`. In Auto mode, it compares mask-edge and image-edge correlation with and without the warp, and uses the warp only if it wins by a clear margin.

| Sample | Correlation, no warp | Correlation, warp | Auto decision |
|---|---:|---:|---|
| FE 20-70 mm portrait | 0.312 | 0.525 | Warp |
| Tamron 35-150 mm street | 0.179 | 0.358 | Warp |

On the portrait, the median mask-to-image displacement dropped from **11.4 px to 1.4 px** (at mask resolution), which removed the teal halo around the subject. At the tutu edge, compiled pixels moved from (34, 74, 74) to (131, 127, 128), against Lightroom's (143, 126, 132).

## Reel export

| Sample | Duration | Frames | Average bitrate after review |
|---|---:|---:|---:|
| Portrait | 9.5 s | 285 | 2.47 Mbps |
| Street | 11.5 s | 345 | 2.22 Mbps |
| Outdoor portrait | 12.0 s | 360 | 1.92 Mbps |
| Indoor portrait | 8.5 s | 255 | 2.69 Mbps |

- Output is H.264 High profile at an exact 30 fps (constant frame rate), 1080 × 1920, encoded offline with WebCodecs and muxed with `mp4-muxer`.
- The photo rectangle is identical on every frame (0 px deviation), so there's no zoom or pan. Within a held beat, photo pixels don't change between frames.
- All four current exports were independently decoded at every frame; presentation timestamps are exactly spaced at 1/30 s, with matching frame counts.
- Bitrate is low because held frames are static. The target was 12–16 Mbps, but the encoder isn't forced to waste bits on frames that don't change.

## Critical review of exported Reels

- Four sample edits were exported before and after the fixes. Every video frame was sought with an awaited seeked event; quarter-second contact sheets, cut filmstrips and full-resolution RGB difference plots were saved. Sequential decoding checked continuity independently of occasional browser capture stalls.
- The portrait sample's beige mask wash and the street sample's near-full purple wash were real overlay fills. Selection interiors are now transparent, with contours retained. Photo and panel dimming were removed; values stay readable during held beats.
- At the off-beat panel opening, measured frame-to-frame RGB differences fell from **39.17 to 4.62** for the portrait sample, **30.67 to 5.93** for the street sample, **26.61 to 5.89** for the outdoor portrait and **28.24 to 3.58** for the indoor portrait (0–255 scale).
- Numeric counters stopped short of their targets at cuts. They now reveal exact setting values and finish three frames before the cut. All **1,230 after frames** have full pane brightness, no empty value panels and fixed photo geometry; every camera/program beat has complete rows in its final three frames.
- Selftest and browser integration pass, including regressions for full-frame selection isolation, exact numeric targets, empty panels and incomplete beat-end text. A stale synthetic title expectation was aligned with the existing measured hue classifier.
- The pacing and cover proposals were subsequently approved and applied below; rewind direction is retained. Gradient banding was not confirmed; encoder settings were retained.

## Round 5: packed passes, shared Reel slot, local Color

- The page stack starts packed. Measured height is **30.02%** of expanded height at 1440 px and **30.02%** at 375 px; neither layout overflows horizontally. Click/tap and Enter/Space expand, Escape and the collapse control pack it; reduced motion switches immediately. Parameters and the separation slider show when expanded.
- The portrait sample and street sample show their mini stack in rewind and every chapter program beat. After half a beat the slice becomes a roughly 64 px panel-header thumbnail, retained through answer and hold. All 630 audited frames keep the motif inside the approved panel slot. Photo geometry remains fixed and held photo pixels remain unchanged outside that slot.
- Outdoor portrait sample local Color is applied in linear light with luminance-preserving gamut fitting. Measured sky HSV hue moves **236.82° → 229.43°**, toward the 230° swatch. Mean masked RGB error against the camera JPEG used in that comparison improves **28.21 → 26.47/255**. The edited reference is measured separately below.
- The historical colour-title experiment was superseded by the factual pipeline covers verified below.

## Approved Reel proposals

| Sample | Previous duration | Current duration | First/last mean abs RGB (0–255) |
|---|---:|---:|---:|
| Portrait | 9.5 s | 9.5 s | 0 |
| Street | 11.5 s | 11.5 s | 0 |
| Outdoor portrait | 11.5 s | 12.0 s | 0 |
| Indoor portrait | 8.5 s | 8.5 s | 0 |

- Hook, loop and cover JPG show the finished photo and headline, with no comparison strip or divider. The rewind still reveals the camera original in its existing direction.
- All 11 chapter answers last 1.0 s: a 0.5 s wipe followed by 0.5 s at rest. Each takes a beat from its own hold first, then from payoff down to a 1.5 s minimum. Chapter selection and the half-second grid are preserved.
- Chapter panels show one mask expression and at most three selected value rows. Exposure comes first, then the strongest colour move, then tone moves ranked against slider ranges. Colour-driving curves use one summary row; incidental curve points and hold paging are absent. Base panels show WB, exposure and the strongest other move. Full page program details are unchanged.
- Every one of the 1,245 rendered frames passed the cover, row-count, curve-list, fixed-photo and typing audits: 0 px photo rectangle deviation, at most four panel rows, and complete text in each beat's final three frames. All four contact sheets seek at 0.25 s steps and await `seeked` before drawing.
- The closing MP4 keyframe reuses the opening keyframe, avoiding different compression of identical source pixels. Browser and independent decoding both measure exactly 0 first/last RGB difference for every sample. Independent decoding checks all frames and exact 30 fps timestamps.
- Selftest and browser integration pass, including regressions for compact row priorities, curve summaries, answer duration/rest, beat grid, payoff floor, no paging, clean covers, fixed geometry, typing deadlines and decoded loop equality.

## Page

- After load, compile and Reel export, there are **no requests to other origins**. Fonts and decoders are served locally.
- Minimum measured contrast for readable text is **5.80:1**.
- Before/after slider: the clip edge, divider and handle stay within 0.02 px of each other at 10, 35, 50 and 80%.
- Layouts at 1440, 768 and 375 px have no horizontal overflow.
- Keyboard path: choose files, compile, focus a slice and press Enter to inspect it, move the slider with the arrow keys, export.

## Not verified

- How Instagram transcodes the uploaded Reel, and playback on physical phones.
- The `MediaRecorder` fallback in browsers without WebCodecs H.264 (Firefox and Safari Reel export).
- Native file-dialog keyboard navigation, which is browser chrome outside the page.

## Slice fan disclosure

- Both sample edits were checked at 1440, 768 and 375 px. Packed height is **30.00–30.12%** of expanded height. Passes run left to right from 0, and the last card wins the frontmost hit test. A 24-pass phone fixture also fits, with no chip collisions.
- All six endpoint pairs have **zero horizontal overflow and zero label collisions**. Cards finish within **0.001 px** of their static expanded and packed positions. Adjacent panes move **0 px** across the eight sampled expansion frames, and the disclosure starts with **0 px** height jump.
- Travel lasts **560 ms**, with a 30 ms pass stagger, reversed on collapse. Phone cards dock beside bottom-up text rows. Twelve endpoint screenshots and both eight-frame filmstrips were saved at 0, 15, 30, 45, 60, 75, 90 and 100% of travel.
- Tab reaches the disclosure; Enter expands and Escape collapses with visible focus. A pointer click on an exposed fan card inspects that pass after travel ends. Repeated toggles during travel are ignored. Reduced motion reaches the same endpoints immediately, with no travel animations.
- Selftest and browser integration pass, including fan order, final positions, reverse stagger, queued inspection and reduced-motion regressions.

## Pipeline Reels

| Sample | Tutorial pass indices | Duration | Frames per export |
|---|---|---:|---:|
| Portrait | 0, 1, 2, 3, 4 | 17.5 s | 525 |
| Street | 0, 2, 3, 4, 5 | 17.5 s | 525 |
| Outdoor portrait | 1, 2, 3, 5, 6 | 17.5 s | 525 |
| Indoor portrait | 0, 1, 2 | 12.5 s | 375 |

- Eight Tutorial exports cover the empty and populated description for each sample. Each contact sheet uses completed video seeks at half-second intervals and the closing frame. All eight decoded opening and closing frames matched exactly.
- The text audit inspected 3,900 Tutorial frames and 2,490 Teaser frames, including partial typewriter strings. All 225 distinct strings passed the whitelist.
- Every chosen Tutorial pass matched the compiled pass and page stack. Each began with a 0.5 s deck lift followed by 2.0 s of controls. The photo rectangle moved 0 px. The largest step panel overlap covered 8.67% of the subject mask.
- The Tutorial panel measured 884 px, or 81.85% of frame width. Minimum effective text sizes were 30 px for values, 32 px for kickers and 30 px for labels. All text stayed within the safe area. Each step showed at most four slider rows.
- Independent XML and drawing checks found zero mismatches in slider values, knob positions, curves, grading wheels, mixer swatches, mask bindings and guide geometry. Captions contained every explicit HSL value, including zeroes.
- The four Teaser schedules matched the pre-change baselines. Suppressing glyphs and their shadows on both canvas surfaces produced identical full-resolution RGBA hashes for all 432 sampled comparisons across the two description settings. Each comparison used a fresh page, as did the baseline.
- The sample selftest and browser integration suite passed, including cover selection, editable caption copying, pass order and readability regressions.

## Displayed units

- Values drawn in both Reels use Lightroom's own slider units. Local (mask) sliders are stored in the XMP as fractions: local exposure is shown as the fraction × 4 EV with two decimals, and every other local slider as the fraction × 100, rounded. On the portrait sample, `LocalHighlights2012 = −0.102804` now reads **−10** and `LocalExposure2012 = −0.11` reads **−0.44**. On the street sample, Glow reads **34**. No drawn value carries more than two decimals.
- On-screen text is measured facts (pass numbers, mask and control names, values, camera line) plus the editor's optional description; no generated wording.

## Registered colour and Reel verification

### Highlight grading — 20 November 2026

The three ARW/XMP/ACR sets and matching Lightroom JPGs in `D:\anzu` were rendered
through the production compiler. Comparisons use 768 px long-edge sRGB captures,
D65 Lab ΔE2000, and one luminance-edge registration per sample shared by both
versions. The reference JPG is used only for comparison, never to tune the render
at runtime. These results are separate from the earlier sample set below.

| Sample | Mean RGB error, 0–255 | Mean ΔE2000 | p95 ΔE2000 |
|---|---:|---:|---:|
| DSC03049 | 14.228 → 14.228 | 8.038 → 8.038 | 17.089 → 17.089 |
| DSC06771 | 8.054 → 8.054 | 4.581 → 4.581 | 12.399 → 12.399 |
| DSC09552 | 15.560 → 11.432 | 9.725 → 5.195 | 18.540 → 9.751 |

- Global grading now fits tint chroma within sRGB at the source luminance before
  blending. Previously, normalizing saturated blue to highlight luminance pushed
  the blue channel far above white. On DSC09552, the global-pass fraction with
  any channel at least 254/255 fell from 52.95% to 0.18%.
- DSC09552's mean ΔE2000 improved in the subject, background, sky and clothes
  regions. RGB error is not uniformly lower: subject RGB increased from 15.590
  to 15.815 and clothes from 12.554 to 13.908, while their mean ΔE2000 fell from
  8.418 to 6.823 and 7.290 to 6.274 respectively. Clipped shirt detail and camera
  profile differences remain; this is not an exact Lightroom reconstruction.
- Synthetic GPU checks cover six tint hues, neutral and white preservation,
  luminance preservation, empty masks, and unchanged exposure behavior. All
  three samples compiled and passed 643 Tutorial control/geometry checks; both
  Reel renderers ran with stationary photos.
- The Node sample selftest and full browser suite passed against `D:\anzu`,
  including H.264 export, slice layout, mobile layout and corrupt-file recovery.
- [Lightcraft's tone pipeline](https://github.com/storytold/lightcraft/blob/main/crates/pipeline/src/tone.rs)
  and [colour operations](https://github.com/storytold/lightcraft/blob/main/crates/pipeline/src/colorops.rs)
  were reviewed as architectural references. No source code was copied. Our
  gamut fitting uses the same linear-luminance construction already present in
  the local Color swatch shader.

### Earlier sample set

| Sample | Whole-frame mean RGB error, 0–255 | Mean ΔE2000 |
|---|---:|---:|
| Portrait sample | 15.90 → 7.91 | 8.22 → 4.50 |
| Street sample | 13.43 → 12.87 | 7.86 → 7.46 |
| Outdoor portrait sample | 17.41 → 17.18 | 7.32 → 7.24 |
| Indoor portrait sample | 6.59 → 6.51 | 2.97 → 2.94 |
| Many-pass landscape sample | 12.08 → 11.99 | 8.59 → 8.54 |
| Landscape sample without AI | 14.81 → 14.73 | 6.61 → 6.59 |

- Each comparison uses the same registered crop for both builds. The portrait’s manually selected sky improved from 24.46 to 6.80/255. The outdoor portrait’s AI sky still measures 49.81/255 against the edited reference. The largest regional increase was 0.29/255 on the portrait subject. Anchoring white during local exposure reduced the outdoor sky from 49.64 to 4.87/255 in isolation, but raised the many-pass landscape’s whole-frame error from 12.08 to 12.20/255.
- The master and channel curve changes passed the cross-sample threshold. Spline interpolation, alternate gamma, mixer widths, white balance and gradient or radial warping did not. Substituting Adobe’s global pass into the street baseline reduced final error from 13.43 to 10.02/255.
- Fourteen exports covered Generative Remove, crop and straighten, brush, colour and luminance ranges, eleven passes, and a global-only edit. Tutorials ran 12–20 seconds. Each step used 0.5 seconds for its deck lift and 1.5–2.5 seconds for its controls.
- Across 5,355 frames, the audits found zero unapproved strings, ASCII negative signs, dangling separators, slider-value mismatches or text outside the safe area. Tutorial guides used zero fill pulses. Maximum subject overlap was 4.27%. The landscape without AI used a hand-traced silhouette for this check. All decoded loop endpoints matched.
- Both modes passed CJK, emoji and 60-character description checks for cover layout, caption opening and ASCII filenames. A synthetic brush correction exercised the recorded dabs in both exports. Brush warp accuracy remains unverified because no standalone brush correction was found among 3,666 sidecars.
