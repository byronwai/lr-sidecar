# Verification

These measurements come from two sample edits: a night portrait on a Sony FE 20-70 mm F4 G, and a street scene on a Tamron 35-150 mm. The samples are not distributed. Run the [tests](../README.md#tests) against your own ARW + XMP + ACR.

## Lens alignment of AI masks

Sony's camera JPEG has in-camera distortion correction applied, while Lightroom stores AI mask rasters in the uncorrected sensor frame. The compiler maps raster lookups through `aux:LensDistortInfo`. In Auto mode, it compares mask-edge and image-edge correlation with and without the warp, and uses the warp only if it wins by a clear margin.

| Sample | Correlation, no warp | Correlation, warp | Auto decision |
|---|---:|---:|---|
| FE 20-70 mm portrait | 0.312 | 0.525 | Warp |
| Tamron 35-150 mm street | 0.179 | 0.358 | Warp |

On the portrait, the median mask-to-image displacement dropped from **11.4 px to 1.4 px** (at mask resolution), which removed the teal halo around the subject. At the tutu edge, compiled pixels moved from (34, 74, 74) to (131, 127, 128), against Lightroom's (143, 126, 132).

## Reel export

| Sample | Duration | Frames | Export time | Average bitrate |
|---|---:|---:|---:|---:|
| Portrait | 9.5 s | 285 | 1.6 s | 4.3 Mbps |
| Street | 11.5 s | 345 | 2.5 s | 5.2 Mbps |

- Output is H.264 High profile at an exact 30 fps (constant frame rate), 1080 × 1920, encoded offline with WebCodecs and muxed with `mp4-muxer`.
- The photo rectangle is identical on every frame (0 px deviation), so there's no zoom or pan. Within a held beat, photo pixels don't change between frames.
- Decoded frames match the renderer within 1–2/255 at every half-second, so encode timing is exact.
- The first and last frames differ by 2.6/255 on average, so the loop is seamless.
- Bitrate is low because held frames are static. The target was 12–16 Mbps, but the encoder isn't forced to waste bits on frames that don't change.

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
