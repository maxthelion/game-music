/** A seeded random source: the same text always gives the same sequence of numbers in 0..1. */
export type Rand = () => number;

export function rng(text: string): Rand {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Frequency in cycles a second of a MIDI note number. */
export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
/** Positive remainder, so pitch classes of negative numbers still land in 0..11. */
export const mod = (n: number, m: number): number => ((n % m) + m) % m;
