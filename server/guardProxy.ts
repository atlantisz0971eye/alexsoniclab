import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { ScanError } from "./errors.ts";
import { checkUrlShape, resolvePublic } from "./urlGuard.ts";

/**
 * A forward proxy that each scan's browser context must use for all of its traffic. It is the SSRF guard at the
 * network layer: for every connection the page opens (the page itself, redirects, scripts, images, iframes, fetches,
 * WebSockets) it checks the host, resolves it, refuses private answers, and connects to the address it checked, so
 * DNS rebinding has nothing to race. HTTPS passes through as an opaque tunnel, so the site sees real Chrome.
 * It also enforces the scan's budget: connections and bytes.
 */

export const REFUSED_HEADER = "x-scan-guard";

export type ProxyStats = { connections: number; bytes: number; blocked: number; blockedHosts: string[] };
export type GuardProxy = { server: string; stats: ProxyStats; close: () => Promise<void> };

export async function startGuardProxy(budget: { maxConnections: number; maxBytes: number }): Promise<GuardProxy> {
  const stats: ProxyStats = { connections: 0, bytes: 0, blocked: 0, blockedHosts: [] };
  const sockets = new Set<net.Socket>();
  let overBudget = false;

  const count = (bytes: number) => {
    stats.bytes += bytes;
    if (stats.bytes > budget.maxBytes && !overBudget) {
      overBudget = true;
      for (const socket of sockets) socket.destroy();
    }
  };
  const block = (host: string) => {
    stats.blocked += 1;
    if (stats.blockedHosts.length < 20 && !stats.blockedHosts.includes(host)) stats.blockedHosts.push(host);
  };
  const admit = () => {
    if (overBudget || stats.connections >= budget.maxConnections) return false;
    stats.connections += 1;
    return true;
  };
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  };

  /** Checks a destination and returns the address to connect to. */
  const guard = async (url: URL) => {
    checkUrlShape(url);
    const [first] = await resolvePublic(url.hostname.replace(/^\[|\]$/g, ""));
    return first.address;
  };

  // Plain http:// requests arrive with an absolute URL.
  const server = http.createServer(async (request, response) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "");
      if (url.protocol !== "http:") throw new ScanError("bad_scheme");
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (!admit()) {
      response.writeHead(429).end();
      return;
    }
    let address: string;
    try {
      address = await guard(url);
    } catch {
      block(url.hostname);
      // Marked, so the scan can tell the guard's refusal from a site's own 403.
      response.writeHead(403, { [REFUSED_HEADER]: "private" }).end();
      return;
    }
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = http.request(
      { host: address, port: url.port || 80, path: `${url.pathname}${url.search}`, method: request.method, headers: { ...headers, host: url.host }, agent: false },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.on("data", (chunk: Buffer) => count(chunk.length));
        reply.pipe(response);
      },
    );
    upstream.on("socket", track);
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });

  // https:// (and WebSockets) arrive as CONNECT host:port and become a tunnel to the checked address.
  server.on("connect", async (request: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    track(client);
    const target = request.url ?? "";
    let url: URL;
    try {
      const port = target.split(":").pop();
      url = new URL(`${port === "80" || port === "8080" ? "http" : "https"}://${target}`);
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    if (!admit()) {
      client.end("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      return;
    }
    let address: string;
    try {
      address = await guard(url);
    } catch {
      block(url.hostname);
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = net.connect({ host: address, port: Number(url.port || 443) });
    track(upstream);
    upstream.setTimeout(20_000, () => upstream.destroy());
    upstream.on("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.on("data", (chunk: Buffer) => count(chunk.length));
      client.on("data", (chunk: Buffer) => count(chunk.length));
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });

  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    server: `http://127.0.0.1:${port}`,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
