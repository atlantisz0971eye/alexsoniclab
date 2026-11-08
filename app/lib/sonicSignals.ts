import { Ink, type ScanRow } from "./scanPage";

/**
 * The page features a player can read. Each becomes the same three things for any row: the columns where it
 * occurs, how much of the row it fills, and whether it "happens" on the row. That shared shape is what lets any
 * player be wired to any source (a remix), and lets carved-out columns disappear from every source at once.
 */

export type Source = "edges" | "text" | "titles" | "media" | "links";
export const SOURCES: Source[] = ["edges", "text", "titles", "media", "links"];

export type Signal = { cols: number[]; amount: number; event: boolean };

const INKS: Record<Exclude<Source, "edges">, number[]> = {
  text: [Ink.Text, Ink.Heading],
  titles: [Ink.Heading],
  media: [Ink.Media],
  links: [Ink.Link],
};

const cache = new WeakMap<ScanRow, { version: number; signals: Record<Source, Signal> }>();

/** The signals of a row, leaving out the carved columns. Cached per row until the carving changes. */
export function signalsOf(row: ScanRow, carved: Set<number>, version: number): Record<Source, Signal> {
  const hit = cache.get(row);
  if (hit && hit.version === version) return hit.signals;
  const width = row.chars.length || 1;
  const keep = (c: number) => !carved.has(c);
  const edges = row.edges.filter(keep);
  const byInk = (inks: number[]) => {
    const cols: number[] = [];
    for (let c = 0; c < row.inks.length; c += 1) if (inks.includes(row.inks[c]) && keep(c)) cols.push(c);
    return cols;
  };
  const text = byInk(INKS.text);
  const titles = byInk(INKS.titles);
  const media = byInk(INKS.media);
  const links = byInk(INKS.links);
  // Long runs are thinned to every sixth column, so a line of text gives a handful of positions, not hundreds.
  const thin = (cols: number[]) => cols.filter((_, i) => i % 6 === 0);
  const signals: Record<Source, Signal> = {
    // Edges keep the meaning the bass always had: positions from the edges, an event on any row with content.
    edges: { cols: edges, amount: row.textDensity, event: !row.empty },
    text: { cols: thin(text), amount: text.length / width, event: text.length > 0 },
    titles: { cols: thin(titles), amount: titles.length / width, event: titles.length > 0 || row.sectionStart },
    media: { cols: thin(media), amount: media.length / width, event: media.length > width * 0.04 },
    links: { cols: links.length ? [links[0]] : [], amount: Math.min(1, row.links / 4), event: row.links > 0 },
  };
  cache.set(row, { version, signals });
  return signals;
}
