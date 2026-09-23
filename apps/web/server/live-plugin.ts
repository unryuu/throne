import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import type { RescriptSubmission } from "@throne/court";
import { CourtService } from "./court-service.ts";
import { LiveService } from "./live-service.ts";

async function readLocalJson(
  req: IncomingMessage,
  limit: number,
): Promise<Record<string, unknown>> {
  if (!req.headers.origin && req.headers["x-throne-client"] !== "local")
    throw new Error("Local client header required");
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON body required");
  let text = "";
  for await (const chunk of req) {
    text += chunk.toString();
    if (text.length > limit) throw new Error("Request too large");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function assertLocal(req: IncomingMessage): string[] {
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host))
    throw new Error("Local host required");
  if (req.headers.origin && req.headers.origin !== `http://${host}`)
    throw new Error("Cross-site requests are not allowed");
  return (req.url ?? "/").split("?")[0]!.split("/").filter(Boolean);
}

export function livePlugin(root: string): Plugin {
  const service = new LiveService(root);
  const court = new CourtService(root);
  return {
    name: "throne-local-live",
    configureServer(server) {
      server.middlewares.use("/api/court", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        try {
          const [id, action] = assertLocal(req);
          let result: unknown;
          if (req.method === "POST") {
            const body = await readLocalJson(req, 65536);
            if (!id && (body.locale === "zh-CN" || body.locale === "en"))
              result = await court.create(body.locale);
            else if (id && action === "rescript" && body.submission)
              result = await court.submit(
                id,
                body.submission as RescriptSubmission,
              );
            else if (id && action === "retry") result = await court.retry(id);
            else throw new Error("Invalid court request");
          } else if (req.method === "GET" && id) {
            if (action === "review") result = await court.review(id);
            else if (action === "replay") result = await court.replay(id);
            else if (!action) result = await court.get(id);
            else throw new Error("Unknown court route");
          } else throw new Error("Unknown court route");
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
      server.middlewares.use("/api/live", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        try {
          const host = req.headers.host ?? "";
          if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host))
            throw new Error("Local host required");
          if (req.headers.origin && req.headers.origin !== `http://${host}`)
            throw new Error("Cross-site requests are not allowed");
          const parts = (req.url ?? "/")
            .split("?")[0]!
            .split("/")
            .filter(Boolean);
          const [id, action] = parts;
          let result: unknown;
          if (req.method === "POST") {
            if (
              !req.headers.origin &&
              req.headers["x-throne-client"] !== "local"
            )
              throw new Error("Local client header required");
            if (!req.headers["content-type"]?.startsWith("application/json"))
              throw new Error("JSON body required");
            let text = "";
            for await (const chunk of req) {
              text += chunk.toString();
              if (text.length > 16384) throw new Error("Request too large");
            }
            const body = JSON.parse(text) as Record<string, unknown>;
            if (!id && (body.locale === "zh-CN" || body.locale === "en"))
              result = await service.create(body.locale);
            else if (
              id &&
              action === "choice" &&
              typeof body.decisionEpisodeId === "string" &&
              (body.choice === "hold_imperial_palace" ||
                body.choice === "move_to_east_gate" ||
                body.choice === "maintain_deployment")
            )
              result = await service.choose(
                id,
                body.choice,
                body.decisionEpisodeId,
              );
            else if (id && action === "retry") result = await service.retry(id);
            else throw new Error("Invalid live request");
          } else if (req.method === "GET" && id) {
            if (action === "review") result = await service.review(id);
            else if (action === "replay") result = await service.replay(id);
            else if (!action) result = await service.get(id);
            else throw new Error("Unknown live route");
          } else throw new Error("Unknown live route");
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
