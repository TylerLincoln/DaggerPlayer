// Extracts text from the Daggerheart SRD 2.0 PDF into content/srd/raw/srd-2.0.txt.
// Usage: npm run content:extract [-- path/to/srd.pdf]
// If no path is given the PDF is downloaded from daggerheart.com into a temp file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pdf from "pdf-parse/lib/pdf-parse.js";

const SRD_URL = "https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf";
const OUT = path.resolve("content/srd/raw/srd-2.0.txt");

/** The PDF text layer splits ligatures ("benefi ts"). Rejoin them. */
export function fixLigatures(t: string): string {
  return t
    .replace(/(ffi|ffl|fi|fl)[ ]+(?=[a-z])/g, "$1")
    .replace(/\b(eff|diff|aff|unaff|suff|Eff|Diff|Aff|Suff)[ ]+(?=[a-z])/g, "$1")
    .replace(/\b(puff|quaff|bluff)[ ]+(?=s\b)/g, "$1");
}

async function main() {
  let file = process.argv[2];
  if (!file) {
    file = path.join(os.tmpdir(), "srd-2.0.pdf");
    console.log("Downloading", SRD_URL);
    const res = await fetch(SRD_URL);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const pages: string[] = [];
  await pdf(fs.readFileSync(file), {
    pagerender: async (page: any) => {
      const c = await page.getTextContent();
      let lastY: number | undefined;
      let s = "";
      for (const it of c.items) {
        if (lastY !== undefined && lastY !== it.transform[5]) s += "\n";
        s += it.str;
        lastY = it.transform[5];
      }
      pages.push(s);
      return s;
    },
  });
  const body = pages.map((p, i) => `@@PDFPAGE ${i + 1}@@\n${fixLigatures(p)}`).join("\n");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body);
  console.log(`Wrote ${OUT}: ${pages.length} pages, ${body.length} chars`);
}
if (process.argv[1]?.endsWith("extract-srd.ts")) main();
