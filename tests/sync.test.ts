import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { Registry } from "../src/content/registry.ts";
import { Outbox, type OutboxItem } from "../src/data/outbox.ts";
import { CharacterDoc } from "../src/rules/character.ts";
import { compareCharacters } from "../src/rules/compare.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("outbox", () => {
  it("keeps items while sending fails and sends them in order once it works", async () => {
    const storage = memoryStorage();
    const box = new Outbox("t", storage);
    box.add("roll", "a", { n: 1 });
    box.add("roll", "b", { n: 2 });
    box.add("roll", "a", { n: 1 }); // duplicate id ignored
    expect(box.pending.map((i) => i.id)).toEqual(["a", "b"]);

    const offline = async () => { throw new Error("Failed to fetch"); };
    expect(await box.flush(offline)).toBe(0);
    expect(box.pending[0].attempts).toBe(1);

    // survives a reload
    const again = new Outbox("t", storage);
    expect(again.pending.map((i) => i.id)).toEqual(["a", "b"]);

    const sent: string[] = [];
    expect(await again.flush(async (i: OutboxItem) => void sent.push(i.id))).toBe(2);
    expect(sent).toEqual(["a", "b"]);
    expect(again.pending).toEqual([]);
  });

  it("stops at the first failure so order is preserved", async () => {
    const box = new Outbox("t2", memoryStorage());
    ["a", "b", "c"].forEach((id) => box.add("roll", id, {}));
    const sent: string[] = [];
    await box.flush(async (i) => { if (i.id === "b") throw new Error("Failed to fetch"); sent.push(i.id); });
    expect(sent).toEqual(["a"]);
    expect(box.pending.map((i) => i.id)).toEqual(["b", "c"]);
  });
});

describe("comparing two copies of a character", () => {
  const base = CharacterDoc.parse(JSON.parse(fs.readFileSync("docs/import/character-template.json", "utf8")));

  it("lists what differs, in table terms", () => {
    const other = structuredClone(base);
    other.state.hpMarked = 5;
    other.state.hope = 1;
    other.state.inventory = other.state.inventory.filter((i) => i.name !== "Whetstone");
    const diffs = compareCharacters(base, other, reg);
    expect(diffs.map((d) => d.label)).toEqual(["Hit Points marked", "Hope", "Inventory"]);
    expect(diffs[0]).toEqual({ label: "Hit Points marked", mine: "2 of 7", theirs: "5 of 7" });
  });

  it("finds nothing when the copies match", () => {
    expect(compareCharacters(base, structuredClone(base), reg)).toEqual([]);
  });

  it("notices a level-up made on the other device", () => {
    const other = structuredClone(base);
    other.levelUps = [];
    const diffs = compareCharacters(base, other, reg);
    expect(diffs.find((d) => d.label === "Level")).toEqual({ label: "Level", mine: "2", theirs: "1" });
  });
});
