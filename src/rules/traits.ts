// Trait assignment at character creation (SRD p. 4): +2, +1, +1, +0, +0, −1 in any order.
import { TRAITS, type Trait } from "../../content/schema/index.ts";

export const STARTING_TRAIT_VALUES = [2, 1, 1, 0, 0, -1] as const;

export type TraitAssignment = Record<Trait, number | null>;

/** Values still available to assign, in display order. */
export function remainingValues(t: TraitAssignment): number[] {
  const pool: number[] = [...STARTING_TRAIT_VALUES];
  for (const tr of TRAITS) {
    const v = t[tr];
    if (v === null) continue;
    const i = pool.indexOf(v);
    if (i !== -1) pool.splice(i, 1);
  }
  return pool;
}

/**
 * Put a value on a trait. If the value isn't free, it is taken from the trait that holds it, and that
 * trait gets this trait's old value (a swap), so the spread always stays legal.
 */
export function assignTrait(t: TraitAssignment, trait: Trait, value: number): TraitAssignment {
  const next = { ...t };
  const old = next[trait];
  if (!remainingValues(next).includes(value)) {
    const holder = TRAITS.find((x) => x !== trait && next[x] === value);
    if (!holder) throw new Error(`value ${value} is not part of the starting spread`);
    next[holder] = old;
  }
  next[trait] = value;
  return next;
}

export function clearTrait(t: TraitAssignment, trait: Trait): TraitAssignment {
  return { ...t, [trait]: null };
}

/** True when the six traits hold exactly +2, +1, +1, +0, +0, −1. */
export function isValidSpread(t: TraitAssignment): boolean {
  const vals = TRAITS.map((x) => t[x]);
  if (vals.some((v) => v === null)) return false;
  return [...(vals as number[])].sort((a, b) => b - a).join() === [...STARTING_TRAIT_VALUES].join();
}

export const formatMod = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "+0");
