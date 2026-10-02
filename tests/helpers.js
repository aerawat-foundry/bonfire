import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const dir = mkdtempSync(join(tmpdir(), 'ember-'));

/** Rasterize SVG with cairosvg (Python), optionally warping/blurring with OpenCV. */
export function rasterize(svg, { width = 900, warp = 0, blur = 0, noise = 0, rotate = 0, seed = 1 } = {}) {
  const svgPath = join(dir, 'in.svg');
  const pngPath = join(dir, 'out.png');
  writeFileSync(svgPath, svg);
  const py = `
import cairosvg, cv2, numpy as np, sys
cairosvg.svg2png(url=${JSON.stringify(svgPath)}, write_to=${JSON.stringify(pngPath)}, output_width=${width})
im = cv2.imread(${JSON.stringify(pngPath)})
rng = np.random.default_rng(${seed})
h, w = im.shape[:2]
if ${warp} > 0 or ${rotate} != 0:
    pad = int(0.15 * w)
    im = cv2.copyMakeBorder(im, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(120, 125, 130))
    H2, W2 = im.shape[:2]
    src = np.float32([[pad, pad], [pad + w, pad], [pad + w, pad + h], [pad, pad + h]])
    d = ${warp} * w
    dst = src + rng.uniform(-d, d, size=(4, 2)).astype(np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    R = np.vstack([cv2.getRotationMatrix2D((W2 / 2, H2 / 2), ${rotate}, 1.0), [0, 0, 1]])
    im = cv2.warpPerspective(im, R @ M, (W2, H2), borderValue=(120, 125, 130))
if ${blur} > 0:
    im = cv2.GaussianBlur(im, (0, 0), ${blur})
if ${noise} > 0:
    im = np.clip(im + rng.normal(0, ${noise}, im.shape), 0, 255).astype(np.uint8)
cv2.imwrite(${JSON.stringify(pngPath)}, im)
`;
  execFileSync('python3', ['-c', py]);
  const png = PNG.sync.read(readFileSync(pngPath));
  return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), width: png.width, height: png.height, path: pngPath };
}
