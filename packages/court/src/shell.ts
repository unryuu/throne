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
};
export type ShellResult = {
  readonly output: string;
  readonly isError: boolean;
  readonly state: ShellState;
};

export const shellLimits = { documents: 3, actions: 3, commands: 30 };

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
  for (const entry of arr<JsonObject>(input.log)) {
    const { n, type, ...rest } = entry;
    files.set(
      `/log/${pad(Number(n))}-${String(type)}.txt`,
      render(rest as JsonObject) + "\n",
    );
  }
  for (const key of Object.keys(input))
    if (!used.has(key)) put(`/other/${key}.txt`, key);
  return files;
}

export function shellHelp(): string {
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
    "",
    "查阅：ls cat head tail grep wc sed -n echo，可用管道 |、&&、for 循环。",
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
    "pending 看今天已排的文书和事，cancel 编号 撤回一项。",
    "",
    "文书和事要等你收笔后世界才往前走。办完了就不再执行命令，只写下你此刻的想法收笔。",
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
  return [`${String(input.now)}。${news}`, "", "$ help", shellHelp()].join(
    "\n",
  );
}

// ---------- parsing ----------

type Command = { argv: string[]; heredoc?: string[] };
type Op = "|" | "&&" | "||" | ";";
type Node =
  | { kind: "cmd"; command: Command }
  | { kind: "for"; name: string; words: string[]; body: Seq };
type Seq = { op: Op | undefined; node: Node }[];
type Token = string | { op: Op | ">" | "<" } | { heredoc: string[] };

/** Variable references are kept as \u0001NAME\u0002 inside words until run time. */
function variable(source: string, i: number): { text: string; end: number } {
  if (source[i + 1] === "(") throw new Error("不支持命令替换 $(...)");
  const m = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/.exec(source.slice(i));
  if (!m) return { text: "$", end: i + 1 };
  return { text: `\u0001${m[1] ?? m[2]}\u0002`, end: i + m[0].length };
}

function tokenize(source: string): Token[] {
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
        if (source[j] === "$") {
          const v = variable(source, j);
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
    if (c === "$") {
      const v = variable(source, i);
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
    if (two === "&&" || two === "||") {
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

function parse(source: string): Seq {
  const tokens = tokenize(source);
  let i = 0;
  const opAt = (k: number) => {
    const t = tokens[k];
    return t !== undefined && typeof t !== "string" && "op" in t
      ? t.op
      : undefined;
  };
  /** Swallows `> /dev/null` and `2> /dev/null`; other redirections are refused. */
  const redirect = (): boolean => {
    const numbered = tokens[i] === "2" && opAt(i + 1) === ">";
    if (!numbered && opAt(i) !== ">" && opAt(i) !== "<") return false;
    const at = numbered ? i + 1 : i;
    if (opAt(at) === ">" && tokens[at + 1] === "/dev/null") {
      i = at + 2;
      return true;
    }
    throw new Error("只读文件系统，不能重定向");
  };
  const command = (): Node => {
    const cmd: Command = { argv: [] };
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (typeof t === "string") {
        if (t === "2" && opAt(i + 1) === ">" && redirect()) continue;
        cmd.argv.push(t);
        i += 1;
        continue;
      }
      if ("heredoc" in t) {
        cmd.heredoc = t.heredoc;
        i += 1;
        continue;
      }
      if (redirect()) continue;
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
    while (redirect()) continue;
    return { kind: "for", name, words, body };
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
  files: Files;
  input: JsonObject;
  state: ShellState;
  vars: Map<string, string>;
};

const substitute = (ctx: Ctx, word: string) =>
  word.replace(
    /\u0001(\w+)\u0002/g,
    (_, name: string) => ctx.vars.get(name) ?? "",
  );

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
  path === "/" || [...files.keys()].some((f) => f.startsWith(path + "/"));

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

function read(ctx: Ctx, path: string): string {
  const full = resolve(ctx.state.cwd, path);
  const text = ctx.files.get(full);
  if (text !== undefined) return text;
  if (isDir(ctx.files, full)) throw new Error(`${path}: 是一个目录`);
  throw new Error(`${path}: 没有那个文件或目录`);
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
    if (!isDir(ctx.files, path)) throw new Error(`${t}: 没有那个文件或目录`);
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

function send(ctx: Ctx, argv: string[], io: Io): Out {
  const kinds = arr<string>(ctx.input.documentKinds);
  const kind = argv[0];
  if (!kind || kind.startsWith("--"))
    throw new Error(
      `用法：send <${kinds.join("|")}> --subject 题目 --text 正文`,
    );
  if (!kinds.includes(kind))
    throw new Error(`你没有 ${kind} 这种文书渠道，可用：${kinds.join("、")}`);
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
  return {
    code: 0,
    out: [
      `文书 ${d.length}/${shellLimits.documents}`,
      ...d,
      `办事 ${a.length}/${shellLimits.actions}`,
      ...a,
    ].join("\n"),
  };
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

function exec(ctx: Ctx, command: Command, io: Io): Out {
  const [name, ...args] = command.argv;
  const stdin = command.heredoc ? command.heredoc.join("\n") : io.stdin;
  const local = { stdin };
  switch (name) {
    case "help":
      return { out: shellHelp(), code: 0 };
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
      return { out: args.join(" "), code: 0 };
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
    default:
      return {
        out: "",
        err: `bash: ${name}: command not found（help 查看可用命令）`,
        code: 127,
      };
  }
}

/** Runs one tool call: a command line that may chain with |, &&, || and ;. */
function run(ctx: Ctx, node: Node, stdin: string | undefined): Out {
  if (node.kind === "cmd") {
    const command = {
      ...node.command,
      argv: node.command.argv.map((a) => substitute(ctx, a)),
    };
    try {
      return exec(ctx, command, { stdin });
    } catch (error) {
      return {
        out: "",
        err: `${command.argv[0]}: ${(error as Error).message}`,
        code: 1,
      };
    }
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
  return { out: chunks.join("\n"), code };
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
  if (state.commands >= shellLimits.commands)
    return {
      output: "天色已晚，今天不能再办事了。请直接写下你此刻的想法收笔。",
      isError: true,
      state,
    };
  const ctx: Ctx = {
    files,
    input,
    state: { ...state, commands: state.commands + 1 },
    vars: new Map(),
  };
  let seq: Seq;
  try {
    seq = parse(source);
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

/** The day's intents in the shape a one-shot decision takes. */
export function shellDecision(state: ShellState, inner: string): JsonObject {
  return {
    inner: inner.trim().slice(0, 1200) || "（未写）",
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
    "办完了就不再调用工具，收笔时只写你此刻真实的想法：第一人称，不超过150字，只有你自己知道。不要复述今天发了什么、办了什么，世界自会记下。",
    "用中文书写。",
  ].join("\n");
}
