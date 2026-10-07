import type { JsonObject, JsonValue } from "@throne/shared-types";

/**
 * Fake terminal for the agent-shell experiment (FEAT-0009). The actor-visible
 * input becomes a read-only file tree; send and do queue the day's intents.
 * No imports beyond types: the harness plugin loads this file directly.
 */

export type ShellDocument = {
  readonly kind: string;
  readonly to?: readonly string[];
  readonly subject: string;
  readonly text: string;
};
export type ShellAction = {
  readonly capabilityId: string;
  readonly parameters: JsonObject;
  readonly description?: string;
};
export type ShellState = {
  readonly cwd: string;
  readonly commands: number;
  readonly documents: readonly ShellDocument[];
  readonly actions: readonly ShellAction[];
  /** Duty work: Yan Song's drafts, Lü Fang's dispositions and words, Lu Bing's routes. */
  readonly drafts?: readonly JsonObject[];
  readonly dispositions?: readonly JsonObject[];
  readonly routes?: readonly JsonObject[];
  readonly report?: string;
  readonly interrupt?: string;
  /** Scratch files the actor wrote under /tmp today. */
  readonly tmp?: Readonly<Record<string, string>>;
  /** Set by `end`; the day is over once it is. */
  readonly inner?: string;
};
export type ShellResult = {
  readonly output: string;
  readonly isError: boolean;
  readonly state: ShellState;
};

export const shellLimits = { documents: 3, actions: 3, commands: 30 };

/** Desk papers for the actors with a duty, shown under desk/. */
const deskFiles: Readonly<Record<string, string>> = {
  memorialsAwaitingYourDraft: "待票拟",
  inbox: "待处置",
  held: "留中",
  cabinetBacklog: "内阁积压",
  standingOrders: "口谕",
  emperor: "皇上",
  reportsAwaitingRouting: "待转呈原报",
};

type Option = { kind: string; description: string };
const options = (value: JsonValue | undefined): Option[] =>
  Array.isArray(value)
    ? (value as Option[])
    : value && typeof value === "object"
      ? Object.entries(value).map(([kind, d]) => ({
          kind,
          description: String(d),
        }))
      : [];

export const emptyShellState: ShellState = {
  cwd: "/",
  commands: 0,
  documents: [],
  actions: [],
};

type Files = ReadonlyMap<string, string>;
type Contact = { id: string; name: string; office?: string };
type Capability = { id: string; description: string; parameters: string };

const arr = <T>(value: JsonValue | undefined): T[] =>
  Array.isArray(value) ? (value as T[]) : [];
const pad = (n: number) => String(n).padStart(4, "0");

function render(value: JsonValue | undefined, indent = ""): string {
  if (value === null || value === undefined) return "（无）";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "（无）";
    if (value.every((v) => v === null || typeof v !== "object"))
      return value.map((v) => String(v)).join("、");
    return value
      .map((v) => `\n${indent}- ${render(v, indent + "  ").trimStart()}`)
      .join("");
  }
  return Object.entries(value)
    .map(([k, v]) => {
      const text = render(v, indent + "  ");
      return text.startsWith("\n")
        ? `\n${indent}${k}:${text}`
        : `\n${indent}${k}: ${text}`;
    })
    .join("")
    .replace(/^\n/, "");
}

/** Builds the read-only file tree from the actor-visible input. */
export function shellFiles(input: JsonObject): Files {
  const files = new Map<string, string>();
  const used = new Set([
    "runId",
    "decisionEpisodeId",
    "actorId",
    "log",
    "newFromLogEntry",
    "now",
  ]);
  const put = (path: string, key: string) => {
    used.add(key);
    if (input[key] !== undefined) files.set(path, render(input[key]) + "\n");
  };
  put("/profile.txt", "self");
  files.set(
    "/contacts.txt",
    arr<Contact>(input.contacts)
      .map((c) => `${c.id}\t${c.name}\t${c.office ?? ""}`)
      .join("\n") + "\n",
  );
  used.add("contacts");
  files.set(
    "/abilities.txt",
    [
      `可发文书：${arr<string>(input.documentKinds).join("、") || "（无）"}`,
      "",
      ...arr<Capability>(input.capabilities).map(
        (c) => `${c.id}\n  ${c.description}\n  参数：${c.parameters}`,
      ),
    ].join("\n") + "\n",
  );
  used.add("documentKinds");
  used.add("capabilities");
  put("/resources.txt", "resources");
  put("/policy.txt", "policyKnownToYou");
  used.add("provinceReports");
  for (const report of arr<JsonObject>(input.provinceReports))
    files.set(`/province/${String(report.county)}.txt`, render(report) + "\n");
  const logFile = new Map<number, string>();
  for (const entry of arr<JsonObject>(input.log)) {
    const { n, type, ...rest } = entry;
    const path = `log/${pad(Number(n))}-${String(type)}.txt`;
    logFile.set(Number(n), path);
    files.set(`/${path}`, render(rest as JsonObject) + "\n");
  }
  for (const [key, name] of Object.entries(deskFiles)) {
    if (input[key] === undefined) continue;
    used.add(key);
    // Papers point at their text in the log instead of repeating it.
    const value = JSON.parse(
      JSON.stringify(input[key]).replace(
        /"textInLogEntry":(\d+)/g,
        (_, n: string) =>
          `"原文":${JSON.stringify(logFile.get(Number(n)) ?? `log 第 ${n} 条`)}`,
      ),
    ) as JsonValue;
    files.set(`/desk/${name}.txt`, render(value) + "\n");
  }
  const duty: [string, string][] = [
    ["edictOptions", "票拟可选的敕令（draft --edict）"],
    ["dispositionOptions", "处置本章的办法（dispose）"],
    ["routeOptions", "转呈原报的路子（route）"],
  ];
  for (const [key, title] of duty) {
    if (input[key] === undefined) continue;
    used.add(key);
    files.set(
      "/abilities.txt",
      files.get("/abilities.txt")! +
        `\n${title}：\n` +
        options(input[key])
          .map((o) => `  ${o.kind}：${o.description}`)
          .join("\n") +
        "\n",
    );
  }
  used.add("energy");
  for (const key of Object.keys(input))
    if (!used.has(key)) put(`/other/${key}.txt`, key);
  return files;
}

export function shellHelp(input: JsonObject = {}): string {
  const role: string[] = [];
  if (input.memorialsAwaitingYourDraft !== undefined)
    role.push(
      "票拟（本职，不花精力；不票拟的奏疏压在内阁，皇上看不到）：",
      "  draft doc-12 --edict order_relief --countyId jiande --text 替皇上拟的批语",
      "  待票拟的奏疏见 desk/待票拟.txt，敕令和参数见 abilities.txt；敕令参数写成 --名 值。",
    );
  if (input.dispositionOptions !== undefined)
    role.push(
      "处置本章（本职，不花精力；没处置的仍留在你手里）：",
      "  dispose doc-12 present          呈览；办法见 abilities.txt",
      "  dispose doc-12 summarize --text 口奏摘要",
      "  report --text 口奏给皇上的话（皇上下次理事时听到）",
      "  interrupt --reason 为何要请皇上出关（只在皇上闭关时有用，皇上可能不见）",
      "  本章见 desk/待处置.txt、desk/留中.txt；内阁积压只知来人和题目。",
    );
  if (input.reportsAwaitingRouting !== undefined)
    role.push(
      "转呈原报（本职，不花精力；每份原报都必须选路，选完才能收笔）：",
      "  route doc-30 directorate --note 附给皇上的话",
      "  route doc-30 direct --interrupt   直接面圣；皇上闭关时 --interrupt 请求打断修道",
      "  原报一字不能改，见 desk/待转呈原报.txt。",
    );
  return [
    "这是你的终端。文件只读，是你此刻所知的一切；命令就是你今天能做的事。",
    "",
    "文件：",
    "  profile.txt     你是谁",
    "  log/            你的经历，一条一个文件，按时间编号",
    "  province/       辖区各县奏报（若有）",
    "  contacts.txt    能写信的人：id、姓名、官职",
    "  abilities.txt   你能发的文书和能办的事",
    "  resources.txt   你手里的钱粮",
    "  policy.txt      你所知的朝廷旨意",
    ...(role.length ? ["  desk/           你案头待办的本章"] : []),
    "",
    "查阅：ls cat head tail grep wc sed -n find sort echo，可用管道、&&、for 循环、$(...)。草稿可以写在 /tmp/ 下，其余文件只读。",
    "",
    "发文书（今日最多三份，每份不超过200字）：",
    "  send memorial --subject 题目 --text 正文",
    "  send letter --to actor:yang-jinshui,actor:hu-zongxian --subject 题目 <<'EOF'",
    "  正文",
    "  EOF",
    "  memorial 奏疏经内阁票拟、司礼监转呈；secret_memorial 密奏不经内阁；letter 私信只能写给 contacts 里的人。",
    "办事（今日最多三件）：",
    "  act repair_dike --countyId tonglu --description 补充说明",
    "  参数名和取值见 abilities.txt。",
    ...(role.length ? [...role, ""] : []),
    "写信、上奏、办事各花 1 点精力，今天剩多少见 pending；本职工作不花。",
    "pending 看今天已排的文书和事，cancel 编号 撤回一项。",
    "",
    "收笔（必须，收笔后今天就过去了）：",
    "  end --text 你此刻真实的想法",
    "  第一人称，不超过150字，只有你自己知道；不必复述今天做了什么。",
    "文书和事要等你收笔后世界才往前走。",
  ].join("\n");
}

/** The opening of the day: where the news starts, then help as if just run. */
export function shellGreeting(input: JsonObject): string {
  const log = arr<JsonObject>(input.log);
  const first = input.newFromLogEntry;
  const fresh =
    typeof first === "number"
      ? log.filter((e) => Number(e.n) >= first).length
      : 0;
  const news =
    typeof first === "number"
      ? `你上次决定之后，新的经历有 ${fresh} 条，从 log/${pad(first)} 起。`
      : "上次决定之后没有新的经历。";
  const energy = (input.energy as JsonObject | undefined)?.available;
  const today = typeof energy === "number" ? `今天你有 ${energy} 点精力。` : "";
  return [
    `${String(input.now)}。${news}${today}`,
    "",
    "$ help",
    shellHelp(input),
  ].join("\n");
}

// ---------- parsing ----------

type Redirect = { fd: 1 | 2; append: boolean; target: string };
type Command = {
  argv: string[];
  heredoc?: string[];
  stdinFile?: string;
  redirects: Redirect[];
};
type Op = "|" | "&&" | "||" | ";";
type Node =
  | { kind: "cmd"; command: Command }
  | {
      kind: "for";
      name: string;
      words: string[];
      body: Seq;
      redirects: Redirect[];
    };
type Seq = { op: Op | undefined; node: Node }[];
type Token = string | { op: Op | ">" | ">>" | "<" } | { heredoc: string[] };

/** The source inside $( ) or backticks starting at i, and where it ends. */
function substitution(
  source: string,
  i: number,
): { inner: string; end: number } {
  const backtick = source[i] === "`";
  let j = backtick ? i + 1 : i + 2;
  let depth = 1;
  let quote: string | undefined;
  for (; j < source.length; j += 1) {
    const c = source[j]!;
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === "\\" && quote === '"') j += 1;
      continue;
    }
    if (c === "\\") {
      j += 1;
      continue;
    }
    if (backtick) {
      if (c === "`") break;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")" && --depth === 0) break;
  }
  if (j >= source.length) throw new Error("命令替换没有闭合");
  return { inner: source.slice(backtick ? i + 1 : i + 2, j), end: j + 1 };
}

/**
 * Variable references are kept as \u0001NAME\u0002 and command substitutions
 * as \u0003INDEX\u0004 inside words until run time.
 */
function variable(
  source: string,
  i: number,
  subs: string[],
): { text: string; end: number } {
  if (source[i] === "`" || source[i + 1] === "(") {
    const sub = substitution(source, i);
    subs.push(sub.inner);
    return { text: `\u0003${subs.length - 1}\u0004`, end: sub.end };
  }
  const m = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*|\?))/.exec(source.slice(i));
  if (!m) return { text: "$", end: i + 1 };
  return { text: `\u0001${m[1] ?? m[2]}\u0002`, end: i + m[0].length };
}

function tokenize(source: string, subs: string[]): Token[] {
  const out: Token[] = [];
  const open: { body: string[]; delimiter: string }[] = [];
  let word: string | undefined;
  let i = 0;
  const flush = () => {
    if (word !== undefined) out.push(word);
    word = undefined;
  };
  while (i < source.length) {
    const c = source[i]!;
    if (c === "\n") {
      flush();
      i += 1;
      for (const h of open.splice(0)) {
        while (i < source.length) {
          const end = source.indexOf("\n", i);
          const line = source.slice(i, end < 0 ? source.length : end);
          i = end < 0 ? source.length : end + 1;
          if (line.trim() === h.delimiter) break;
          h.body.push(line);
        }
      }
      out.push({ op: ";" });
      continue;
    }
    if (c === " " || c === "\t") {
      flush();
      i += 1;
      continue;
    }
    if (c === "#" && word === undefined) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (c === "'") {
      const end = source.indexOf("'", i + 1);
      if (end < 0) throw new Error("引号没有配对");
      word = (word ?? "") + source.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== '"') {
        if (source[j] === "$" || source[j] === "`") {
          const v = variable(source, j, subs);
          text += v.text;
          j = v.end;
          continue;
        }
        if (source[j] === "\\" && j + 1 < source.length) j += 1;
        text += source[j];
        j += 1;
      }
      if (j >= source.length) throw new Error("引号没有配对");
      word = (word ?? "") + text;
      i = j + 1;
      continue;
    }
    if (c === "\\" && i + 1 < source.length) {
      word = (word ?? "") + source[i + 1];
      i += 2;
      continue;
    }
    if (c === "$" || c === "`") {
      const v = variable(source, i, subs);
      word = (word ?? "") + v.text;
      i = v.end;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === "<<") {
      flush();
      const m = /^-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(
        source.slice(i + 2),
      );
      if (!m) throw new Error("heredoc 缺少结束标记");
      const body: string[] = [];
      open.push({ body, delimiter: m[2]! });
      out.push({ heredoc: body });
      i += 2 + m[0].length;
      continue;
    }
    if (two === "&&" || two === "||" || two === ">>") {
      flush();
      out.push({ op: two });
      i += 2;
      continue;
    }
    if (c === "|" || c === ";" || c === ">" || c === "<") {
      flush();
      out.push({ op: c });
      i += 1;
      continue;
    }
    word = (word ?? "") + c;
    i += 1;
  }
  flush();
  if (open.length) throw new Error("heredoc 没有结束");
  return out;
}

function parse(source: string, subs: string[]): Seq {
  const tokens = tokenize(source, subs);
  let i = 0;
  const opAt = (k: number) => {
    const t = tokens[k];
    return t !== undefined && typeof t !== "string" && "op" in t
      ? t.op
      : undefined;
  };
  /** Reads `[n]> target`, `[n]>> target` or `< file` at i into the lists given. */
  const redirect = (
    redirects: Redirect[],
    stdin?: (path: string) => void,
  ): boolean => {
    const fd =
      (tokens[i] === "1" || tokens[i] === "2") &&
      (opAt(i + 1) === ">" || opAt(i + 1) === ">>")
        ? Number(tokens[i])
        : undefined;
    const at = fd === undefined ? i : i + 1;
    const op = opAt(at);
    if (op !== ">" && op !== ">>" && op !== "<") return false;
    const target = tokens[at + 1];
    if (typeof target !== "string") throw new Error(`${op} 后面缺少目标`);
    i = at + 2;
    if (op === "<") {
      if (!stdin) throw new Error("这里不能用 < 读入");
      stdin(target);
    } else
      redirects.push({
        fd: fd === 2 ? 2 : 1,
        append: op === ">>",
        target,
      });
    return true;
  };
  const command = (): Node => {
    const cmd: Command = { argv: [], redirects: [] };
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (redirect(cmd.redirects, (path) => (cmd.stdinFile = path))) continue;
      if (typeof t === "string") {
        cmd.argv.push(t);
        i += 1;
        continue;
      }
      if ("heredoc" in t) {
        cmd.heredoc = t.heredoc;
        i += 1;
        continue;
      }
      break;
    }
    return { kind: "cmd", command: cmd };
  };
  const forLoop = (): Node => {
    const usage = "for 的写法：for 变量 in 列表; do 命令; done";
    i += 1;
    const name = tokens[i];
    if (typeof name !== "string" || !/^[A-Za-z_]\w*$/.test(name))
      throw new Error(usage);
    i += 1;
    const words: string[] = [];
    if (tokens[i] === "in") {
      i += 1;
      while (typeof tokens[i] === "string" && tokens[i] !== "do")
        words.push(tokens[i++] as string);
    }
    while (opAt(i) === ";") i += 1;
    if (tokens[i] !== "do") throw new Error(usage);
    i += 1;
    const body = seq("done");
    i += 1;
    const redirects: Redirect[] = [];
    while (redirect(redirects)) continue;
    return { kind: "for", name, words, body, redirects };
  };
  const seq = (stop?: string): Seq => {
    const out: Seq = [];
    let op: Op | undefined;
    for (;;) {
      const t = tokens[i];
      if (t === undefined || (stop !== undefined && t === stop)) {
        if (op) throw new Error("命令不完整");
        if (stop !== undefined && t === undefined)
          throw new Error(`缺少 ${stop}`);
        return out;
      }
      const at = opAt(i);
      if (at === ";") {
        if (op) throw new Error("命令不完整");
        i += 1;
        continue;
      }
      if (at === "|" || at === "&&" || at === "||")
        throw new Error(`${at} 前面缺少命令`);
      const node = t === "for" ? forLoop() : command();
      if (node.kind === "cmd" && !node.command.argv.length)
        throw new Error("缺少命令");
      out.push({ op: out.length ? (op ?? ";") : undefined, node });
      op = undefined;
      const next = opAt(i);
      if (next === "|" || next === "&&" || next === "||") {
        op = next;
        i += 1;
      }
    }
  };
  return seq();
}

// ---------- commands ----------

type Io = { stdin: string | undefined };
type Out = { out: string; err?: string; code: number };
type Ctx = {
  /** The read-only tree plus today's /tmp files. */
  files: Map<string, string>;
  input: JsonObject;
  state: ShellState;
  vars: Map<string, string>;
  subs: string[];
  code: number;
};

const tmpLimit = 20000;

const substitute = (ctx: Ctx, word: string): string =>
  word
    .replace(/\u0001(\w+|\?)\u0002/g, (_, name: string) =>
      name === "?" ? String(ctx.code) : (ctx.vars.get(name) ?? ""),
    )
    .replace(/\u0003(\d+)\u0004/g, (_, n: string) =>
      runSeq(ctx, parse(ctx.subs[Number(n)]!, ctx.subs)).output.replace(
        /\n+$/,
        "",
      ),
    );

function write(ctx: Ctx, path: string, text: string, append: boolean): void {
  const full = resolve(ctx.state.cwd, path);
  if (!full.startsWith("/tmp/"))
    throw new Error(`${path}: 只读文件系统；草稿可以写在 /tmp/ 下`);
  const next = (append ? (ctx.files.get(full) ?? "") : "") + text;
  if (next.length > tmpLimit) throw new Error(`${path}: 草稿太长`);
  ctx.files.set(full, next);
  ctx.state = { ...ctx.state, tmp: { ...ctx.state.tmp, [full]: next } };
}

function resolve(cwd: string, path: string): string {
  const raw = path.replace(/^~(?=\/|$)/, "");
  const parts = (raw.startsWith("/") ? raw : `${cwd}/${raw}`).split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return "/" + stack.join("/");
}

const isDir = (files: Files, path: string) =>
  path === "/" ||
  path === "/tmp" ||
  [...files.keys()].some((f) => f.startsWith(path + "/"));

function children(files: Files, dir: string): string[] {
  const prefix = dir === "/" ? "/" : dir + "/";
  const names = new Set<string>();
  for (const f of files.keys())
    if (f.startsWith(prefix)) {
      const rest = f.slice(prefix.length);
      const slash = rest.indexOf("/");
      names.add(slash < 0 ? rest : rest.slice(0, slash) + "/");
    }
  return [...names].sort();
}

/** Expands *, ? and [...] in the last path segment, keeping the path as written. */
function expand(ctx: Ctx, arg: string): string[] {
  if (!/[*?[]/.test(arg)) return [arg];
  const slash = arg.lastIndexOf("/");
  const written = slash < 0 ? "" : arg.slice(0, slash + 1);
  const dir = resolve(ctx.state.cwd, written || ".");
  let pattern: RegExp;
  try {
    pattern = new RegExp(
      "^" +
        arg
          .slice(slash + 1)
          .replace(/[.+^${}()|\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")
          .replace(/\[!/g, "[^") +
        "$",
    );
  } catch {
    return [arg];
  }
  const hits = children(ctx.files, dir)
    .map((n) => n.replace(/\/$/, ""))
    .filter((n) => pattern.test(n))
    .map((n) => written + n);
  return hits.length ? hits : [arg];
}

/** Names the working directory, since a cd in an earlier call is the usual cause. */
const missing = (ctx: Ctx, path: string) =>
  `${path}: 没有那个文件或目录` +
  (ctx.state.cwd !== "/" && !path.startsWith("/")
    ? `（当前目录 ${ctx.state.cwd}，cd / 回到起点）`
    : "");

function read(ctx: Ctx, path: string): string {
  const full = resolve(ctx.state.cwd, path);
  const text = ctx.files.get(full);
  if (text !== undefined) return text;
  if (isDir(ctx.files, full)) throw new Error(`${path}: 是一个目录`);
  throw new Error(missing(ctx, path));
}

const lines = (text: string) =>
  text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");

type Flags = {
  flags: Set<string>;
  values: Map<string, string>;
  rest: string[];
};

function flags(argv: string[], withValue: string[] = []): Flags {
  const out: Flags = { flags: new Set(), values: new Map(), rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--") {
      out.rest.push(...argv.slice(i + 1));
      break;
    }
    if (/^-\d+$/.test(a)) {
      out.values.set("n", a.slice(1));
      continue;
    }
    if (a.startsWith("-") && a.length > 1 && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j += 1) {
        const f = a[j]!;
        if (withValue.includes(f)) {
          const value = a.slice(j + 1) || argv[++i];
          if (value === undefined) throw new Error(`-${f} 缺少参数`);
          out.values.set(f, value);
          break;
        }
        out.flags.add(f);
      }
      continue;
    }
    out.rest.push(a);
  }
  return out;
}

function sources(ctx: Ctx, rest: string[], io: Io) {
  const paths = rest.flatMap((r) => expand(ctx, r));
  if (!paths.length) {
    if (io.stdin === undefined) throw new Error("缺少文件名");
    return [{ name: "", text: io.stdin }];
  }
  return paths.map((p) => ({ name: p, text: read(ctx, p) }));
}

function headTail(ctx: Ctx, argv: string[], io: Io, tail: boolean): Out {
  const f = flags(argv, ["n"]);
  const raw = f.values.get("n") ?? "10";
  const fromStart = tail && raw.startsWith("+");
  const n = Number(raw.replace(/^\+/, ""));
  if (!Number.isInteger(n) || n < 0) throw new Error(`无效的行数：${raw}`);
  const srcs = sources(ctx, f.rest, io);
  return {
    code: 0,
    out: srcs
      .map((s) => {
        const ls = lines(s.text);
        const picked = !tail
          ? ls.slice(0, n)
          : fromStart
            ? ls.slice(Math.max(0, n - 1))
            : ls.slice(Math.max(0, ls.length - n));
        const head = srcs.length > 1 ? `==> ${s.name} <==\n` : "";
        return head + picked.join("\n");
      })
      .join("\n\n"),
  };
}

function grep(ctx: Ctx, argv: string[], io: Io): Out {
  const f = flags(argv, ["e", "A", "B", "C", "m"]);
  const pattern = f.values.get("e") ?? f.rest.shift();
  if (pattern === undefined) throw new Error("用法：grep [选项] 模式 [文件]");
  let re: RegExp;
  try {
    re = new RegExp(
      f.flags.has("F")
        ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        : pattern.replace(/\\\|/g, "|"),
      f.flags.has("i") ? "i" : "",
    );
  } catch {
    throw new Error(`无效的模式：${pattern}`);
  }
  let rest = f.rest;
  if (f.flags.has("r") || f.flags.has("R")) {
    const roots = rest.length ? rest : ["."];
    rest = roots.flatMap((r) => {
      const dir = resolve(ctx.state.cwd, r);
      if (ctx.files.has(dir)) return [dir];
      const prefix = dir === "/" ? "/" : dir + "/";
      return [...ctx.files.keys()].filter((k) => k.startsWith(prefix)).sort();
    });
  }
  const srcs = sources(ctx, rest, io);
  const many = srcs.length > 1 && !f.flags.has("h");
  const after = Number(f.values.get("A") ?? f.values.get("C") ?? 0);
  const before = Number(f.values.get("B") ?? f.values.get("C") ?? 0);
  const limit = Number(f.values.get("m") ?? Infinity);
  const out: string[] = [];
  let found = false;
  for (const s of srcs) {
    const ls = lines(s.text);
    const hits = ls
      .map((l, i) => (re.test(l) !== f.flags.has("v") ? i : -1))
      .filter((i) => i >= 0)
      .slice(0, limit);
    if (hits.length) found = true;
    const label = s.name.replace(/^\//, "");
    if (f.flags.has("l")) {
      if (hits.length) out.push(label);
      continue;
    }
    if (f.flags.has("c")) {
      out.push(many ? `${label}:${hits.length}` : String(hits.length));
      continue;
    }
    const shown = new Set<number>();
    for (const h of hits)
      for (
        let i = Math.max(0, h - before);
        i <= Math.min(ls.length - 1, h + after);
        i += 1
      )
        shown.add(i);
    for (const i of [...shown].sort((a, b) => a - b))
      out.push(
        (many ? `${label}:` : "") +
          (f.flags.has("n") ? `${i + 1}:` : "") +
          ls[i],
      );
  }
  return { out: out.join("\n"), code: found ? 0 : 1 };
}

function ls(ctx: Ctx, argv: string[]): Out {
  const f = flags(argv);
  const targets = f.rest.length ? f.rest.flatMap((r) => expand(ctx, r)) : ["."];
  const blocks = targets.map((t) => {
    const path = resolve(ctx.state.cwd, t);
    if (ctx.files.has(path)) return t;
    if (!isDir(ctx.files, path)) throw new Error(missing(ctx, t));
    const names = children(ctx.files, path);
    const body = f.flags.has("l")
      ? names
          .map((n) => {
            const text = ctx.files.get(path === "/" ? `/${n}` : `${path}/${n}`);
            return text === undefined
              ? n
              : `${String(text.length).padStart(6)}  ${n}`;
          })
          .join("\n")
      : names.join("\n");
    return targets.length > 1 ? `${t}:\n${body}` : body;
  });
  return { out: blocks.join("\n\n"), code: 0 };
}

function wc(ctx: Ctx, argv: string[], io: Io): Out {
  const f = flags(argv);
  const srcs = sources(ctx, f.rest, io);
  const only = ["l", "c", "m", "w"].filter((x) => f.flags.has(x));
  return {
    code: 0,
    out: srcs
      .map((s) => {
        const counts: Record<string, number> = {
          l: (s.text.match(/\n/g) ?? []).length,
          w: s.text.split(/\s+/).filter(Boolean).length,
          c: s.text.length,
          m: s.text.length,
        };
        const cols = (only.length ? only : ["l", "w", "c"]).map(
          (k) => counts[k],
        );
        return [...cols, s.name.replace(/^\//, "")].join(" ").trim();
      })
      .join("\n"),
  };
}

function sed(ctx: Ctx, argv: string[], io: Io): Out {
  const f = flags(argv);
  const script = f.rest.shift();
  const m = script && /^(\d+)(?:,(\d+|\$))?p$/.exec(script);
  if (!f.flags.has("n") || !m)
    throw new Error("这里的 sed 只支持 sed -n '起,止p' 文件");
  const from = Number(m[1]);
  const srcs = sources(ctx, f.rest, io);
  return {
    code: 0,
    out: srcs
      .map((s) => {
        const ls = lines(s.text);
        const to = m[2] === "$" ? ls.length : Number(m[2] ?? from);
        return ls.slice(from - 1, to).join("\n");
      })
      .join("\n"),
  };
}

/** Splits --name value / --name=value pairs; a repeated name keeps every value. */
function longOptions(argv: string[]): {
  positional: string[];
  opts: Map<string, string[]>;
} {
  const opts = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    let key = a.slice(2);
    let value: string | undefined;
    if (eq > 0) {
      key = a.slice(2, eq);
      value = a.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${a} 缺少值`);
      i += 1;
    }
    opts.set(key, [...(opts.get(key) ?? []), value]);
  }
  return { positional, opts };
}

/** Energy left today, or undefined when the actor has no energy limit (an arrested man's last word). */
function energyLeft(ctx: Ctx): number | undefined {
  const available = (ctx.input.energy as JsonObject | undefined)?.available;
  return typeof available === "number"
    ? available - ctx.state.documents.length - ctx.state.actions.length
    : undefined;
}

function spend(ctx: Ctx): void {
  const left = energyLeft(ctx);
  if (left !== undefined && left < 1)
    throw new Error("精力不济，今天办不了更多了；可先 cancel 撤回一项");
}

function send(ctx: Ctx, argv: string[], io: Io): Out {
  const kinds = arr<string>(ctx.input.documentKinds);
  const kind = argv[0];
  if (!kind || kind.startsWith("--"))
    throw new Error(
      `用法：send <${kinds.join("|")}> --subject 题目 --text 正文`,
    );
  if (!kinds.includes(kind))
    throw new Error(`你没有 ${kind} 这种文书渠道，可用：${kinds.join("、")}`);
  spend(ctx);
  if (ctx.state.documents.length >= shellLimits.documents)
    throw new Error(
      `今天已排了 ${shellLimits.documents} 份文书，不能再发；可先 cancel 撤回`,
    );
  const { positional, opts } = longOptions(argv.slice(1));
  for (const key of opts.keys())
    if (!["to", "subject", "text"].includes(key))
      throw new Error(`没有 --${key} 这个选项`);
  const to = (opts.get("to") ?? [])
    .flatMap((t) => t.split(/[,，、]/))
    .map((t) => t.trim())
    .filter(Boolean);
  const subject = opts.get("subject")?.join(" ").trim();
  const text = (
    opts.get("text")?.join("\n") ??
    (positional.length ? positional.join(" ") : io.stdin) ??
    ""
  ).trim();
  if (!subject) throw new Error("缺少 --subject");
  if (!text) throw new Error("缺少正文：用 --text 或 heredoc");
  if (subject.length > 80) throw new Error("题目太长");
  if (text.length > 2000) throw new Error("正文太长");
  let recipients: string[] | undefined;
  if (kind === "letter") {
    if (!to.length) throw new Error("私信须用 --to 写明收信人 id");
    const contacts = arr<Contact>(ctx.input.contacts);
    recipients = to.map((t) => {
      const c = contacts.find((x) => x.id === t || x.name === t);
      if (!c) throw new Error(`无此收件人：${t}（见 contacts.txt）`);
      return c.id;
    });
  } else if (to.length) throw new Error(`${kind} 不用 --to`);
  const doc: ShellDocument = {
    kind,
    ...(recipients ? { to: recipients } : {}),
    subject,
    text,
  };
  const documents = [...ctx.state.documents, doc];
  ctx.state = { ...ctx.state, documents };
  return {
    code: 0,
    out: `已排入今日文书第 ${documents.length} 份：${kind}《${subject}》${recipients ? ` 致 ${recipients.join("、")}` : ""}，${text.length} 字。收笔后发出。`,
  };
}

function parseValue(v: string): JsonValue {
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

function act(ctx: Ctx, argv: string[]): Out {
  const caps = arr<Capability>(ctx.input.capabilities);
  const id = argv[0];
  if (!id || id.startsWith("--"))
    throw new Error(
      `用法：act <事项> --参数 值；事项见 abilities.txt：${caps.map((c) => c.id).join("、") || "（无）"}`,
    );
  const cap = caps.find((c) => c.id === id);
  if (!cap) throw new Error(`没有 ${id} 这件事可办，见 abilities.txt`);
  spend(ctx);
  if (ctx.state.actions.length >= shellLimits.actions)
    throw new Error(
      `今天已排了 ${shellLimits.actions} 件事，不能再办；可先 cancel 撤回`,
    );
  const { positional, opts } = longOptions(argv.slice(1));
  if (positional.length)
    throw new Error(`多余的参数：${positional.join(" ")}，参数须写成 --名 值`);
  const description = opts.get("description")?.join(" ");
  opts.delete("description");
  for (const [key, values] of opts)
    if (values.length > 1) throw new Error(`--${key} 写了两次`);
  const keys = [...cap.parameters.matchAll(/"(\w+)"\s*:/g)].map((m) => m[1]!);
  for (const key of opts.keys())
    if (!keys.includes(key))
      throw new Error(`${id} 没有参数 ${key}，参数：${cap.parameters}`);
  for (const key of keys)
    if (!opts.has(key))
      throw new Error(`缺少 --${key}，参数：${cap.parameters}`);
  for (const m of cap.parameters.matchAll(/"(\w+)"\s*:\s*"([\w|]+)"/g)) {
    const allowed = m[2]!.split("|");
    if (!allowed.includes(opts.get(m[1]!)![0]!))
      throw new Error(`--${m[1]} 只能是 ${allowed.join("、")}`);
  }
  const parameters: JsonObject = Object.fromEntries(
    [...opts].map(([k, v]) => [k, parseValue(v[0]!)]),
  );
  const action: ShellAction = {
    capabilityId: id,
    parameters,
    ...(description ? { description } : {}),
  };
  const actions = [...ctx.state.actions, action];
  ctx.state = { ...ctx.state, actions };
  return {
    code: 0,
    out: `已排入今日要办的第 ${actions.length} 件事：${id} ${JSON.stringify(parameters)}。收笔后才见分晓。`,
  };
}

function pending(ctx: Ctx): Out {
  const d = ctx.state.documents.map(
    (x, i) =>
      `D${i + 1}  ${x.kind}《${x.subject}》${x.to ? ` 致 ${x.to.join("、")}` : ""}\n    ${x.text}`,
  );
  const a = ctx.state.actions.map(
    (x, i) =>
      `A${i + 1}  ${x.capabilityId} ${JSON.stringify(x.parameters)}${x.description ? `  ${x.description}` : ""}`,
  );
  const left = energyLeft(ctx);
  const duty = [
    ...(ctx.state.drafts ?? []).map(
      (x) =>
        `票拟 ${String(x.memorialId)}：${JSON.stringify(x.edict)} ${String(x.text)}`,
    ),
    ...(ctx.state.dispositions ?? []).map(
      (x) =>
        `处置 ${String(x.documentId)}：${String(x.action)}${x.text ? ` ${String(x.text)}` : ""}`,
    ),
    ...(ctx.state.routes ?? []).map(
      (x) =>
        `转呈 ${String(x.reportId)}：${String(x.channel)}${x.interrupt ? " 请求打断" : ""}${x.note ? ` ${String(x.note)}` : ""}`,
    ),
    ...(ctx.state.report ? [`口奏：${ctx.state.report}`] : []),
    ...(ctx.state.interrupt ? [`请皇上出关：${ctx.state.interrupt}`] : []),
  ];
  return {
    code: 0,
    out: [
      ...(left !== undefined ? [`精力剩 ${left} 点`] : []),
      `文书 ${d.length}/${shellLimits.documents}`,
      ...d,
      `办事 ${a.length}/${shellLimits.actions}`,
      ...a,
      ...(duty.length ? ["本职（不花精力）", ...duty] : []),
    ].join("\n"),
  };
}

function item(
  ctx: Ctx,
  key: string,
  idKey: string,
  id: string | undefined,
  what: string,
): JsonObject {
  const list = arr<JsonObject>(ctx.input[key]);
  const found = list.find((x) => x[idKey] === id);
  if (!found)
    throw new Error(
      `${id ?? "（未写编号）"} 不在${what}里，可选：${list.map((x) => String(x[idKey])).join("、") || "（无）"}`,
    );
  return found;
}

/** Duty entries replace an earlier one for the same paper. */
function upsert(
  list: readonly JsonObject[] | undefined,
  idKey: string,
  entry: JsonObject,
): JsonObject[] {
  return [...(list ?? []).filter((x) => x[idKey] !== entry[idKey]), entry];
}

function draft(ctx: Ctx, argv: string[], io: Io): Out {
  const [memorialId, ...rest] = argv;
  item(
    ctx,
    "memorialsAwaitingYourDraft",
    "memorialId",
    memorialId,
    "待票拟的奏疏",
  );
  const { positional, opts } = longOptions(rest);
  const kind = opts.get("edict")?.[0];
  const kinds = options(ctx.input.edictOptions).map((o) => o.kind);
  if (!kind || !kinds.includes(kind))
    throw new Error(`--edict 须取 ${kinds.join("、")}`);
  const text = (
    opts.get("text")?.join("\n") ??
    (positional.length ? positional.join(" ") : io.stdin) ??
    ""
  ).trim();
  if (!text) throw new Error("缺少 --text 票拟批语");
  if (text.length > 600) throw new Error("批语太长");
  const params: JsonObject = Object.fromEntries(
    [...opts]
      .filter(([k]) => k !== "edict" && k !== "text")
      .map(([k, v]) => [k, parseValue(v[0]!)]),
  );
  const entry = { memorialId: memorialId!, edict: { kind, params }, text };
  ctx.state = {
    ...ctx.state,
    drafts: upsert(ctx.state.drafts, "memorialId", entry),
  };
  return {
    code: 0,
    out: `已票拟 ${memorialId}：${kind} ${JSON.stringify(params)}。收笔后送司礼监；敕令能否施行由朝廷规矩核对。`,
  };
}

function dispose(ctx: Ctx, argv: string[]): Out {
  const [documentId, action, ...rest] = argv;
  const inInbox = arr<JsonObject>(ctx.input.inbox).some(
    (x) => x.documentId === documentId,
  );
  if (!inInbox)
    item(ctx, "held", "documentId", documentId, "待处置或留中的本章");
  const actions = options(ctx.input.dispositionOptions).map((o) => o.kind);
  if (!action || !actions.includes(action))
    throw new Error(`处置办法须取 ${actions.join("、")}`);
  const { positional, opts } = longOptions(rest);
  const text = (opts.get("text")?.join("\n") ?? positional.join(" ")).trim();
  const entry: JsonObject = {
    documentId: documentId!,
    action,
    ...(text ? { text } : {}),
  };
  ctx.state = {
    ...ctx.state,
    dispositions: upsert(ctx.state.dispositions, "documentId", entry),
  };
  return { code: 0, out: `已处置 ${documentId}：${action}。收笔后生效。` };
}

function said(argv: string[], io: Io, option: string, max: number): string {
  const { positional, opts } = longOptions(argv);
  const text = (
    opts.get(option)?.join("\n") ??
    (positional.length ? positional.join(" ") : io.stdin) ??
    ""
  ).trim();
  if (!text) throw new Error(`缺少 --${option}`);
  if (text.length > max) throw new Error("太长了，写短些");
  return text;
}

function route(ctx: Ctx, argv: string[]): Out {
  const [reportId, channel, ...rest] = argv;
  item(ctx, "reportsAwaitingRouting", "reportId", reportId, "待转呈的原报");
  const channels = options(ctx.input.routeOptions).map((o) => o.kind);
  if (!channel || !channels.includes(channel))
    throw new Error(`路子须取 ${channels.join("、")}`);
  const interrupt = rest.includes("--interrupt");
  const { positional, opts } = longOptions(
    rest.filter((a) => a !== "--interrupt"),
  );
  const note = (opts.get("note")?.join("\n") ?? positional.join(" ")).trim();
  if (note.length > 400) throw new Error("附言太长");
  const entry: JsonObject = {
    reportId: reportId!,
    channel,
    ...(note ? { note } : {}),
    ...(interrupt ? { interrupt: true } : {}),
  };
  ctx.state = {
    ...ctx.state,
    routes: upsert(ctx.state.routes, "reportId", entry),
  };
  return { code: 0, out: `原报 ${reportId} 走 ${channel}。收笔后送出。` };
}

function cancel(ctx: Ctx, argv: string[]): Out {
  const m = /^([DA])(\d+)$/i.exec(argv[0] ?? "");
  if (!m) throw new Error("用法：cancel D1 或 cancel A2（编号见 pending）");
  const index = Number(m[2]) - 1;
  const key = m[1]!.toUpperCase() === "D" ? "documents" : "actions";
  const list = ctx.state[key];
  if (!list[index]) throw new Error(`没有 ${argv[0]}`);
  ctx.state = { ...ctx.state, [key]: list.filter((_, i) => i !== index) };
  return { code: 0, out: `已撤回 ${argv[0]}。` };
}

function end(ctx: Ctx, argv: string[], io: Io): Out {
  const { positional, opts } = longOptions(argv);
  for (const key of opts.keys())
    if (key !== "text") throw new Error(`没有 --${key} 这个选项`);
  const inner = (
    opts.get("text")?.join("\n") ??
    (positional.length ? positional.join(" ") : io.stdin) ??
    ""
  ).trim();
  if (!inner) throw new Error("用法：end --text 你此刻真实的想法");
  const unrouted = arr<JsonObject>(ctx.input.reportsAwaitingRouting)
    .map((r) => String(r.reportId))
    .filter((id) => !(ctx.state.routes ?? []).some((x) => x.reportId === id));
  if (unrouted.length)
    throw new Error(`还有原报没选路：${unrouted.join("、")}；原报不能压下`);
  if (inner.length > 1200) throw new Error("太长了，写短些");
  ctx.state = { ...ctx.state, inner };
  return {
    code: 0,
    out: `今日收笔：文书 ${ctx.state.documents.length} 份，办事 ${ctx.state.actions.length} 件。`,
  };
}

function find(ctx: Ctx, argv: string[]): Out {
  const roots: string[] = [];
  let name: RegExp | undefined;
  let type: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "-name" || a === "-iname") {
      const pattern = argv[++i] ?? "*";
      name = new RegExp(
        "^" +
          pattern
            .replace(/[.+^${}()|\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".") +
          "$",
        a === "-iname" ? "i" : "",
      );
    } else if (a === "-type") type = argv[++i];
    else if (a === "-maxdepth" || a === "-mindepth") i += 1;
    else if (!a.startsWith("-")) roots.push(a);
  }
  const out: string[] = [];
  for (const root of roots.length ? roots : ["."]) {
    const base = resolve(ctx.state.cwd, root);
    if (ctx.files.has(base)) {
      out.push(root);
      continue;
    }
    if (!isDir(ctx.files, base)) throw new Error(missing(ctx, root));
    const prefix = base === "/" ? "/" : base + "/";
    const found = new Set<string>();
    for (const f of ctx.files.keys()) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length).split("/");
      for (let k = 1; k < rest.length; k += 1)
        found.add(`d:${rest.slice(0, k).join("/")}`);
      found.add(`f:${rest.join("/")}`);
    }
    if (!type || type === "d") if (!name || name.test(root)) out.push(root);
    for (const entry of [...found].sort((a, b) =>
      a.slice(2).localeCompare(b.slice(2)),
    )) {
      const kind = entry[0];
      const rel = entry.slice(2);
      if (type && type !== kind) continue;
      if (name && !name.test(rel.split("/").at(-1)!)) continue;
      out.push(`${root.replace(/\/$/, "")}/${rel}`);
    }
  }
  return { out: out.join("\n"), code: 0 };
}

const builtins = [
  "help",
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "egrep",
  "wc",
  "sed",
  "find",
  "tree",
  "sort",
  "echo",
  "pwd",
  "cd",
  "date",
  "whoami",
  "env",
  "printenv",
  "which",
  "type",
  "true",
  "false",
  "bash",
  "sh",
  "send",
  "act",
  "pending",
  "cancel",
  "end",
  "draft",
  "dispose",
  "route",
  "report",
  "interrupt",
];

function exec(ctx: Ctx, command: Command, io: Io): Out {
  const [name, ...args] = command.argv;
  const stdin = command.heredoc ? command.heredoc.join("\n") : io.stdin;
  const local = { stdin };
  switch (name) {
    case "help":
      return { out: shellHelp(ctx.input), code: 0 };
    case "ls":
      return ls(ctx, args);
    case "cat":
      return {
        out: sources(
          ctx,
          args.filter((a) => !a.startsWith("-") || a === "-"),
          local,
        )
          .map((s) => s.text.replace(/\n$/, ""))
          .join("\n"),
        code: 0,
      };
    case "head":
      return headTail(ctx, args, local, false);
    case "tail":
      return headTail(ctx, args, local, true);
    case "grep":
    case "egrep":
      return grep(ctx, args, local);
    case "wc":
      return wc(ctx, args, local);
    case "sed":
      return sed(ctx, args, local);
    case "echo":
      return {
        out: (args[0] === "-e" || args[0] === "-n" ? args.slice(1) : args)
          .join(" ")
          .replace(/\\n/g, args[0] === "-e" ? "\n" : "\\n"),
        code: 0,
      };
    case "true":
    case ":":
      return { out: "", code: 0 };
    case "false":
      return { out: "", code: 1 };
    case "bash":
    case "sh": {
      if (args[0] !== "-c" || args[1] === undefined)
        throw new Error("这里只支持 bash -c '命令'");
      const result = runSeq(ctx, parse(args[1], ctx.subs));
      return { out: result.output, code: result.code };
    }
    case "find":
      return find(ctx, args);
    case "tree":
      return find(ctx, args.length ? args : ["."]);
    case "which":
    case "type":
    case "command": {
      const names = args.filter((a) => !a.startsWith("-"));
      const known = names.filter((n) => builtins.includes(n));
      return {
        out: known.map((n) => `${n}: 终端内置命令`).join("\n"),
        ...(known.length < names.length
          ? {
              err: names
                .filter((n) => !known.includes(n))
                .map((n) => `${n}: 没有这个命令`)
                .join("\n"),
            }
          : {}),
        code: known.length === names.length ? 0 : 1,
      };
    }
    case "env":
    case "printenv":
      return {
        out: [
          "HOME=/",
          `PWD=${ctx.state.cwd}`,
          `USER=${String((ctx.input.self as JsonObject | undefined)?.name ?? "")}`,
        ].join("\n"),
        code: 0,
      };
    case "sort": {
      const f = flags(args);
      const ls = sources(ctx, f.rest, local).flatMap((x) => lines(x.text));
      const sorted = f.flags.has("n")
        ? ls.sort((a, b) => parseFloat(a) - parseFloat(b))
        : ls.sort();
      if (f.flags.has("r")) sorted.reverse();
      return {
        out: (f.flags.has("u") ? [...new Set(sorted)] : sorted).join("\n"),
        code: 0,
      };
    }
    case "pwd":
      return { out: ctx.state.cwd, code: 0 };
    case "cd": {
      const path = resolve(ctx.state.cwd, args[0] ?? "/");
      if (!isDir(ctx.files, path)) throw new Error(`cd: ${args[0]}: 不是目录`);
      ctx.state = { ...ctx.state, cwd: path };
      return { out: "", code: 0 };
    }
    case "date":
      return { out: String(ctx.input.now), code: 0 };
    case "whoami":
      return {
        out: String((ctx.input.self as JsonObject | undefined)?.name ?? ""),
        code: 0,
      };
    case "send":
      return send(ctx, args, local);
    case "act":
      return act(ctx, args);
    case "pending":
      return pending(ctx);
    case "cancel":
      return cancel(ctx, args);
    case "end":
      return end(ctx, args, local);
    case "draft":
      return draft(ctx, args, local);
    case "dispose":
      return dispose(ctx, args);
    case "route":
      return route(ctx, args);
    case "report":
      if (ctx.input.dispositionOptions === undefined)
        throw new Error("你没有口奏的门路");
      ctx.state = { ...ctx.state, report: said(args, local, "text", 1500) };
      return { code: 0, out: "口奏已备好，皇上下次理事时听到。" };
    case "interrupt":
      if (ctx.input.dispositionOptions === undefined)
        throw new Error("你没有请皇上出关的门路");
      ctx.state = { ...ctx.state, interrupt: said(args, local, "reason", 300) };
      return { code: 0, out: "收笔后递进去，皇上见不见不一定。" };
    default:
      return {
        out: "",
        err: `bash: ${name}: command not found（help 查看可用命令）`,
        code: 127,
      };
  }
}

function attempt(ctx: Ctx, name: string | undefined, f: () => Out): Out {
  try {
    return f();
  } catch (error) {
    return { out: "", err: `${name}: ${(error as Error).message}`, code: 1 };
  }
}

/** Sends stdout and stderr where the redirections say. */
function redirected(ctx: Ctx, result: Out, redirects: Redirect[]): Out {
  let { out, err } = result;
  let code = result.code;
  for (const r of redirects) {
    const target = substitute(ctx, r.target);
    const text = r.fd === 1 ? out : (err ?? "");
    if (target === "/dev/null") {
      if (r.fd === 1) out = "";
      else err = undefined;
    } else if (target === "&1" || target === "&2") {
      if (r.fd === 2 && target === "&1") {
        out = [err, out].filter(Boolean).join("\n");
        err = undefined;
      } else if (r.fd === 1 && target === "&2") {
        err = [err, out].filter(Boolean).join("\n");
        out = "";
      }
    } else {
      try {
        write(ctx, target, text ? text + "\n" : "", r.append);
        if (r.fd === 1) out = "";
        else err = undefined;
      } catch (error) {
        err = [err, `bash: ${(error as Error).message}`]
          .filter(Boolean)
          .join("\n");
        code = 1;
      }
    }
  }
  return { out, ...(err ? { err } : {}), code };
}

function run(ctx: Ctx, node: Node, stdin: string | undefined): Out {
  if (node.kind === "cmd") {
    const command: Command = {
      ...node.command,
      argv: node.command.argv.map((a) => substitute(ctx, a)),
    };
    const name = command.argv[0];
    const result = attempt(ctx, name, () => {
      const input = command.stdinFile
        ? read(ctx, substitute(ctx, command.stdinFile))
        : stdin;
      return exec(ctx, command, { stdin: input });
    });
    return redirected(ctx, result, command.redirects);
  }
  const chunks: string[] = [];
  let code = 0;
  for (const word of node.words.flatMap((w) =>
    expand(ctx, substitute(ctx, w)),
  )) {
    ctx.vars.set(node.name, word);
    const result = runSeq(ctx, node.body);
    if (result.output) chunks.push(result.output);
    code = result.code;
  }
  return redirected(ctx, { out: chunks.join("\n"), code }, node.redirects);
}

function runSeq(ctx: Ctx, seq: Seq): { output: string; code: number } {
  const chunks: string[] = [];
  let code = 0;
  let piped: string | undefined;
  for (let i = 0; i < seq.length; i += 1) {
    const { op, node } = seq[i]!;
    if (op === "&&" && code !== 0) continue;
    if (op === "||" && code === 0) continue;
    const result = run(ctx, node, op === "|" ? piped : undefined);
    code = result.code;
    ctx.code = code;
    if (result.err) chunks.push(result.err);
    if (seq[i + 1]?.op === "|") piped = result.out;
    else if (result.out) chunks.push(result.out);
  }
  return { output: chunks.join("\n"), code };
}

/** Runs one tool call: a command line that may chain with |, &&, ||, ; and for loops. */
export function runShell(
  input: JsonObject,
  state: ShellState,
  source: string,
  files: Files = shellFiles(input),
): ShellResult {
  if (state.inner !== undefined)
    return { output: "今天已经收笔了。", isError: true, state };
  const tired = state.commands >= shellLimits.commands;
  if (tired && !/^\s*end\b/.test(source))
    return {
      output:
        "天色已晚，今天不能再办事了。请用 end --text 写下你此刻的想法收笔。",
      isError: true,
      state,
    };
  const ctx: Ctx = {
    files: new Map([...files, ...Object.entries(state.tmp ?? {})]),
    input,
    state: tired ? state : { ...state, commands: state.commands + 1 },
    vars: new Map(),
    subs: [],
    code: 0,
  };
  let seq: Seq;
  try {
    seq = parse(source, ctx.subs);
  } catch (error) {
    return {
      output: `bash: ${(error as Error).message}`,
      isError: true,
      state: ctx.state,
    };
  }
  const result = runSeq(ctx, seq);
  return {
    output: result.output || "(无输出)",
    isError: result.code !== 0,
    state: ctx.state,
  };
}

/** The day's intents in the shape a one-shot decision takes; the day must have ended. */
export function shellDecision(state: ShellState): JsonObject {
  if (state.inner === undefined) throw new Error("The actor never ran end");
  return {
    inner: state.inner,
    documents: state.documents.map((d) => ({
      kind: d.kind,
      ...(d.to ? { to: [...d.to] } : {}),
      subject: d.subject,
      text: d.text,
    })),
    actions: state.actions.map((a) => ({
      capabilityId: a.capabilityId,
      parameters: a.parameters,
      ...(a.description ? { description: a.description } : {}),
    })),
    drafts: [...(state.drafts ?? [])],
    dispositions: [...(state.dispositions ?? [])],
    routes: [...(state.routes ?? [])],
    ...(state.report ? { report: state.report } : {}),
    ...(state.interrupt ? { interrupt: { reason: state.interrupt } } : {}),
  };
}

/** Instructions for the agent mode; the reply-format part of systemPrompt does not apply. */
export function shellSystemPrompt(input: JsonObject): string {
  const self = (input.self ?? {}) as JsonObject;
  return [
    `你在一个明代政治模拟中扮演${String(self.name)}（${String(self.office)}），不是玩家的助手。世界依照所有人物的实际行动发展，结局未定，不必照搬史书或戏剧。`,
    "你只知道终端里的信息。奏报、书信和传闻只是别人的说法，未必是真相；不要假定你知道别人心里想什么、私下做了什么。",
    "你可以想一套、说一套、做一套。皇帝只看得到送到御前的文书，看不到你的内心和私信。",
    "你面前是一台终端（bash 工具）。文件是你此刻所知的一切，命令就是你今天能做的事：查阅用 ls、cat、grep 等，发文书用 send，办事用 act。",
    "今天你看到的是今早的情形。发出的文书和办的事要等你收笔后世界才给出结果，不要声称事情已经办成。可以什么都不做。",
    "文书用半文半白的明代公文口吻，每份不超过200字。",
    ...(input.dispositionOptions !== undefined
      ? ["口奏可以报喜不报忧，但皇上另有耳目。"]
      : []),
    "办完了用 end 收笔，写下你此刻真实的想法：第一人称，不超过150字，只有你自己知道。收笔后今天就过去了。",
    "用中文书写。",
  ].join("\n");
}
