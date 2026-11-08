import type { PlayerId, SonicStyle } from "../data/sonicStyles";
import type { ScanRow } from "./scanPage";
import { signalsOf, type Source } from "./sonicSignals";

/**
 * The five players of alexsonicLAb. Each reads one source of the bar of rows (by default its own: edges, text,
 * titles, media, links; rewired on the deck for a remix) and decides what its instrument plays on one sixteenth.
 * The style says how. The drums are the clock and belong to no player.
 */

export type Hit =
  | { voice: "kick" }
  | { voice: "clap" }
  | { voice: "snare"; gain: number }
  | { voice: "hat"; player: "typist"; open: boolean }
  | { voice: "click"; player: "typist" }
  | { voice: "ghost"; player: "typist" }
  | { voice: "bass"; player: "architect"; freq: number; accent: boolean; slide: boolean }
  | { voice: "stab"; player: "headliner"; freqs: number[] }
  | { voice: "pad"; player: "photographer"; freqs: number[]; brightness: number }
  | { voice: "blip"; player: "linker"; freq: number };

export const hitPlayer = (hit: Hit): PlayerId | null => ("player" in hit ? hit.player : null);

export type Routes = Record<PlayerId, Source>;
export const DEFAULT_ROUTES: Routes = { architect: "edges", typist: "text", headliner: "titles", photographer: "media", linker: "links" };

/** What the players need besides the rows: who reads what, and which columns have been carved out. */
export type Wiring = { routes: Routes; carved: Set<number>; carveVersion: number };

// Each section keeps its own mode: darkest for technology, a little light for the gallery.
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MODE: Record<string, number[]> = { top: PHRYGIAN, tian: PHRYGIAN, ren: AEOLIAN, di: DORIAN, development: PHRYGIAN, gallery: DORIAN, workbench: AEOLIAN, bio: DORIAN };

const note = (root: number, scale: number[], degree: number, octave = 0) => {
  const d = ((degree % scale.length) + scale.length) % scale.length;
  const o = Math.floor(degree / scale.length) + octave;
  return root * Math.pow(2, (scale[d] + 12 * o) / 12);
};

/** Everything that sounds on sixteenth `s` of the bar. */
export function compose(style: SonicStyle, bar: ScanRow[], s: number, wiring: Wiring): Hit[] {
  if (!bar.length) return [];
  const hits: Hit[] = [];
  const row = bar[s % bar.length];
  const previous = bar[(s + bar.length - 1) % bar.length];
  const scale = MODE[row.section] ?? AEOLIAN;
  const read = (r: ScanRow, player: PlayerId) => signalsOf(r, wiring.carved, wiring.carveVersion)[wiring.routes[player]];
  // Gaps between sections read as empty rows: in most styles the drums drop out there and the bar is a breakdown.
  const breakdown = style.breakdown && bar.filter((r) => r.empty).length > bar.length * 0.6;
  const busy = bar.some((r) => r.textDensity > 0);

  // The clock.
  if (!breakdown && style.kick.includes(s)) hits.push({ voice: "kick" });
  if (!breakdown && busy && style.snare.includes(s)) hits.push(style.snareVoice === "clap" ? { voice: "clap" } : { voice: "snare", gain: 1 });

  // Typist: how much of the row its source fills is the rhythm.
  const typing = read(row, "typist").amount;
  if (style.typist === "hats") {
    if (s % 2 === 1 && typing > style.textGate) hits.push({ voice: "hat", player: "typist", open: false });
    if (s % 4 === 2 && typing > style.textGate * 5) hits.push({ voice: "hat", player: "typist", open: true });
  } else if (style.typist === "breaks") {
    if (s % 2 === 0 && typing > style.textGate) hits.push({ voice: "hat", player: "typist", open: false });
    if ([3, 7, 9, 11, 15].includes(s) && typing > style.textGate * 4 && (s + row.index) % 2 === 0) hits.push({ voice: "ghost", player: "typist" });
  } else if (typing > style.textGate && (s + row.index) % 3 === 0) {
    hits.push({ voice: "click", player: "typist" });
  }

  // Architect: how many positions its source has on the row and where the first one sits pick the bass note.
  const built = read(row, "architect");
  const dense = style.bass.every === 1;
  if (built.event && (s % style.bass.every === 0 || (dense && built.cols.length > 1))) {
    const degree = built.cols.length * 2 + ((built.cols[0] ?? 0) % 7) + Math.round(built.amount * 10);
    const accent = row.heading || row.links > 0 || row.sectionStart;
    const before = read(previous, "architect");
    const slide = before.event && before.cols.some((col) => built.cols.includes(col));
    hits.push({ voice: "bass", player: "architect", freq: note(style.root, scale, degree, style.bass.octave + (row.heading ? 1 : 0)), accent, slide });
  }

  // Headliner: a chord wherever its source happens.
  const headline = read(row, "headliner");
  if (headline.event && s % 2 === 0) {
    const degree = headline.cols.length + 2;
    hits.push({ voice: "stab", player: "headliner", freqs: [0, 2, 4].map((step) => note(style.root, scale, degree + step, style.stab.octave)) });
  }

  // Photographer: once a bar, a held chord whose brightness follows how much of the bar its source fills.
  if (s === 0) {
    const amount = bar.reduce((sum, r) => sum + read(r, "photographer").amount, 0) / bar.length;
    if (style.pad.always || amount > 0.04) {
      const degree = (read(bar[0], "photographer").cols.length + bar.length) % 7;
      hits.push({ voice: "pad", player: "photographer", freqs: [0, 2, 4, 6].map((step) => note(style.root, scale, degree + step, 2)), brightness: Math.min(1, 0.25 + amount * 3) });
    }
  }

  // Linker: a short ping on the off-beats wherever its source happens.
  const linked = read(row, "linker");
  if (linked.event && s % 2 === 1) hits.push({ voice: "blip", player: "linker", freq: note(style.root, scale, linked.cols.length * 2 + Math.round(linked.amount * 8) + s, style.blip.octave) });

  return hits;
}
