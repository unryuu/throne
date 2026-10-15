import { spawn } from "node:child_process";
import { access, mkdir, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const windows = process.platform === "win32";
let child;
let stopping = false;
let cancelInput;

function stop() {
  stopping = true;
  cancelInput?.();
  if (!child?.pid) return;
  if (windows) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    killer.on("error", () => child?.kill());
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function run(command, args, cwd = root) {
  if (stopping) throw new Error("已退出");
  return new Promise((resolve, reject) => {
    const current = spawn(command, args, {
      cwd,
      stdio: ["ignore", "inherit", "inherit"],
      detached: !windows,
      // Only the fixed npx command uses cmd.exe; keys never enter a command line.
      shell: windows && command === "npx",
    });
    child = current;
    current.on("error", reject);
    current.on("close", (code, signal) => {
      child = undefined;
      if (stopping || code === 0) resolve();
      else reject(new Error(`进程退出（${signal ?? code}），请查看上方报错。`));
    });
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function readKey() {
  if (!process.stdin.isTTY)
    throw new Error("请在交互式终端运行 npm run play，以便隐藏输入密钥。");
  process.stdout.write("粘贴你的 DeepSeek key：");
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = process.stdin.isRaw;
    const finish = (error) => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      cancelInput = undefined;
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onEnd = () => finish(new Error("密钥输入已结束，请重新运行。"));
    const onData = (chunk) => {
      for (const c of chunk.toString("utf8")) {
        if (c === "\u0003" || c === "\u0004") {
          stopping = true;
          finish(new Error("已退出"));
          return;
        }
        if (c === "\r" || c === "\n") {
          finish();
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c === "\u0015") value = "";
        else if (c >= " " && value.length < 1024) value += c;
      }
    };
    cancelInput = () => finish(new Error("已退出"));
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error(
      "需要 Node.js 22.12 或以上，请从 https://nodejs.org/ 安装新版后再运行 npm run play。",
    );

  const dependencies = [
    "node_modules/.modules.yaml",
    "node_modules/tsx/package.json",
    "apps/web/node_modules/vite/package.json",
    "apps/web/node_modules/react/package.json",
    "packages/agent-runtime/node_modules/@deepseek-ai/dsh-sdk-client/package.json",
  ];
  if (
    !(
      await Promise.all(dependencies.map((path) => exists(join(root, path))))
    ).every(Boolean)
  ) {
    console.log("首次启动，正在安装依赖（npx -y pnpm@11.19.0 install）……");
    await run("npx", ["-y", "pnpm@11.19.0", "install"]);
  }
  if (stopping) return;

  const keyPath = join(root, "secret/deepseek.txt");
  if (process.env.DEEPSEEK_API_KEY !== undefined) {
    if (!process.env.DEEPSEEK_API_KEY.trim())
      throw new Error(
        "DEEPSEEK_API_KEY 是空的，请取消该环境变量或填入有效密钥。",
      );
  } else if (!(await exists(keyPath))) {
    let key;
    do {
      key = await readKey();
      if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(key))
        console.log("密钥格式不对：应为 sk- 开头的完整密钥，请重新粘贴。");
    } while (!/^sk-[A-Za-z0-9_-]{16,}$/.test(key));
    await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
    const file = await open(keyPath, "wx", 0o600);
    try {
      await file.writeFile(key + "\n");
    } finally {
      await file.close();
    }
    console.log("密钥已保存到 secret/deepseek.txt，以后无需再输入。");
  }
  if (stopping) return;

  const require = createRequire(join(root, "apps/web/package.json"));
  const vite = join(
    dirname(require.resolve("vite/package.json")),
    "bin/vite.js",
  );
  console.log(
    "正在启动嘉靖朝，浏览器将自动打开；地址见下方 Local，按 Ctrl+C 退出。",
  );
  await run(
    process.execPath,
    [vite, "--configLoader", "runner", "--open", "/"],
    join(root, "apps/web"),
  );
}

try {
  await main();
} catch (error) {
  if (!stopping) console.error(`启动失败：${error.message}`);
  process.exitCode = stopping ? 130 : 1;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  if (stopping) process.exitCode = 130;
}
