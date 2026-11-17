# LR Sidecar Compiler

Inspect a Sony ARW preview, read a Camera Raw XMP edit, and apply its ACR masks and patches in the browser. The animated slice stack shows each pass. Export the composite as PNG or JPEG, or make a vertical H.264 MP4 in a browser with a compatible encoder.

The renderer starts with the camera's embedded JPEG and approximates Lightroom's controls. The files you select are processed in your browser.

[Open the compiler](https://lr-sidecar.byronwai.workers.dev/) · [Read the format notes](https://byronwai.github.io/2026/11/16/Lightroom-RAW-Sidecars/)

## Run locally

```sh
python -m http.server 4100 --directory public
```

Open http://localhost:4100/ in a browser with WebGL2. Choose one ARW, its XMP, and the matching ACR, then select **Compile edit**.

## Test and deploy

The tests use the DSC03049 fixture supplied separately. For the browser test, start Chrome with remote debugging on port 9223 and run the local server. Set `LR_SIDECAR_URL` to target a different deployment.

```sh
node test/selftest.mjs /path/to/LR
node test/browser.mjs /path/to/LR
npx wrangler deploy
```

The vendored JPEG XL decoder is `@jsquash/jxl` 1.3.0 ([Apache-2.0](public/vendor/jsquash-jxl/LICENSE)).
