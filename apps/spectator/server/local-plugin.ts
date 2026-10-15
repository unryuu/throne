import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import { listLocalRuns, readChronicle } from "./local-runs.ts";
import { Storyteller } from "./storyteller.ts";

export function assertLocalRequest(req: IncomingMessage): void {
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host))
    throw new Error("Local host required");
  if (req.headers.origin && req.headers.origin !== `http://${host}`)
    throw new Error("Cross-site requests are not allowed");
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new Error("Cross-site requests are not allowed");
  if (
    req.method === "POST" &&
    !req.headers.origin &&
    req.headers["x-throne-client"] !== "local"
  )
    throw new Error("Local client header required");
}
export function localRunsPlugin(root: string): Plugin {
  const storyteller = new Storyteller(root);
  return {
    name: "spectator-local-runs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/local-runs", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        try {
          assertLocalRequest(req);
          const parts = (req.url ?? "/")
            .split("?")[0]!
            .split("/")
            .filter(Boolean);
          const [id, action] = parts;
          let result: unknown;
          if (parts.length > 2) throw new Error("Unknown local route");
          if (req.method === "GET" && !id) result = await listLocalRuns(root);
          else if (req.method === "GET" && id && !action) {
            const chronicle = await readChronicle(root, id);
            // Story errors must not prevent reading the chronicle.
            let storyError: string | undefined;
            const story = await storyteller.cached(chronicle).catch((error) => {
              storyError = String(error);
              return undefined;
            });
            result = { chronicle, story, storyError };
          } else if (req.method === "POST" && id && action === "story")
            result = await storyteller.generate(id);
          else throw new Error("Unknown local route");
          res.end(JSON.stringify(result));
        } catch (error) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    },
  };
}
