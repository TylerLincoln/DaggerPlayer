// Bundled content packs. Pack metadata loads eagerly; entry data is split per type and loaded on demand.
import type { Entry, EntryType, PackMeta } from "../../content/schema/index.ts";

const metas = import.meta.glob<PackMeta>("/content/*/pack.json", { eager: true, import: "default" });
const data = import.meta.glob<Entry[]>("/content/*/data/*.json", { import: "default" });

export const bundledPacks: PackMeta[] = Object.values(metas);

/** Load entries of the given packs (all types, or one type). */
export async function loadEntries(packIds: string[], type?: EntryType): Promise<Entry[]> {
  const files = Object.entries(data).filter(([path]) => {
    const m = path.match(/^\/content\/([^/]+)\/data\/([^/]+)\.json$/);
    return m && packIds.includes(metas[`/content/${m[1]}/pack.json`]?.id ?? "") && (!type || m[2] === type);
  });
  return (await Promise.all(files.map(([, load]) => load()))).flat();
}
