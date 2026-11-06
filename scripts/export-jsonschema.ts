// Writes content/schema/pack.schema.json: JSON Schema for a content pack file ({ meta, entries }),
// generated from the Zod schemas so homebrew authors and editors can validate packs.
// Usage: npm run content:jsonschema
import fs from "node:fs";
import { z } from "zod";
import { Pack } from "../content/schema/index.ts";

const schema = z.toJSONSchema(Pack, { target: "draft-2020-12", io: "input", reused: "ref" });
fs.writeFileSync("content/schema/pack.schema.json", JSON.stringify({ title: "DaggerPlayer content pack", ...schema }, null, 2) + "\n");
console.log("Wrote content/schema/pack.schema.json");
