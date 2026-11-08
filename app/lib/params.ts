import type { PlayerId } from "../data/sonicStyles.ts";
import type { LabSettings } from "./labSettings.ts";

/**
 * Every parameter of the standalone site in one table: its URL key, its layer, its values and its default.
 * The same table drives the address bar, the server's whitelist and cache key, and the SETUP and PARAMS panels.
 *
 * Layers: "scan" changes how the server reads the page (so it needs a new scan and is a cache key); "map", "sound"
 * and "perform" act in the browser at once.
 */

export type Layer = "scan" | "map" | "sound" | "perform";
export type Choice = { value: string; label: string };
export type Param =
  | { key: string; layer: Layer; label: string; kind: "choice"; choices: Choice[]; fallback: string; hint?: string }
  | { key: string; layer: Layer; label: string; kind: "range"; min: number; max: number; step: number; fallback: string; hint?: string };

const choices = (...items: (string | [string, string])[]): Choice[] => items.map((item) => (Array.isArray(item) ? { value: item[0], label: item[1] } : { value: item, label: item.toUpperCase() }));
/** "" means: whatever the style says. */
const STYLE = ["", "STYLE"] as [string, string];

export const PARAMS: Param[] = [
  // A · reading, on the server
  { key: "w", layer: "scan", label: "WIDTH", kind: "choice", choices: choices(["390", "390 PHONE"], ["1280", "1280"], ["1920", "1920 WIDE"]), fallback: "1280", hint: "viewport the page is laid out at" },
  { key: "dark", layer: "scan", label: "DARK", kind: "choice", choices: choices(["0", "OFF"], ["1", "ON"]), fallback: "0", hint: "render with prefers-color-scheme: dark" },
  { key: "clean", layer: "scan", label: "CLEAN", kind: "choice", choices: choices(["0", "OFF"], ["1", "ON"]), fallback: "0", hint: "hide cookie and consent banners" },
  { key: "wait", layer: "scan", label: "WAIT", kind: "choice", choices: choices("fast", "normal", "patient"), fallback: "normal", hint: "how long lazy content gets to load" },
  { key: "h", layer: "scan", label: "DEPTH", kind: "choice", choices: choices(["10000", "10K"], ["30000", "30K"], ["60000", "60K"]), fallback: "30000", hint: "how far down the page is read, px" },
  { key: "lang", layer: "scan", label: "LANG", kind: "choice", choices: choices("en", "zh", "ja", "de", "fr", "es"), fallback: "en", hint: "Accept-Language and locale" },

  // B · mapping the page to rows
  { key: "row", layer: "map", label: "ROW", kind: "choice", choices: choices(["10", "10PX"], ["20", "20PX"], ["40", "40PX"]), fallback: "20", hint: "page height per row: smaller is denser" },
  { key: "dir", layer: "map", label: "DIRECTION", kind: "choice", choices: choices(["down", "↓ DOWN"], ["up", "↑ UP"]), fallback: "down" },
  { key: "kinds", layer: "map", label: "READ", kind: "choice", choices: choices(["all", "ALL"], ["text,heading", "WORDS"], ["card,section", "BOXES"], ["media", "IMAGES"], ["link", "LINKS"], ["card,section,media", "NO WORDS"]), fallback: "all" },
  { key: "cols", layer: "map", label: "COLUMNS", kind: "choice", choices: choices(["auto", "AUTO"], ["80", "80"], ["120", "120"], ["160", "160"]), fallback: "auto" },

  // C · sound
  { key: "bpm", layer: "sound", label: "BPM", kind: "range", min: 0, max: 170, step: 1, fallback: "0", hint: "0 = the style's tempo" },
  { key: "swing", layer: "sound", label: "SWING", kind: "range", min: -0.01, max: 0.6, step: 0.01, fallback: "-0.01", hint: "below 0 = the style's swing" },
  { key: "root", layer: "sound", label: "KEY", kind: "choice", choices: choices(STYLE, ["55", "A"], ["65.41", "C"], ["73.42", "D"], ["82.41", "E"], ["87.31", "F"], ["98", "G"]), fallback: "" },
  { key: "drums", layer: "sound", label: "DRUMS", kind: "choice", choices: choices(STYLE, ["four", "FOUR"], ["broken", "BROKEN"], ["half", "HALF"]), fallback: "" },
  { key: "breakdown", layer: "sound", label: "BREAKS", kind: "choice", choices: choices(STYLE, ["1", "DROP"], ["0", "STEADY"]), fallback: "", hint: "kick drops out between sections" },
  { key: "typist", layer: "sound", label: "TYPIST", kind: "choice", choices: choices(STYLE, "hats", "breaks", "clicks"), fallback: "" },
  { key: "arch", layer: "sound", label: "ARCHITECT", kind: "range", min: -0.01, max: 1, step: 0.01, fallback: "-0.01", hint: "bass level · below 0 = style mix" },
  { key: "typ", layer: "sound", label: "TYPIST LVL", kind: "range", min: -0.01, max: 1, step: 0.01, fallback: "-0.01" },
  { key: "head", layer: "sound", label: "HEADLINER", kind: "range", min: -0.01, max: 1, step: 0.01, fallback: "-0.01" },
  { key: "photo", layer: "sound", label: "PHOTOGRAPHER", kind: "range", min: -0.01, max: 1, step: 0.01, fallback: "-0.01" },
  { key: "link", layer: "sound", label: "LINKER", kind: "range", min: -0.01, max: 1, step: 0.01, fallback: "-0.01" },
  { key: "delay", layer: "sound", label: "DELAY", kind: "range", min: 0, max: 1, step: 0.01, fallback: "0.5" },
  { key: "reverb", layer: "sound", label: "REVERB", kind: "range", min: 0, max: 1, step: 0.01, fallback: "0.5" },
  { key: "filter", layer: "sound", label: "FILTER", kind: "choice", choices: choices(["narrow", "NARROW"], ["mid", "MID"], ["wide", "WIDE"]), fallback: "mid", hint: "range scrolling opens" },
  { key: "sens", layer: "sound", label: "SENSITIVITY", kind: "range", min: 0.25, max: 3, step: 0.05, fallback: "1", hint: "how much scroll speed opens the filter" },

  // D · performing
  { key: "auto", layer: "perform", label: "AUTO", kind: "choice", choices: choices(["0", "OFF"], ["40", "SLOW"], ["120", "MID"], ["300", "FAST"]), fallback: "0", hint: "reads by itself, page px per second" },
  { key: "axis", layer: "perform", label: "HEAD", kind: "range", min: 0.15, max: 0.6, step: 0.01, fallback: "0.4", hint: "read head height on screen" },
  { key: "curve", layer: "perform", label: "XFADE", kind: "choice", choices: choices(["power", "SMOOTH"], ["linear", "LINEAR"], ["cut", "CUT"]), fallback: "power" },
  { key: "ink", layer: "perform", label: "INK", kind: "choice", choices: choices(["section", "SECTIONS"], ["green", "GREEN"], ["amber", "AMBER"]), fallback: "section" },
];

export const LAYERS: { id: Layer; title: string }[] = [
  { id: "scan", title: "A · READ (rescans)" },
  { id: "map", title: "B · MAP" },
  { id: "sound", title: "C · SOUND" },
  { id: "perform", title: "D · PERFORM" },
];

export type Values = Record<string, string>;
const byKey = new Map(PARAMS.map((param) => [param.key, param]));

/** A value that the table allows, or null. */
export function validValue(key: string, raw: string | null): string | null {
  const param = byKey.get(key);
  if (!param || raw === null) return null;
  if (param.kind === "choice") return param.choices.some((choice) => choice.value === raw) ? raw : null;
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= param.min && n <= param.max ? String(n) : null;
}

/** Every parameter's value from a query string: allowed values only, the rest at their defaults. */
export function readValues(search: URLSearchParams): Values {
  const values: Values = {};
  for (const param of PARAMS) values[param.key] = validValue(param.key, search.get(param.key)) ?? param.fallback;
  return values;
}

/** The parameters that differ from their defaults, in table order: a stable spelling for links and cache keys. */
export function writeValues(values: Values, layer?: Layer): [string, string][] {
  return PARAMS.filter((param) => (!layer || param.layer === layer) && values[param.key] !== undefined && values[param.key] !== param.fallback).map((param) => [param.key, values[param.key]]);
}

// ---------- A · what the server needs ----------

export type ScanOptions = { width: number; height: number; dark: boolean; clean: boolean; wait: "fast" | "normal" | "patient"; maxHeight: number; lang: string };

export function scanOptions(values: Values): ScanOptions {
  const width = Number(values.w);
  return {
    width,
    height: width === 390 ? 844 : width === 1920 ? 1080 : 800,
    dark: values.dark === "1",
    clean: values.clean === "1",
    wait: values.wait as ScanOptions["wait"],
    maxHeight: Number(values.h),
    lang: values.lang,
  };
}

// ---------- B, C, D · what the Lab needs ----------

const DRUMS: Record<string, { kick: number[]; snare: number[] }> = {
  four: { kick: [0, 4, 8, 12], snare: [4, 12] },
  broken: { kick: [0, 3, 6, 10, 11], snare: [4, 12, 15] },
  half: { kick: [0, 10], snare: [8] },
};
const FILTERS: Record<string, { min: number; max: number }> = { narrow: { min: 300, max: 2400 }, mid: { min: 380, max: 9580 }, wide: { min: 120, max: 16000 } };
const LEVEL_KEYS: [string, PlayerId][] = [["arch", "architect"], ["typ", "typist"], ["head", "headliner"], ["photo", "photographer"], ["link", "linker"]];

export function labSettings(values: Values): Partial<LabSettings> {
  const n = (key: string) => Number(values[key]);
  const levels: Partial<Record<PlayerId, number>> = {};
  for (const [key, player] of LEVEL_KEYS) if (n(key) >= 0) levels[player] = n(key);
  return {
    rowPx: n("row"),
    reverse: values.dir === "up",
    kinds: values.kinds === "all" ? null : (values.kinds.split(",") as LabSettings["kinds"]),
    cols: values.cols === "auto" ? null : n("cols"),
    axis: n("axis"),
    autoScroll: n("auto"),
    ink: values.ink as LabSettings["ink"],
    curve: values.curve as LabSettings["curve"],
    filter: FILTERS[values.filter],
    sensitivity: n("sens"),
    sends: values.delay === "0.5" && values.reverb === "0.5" ? null : { delay: n("delay"), reverb: n("reverb") },
    levels: Object.keys(levels).length ? levels : null,
    sound: {
      ...(n("bpm") > 0 ? { bpm: Math.max(60, n("bpm")) } : {}),
      ...(n("swing") >= 0 ? { swing: n("swing") } : {}),
      ...(values.root ? { root: n("root") } : {}),
      ...(values.drums ? DRUMS[values.drums] : {}),
      ...(values.breakdown ? { breakdown: values.breakdown === "1" } : {}),
      ...(values.typist ? { typist: values.typist as "hats" | "breaks" | "clicks" } : {}),
    },
  };
}
