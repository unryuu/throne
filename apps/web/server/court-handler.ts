import type { Visitor } from "./passcodes.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  courtSettingsSchema,
  type AudienceAction,
  type RescriptSubmission,
} from "@throne/court";
import type { CourtService } from "./court-service.ts";
async function readJson(
  req: IncomingMessage,
  limit: number,
): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON body required");
  let text = "";
  for await (const chunk of req) {
    text += chunk.toString();
    if (text.length > limit) throw new Error("Request too large");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export function createCourtHandler(court: CourtService) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    attribution?: Visitor,
  ) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      const [id, action] = path.split("?")[0]!.split("/").filter(Boolean);
      let result: unknown;
      if (req.method === "POST") {
        const body = await readJson(req, 65536);
        if (!id && (body.locale === "zh-CN" || body.locale === "en")) {
          if (
            body.seed !== undefined &&
            (typeof body.seed !== "string" || !body.seed.trim())
          )
            throw new Error("Seed must be a nonempty string");
          if (
            body.excludePackIds !== undefined &&
            (!Array.isArray(body.excludePackIds) ||
              !body.excludePackIds.every((value) => typeof value === "string"))
          )
            throw new Error("excludePackIds must be an array of strings");
          if (
            body.operationId !== undefined &&
            typeof body.operationId !== "string"
          )
            throw new Error("operationId must be a string");
          result = await court.create(
            body.locale,
            courtSettingsSchema.parse(body.settings ?? {}),
            {
              ...(attribution ? { attribution } : {}),
              ...(Array.isArray(body.excludePackIds) &&
              body.excludePackIds.every((id) => typeof id === "string")
                ? { excludePackIds: body.excludePackIds as string[] }
                : {}),
              ...(typeof body.seed === "string" ? { seed: body.seed } : {}),
              ...(typeof body.operationId === "string"
                ? { operationId: body.operationId }
                : {}),
            },
          );
        } else if (id && action === "rescript" && body.submission)
          result = await court.submit(
            id,
            body.submission as RescriptSubmission,
            attribution,
          );
        else if (id && action === "act" && body.action)
          result = await court.act(
            id,
            String(body.audienceId),
            body.action as AudienceAction,
            attribution,
          );
        else if (id && action === "retry")
          result = await court.retry(id, attribution);
        else throw new Error("Invalid court request");
      } else if (req.method === "GET" && id) {
        if (id === "progress" && action)
          result = { busy: court.busyMessages(action) };
        else if (action === "review") result = await court.review(id);
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
  };
}
