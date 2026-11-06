import type { Source } from "../../content/schema/index.ts";

export const PACK = "srd";
export const FRAMES_PACK = "srd-frames";
export const DOCUMENT = "Daggerheart SRD 2.0";

export function src(page: number, pageEnd?: number): Source {
  return { kind: "srd", document: DOCUMENT, page, ...(pageEnd && pageEnd !== page ? { pageEnd } : {}) };
}
