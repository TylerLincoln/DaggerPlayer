// Extracts the ten domain icons from SRD 2.0 page 7 (Public Game Content per DPCGL 2.0 §1.6).
// Each icon sits just right of its domain heading. We render that box with poppler's pdftoppm,
// trim to the ink, and save an alpha mask PNG (black + transparency) so the UI can tint it with CSS.
// Usage: npm run content:icons -- path/to/srd.pdf      (needs poppler-utils: pdftoppm)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PAGE = 7;
const DPI = 600;
const OUT = path.resolve("content/srd/icons");
const DOMAINS = ["ARCANA", "BLADE", "BONE", "CODEX", "DREAD", "GRACE", "MIDNIGHT", "SAGE", "SPLENDOR", "VALOR"];

/** Minimal PNG encoder (RGBA, 8-bit). */
function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Parse a binary PGM (P5) as written by pdftoppm -gray. */
function readPgm(buf: Buffer) {
  const header = buf.toString("latin1", 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (!header) throw new Error("not a P5 PGM");
  return { width: Number(header[1]), height: Number(header[2]), data: buf.subarray(header[0].length) };
}

async function main() {
  const pdf = process.argv[2];
  if (!pdf) throw new Error("usage: extract-icons <srd.pdf>");
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), verbosity: 0 }).promise;
  const page = await doc.getPage(PAGE);
  const pageH = page.getViewport({ scale: 1 }).height;
  const text = await page.getTextContent();
  const heads = (text.items as { str: string; transform: number[]; width: number }[]).filter((i) => DOMAINS.includes(i.str.trim()));
  if (heads.length !== DOMAINS.length) throw new Error(`found ${heads.length} domain headings on p${PAGE}`);

  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icons-"));
  const k = DPI / 72;
  for (const h of heads) {
    const name = h.str.trim().toLowerCase();
    // search box (PDF points): right of the heading text, a little above and below its baseline
    const [x, y] = [h.transform[4] + h.width + 1, h.transform[5]];
    const box = { x: Math.round(x * k), y: Math.round((pageH - (y + 16)) * k), w: Math.round(26 * k), h: Math.round(22 * k) };
    const base = path.join(tmp, name);
    execFileSync("pdftoppm", ["-f", `${PAGE}`, "-l", `${PAGE}`, "-r", `${DPI}`, "-gray", "-x", `${box.x}`, "-y", `${box.y}`, "-W", `${box.w}`, "-H", `${box.h}`, "-singlefile", pdf, base]);
    const img = readPgm(fs.readFileSync(`${base}.pgm`));
    // trim to ink (anything darker than near-white), with a small margin
    let [x0, y0, x1, y1] = [img.width, img.height, -1, -1];
    for (let yy = 0; yy < img.height; yy++)
      for (let xx = 0; xx < img.width; xx++)
        if (img.data[yy * img.width + xx] < 230) {
          x0 = Math.min(x0, xx); y0 = Math.min(y0, yy); x1 = Math.max(x1, xx); y1 = Math.max(y1, yy);
        }
    if (x1 < 0) throw new Error(`${name}: no ink found next to heading`);
    const m = 4;
    [x0, y0, x1, y1] = [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(img.width - 1, x1 + m), Math.min(img.height - 1, y1 + m)];
    const w = x1 - x0 + 1;
    const hh = y1 - y0 + 1;
    const rgba = new Uint8Array(w * hh * 4);
    for (let yy = 0; yy < hh; yy++)
      for (let xx = 0; xx < w; xx++) {
        const g = img.data[(y0 + yy) * img.width + (x0 + xx)];
        rgba[(yy * w + xx) * 4 + 3] = 255 - g; // ink becomes opacity
      }
    fs.writeFileSync(path.join(OUT, `${name}.png`), png(w, hh, rgba));
    console.log(`${name}.png ${w}x${hh}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
main();
