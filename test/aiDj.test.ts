import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSet } from "../app/lib/aiDj.ts";
import type { ScanSnapshot } from "../app/lib/scanPage.ts";
import { labSettings, readValues, writeValues } from "../app/lib/params.ts";

// A page of three sections with some text, images and cards.
const snapshot: ScanSnapshot = {
  width: 1280,
  height: 6000,
  sections: [{ id: "intro", top: 0, bottom: 1800 }, { id: "work", top: 1800, bottom: 4200 }, { id: "about", top: 4200, bottom: 6000 }],
  boxes: Array.from({ length: 300 }, (_, i) => ({ kind: (["text", "heading", "media", "card", "link"] as const)[i % 5], top: i * 20, bottom: i * 20 + 18, left: 100, right: 900, text: "abc", section: "intro", luma: 0.5 })),
  source: { url: "https://example.com/", title: "Example", readAt: "2026-11-08T00:00:00Z" },
};

test("the same seed on the same page gives the same set; another seed gives another", () => {
  const a = generateSet(snapshot, "techno42", { cols: 120 });
  const b = generateSet(snapshot, "techno42", { cols: 120 });
  const c = generateSet(snapshot, "other", { cols: 120 });
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.deck, b.deck);
  assert.notDeepEqual(a.events, c.events);
});

test("a set is playable: sorted in time, the head stays on the page, and it reads to the end", () => {
  for (const seed of ["1", "2", "3", "abc", "zzz"]) {
    const set = generateSet(snapshot, seed, { cols: 120 });
    const times = set.events.map((e) => e[0]);
    assert.deepEqual(times, [...times].sort((x, y) => x - y));
    const ys = set.events.filter((e) => e[1] === "y").map((e) => e[2] as number);
    assert.ok(ys.every((y) => y >= 0 && y < snapshot.height), seed);
    assert.equal(ys.at(-1), snapshot.height - 1);
    for (const event of set.events.filter((e) => e[1] === "carve")) assert.ok((event[2] as number[]).every((c) => c >= 0 && c < 120));
    assert.ok(times.at(-1)! < 200_000);
  }
});

test("parameters round-trip through the URL and only offered values pass", () => {
  const values = readValues(new URLSearchParams("w=390&row=10&bpm=132&auto=120&kinds=media&evil=1&w2=x&dark=7"));
  assert.equal(values.w, "390");
  assert.equal(values.dark, "0"); // 7 is not offered
  assert.deepEqual(writeValues(values), [["w", "390"], ["row", "10"], ["kinds", "media"], ["bpm", "132"], ["auto", "120"]]);
  assert.deepEqual(writeValues(values, "scan"), [["w", "390"]]);
  const settings = labSettings(values);
  assert.equal(settings.rowPx, 10);
  assert.deepEqual(settings.kinds, ["media"]);
  assert.equal(settings.sound?.bpm, 132);
  assert.equal(settings.autoScroll, 120);
  assert.equal(settings.levels, null);
});
