import type { DeckState } from "../components/SonicDeck";

/**
 * A performance in alexsonicLAb, as data: where the read head started, the deck at the start, and every move
 * after it with its time. Packed into a link (deflated, base64url, in the hash so it never reaches a server),
 * it replays the same scan, and so the same music, on another screen of the same width.
 */

export type PerformanceEvent =
  | [number, "y", number] // read head position
  | [number, "deck", DeckState]
  | [number, "load", number] // bars captured into deck A, 0 = eject
  | [number, "xfade", number] // crossfader, 0 = deck A, 1 = deck B
  | [number, "roll", number] // roll length in sixteenths, 0 = release
  | [number, "pixel", PixelMode]
  | [number, "carve", number[]];

export type PixelMode = "normal" | "sort" | "melt";
export type Performance = { v: 1; width: number; y0: number; deck: DeckState; events: PerformanceEvent[] };

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

export async function encodePerformance(performance: Performance) {
  const json = new TextEncoder().encode(JSON.stringify(performance));
  if (typeof CompressionStream === "undefined") return `j${toBase64Url(json)}`;
  return `z${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}`;
}

export async function decodePerformance(packed: string): Promise<Performance | null> {
  try {
    const bytes = fromBase64Url(packed.slice(1));
    const json = packed[0] === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
    const data = JSON.parse(new TextDecoder().decode(json));
    return data?.v === 1 && Array.isArray(data.events) ? (data as Performance) : null;
  } catch {
    return null;
  }
}
