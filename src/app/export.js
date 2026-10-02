// Shared helpers for turning a poster SVG into downloads.

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Rasterize an SVG string at `width` pixels (fonts embedded in the SVG are used). */
export async function svgToCanvas(svg, width) {
  const w = +svg.match(/ width="(\d+)"/)[1];
  const h = +svg.match(/ height="(\d+)"/)[1];
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((h / w) * width);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return canvas;
}

export const slug = (s) => s.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ember';

export const downloadSvg = (svg, name) => download(new Blob([svg], { type: 'image/svg+xml' }), name);

export async function downloadPng(svg, name, width = 3600) {
  const canvas = await svgToCanvas(svg, width);
  canvas.toBlob((blob) => download(blob, name), 'image/png');
}
