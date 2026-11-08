import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ScanError } from "./errors.ts";

/**
 * The SSRF guard. A URL may be read only if it is http(s) on a normal port, has no credentials, and every address
 * its host resolves to is a public unicast address. The same check runs again for every redirect and for every
 * request the page makes, and the connection itself is pinned to an address that passed (see safeFetch).
 */

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp"];

/** Parse what a visitor typed into a URL, adding https:// when there is no scheme. */
export function normalizeUrl(input: string): URL {
  const raw = input.trim();
  if (!raw || raw.length > 2048) throw new ScanError("bad_url");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new ScanError("bad_url");
  }
  url.hash = "";
  return url;
}

/** The checks that need no DNS: scheme, credentials, port and obviously internal names. */
export function checkUrlShape(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ScanError("bad_scheme");
  if (url.username || url.password) throw new ScanError("bad_url");
  if (!ALLOWED_PORTS.has(url.port)) throw new ScanError("bad_port");
  const host = hostOf(url);
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) throw new ScanError("private_address");
  // A bare name without a dot is a machine on some local network.
  if (!isIP(host) && !host.includes(".")) throw new ScanError("private_address");
  if (isIP(host) && !isPublicAddress(host)) throw new ScanError("private_address");
}

/** The host without IPv6 brackets or a trailing dot. */
export function hostOf(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** Resolve a host and return its addresses, refusing it if any of them is not public. */
export async function resolvePublic(host: string): Promise<{ address: string; family: 4 | 6 }[]> {
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new ScanError("private_address");
    return [{ address: host, family: isIP(host) as 4 | 6 }];
  }
  let records: { address: string; family: number }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ScanError("unresolvable");
  }
  if (!records.length) throw new ScanError("unresolvable");
  // One private answer is enough to refuse: a host that resolves to both is a rebinding trick or a misconfiguration.
  if (records.some((record) => !isPublicAddress(record.address))) throw new ScanError("private_address");
  return records.map((record) => ({ address: record.address, family: record.family === 6 ? 6 : 4 }));
}

/** Everything about a URL that can be checked before connecting. */
export async function checkUrl(url: URL) {
  checkUrlShape(url);
  return resolvePublic(hostOf(url));
}

// ---------- address classification ----------

type Range = [bigint, number]; // network, prefix length

const v4 = (text: string): bigint => text.split(".").reduce((n, part) => (n << 8n) | BigInt(Number(part)), 0n);
const v4Range = (cidr: string): Range => {
  const [net, bits] = cidr.split("/");
  return [v4(net), Number(bits)];
};

/** Not public: this network, private, CGNAT, loopback, link-local (cloud metadata), protocol, docs, benchmark, multicast, reserved. */
const V4_BLOCKED: Range[] = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24",
  "192.0.2.0/24", "192.31.196.0/24", "192.52.193.0/24", "192.88.99.0/24", "192.168.0.0/16", "192.175.48.0/24",
  "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
].map(v4Range);

function v6(text: string): bigint {
  let address = text.toLowerCase().split("%")[0];
  // An IPv4 tail (::ffff:1.2.3.4) becomes two hextets.
  const tail = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4(tail[1]);
    address = address.slice(0, -tail[1].length) + `${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const [head, rest] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const fill = address.includes("::") ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array(fill).fill("0"), ...right];
  if (parts.length !== 8) throw new Error(`bad IPv6 address ${text}`);
  return parts.reduce((n, part) => (n << 16n) | BigInt(parseInt(part || "0", 16)), 0n);
}
const v6Range = (cidr: string): Range => {
  const [net, bits] = cidr.split("/");
  return [v6(net), Number(bits)];
};

/** Not public: unspecified, loopback, IPv4-mapped/translated (checked as IPv4), discard, docs, ULA, link-local, site-local, multicast. */
const V6_BLOCKED: Range[] = [
  "::/128", "::1/128", "100::/64", "2001:db8::/32", "fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8",
  // Teredo and ORCHID hide or invent addresses; 6to4 wraps an IPv4 address.
  "2001::/32", "2001:10::/28", "2001:20::/28",
].map(v6Range);

const inRange = (value: bigint, [net, bits]: Range, width: number) => {
  const shift = BigInt(width - bits);
  return value >> shift === net >> shift;
};

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const n = v4(address);
    return !V4_BLOCKED.some((range) => inRange(n, range, 32));
  }
  if (family !== 6) return false;
  let n: bigint;
  try {
    n = v6(address);
  } catch {
    return false;
  }
  // IPv4 inside IPv6 is judged as the IPv4 address it carries: mapped (::ffff:0:0/96), compatible (::/96),
  // NAT64 (64:ff9b::/96 and 64:ff9b:1::/48) and 6to4 (2002::/16).
  const embedded = (value: bigint) => {
    const text = [24n, 16n, 8n, 0n].map((s) => Number((value >> s) & 0xffn)).join(".");
    return isPublicAddress(text);
  };
  if (inRange(n, v6Range("::ffff:0:0/96"), 128) || inRange(n, v6Range("::/96"), 128)) return n > 1n && embedded(n & 0xffffffffn);
  if (inRange(n, v6Range("64:ff9b::/96"), 128) || inRange(n, v6Range("64:ff9b:1::/48"), 128)) return embedded(n & 0xffffffffn);
  if (inRange(n, v6Range("2002::/16"), 128)) return embedded((n >> 80n) & 0xffffffffn);
  return !V6_BLOCKED.some((range) => inRange(n, range, 128));
}
