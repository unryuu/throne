import { Analytics } from "./analytics.ts";
import { readPasscodes } from "./passcodes.ts";
import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCourtHandler } from "./court-handler.ts";
import { CourtService } from "./court-service.ts";
import { createAuth, readAuthSecrets } from "./standalone-auth.ts";
import { runsDirectory } from "@throne/agent-runtime/live";

const mime: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};
const missing = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

export function createStandaloneServer(options: {
  readonly root: string;
  readonly signingKey: string;
  readonly origin: string;
  readonly court?: CourtService;
  readonly now?: () => number;
}) {
  const origin = new URL(options.origin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== options.origin
  )
    throw new Error(
      "THRONE_PUBLIC_ORIGIN must be an http(s) origin without a trailing slash",
    );
  const analytics = new Analytics(options.root, options.now);
  const authenticate = createAuth({ ...options, analytics });
  const court = createCourtHandler(
    options.court ??
      new CourtService(options.root, undefined, undefined, analytics),
  );
  const dist = resolve(options.root, "apps/web/dist");
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    try {
      // nginx must overwrite forwarded headers; the configured origin is authoritative.
      if (
        req.headers.host !== origin.host ||
        (req.headers["x-forwarded-proto"] !== undefined &&
          req.headers["x-forwarded-proto"] !== origin.protocol.slice(0, -1))
      ) {
        res.writeHead(400).end("Unexpected host or forwarded protocol");
        return;
      }
      const path = new URL(req.url ?? "/", origin).pathname;
      const identity = await authenticate(req, res, path);
      if (!identity) return;
      if (
        (req.headers.origin && req.headers.origin !== origin.origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        res.writeHead(403).end("Cross-site requests are not allowed");
        return;
      }
      if (path === "/api/court" || path.startsWith("/api/court/")) {
        await court(req, res, path.slice("/api/court".length), identity);
        return;
      }
      if (path.startsWith("/api/")) {
        res.writeHead(404).end("Not found");
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
        return;
      }
      let name = decodeURIComponent(path);
      if (name === "/") {
        try {
          await stat(resolve(dist, "desk.html"));
          name = "/desk.html";
        } catch (error) {
          if (!missing(error)) throw error;
          name = "/index.html";
        }
      }
      if (
        name.includes("\0") ||
        name.split(/[\\/]/).some((part) => part.startsWith("."))
      ) {
        res.writeHead(404).end("Not found");
        return;
      }
      const [base, file] = await Promise.all([
        realpath(dist),
        realpath(resolve(dist, `.${name}`)),
      ]);
      if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      const contents = await readFile(file);
      res.setHeader(
        "Content-Type",
        mime[extname(file)] ?? "application/octet-stream",
      );
      res.setHeader("Content-Length", contents.length);
      res.end(req.method === "HEAD" ? undefined : contents);
    } catch (error) {
      const status = missing(error)
        ? 404
        : error instanceof URIError
          ? 400
          : 500;
      if (status === 500) console.error("Standalone request failed:", error);
      if (!res.headersSent)
        res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(status === 500 ? "Internal server error" : "Not found");
    }
  });
  server.requestTimeout = 60000; // Receiving the request body, not model response time.
  server.setTimeout(0);
  return server;
}

export async function startStandalone() {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be 1–65535");
  runsDirectory(root);
  await readPasscodes(root);
  const server = createStandaloneServer({
    root,
    ...(await readAuthSecrets(root)),
    origin: process.env.THRONE_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.log(`Throne listening on http://127.0.0.1:${port}`);
  const stop = () => {
    server.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await startStandalone();
