import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
    password: await read("THRONE_PASSWORD", "password.txt"),
    signingKey: await read("THRONE_COOKIE_SECRET", "cookie-secret.txt"),
  };
}

export function createAuth(options: {
  readonly password: string;
  readonly signingKey: string;
  readonly origin: string;
  readonly now?: () => number;
}) {
  if (!options.password || Buffer.byteLength(options.signingKey) < 32)
    throw new Error(
      "A password and a cookie signing secret of at least 32 bytes are required",
    );
  const now = options.now ?? Date.now;
  const sign = (payload: string) =>
    createHmac("sha256", options.signingKey)
      .update(digest(options.password))
      .update(payload)
      .digest("base64url");
  let failures: number[] = [];
  const show = (res: ServerResponse, status: number, message = "") => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(page(message));
  };
  const valid = (req: IncomingMessage) => {
    const token = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!token) return false;
    const [expiry, signature, extra] = token.split(".");
    if (
      !expiry ||
      !signature ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
      extra !== undefined ||
      !/^\d+$/.test(expiry)
    )
      return false;
    const seconds = Math.floor(now() / 1000);
    if (Number(expiry) <= seconds || Number(expiry) > seconds + lifetime)
      return false;
    const expected = sign(expiry);
    return (
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  };
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<boolean> => {
    if (path === "/auth/login" && req.method === "POST") {
      if (
        (req.headers.origin && req.headers.origin !== options.origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        show(res, 403, "请求来源不符。");
        return false;
      }
      if (
        !req.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        show(res, 400, "请使用口令表单。");
        return false;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) {
          show(res, 413, "口令过长。");
          return false;
        }
      }
      failures = failures.filter((t) => t > now() - 60000);
      if (failures.length >= 5) {
        res.setHeader("Retry-After", "60");
        show(res, 429, "尝试过多，请一分钟后再试。");
        return false;
      }
      if (
        !timingSafeEqual(
          digest(new URLSearchParams(body).get("password") ?? ""),
          digest(options.password),
        )
      ) {
        failures.push(now());
        show(res, 401, "口令不对。");
        return false;
      }
      failures = [];
      const expiry = String(Math.floor(now() / 1000) + lifetime);
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=${expiry}.${sign(expiry)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime}${options.origin.startsWith("https:") ? "; Secure" : ""}`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(303, { Location: "/" });
      res.end();
      return false;
    }
    if (valid(req)) return true;
    show(res, 401);
    return false;
  };
}
