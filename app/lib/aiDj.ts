import { PLAYERS, STYLES, type PlayerId, type StyleId } from "../data/sonicStyles.ts";
import type { ScanSnapshot } from "./scanPage.ts";
import type { Performance, PerformanceEvent, PixelMode } from "./sonicPerformance.ts";

/**
 * The AI DJ: a seeded random performance. From the page's shape (its sections and how dense they are) and a seed it
 * writes a set: how fast the read head travels through each part, style changes at section lines, loops captured
 * into deck A and crossfaded in, rolls, mutes, pixel modes and carves. The same seed on the same page always gives
 * the same set, so a seed is something to share; a new seed is a new set. Nothing is learned or sent anywhere.
 *
 * The set is an ordinary Performance, the format of the Lab's replay links, so the Lab plays it as it plays those.
 */

/** A small fast PRNG (mulberry32) seeded from any text. */
export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    range: (min: number, max: number) => min + next() * (max - min),
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)],
  };
}

export const newSeed = () => Math.random().toString(36).slice(2, 8);

type Part = { top: number; bottom: number; density: number; media: number };

/** The page cut into parts at its section lines (or every 1600px when it has none), with how busy each part is. */
function partsOf(snapshot: ScanSnapshot): Part[] {
  const lines = [0, ...snapshot.sections.map((s) => s.top).filter((top) => top > 200), snapshot.height].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    for (let y = lines[i]; y < lines[i + 1]; y += 1600) cuts.push(y);
  }
  cuts.push(snapshot.height);
  const parts: Part[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const [top, bottom] = [cuts[i], cuts[i + 1]];
    if (bottom - top < 80) continue;
    const inside = snapshot.boxes.filter((box) => box.top >= top && box.top < bottom);
    const words = inside.filter((box) => box.kind === "text" || box.kind === "heading").length;
    const media = inside.filter((box) => box.kind === "media").length;
    parts.push({ top, bottom, density: words / ((bottom - top) / 100), media });
  }
  return parts.length ? parts : [{ top: 0, bottom: snapshot.height, density: 1, media: 0 }];
}

export type SetOptions = {
  /** Roughly how long the set lasts, in seconds; the page is read once from top to bottom within it. */
  length?: number;
  /** Columns on screen, so carves land inside the field. */
  cols?: number;
};

export function generateSet(snapshot: ScanSnapshot, seed: string, options: SetOptions = {}): Performance {
  const r = rng(`${seed}|${snapshot.source?.url ?? ""}|${snapshot.height}`);
  const parts = partsOf(snapshot);
  const length = (options.length ?? 150) * 1000;
  const cols = options.cols ?? 120;
  const events: PerformanceEvent[] = [];
  const at = (t: number, ...event: PerformanceEvent extends [number, ...infer Rest] ? Rest : never) => events.push([Math.round(t), ...event] as PerformanceEvent);

  // Time per part: a share of the set, more for busy parts (more to hear), with some chance in it.
  const weights = parts.map((part) => (0.6 + Math.min(3, part.density) * 0.5 + Math.min(4, part.media) * 0.1) * r.range(0.7, 1.3) * Math.sqrt((part.bottom - part.top) / 800));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let style: StyleId = r.pick(STYLES).id;
  const opening = style;
  let t = 1200;
  let loaded = false;
  let pixel: PixelMode = "normal";
  const mutes = new Set<PlayerId>();

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const span = (weights[i] / total) * length;
    const start = t;

    // At a section line: maybe a new style (it comes in at the next bar), maybe a breakdown with players muted.
    if (i > 0 && r.chance(0.35)) {
      style = r.pick(STYLES.filter((s) => s.id !== style)).id;
      at(t, "deck", { style, pending: null });
    }
    if (r.chance(0.25)) {
      const player = r.pick(PLAYERS).id;
      if (mutes.has(player)) mutes.delete(player);
      else if (mutes.size < 2) mutes.add(player);
      at(t, "deck", { mutes: [...mutes], solos: [] });
    }

    // Travel through the part, sometimes pausing (the loop and the live deck carry on), sometimes rocking back.
    const steps = Math.max(4, Math.round(span / 100));
    let y = part.top;
    const pauseAt = r.chance(0.3) ? Math.floor(r.range(0.3, 0.7) * steps) : -1;
    const pauseFor = Math.round(r.range(8, 24));
    const rockAt = r.chance(0.25) ? Math.floor(r.range(0.4, 0.8) * steps) : -1;
    for (let k = 0; k <= steps; k += 1) {
      const tk = start + (k / steps) * span;
      if (k >= pauseAt && k < pauseAt + pauseFor && pauseAt >= 0) continue;
      const progress = Math.min(1, k / steps);
      y = part.top + (part.bottom - part.top) * progress;
      if (k >= rockAt && k < rockAt + 6 && rockAt >= 0) y -= Math.sin(((k - rockAt) / 6) * Math.PI) * 160;
      at(tk, "y", Math.round(Math.max(0, Math.min(snapshot.height - 1, y))));
    }

    // A loop: capture the last bars into deck A, bring it in with the crossfader, later take it out and eject.
    if (!loaded && span > 6000 && r.chance(0.45)) {
      const t0 = start + span * r.range(0.25, 0.5);
      at(t0, "load", r.pick([1, 2, 2, 4, 8]));
      const mix = r.range(0.25, 0.6);
      for (let k = 1; k <= 8; k += 1) at(t0 + k * 400, "xfade", Math.round((1 - (1 - mix) * (k / 8)) * 100) / 100);
      loaded = true;
    } else if (loaded && r.chance(0.6)) {
      const t0 = start + span * r.range(0.2, 0.6);
      for (let k = 1; k <= 8; k += 1) at(t0 + k * 450, "xfade", Math.round(Math.min(1, 0.4 + (0.6 * k) / 8) * 100) / 100);
      at(t0 + 4000, "load", 0);
      loaded = false;
    }

    // Near the end of the part: a roll into the next one.
    if (r.chance(0.4)) {
      const t0 = start + span - r.range(1200, 2600);
      at(t0, "roll", r.pick([4, 2, 1]));
      at(t0 + r.range(700, 1800), "roll", 0);
    }

    // Pixel modes now and then, back to normal after a while.
    if (r.chance(0.3)) {
      pixel = pixel === "normal" ? r.pick(["sort", "melt"] as const) : "normal";
      at(start + span * r.range(0.1, 0.6), "pixel", pixel);
    }

    // A carve: a few columns cut out of the page for a stretch, then put back.
    if (r.chance(0.2)) {
      const c = Math.floor(r.range(0.1, 0.9) * cols);
      const width = Math.floor(r.range(3, 14));
      const t0 = start + span * r.range(0.1, 0.5);
      at(t0, "carve", Array.from({ length: width }, (_, j) => c + j).filter((col) => col < cols));
      at(t0 + r.range(3000, 9000), "carve", []);
    }

    t = start + span;
  }

  // Close: everything back to plain, the loop out, the last row read.
  if (pixel !== "normal") at(t, "pixel", "normal");
  if (loaded) {
    at(t, "xfade", 1);
    at(t + 200, "load", 0);
  }
  if (mutes.size) at(t, "deck", { mutes: [], solos: [] });
  at(t + 400, "y", snapshot.height - 1);

  events.sort((a, b) => a[0] - b[0]);
  return { v: 1, width: typeof window === "undefined" ? 1280 : window.innerWidth, y0: 0, deck: { style: opening, pending: null, mutes: [], solos: [] }, events };
}
