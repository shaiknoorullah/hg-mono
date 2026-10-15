// Small PNG helpers on pngjs: read, write, crop with padding, side by side, shrink, outline.
// Every image is RGBA, 8 bits a channel (pngjs converts what it reads).

import { readFileSync, writeFileSync } from 'node:fs';
import pngjs from 'pngjs';

const { PNG } = pngjs;

/** Magenta: where a capture is shorter than its board. Nothing in either app is this colour. */
export const PAD = [255, 0, 255, 255];

export const readPng = (file) => PNG.sync.read(readFileSync(file));
export const writePng = (file, png) => writeFileSync(file, PNG.sync.write(png));
export const toBuffer = (png) => PNG.sync.write(png);

/** A new image, filled with one colour. */
export function canvas(width, height, rgba = [255, 255, 255, 255]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set(rgba, i);
  return png;
}

/** The w×h window at (x, y); anything outside the source is `pad`. */
export function crop(src, x, y, w, h, pad = PAD) {
  const out = canvas(w, h, pad);
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(src.width, x + w);
  const y1 = Math.min(src.height, y + h);
  for (let sy = y0; sy < y1; sy++) {
    const from = (sy * src.width + x0) * 4;
    src.data.copy(out.data, ((sy - y) * w + (x0 - x)) * 4, from, from + (x1 - x0) * 4);
  }
  return out;
}

/** The images left to right, top-aligned, `gap` px apart. */
export function sideBySide(images, gap = 24, bg = [255, 255, 255, 255]) {
  const width = images.reduce((s, im) => s + im.width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map((im) => im.height));
  const out = canvas(width, height, bg);
  let left = 0;
  for (const im of images) {
    for (let y = 0; y < im.height; y++) im.data.copy(out.data, (y * width + left) * 4, y * im.width * 4, (y + 1) * im.width * 4);
    left += im.width + gap;
  }
  return out;
}

/** 1/f the size, each pixel the mean of an f×f block. */
export function shrink(src, f) {
  if (f <= 1) return src;
  const w = Math.floor(src.width / f);
  const h = Math.floor(src.height / f);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * src.width + x * f + dx) * 4;
          for (let c = 0; c < 4; c++) sum[c] += src.data[i + c];
        }
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out.data[o + c] = Math.round(sum[c] / (f * f));
    }
  }
  return out;
}

/** Draws the outline of a rectangle, `t` px thick, clipped to the image. */
export function outline(png, { x, y, w, h }, rgba, t = 2) {
  const put = (px, py) => {
    if (px >= 0 && py >= 0 && px < png.width && py < png.height) png.data.set(rgba, (py * png.width + px) * 4);
  };
  for (let k = 0; k < t; k++) {
    for (let px = x - t; px < x + w + t; px++) {
      put(px, y - 1 - k);
      put(px, y + h + k);
    }
    for (let py = y - t; py < y + h + t; py++) {
      put(x - 1 - k, py);
      put(x + w + k, py);
    }
  }
}
