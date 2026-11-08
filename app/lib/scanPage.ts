/**
 * Reads a page as boxes in page coordinates: every heading, line of text, card, media element and section edge.
 * A scan row is then a thin horizontal band of the page: the boxes it crosses become ASCII cells (edges as lines,
 * text as its own letters, media as density) and musical features.
 *
 * The snapshot is a plain object, so the Lab can play one read from the page under it (the portfolio) or one read
 * from another site in a headless browser on a server (the standalone alexsonicLAb). `snapshotPage` is written to
 * run on its own inside any page: it uses nothing from outside its body, so a server can inject its source text.
 */

export type BoxKind = "section" | "card" | "heading" | "text" | "link" | "media";
export type ScanBox = { kind: BoxKind; top: number; bottom: number; left: number; right: number; text: string; section: string; luma: number };
export type ScanSnapshot = {
  boxes: ScanBox[];
  height: number;
  width: number;
  sections: { id: string; top: number; bottom: number }[];
  /** Where a snapshot read elsewhere came from. */
  source?: { url: string; title: string; readAt: string };
};

/** What to read on a page. The defaults read the portfolio; `GENERIC_PAGE` reads any site. */
export type SnapshotOptions = {
  /** Named sections, looked up by id. When empty, landmarks matching `sectionSelector` are the sections. */
  sectionIds: string[];
  sectionSelector: string;
  cardSelector: string;
  /** Also count as cards the boxes a page draws with a border, a shadow or a filled rounded background. */
  detectCards: boolean;
  /** Media to leave out (full-section background canvases would fill everything). */
  skipMedia: string;
  maxLines: number;
  /** Nothing below this many pixels is read. */
  maxHeight: number;
  /** The most letters kept per line of text. */
  maxText: number;
};

export const PORTFOLIO_PAGE: SnapshotOptions = {
  sectionIds: ["tian", "ren", "di", "development", "gallery", "workbench", "bio"],
  sectionSelector: "",
  cardSelector: [
    ".portfolio-glass-card",
    ".gallery-glass-card",
    ".project-card",
    ".workbench-cut",
    ".workbench-row",
    ".card",
    "header.section-head",
    ".section-head",
  ].join(","),
  detectCards: false,
  skipMedia: ".gallery-veins, .workbench-mill, .dev-signal",
  maxLines: 6000,
  maxHeight: Infinity,
  maxText: 400,
};

export const GENERIC_PAGE: SnapshotOptions = {
  sectionIds: [],
  sectionSelector: "header, nav, main, section, article, aside, footer, [role=banner], [role=main], [role=contentinfo]",
  cardSelector: ".card, [class*=card], li > article, figure, table, form, fieldset, blockquote, pre",
  detectCards: true,
  skipMedia: "",
  maxLines: 5000,
  maxHeight: 30000,
  maxText: 160,
};

/** Cell styles, drawn in different colours. */
export const Ink = { Blank: 0, Edge: 1, Text: 2, Heading: 3, Media: 4, Rule: 5, Link: 6 } as const;
type InkValue = (typeof Ink)[keyof typeof Ink];

export type ScanRow = {
  index: number;
  y: number;
  section: string;
  chars: string;
  inks: Uint8Array;
  /** Columns where a vertical edge crosses this row, left to right. */
  edges: number[];
  textDensity: number;
  heading: boolean;
  links: number;
  media: number;
  sectionStart: boolean;
  empty: boolean;
};

/** The page height covered by one scan row. */
export const ROW_PX = 20;

/** One pass over the DOM. Runs when the intro opens and again when the layout changes. */
export function snapshotPage(root: HTMLElement, options: SnapshotOptions = PORTFOLIO_PAGE): ScanSnapshot {
  // Everything this needs is defined in here, so the function's source can run inside another page.
  const scrollY = window.scrollY;
  const width = document.documentElement.clientWidth;
  const maxHeight = options.maxHeight;
  const boxes: ScanBox[] = [];
  const sections: ScanSnapshot["sections"] = [];
  const visible = (rect: DOMRect) => rect.width > 1 && rect.height > 1;
  const inRange = (rect: DOMRect) => rect.top + scrollY < maxHeight;
  const luminance = (colour: string) => {
    const match = colour.match(/\d+(\.\d+)?/g);
    if (!match) return 0.5;
    const [r, g, b] = match.map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const named = options.sectionIds.length > 0;
  const sectionOf = (element: Element) => (named ? element.closest("section[id]")?.id ?? "top" : "top");
  const push = (kind: BoxKind, rect: DOMRect, element: Element, text = "", luma = 0.5) => {
    boxes.push({ kind, top: rect.top + scrollY, bottom: rect.bottom + scrollY, left: Math.max(0, rect.left), right: Math.min(width, rect.right), text, section: sectionOf(element), luma });
  };

  if (named) {
    for (const id of options.sectionIds) {
      const element = document.getElementById(id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (!visible(rect)) continue;
      sections.push({ id, top: rect.top + scrollY, bottom: rect.bottom + scrollY });
      push("section", rect, element);
    }
  } else if (options.sectionSelector) {
    // Landmarks of any page: wide and tall enough to be a part of it, at least a few rows apart, at most 48.
    // A landmark is named by its first heading, its label, or a readable id (not a generated one), else its tag.
    const slug = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 16);
    const label = (element: Element) => {
      const heading = (element.querySelector("h1, h2, h3")?.textContent ?? "").trim();
      const id = /\d|^[a-z]{1,4}$/i.test(element.id) ? "" : element.id;
      for (const raw of [heading.length <= 40 ? heading : "", element.getAttribute("aria-label") ?? "", id, element.getAttribute("role") ?? "", element.tagName]) {
        const name = slug(raw);
        if (name) return name;
      }
      return "part";
    };
    let lastTop = -Infinity;
    const found = Array.from(root.querySelectorAll(options.sectionSelector))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width >= width * 0.5 && rect.height >= 160 && inRange(rect))
      .sort((a, b) => a.rect.top - b.rect.top);
    for (const { element, rect } of found) {
      const top = rect.top + scrollY;
      if (top - lastTop < 60 || sections.length >= 48) continue;
      lastTop = top;
      const id = label(element);
      sections.push({ id, top, bottom: Math.min(maxHeight, rect.bottom + scrollY) });
      boxes.push({ kind: "section", top, bottom: Math.min(maxHeight, rect.bottom + scrollY), left: 0, right: width, text: "", section: id, luma: 0.5 });
    }
  }

  const cards = new Set<Element>();
  root.querySelectorAll(options.cardSelector).forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (visible(rect) && inRange(rect)) {
      cards.add(element);
      push("card", rect, element);
    }
  });
  if (options.detectCards) {
    // A card is whatever the page draws as a box: a border, a shadow, or a filled background with rounded corners.
    const candidates = root.querySelectorAll("div, li, article, aside, figure, nav, header, footer, section, form, table");
    let found = 0;
    for (let i = 0; i < candidates.length && i < 8000 && found < 1500; i += 1) {
      const element = candidates[i];
      if (cards.has(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 40 || rect.width > width * 0.98 || !inRange(rect)) continue;
      const style = getComputedStyle(element);
      const border = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none" && !/rgba\(.*, 0\)|transparent/.test(style.borderTopColor);
      const shadow = style.boxShadow !== "none";
      const filled = parseFloat(style.borderTopLeftRadius) > 0 && !/rgba\(.*, 0\)|transparent/.test(style.backgroundColor);
      if (border || shadow || filled) {
        push("card", rect, element);
        found += 1;
      }
    }
  }

  root.querySelectorAll("img, video, canvas, svg").forEach((element) => {
    // Backgrounds drawn on full-section canvases would fill everything; leave them out.
    if (options.skipMedia && element.matches(options.skipMedia)) return;
    const rect = element.getBoundingClientRect();
    if (visible(rect) && rect.width > 24 && rect.height > 24 && inRange(rect)) push("media", rect, element, "", luminance(getComputedStyle(element).color));
  });

  root.querySelectorAll("a, button").forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (visible(rect) && inRange(rect) && (element.textContent ?? "").trim()) push("link", rect, element);
  });

  // Every line of text, with its own letters, so the scan shows what is really written there.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let lines = 0;
  for (let node = walker.nextNode(); node && lines < options.maxLines; node = walker.nextNode()) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    const parent = node.parentElement;
    if (!text || !parent || parent.closest("[aria-hidden='true'], script, style, noscript, template, .sr-only")) continue;
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((rect) => visible(rect) && inRange(rect));
    if (!rects.length) continue;
    const heading = !!parent.closest("h1, h2, h3");
    const total = rects.reduce((sum, rect) => sum + rect.width, 0);
    let offset = 0;
    for (const rect of rects) {
      // Share the node's letters among its line boxes by width: close enough for a scan.
      const count = Math.max(1, Math.round((rect.width / total) * text.length));
      push(heading ? "heading" : "text", rect, parent, text.slice(offset, offset + Math.min(count, options.maxText)));
      offset += count;
      lines += 1;
    }
  }

  // Without named sections, a box belongs to the last landmark that starts above it.
  if (!named && sections.length) {
    for (const box of boxes) {
      if (box.kind === "section") continue;
      let id = "top";
      for (const s of sections) if (box.top >= s.top && box.top < s.bottom) id = s.id;
      box.section = id;
    }
  }

  boxes.sort((a, b) => a.top - b.top);
  return { boxes, height: Math.min(maxHeight, document.documentElement.scrollHeight), width, sections };
}

const DENSITY = " .:-=+*#%@";

/** The ASCII and the features of one scan row of the page. */
export function readRow(snapshot: ScanSnapshot, index: number, cols: number): ScanRow {
  const y0 = index * ROW_PX;
  const y1 = y0 + ROW_PX;
  const chars = new Array<string>(cols).fill(" ");
  const inks = new Uint8Array(cols);
  const edgeSet = new Set<number>();
  const col = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor((x / snapshot.width) * cols)));
  const set = (c: number, ch: string, ink: InkValue) => {
    chars[c] = ch;
    inks[c] = ink;
  };

  const section = snapshot.sections.find((s) => y0 >= s.top && y0 < s.bottom)?.id ?? "top";
  let sectionStart = false;
  let heading = false;
  let links = 0;
  let mediaCells = 0;
  let textCells = 0;

  // The boxes are sorted by top; stop as soon as they start below this row.
  const crossing: ScanBox[] = [];
  for (const box of snapshot.boxes) {
    if (box.top >= y1) break;
    if (box.bottom > y0) crossing.push(box);
  }

  const order: BoxKind[] = ["media", "card", "link", "text", "heading", "section"];
  for (const kind of order) {
    for (const box of crossing) {
      if (box.kind !== kind) continue;
      const c0 = col(box.left);
      const c1 = col(box.right - 1);
      const startsHere = box.top >= y0 && box.top < y1;
      const endsHere = box.bottom > y0 && box.bottom <= y1;
      if (kind === "media") {
        // A full-width background (a theme video) is only hinted at with sparse dots, so it never drowns the rest.
        const backdrop = box.right - box.left > snapshot.width * 0.6;
        for (let c = c0; c <= c1; c += 1) {
          const n = Math.abs((Math.sin(c * 12.9898 + index * 78.233) * 43758.5453) % 1);
          if (backdrop) {
            if (n > 0.93) set(c, n > 0.985 ? ":" : "·", Ink.Media);
            continue;
          }
          set(c, DENSITY[Math.min(DENSITY.length - 1, Math.floor(n * 4 + box.luma * 5))], Ink.Media);
          mediaCells += 1;
        }
      } else if (kind === "card") {
        if (startsHere || endsHere) {
          for (let c = c0; c <= c1; c += 1) set(c, "─", Ink.Edge);
          set(c0, startsHere ? "┌" : "└", Ink.Edge);
          set(c1, startsHere ? "┐" : "┘", Ink.Edge);
        } else {
          set(c0, "│", Ink.Edge);
          set(c1, "│", Ink.Edge);
        }
        edgeSet.add(c0);
        edgeSet.add(c1);
      } else if (kind === "link") {
        links += 1;
        if (endsHere) for (let c = c0; c <= c1; c += 1) if (chars[c] === " ") set(c, "_", Ink.Link);
      } else if (kind === "text" || kind === "heading") {
        // A line of text belongs to the row its middle falls in, so each line is written once.
        const middle = (box.top + box.bottom) / 2;
        if (middle < y0 || middle >= y1) continue;
        // One letter per column, spread over the line's width: big type gets gaps, small type is sampled.
        const span = c1 - c0 + 1;
        const length = box.text.length;
        for (let i = 0; i < length; i += 1) {
          const ch = box.text[i];
          const c = c0 + Math.floor((i * span) / length);
          if (ch === " " || c > c1) continue;
          set(c, ch, kind === "heading" ? Ink.Heading : Ink.Text);
          textCells += 1;
        }
        if (kind === "heading") heading = true;
      } else if (kind === "section" && startsHere) {
        sectionStart = true;
        const label = ` §${box.section.toUpperCase()} `;
        for (let c = 0; c < cols; c += 1) set(c, "━", Ink.Rule);
        for (let i = 0; i < label.length && 4 + i < cols; i += 1) set(4 + i, label[i], Ink.Rule);
      }
    }
  }

  const edges = Array.from(edgeSet).sort((a, b) => a - b);
  return {
    index,
    y: y0,
    section,
    chars: chars.join(""),
    inks,
    edges,
    textDensity: textCells / cols,
    heading,
    links,
    media: mediaCells / cols,
    sectionStart,
    empty: !edges.length && !textCells && !mediaCells && !sectionStart,
  };
}
