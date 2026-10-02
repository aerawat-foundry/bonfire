# Ember

> *Humankind's great tech began with fire. This `this.side.of.tech` is You.*

A generator and scanner for **Ember codes**: posters where a standard QR code
burns at the base of a grid column and rises as a plume of embers.

* **The QR is real.** It's a standard QR at error correction H, readable by
  any phone camera.
* **The fire is a code too.** The ember pattern above the QR is a
  Reed-Solomon-protected copy of the text (or a hidden second text) under its
  own reversible convention ([SPEC.md](SPEC.md)). Every "random" particle is
  derived from the text.
* **Hotpoints** are a few glowing modules inside the QR, placed by the text's
  SHA-256 hash. The Ember scanner checks they glow, so a flat black
  reprint is flagged.

## Pages

| URL      | What it does |
|----------|--------------|
| `/`      | **Generator.** Type text, get the poster as SVG or PNG. Optional hidden ember text, plus an X-ray view of the convention. |
| `/scan/` | **Scanner.** Opens straight to the camera, with a gallery icon to scan a saved image (paste and drag-and-drop work too). A **Standard QR / Ember QR** switch picks the mode: Standard reads only the QR; Ember also reads the fire (pooling evidence across camera frames) and checks the hotpoints. `?mode=standard` or `?mode=ember` preselects it. |

## Run

```sh
npm install
npm run dev        # http://localhost:5173/ and /scan/
npm run dev:phone  # same, over HTTPS on your network (self-signed), to test the camera on a phone
npm run build      # static site in dist/ (relative paths; host anywhere)
npm test
```

### Installable app (PWA)

The build includes a web app manifest and a service worker (`sw.js`,
generated with the exact list of built files). The app installs to the home
screen and opens straight to the scanner. After the first visit both pages,
including the ZXing WebAssembly, work offline. Use the **Install** button in the
generator header or the scanner's top bar. On iPhone, use Share ▸ Add to Home Screen.

### Camera permission

The scanner opens the camera by itself only when permission is already
granted. Otherwise it shows **Enable camera**, and that tap opens the browser's
permission dialog: browsers show the dialog reliably only in response to a
tap. If the camera was blocked earlier, browsers never ask again, so the
scanner shows how to re-allow it on iPhone, Android or desktop.

The dialog also never appears on plain `http://` (except `localhost`) or
inside another site's frame. Use HTTPS (`npm run dev:phone` for local testing).

The camera needs a secure context (HTTPS or `localhost`) and its own tab: pages embedded in another site's frame are not allowed to use the camera, and the scanner says so and offers to open in a new tab.

The end-to-end tests rasterize and distort posters with Python:
`pip install cairosvg opencv-python-headless numpy`. Those tests are skipped
when Python is missing.

## Layout

```
src/core/      convention + rendering + scanning (no DOM; runs in Node too)
  prng.js        SHA-256 counter stream used for every convention choice
  rs.js          Reed-Solomon GF(256) with error + erasure decoding
  qr.js          standard QR matrix (qrcode-generator) + function-pattern mask
  ember.js       ember layout and codec
  hotpoints.js   hotpoint placement
  render.js      poster SVG
  scan.js        ZXing (WebAssembly) + grid refinement + ember / hotpoint reading
src/app/       the two pages, plus pwa.js (install + service worker registration)
src/sw-template.js  service worker; vite.config.js fills in the precache list
public/        manifest and app icons
tests/         unit tests and render → distort → scan tests
```

## Limits

* Ember capacity grows with the QR: 23 bytes for a version 1 QR, 56 for
  version 4, and 124 at most (one RS block). Texts longer than 124 bytes are
  rejected by the generator.
* The scanner needs the whole plume in frame and in reasonable focus. The
  QR alone is enough for ordinary readers.
* Printing: keep modules at least about 1.5 mm for phone scanning at arm's length.
  The PNG export is about 36 px per module.
