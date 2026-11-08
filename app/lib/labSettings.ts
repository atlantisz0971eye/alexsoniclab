import type { PlayerId, SonicStyle } from "../data/sonicStyles";
import type { BoxKind } from "./scanPage";

/**
 * Everything about how the Lab reads, sounds and looks that a host page may change. The portfolio passes nothing
 * and gets DEFAULT_SETTINGS, which is exactly how the Lab has always behaved; the standalone site exposes these as
 * parameters. Every field is optional on the way in.
 */

export type InkMode = "section" | "green" | "amber";
export type CrossfadeCurve = "power" | "linear" | "cut";

/** Values that replace the playing style's own; anything left out keeps the style's value. */
export type SoundOverrides = Partial<Pick<SonicStyle, "bpm" | "swing" | "root" | "breakdown" | "typist" | "kick" | "snare">>;

export type LabSettings = {
  /** Page height covered by one scan row, in pixels. */
  rowPx: number;
  /** Read the page from the bottom up. */
  reverse: boolean;
  /** Which kinds of boxes are read; null reads all of them. */
  kinds: BoxKind[] | null;
  /** Characters across the field; null fits them to the screen. */
  cols: number | null;
  /** Where the read head sits, as a share of the screen height. */
  axis: number;
  /** Reads on its own at this many page pixels per second; 0 waits for scrolling. */
  autoScroll: number;
  ink: InkMode;
  sound: SoundOverrides;
  /** Player levels that replace the style's mix; null keeps the mix. */
  levels: Partial<Record<PlayerId, number>> | null;
  /** Delay and reverb sends (0.5 is the style's own amount); null keeps the deck's. */
  sends: { delay: number; reverb: number } | null;
  /** Range of the master filter that scanning speed opens, in Hz. */
  filter: { min: number; max: number };
  /** How strongly scanning speed opens the filter. */
  sensitivity: number;
  curve: CrossfadeCurve;
};

export const DEFAULT_SETTINGS: LabSettings = {
  rowPx: 20,
  reverse: false,
  kinds: null,
  cols: null,
  axis: 0.4,
  autoScroll: 0,
  ink: "section",
  sound: {},
  levels: null,
  sends: null,
  filter: { min: 380, max: 9580 },
  sensitivity: 1,
  curve: "power",
};

export const withSettings = (settings?: Partial<LabSettings>): LabSettings => ({ ...DEFAULT_SETTINGS, ...settings });

/** A style with the overrides applied. The style object itself is returned when there are none. */
export function applySound(style: SonicStyle, sound: SoundOverrides): SonicStyle {
  const keys = Object.keys(sound) as (keyof SoundOverrides)[];
  if (!keys.some((key) => sound[key] !== undefined)) return style;
  const next = { ...style };
  for (const key of keys) if (sound[key] !== undefined) (next as Record<string, unknown>)[key] = sound[key];
  return next;
}
