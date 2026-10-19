import { Analytics, analyticsPath, readAnalytics } from "./analytics.ts";
import { readPasscodes } from "./passcodes.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { requestInProcess } from "./http-test.ts";
import { createServer as createViteServer } from "vite";
import { createStandaloneServer } from "./standalone.ts";
import { readAuthSecrets } from "./standalone-auth.ts";
import { CourtService } from "./court-service.ts";
import { livePlugin } from "./live-plugin.ts";
import { saveOpeningPack, listOpeningPacks } from "./opening-pack-store.ts";
import { courtSettingsSchema } from "@throne/court";
import { cachedCall, runsDirectory } from "@throne/agent-runtime/live";

const servers = new Map<string, Server>();
async function fetchHttp(url: string, init: RequestInit = {}) {
  const server = servers.get(new URL(url).origin);
  if (!server) throw new Error("No test server mounted");
  return requestInProcess(server, url, init);
}

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
  servers.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function mount(server: Server) {
  const origin = `http://127.0.0.1:${4100 + servers.size}`;
  servers.set(origin, server);
  return origin;
}
async function setup(secure = false) {
  const root = await mkdtemp(join(tmpdir(), "standalone-"));
  const dist = join(root, "apps/web/dist");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "index.html"), "legacy index");
  await writeFile(join(dist, "app.js"), "asset");
  await mkdir(join(root, "secret"));
  await writeFile(
    join(root, "secret/passcodes.json"),
    JSON.stringify([{ code: "test-password", label: "测试", enabled: true }]),
  );
  let time = Date.now();
  const court = new CourtService(
    root,
    undefined,
    undefined,
    new Analytics(root, () => time),
  );
  const get = vi
    .spyOn(court, "get")
    .mockResolvedValue({ id: "saved", status: "waiting" } as never);
  const origin = `${secure ? "https" : "http"}://game.example`;
  const config = {
    root,
    signingKey: "s".repeat(32),
    origin,
    court,
    now: () => time,
  };
  const url = await mount(createStandaloneServer(config));
  const request = (path: string, init: RequestInit = {}) =>
    fetchHttp(url + path, {
      ...init,
      redirect: "manual",
      headers: { Host: "game.example", ...init.headers },
    });
  const login = (password = "test-password") =>
    request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password }),
    });
  return {
    root,
    dist,
    request,
    login,
    get,
    config,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("standalone boundary", () => {
  it("gates every page, asset and API, accepts a signed persistent cookie and rejects tampering/expiry", async () => {
    const s = await setup(true);
    for (const path of [
      "/",
      "/index.html",
      "/app.js",
      "/api/court/saved",
      "/api/live/old",
    ]) {
      const response = await s.request(path);
      expect(response.status).toBe(401);
      expect(await response.text()).toContain('type="password"');
    }
    expect(
      (
        await s.request("/api/court/saved/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect(s.get).not.toHaveBeenCalled();
    const logged = await s.login();
    expect(logged.status).toBe(303);
    const setCookie = logged.headers.get("set-cookie")!;
    expect(setCookie).toContain(
      "HttpOnly; SameSite=Lax; Max-Age=15552000; Secure",
    );
    expect(setCookie).not.toContain("test-password");
    const cookie = setCookie.split(";")[0]!;
    expect(
      await (await s.request("/", { headers: { Cookie: cookie } })).text(),
    ).toBe("legacy index");
    expect(
      await (
        await s.request("/api/court/saved", { headers: { Cookie: cookie } })
      ).json(),
    ).toMatchObject({ id: "saved" });
    expect(
      (await s.request("/api/live/old", { headers: { Cookie: cookie } }))
        .status,
    ).toBe(404);
    expect(
      (
        await s.request("/api/court/saved", {
          headers: { Cookie: cookie + "x" },
        })
      ).status,
    ).toBe(401);
    const retry = vi
      .spyOn(s.config.court, "retry")
      .mockResolvedValue({ id: "saved" } as never);
    const post = {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    };
    expect((await s.request("/api/court/saved/retry", post)).status).toBe(200);
    expect(
      (
        await s.request("/api/court/saved/retry", {
          ...post,
          headers: { ...post.headers, Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(retry).toHaveBeenCalledOnce();
    await writeFile(
      join(s.root, "secret/passcodes.json"),
      JSON.stringify([{ code: "changed", label: "测试", enabled: true }]),
    );
    expect((await s.request("/", { headers: { Cookie: cookie } })).status).toBe(
      401,
    );
    await writeFile(
      join(s.root, "secret/passcodes.json"),
      JSON.stringify([{ code: "test-password", label: "测试", enabled: true }]),
    );
    const restarted = await mount(createStandaloneServer(s.config));
    expect(
      (
        await fetchHttp(restarted + "/", {
          headers: { Host: "game.example", Cookie: cookie },
        })
      ).status,
    ).toBe(200);
    s.advance(181 * 86400000);
    expect((await s.request("/", { headers: { Cookie: cookie } })).status).toBe(
      401,
    );
  });

  it("prefers desk.html and confines static files to the build directory", async () => {
    const s = await setup();
    const logged = await s.login();
    expect(logged.headers.get("set-cookie")).not.toContain("Secure");
    const headers = {
      Cookie: logged.headers.get("set-cookie")!.split(";")[0]!,
    };
    expect(await (await s.request("/", { headers })).text()).toBe(
      "legacy index",
    );
    await writeFile(join(s.dist, "desk.html"), "mobile desk");
    expect(await (await s.request("/", { headers })).text()).toBe(
      "mobile desk",
    );
    await writeFile(join(s.root, "private.txt"), "secret");
    await symlink(join(s.root, "private.txt"), join(s.dist, "leak.txt"));
    for (const path of [
      "/leak.txt",
      "/.env",
      "/%2e%2e%2fprivate.txt",
      "/missing.js",
    ])
      expect((await s.request(path, { headers })).status).toBe(404);
    expect((await s.request("/", { method: "HEAD", headers })).status).toBe(
      200,
    );
    expect(
      (
        await s.request("/", {
          headers: { ...headers, Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.request("/", {
          headers: { ...headers, "X-Forwarded-Proto": "https" },
        })
      ).status,
    ).toBe(400);
  });

  it("accepts shared-link page navigation while retaining cross-site API and login rejection", async () => {
    const s = await setup(true);
    const logged = await s.login();
    const headers = {
      Cookie: logged.headers.get("set-cookie")!.split(";")[0]!,
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
    };
    expect((await s.request("/", { headers })).status).toBe(200);
    expect((await s.request("/", { method: "HEAD", headers })).status).toBe(
      200,
    );
    expect((await s.request("/api/court/saved", { headers })).status).toBe(403);
    expect(
      (
        await s.request("/auth/login", {
          method: "POST",
          headers,
          body: "password=test-password",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.request("/", {
          headers: {
            ...headers,
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
          },
        })
      ).status,
    ).toBe(403);
  });

  it("throttles wrong passwords globally and rejects cross-site login", async () => {
    const s = await setup();
    for (let i = 0; i < 5; i++)
      expect((await s.login("wrong")).status).toBe(401);
    const blocked = await s.login();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    s.advance(60001);
    expect((await s.login()).status).toBe(303);
    expect(
      (
        await s.request("/auth/login", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });

  it("loads explicit secrets, fails closed on missing/empty configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "secrets-"));
    await expect(readAuthSecrets(root)).rejects.toThrow();
    await mkdir(join(root, "secret"));
    await writeFile(join(root, "secret/cookie-secret.txt"), "k".repeat(32));
    expect((await readAuthSecrets(root)).signingKey).toBe("k".repeat(32));
    vi.stubEnv("THRONE_COOKIE_SECRET", "from-env");
    expect((await readAuthSecrets(root)).signingKey).toBe("from-env");
    vi.stubEnv("THRONE_COOKIE_SECRET", "");
    await expect(readAuthSecrets(root)).rejects.toThrow("empty");
    await expect(readPasscodes(root)).rejects.toThrow("Cannot read");
  });
});

it("uses the same court routes in Vite while retaining localhost and local POST checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "vite-routes-"));
  const get = vi
    .spyOn(CourtService.prototype, "get")
    .mockResolvedValue({ id: "saved" } as never);
  const retry = vi
    .spyOn(CourtService.prototype, "retry")
    .mockResolvedValue({ id: "retried" } as never);
  const vite = await createViteServer({
    configFile: false,
    root,
    plugins: [livePlugin(root)],
    server: { middlewareMode: true, hmr: false, ws: false, allowedHosts: true },
  });
  cleanup.push(() => vite.close());
  const base = await mount(
    createServer((req, res) =>
      vite.middlewares(req, res, () => res.end("Not found")),
    ),
  );
  expect(
    await (await fetchHttp(base + "/api/court/saved?test=1")).json(),
  ).toEqual({
    id: "saved",
  });
  expect(get).toHaveBeenCalledWith("saved");
  for (const headers of [
    { Host: "game.example" },
    { Origin: "https://evil.example" },
  ]) {
    expect(
      (await fetchHttp(base + "/api/court/saved", { headers })).status,
    ).toBe(400);
  }
  const post = {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
  };
  expect((await fetchHttp(base + "/api/court/saved/retry", post)).status).toBe(
    400,
  );
  for (const extra of [{ "X-Throne-Client": "local" }, { Origin: base }]) {
    const response = await fetchHttp(base + "/api/court/saved/retry", {
      ...post,
      headers: { ...post.headers, ...extra },
    });
    expect(await response.json()).toEqual({ id: "retried" });
  }
  expect(retry).toHaveBeenCalledTimes(2);
});

it("stores court saves and opening packs under the configured persistent directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "persistent-root-"));
  const data = await mkdtemp(join(tmpdir(), "persistent-data-"));
  vi.stubEnv("THRONE_RUNS_DIR", data);
  const service = new CourtService(
    root,
    () => async () => JSON.stringify({ inner: "今日照常办差。" }),
  );
  const snapshot = await service.create(
    "zh-CN",
    courtSettingsSchema.parse({ summaries: false }),
  );
  expect(
    JSON.parse(
      await readFile(join(data, "court", `${snapshot.id}.json`), "utf8"),
    ).id,
  ).toBe(snapshot.id);
  expect((await new CourtService(root).get(snapshot.id)).id).toBe(snapshot.id);
  const pack = {
    version: 1 as const,
    id: "test",
    seed: "seed",
    settings: courtSettingsSchema.parse({}),
    locale: "zh-CN" as const,
    throughDay: 5,
    branches: [],
    complete: true,
  };
  await saveOpeningPack(root, pack);
  expect(await listOpeningPacks(root)).toEqual([pack]);
  let calls = 0;
  const request = {
    root,
    request: { deploymentTest: true },
    episode: "persistent-cache",
    onTrace: () => {},
    run: async (
      trace: Parameters<Parameters<typeof cachedCall>[0]["run"]>[0],
    ) => {
      calls++;
      trace({
        decisionEpisodeId: "persistent-cache",
        requestedProvider: "test",
        requestedModel: "test",
        returnedProvider: "test",
        returnedModel: "test",
        thinking: "enabled",
        reasoningEffort: "high",
        thinkingObserved: false,
        durationMs: 0,
        usage: null,
        status: "succeeded",
      });
      return "cached result";
    },
  };
  expect(await cachedCall(request)).toBe("cached result");
  expect(await cachedCall(request)).toBe("cached result");
  expect(calls).toBe(1);
  await expect(
    (await import("node:fs/promises")).readdir(join(data, "cache/calls")),
  ).resolves.toHaveLength(1);
  expect(runsDirectory(root)).toBe(data);
  vi.stubEnv("THRONE_RUNS_DIR", "relative-data");
  expect(runsDirectory(root)).toBe(join(root, "relative-data"));
});

it("hot-reloads channel codes, signs visitor identity, revokes disabled cookies and logs without secrets", async () => {
  const s = await setup();
  const codes = [
    { code: "alpha-password", label: "朋友圈", enabled: true },
    { code: "beta-password", label: "小红书", enabled: true },
  ];
  const path = join(s.root, "secret/passcodes.json");
  await writeFile(path, JSON.stringify(codes));
  const first = (await s.login("alpha-password")).headers
    .get("set-cookie")!
    .split(";")[0]!;
  const second = (await s.login("beta-password")).headers
    .get("set-cookie")!
    .split(";")[0]!;
  const decode = (cookie: string) =>
    JSON.parse(
      Buffer.from(cookie.split("=")[1]!.split(".")[0]!, "base64url").toString(),
    );
  expect(decode(first)).toMatchObject({ channel: "朋友圈" });
  expect(decode(second)).toMatchObject({ channel: "小红书" });
  expect(decode(first).visitor).not.toBe(decode(second).visitor);
  const again = await s.request("/auth/login", {
    method: "POST",
    headers: {
      Cookie: first,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "password=alpha-password",
  });
  expect(decode(again.headers.get("set-cookie")!.split(";")[0]!).visitor).toBe(
    decode(first).visitor,
  );
  await writeFile(
    path,
    JSON.stringify([{ ...codes[0], enabled: false }, codes[1]]),
  );
  expect((await s.request("/", { headers: { Cookie: first } })).status).toBe(
    401,
  );
  expect((await s.request("/", { headers: { Cookie: second } })).status).toBe(
    200,
  );
  expect((await s.login("alpha-password")).status).toBe(401);
  await writeFile(
    path,
    JSON.stringify([{ ...codes[0], code: "new-password" }, codes[1]]),
  );
  expect((await s.request("/", { headers: { Cookie: first } })).status).toBe(
    401,
  );
  const events = await readAnalytics(analyticsPath(s.root));
  expect(events.filter((e) => e.type === "auth.login")).toHaveLength(3);
  expect(events.filter((e) => e.type === "auth.failure")).toEqual([
    expect.objectContaining({ reason: "invalid-code" }),
  ]);
  const raw = await readFile(analyticsPath(s.root), "utf8");
  for (const secret of ["alpha-password", "beta-password", "127.0.0.1"])
    expect(raw).not.toContain(secret);
  await writeFile(path, "{broken");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await s.request("/", { headers: { Cookie: second } })).status).toBe(
    500,
  );
  expect(errors).toHaveBeenCalled();
});

it("returns the channel budget error before any model call at the opening API", async () => {
  const s = await setup();
  await writeFile(
    join(s.root, "secret/passcodes.json"),
    JSON.stringify([
      { code: "test-password", label: "测试", enabled: true, maxRunsPerDay: 0 },
    ]),
  );
  const cookie = (await s.login()).headers.get("set-cookie")!.split(";")[0]!;
  const model = vi.spyOn(s.config.court, "model");
  const response = await s.request("/api/court", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "zh-CN" }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "今日国库已空" });
  expect(model).not.toHaveBeenCalled();
});
