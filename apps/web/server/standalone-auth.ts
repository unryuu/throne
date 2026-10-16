import { readPasscodes, type Passcode, type Visitor } from "./passcodes.ts";
import type { Analytics } from "./analytics.ts";
import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

const cookieName = "throne_session";
const lifetime = 180 * 24 * 60 * 60;
const digest = (value: string) => createHash("sha256").update(value).digest();
const page = (message = "") =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>入宫</title><body style="max-width:22rem;margin:20vh auto;padding:1rem;font-family:system-ui"><h1>入宫</h1><form method="post" action="/auth/login"><label>口令 <input name="password" type="password" autocomplete="current-password" required autofocus style="font-size:1rem;max-width:100%"></label><p><button type="submit">进入</button></p></form><p>${message}</p></body></html>`;

export async function readAuthSecrets(root: string) {
  const read = async (name: string, file: string) => {
    const value = (
      process.env[name] ?? (await readFile(join(root, "secret", file), "utf8"))
    ).trim();
    if (!value) throw new Error(`${name} is empty`);
    return value;
  };
  return {
    signingKey: await read("THRONE_COOKIE_SECRET", "cookie-secret.txt"),
  };
}

export function createAuth(options: {
  readonly root: string;
  readonly analytics: Analytics;
  readonly signingKey: string;
  readonly origin: string;
  readonly now?: () => number;
}) {
  if (Buffer.byteLength(options.signingKey) < 32)
    throw new Error("A cookie signing secret of at least 32 bytes is required");
  const now = options.now ?? Date.now;
  const sign = (payload: string, code: string) =>
    createHmac("sha256", options.signingKey)
      .update(digest(code))
      .update(payload)
      .digest("base64url");
  let failures: number[] = [];
  const show = (res: ServerResponse, status: number, message = "") => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(page(message));
  };
  const valid = (
    req: IncomingMessage,
    passcodes: readonly Passcode[],
  ): Visitor | undefined => {
    const token = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!token || token.length > 2048) return;
    const [payload, signature, extra] = token.split(".");
    if (
      !payload ||
      !signature ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
      extra !== undefined
    )
      return;
    let session: { expiry: number; channel: string; visitor: string };
    try {
      session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return;
    }
    if (
      !session ||
      !Number.isSafeInteger(session.expiry) ||
      typeof session.channel !== "string" ||
      typeof session.visitor !== "string" ||
      !/^[a-f0-9-]{36}$/.test(session.visitor)
    )
      return;
    const seconds = Math.floor(now() / 1000);
    if (session.expiry <= seconds || session.expiry > seconds + lifetime)
      return;
    const passcode = passcodes.find(
      (p) => p.enabled && p.label === session.channel,
    );
    if (
      !passcode ||
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(sign(payload, passcode.code)),
      )
    )
      return;
    return { channel: session.channel, visitor: session.visitor };
  };
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<Visitor | undefined> => {
    const passcodes = await readPasscodes(options.root);
    const failure = async (reason: string) =>
      options.analytics.record({ type: "auth.failure", reason });
    if (path === "/auth/login" && req.method === "POST") {
      if (
        (req.headers.origin && req.headers.origin !== options.origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        await failure("cross-site");
        show(res, 403, "请求来源不符。");
        return;
      }
      if (
        !req.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        await failure("invalid-form");
        show(res, 400, "请使用口令表单。");
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) {
          await failure("too-large");
          show(res, 413, "口令过长。");
          return;
        }
      }
      failures = failures.filter((t) => t > now() - 60000);
      if (failures.length >= 5) {
        await failure("throttled");
        res.setHeader("Retry-After", "60");
        show(res, 429, "尝试过多，请一分钟后再试。");
        return;
      }
      const candidate = digest(new URLSearchParams(body).get("password") ?? "");
      const passcode = passcodes.find(
        (p) => p.enabled && timingSafeEqual(candidate, digest(p.code)),
      );
      if (!passcode) {
        failures.push(now());
        await failure("invalid-code");
        show(res, 401, "口令不对。");
        return;
      }
      failures = [];
      const identity = {
        channel: passcode.label,
        visitor: valid(req, passcodes)?.visitor ?? randomUUID(),
      };
      await options.analytics.record({ type: "auth.login", ...identity });
      const payload = Buffer.from(
        JSON.stringify({
          ...identity,
          expiry: Math.floor(now() / 1000) + lifetime,
        }),
      ).toString("base64url");
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=${payload}.${sign(payload, passcode.code)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime}${options.origin.startsWith("https:") ? "; Secure" : ""}`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(303, { Location: "/" });
      res.end();
      return;
    }
    const identity = valid(req, passcodes);
    if (identity) return identity;
    show(res, 401);
    return;
  };
}
