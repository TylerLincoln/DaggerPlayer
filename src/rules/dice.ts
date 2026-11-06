// Dice. The random source is injectable so rules can be tested deterministically.
export type Rng = () => number; // [0, 1)

export const cryptoRng: Rng = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
};

export const rollDie = (sides: number, rng: Rng = cryptoRng) => 1 + Math.floor(rng() * sides);

export interface DiceRoll {
  expr: string;
  dice: { sides: number; value: number }[];
  bonus: number;
  total: number;
}

/** Roll an expression like "1d4+2", "2d6", "d8", "1d4+1" (one dice group and an optional flat bonus). */
export function roll(expr: string, rng: Rng = cryptoRng): DiceRoll {
  const m = expr.replace(/\s+/g, "").match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) throw new Error(`can't roll "${expr}"`);
  const count = Number(m[1] || 1);
  const sides = Number(m[2]);
  const dice = Array.from({ length: count }, () => ({ sides, value: rollDie(sides, rng) }));
  const bonus = Number(m[3] ?? 0);
  return { expr, dice, bonus, total: dice.reduce((s, d) => s + d.value, 0) + bonus };
}

/** Deterministic RNG for tests: returns the given die faces in order (face f of an n-sided die). */
export function scriptedRng(faces: { value: number; sides: number }[]): Rng {
  let i = 0;
  return () => {
    const f = faces[i++ % faces.length];
    return (f.value - 0.5) / f.sides;
  };
}
