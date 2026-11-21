# Beginner's guide

This guide takes you from a photo you edited in Lightroom to a layer-by-layer breakdown of the edit, and optionally an Instagram Reel of it. You don't need to install anything. Everything runs in your browser, and your files stay on your device.

**[Open the compiler →](https://lr-sidecar.byronwai.workers.dev/)**

## What you need

| File | What it is | Needed? |
|---|---|---|
| `.ARW` or `.CR3` | The original raw photo from a Sony or Canon camera | **Yes** |
| `.xmp` | Lightroom's edit record: every slider, curve and mask | **Yes** |
| `.acr` | Lightroom's companion file for heavy edits: AI masks (Subject, Sky, Background…) and Generative Remove | Only if your edit uses them |
| `.jpg` | Your finished photo, exported from Lightroom | Optional, for the Reel |

The compiler works with Sony ARW and Canon CR3 files. Other raw formats (NEF, DNG, RAF…) aren't supported yet.

## Step 1. Get the files out of Lightroom

**Lightroom (desktop):**

1. Select the edited photo.
2. Choose **Export**.
3. Set the file type to **Original + Settings**.
4. Export to a folder. You get the raw file, its `.xmp`, and an `.acr` if the edit needs one.

**Lightroom Classic:** select the photo and choose **Metadata → Save Metadata to File** (Ctrl+S / ⌘S). Lightroom writes the `.xmp` beside the raw file. From version 15.0, it also writes an `.acr` when the edit has AI masks or other heavy edits.

Keep all the files of one photo together, with the same name: `DSC01234.ARW`, `DSC01234.xmp`, `DSC01234.acr`.

For the Reel, also export a normal **JPEG** of the finished photo. It's optional, but it gives the Reel's cover and ending Lightroom's exact colours.

## Step 2. Load the files

1. Open the compiler in a current version of Chrome or Edge. Firefox and Safari can compile, but Reel export is fastest in Chrome or Edge.
2. Drag all the files onto the drop area at the top, or press **Choose files** and select them together.
3. Each slot lights up as a file is recognised: **01 / RAW**, **02 / XMP**, **03 / ACR**, **04 / JPG**. If something is wrong, a red message under the slots says which file and why.

## Step 3. Compile

Press **Compile edit**. The compiler reads the camera's own preview from the raw file, then replays your edit on top of it, one step at a time. A large photo takes a few seconds.

Tick **Full preview resolution** before compiling if you want the sharpest on-screen preview. It's slower.

## Step 4. Explore the edit

The page has three columns:

- **01 Input:** the camera's rendering, before your edit.
- **02 Passes:** the slice stack. Each slice is one step of your edit: global settings first, then each mask and its adjustments, in the order Lightroom stores them.
  - Hover over a slice (or press and hold on a phone) to bring it to the front.
  - Click a slice to see its mask, the slider values, and what it changed.
  - Drag **LAYER SEPARATION** to fan the slices out.
- **03 Output:** the finished result. Drag across the image to compare it with the camera's version (arrow keys also work).

Below them, **Under the hood** has the inspectors. They show what's inside each file: the raw container, every XMP setting, and every texture in the ACR.

## Step 5. Save the result

- **↓ PNG** or **↓ JPG** saves the compiled image at full resolution.

## Step 6. Make a Reel (optional)

1. In the Reel section, pick a mode:
   - **Teaser:** short and punchy, showing the edits with the most visible impact.
   - **Tutorial:** slower, with the slider values typed out beside the photo.
2. Optionally type a short **Description** (up to 60 characters). It appears in the Reel as your own words.
3. Optionally press **Add edited JPG** and choose your Lightroom export. The cover and ending then use its exact colours. The step-by-step part always uses the rebuilt layers.
4. Press **Export Reel**. Then use **Download MP4** for the 1080 × 1920 video and **Cover JPG** for its cover image. **Copy caption** gives you a caption to paste into Instagram.

## Good to know

- **It's an approximation.** The compiler starts from the camera's JPEG preview, not the raw sensor data, and re-creates Lightroom's adjustments with its own maths. Expect it to look close, not identical. The slice-by-slice story is the point, not a pixel-perfect copy.
- **Nothing is uploaded.** The page makes no requests to other servers. You can disconnect from the internet after it loads.
- **Missing ACR?** If your edit uses AI masks or Generative Remove and the `.acr` is missing, the compiler reports a missing raster. Re-export with **Original + Settings**.

## Troubleshooting

| Problem | What to try |
|---|---|
| "Unsupported file …" | Only Sony ARW and Canon CR3 raws work today, with XMP, ACR and JPG sidecars. |
| An AI mask looks shifted around the subject's edge | Open **Under the hood → 03 / ACR** and set **AI raster lens alignment** to **Warp** or **Off**. Sony cameras correct lens distortion in the preview, and Lightroom's masks don't. |
| Reel export is slow or records in real time | Your browser lacks the fast video encoder. Use Chrome or Edge and keep the tab visible. |
| The page looks out of date | Reload with Ctrl+Shift+R (⌘⇧R on a Mac). |

Want the technical details of the file formats? Read the [format notes](https://byronwai.github.io/2026/11/16/Lightroom-RAW-Sidecars/).
