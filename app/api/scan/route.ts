import { NextResponse, type NextRequest } from "next/server";
import { ScanError } from "../../../server/errors.ts";
import { allowScan, cached, remember } from "../../../server/limits.ts";
import { scanUrl } from "../../../server/scan.ts";
import { normalizeUrl } from "../../../server/urlGuard.ts";
import { PARAMS, scanOptions, validValue, writeValues, type Values } from "../../lib/params.ts";

/**
 * GET /api/scan?url=https://example.com
 * Answers with { ok: true, snapshot, stats } (geometry only, never HTML) or { ok: false, code, message }.
 * A good answer is cached by Vercel's CDN for an hour, keyed by the normalized URL.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel: rendering a heavy page can take half a minute; cold starts add a few seconds.
export const maxDuration = 60;

const fail = (error: ScanError, headers: Record<string, string> = {}) =>
  NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: { "cache-control": "no-store", ...headers } });

const clientIp = (request: NextRequest) => request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = normalizeUrl(input);
  } catch (error) {
    return fail(error instanceof ScanError ? error : new ScanError("bad_url"));
  }
  // Reading settings: only the values the site offers. Anything else in the query is ignored.
  const values: Values = {};
  for (const param of PARAMS.filter((p) => p.layer === "scan")) {
    const raw = request.nextUrl.searchParams.get(param.key);
    const value = raw === null ? param.fallback : validValue(param.key, raw);
    if (value === null) return fail(new ScanError("bad_param", param.key));
    values[param.key] = value;
  }
  // One spelling per page and settings (defaults left out, fixed order), so the CDN and the cache see one key.
  const query = new URLSearchParams([["url", url.href], ...writeValues(values, "scan")]).toString();
  if (request.nextUrl.search.slice(1) !== query) {
    const canonical = new URL(request.nextUrl);
    canonical.search = `?${query}`;
    return NextResponse.redirect(canonical, 308);
  }
  const key = query;

  const hit = cached(key);
  if (hit) return NextResponse.json({ ok: true, snapshot: hit, cached: true }, { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });

  const allowed = allowScan(clientIp(request));
  if (!allowed.ok) return fail(new ScanError("rate_limited"), { "retry-after": String(allowed.retryAfter) });

  try {
    const { snapshot, stats } = await scanUrl(url, scanOptions(values));
    remember(key, snapshot);
    console.info(`scan ok ${url.host} ${writeValues(values, "scan").map((pair) => pair.join("=")).join("&")} ${stats.ms}ms ${stats.connections} conns ${(stats.bytes / 1048576).toFixed(1)}MB ${stats.boxes} boxes ${stats.height}px blocked=${stats.blocked}`);
    return NextResponse.json({ ok: true, snapshot, stats }, { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    const scanError = error instanceof ScanError ? error : new ScanError("internal", String(error));
    console.warn(`scan ${scanError.code} ${url.host} ${scanError.detail ?? ""}`);
    // A site that blocks bots or needs a login will say the same for a while: let the CDN remember that briefly.
    const remembered: Record<string, string> = scanError.code === "blocked" || scanError.code === "login" ? { "cache-control": "public, s-maxage=300" } : {};
    return fail(scanError, remembered);
  }
}
