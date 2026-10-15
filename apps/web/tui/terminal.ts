import {
  createInterface,
  emitKeypressEvents,
  type Key as NodeKey,
} from "node:readline";
import type { Key } from "./state.ts";

export function decodeKey(
  text: string | undefined,
  key: NodeKey,
): Key | undefined {
  if (key.ctrl && (key.name === "c" || key.name === "d")) return "quit";
  if (text === "?") return "help";
  const aliases: Record<string, Key> = {
    h: "left",
    j: "down",
    k: "up",
    l: "right",
    return: "enter",
    enter: "enter",
    escape: "escape",
    up: "up",
    down: "down",
    left: "left",
    right: "right",
    pageup: "pageup",
    pagedown: "pagedown",
    home: "home",
    end: "end",
  };
  return aliases[key.name ?? text ?? ""];
}

export class Terminal {
  private readonly wasRaw = process.stdin.isRaw ?? false;
  private closed = false;
  private reading = false;
  private line: ReturnType<typeof createInterface> | undefined;
  private cancel: (() => void) | undefined;
  private onKey: ((key: Key) => void) | undefined;
  private onResize: (() => void) | undefined;
  private readonly handle = (text: string | undefined, key: NodeKey) => {
    if (this.reading || this.closed) return;
    const decoded = decodeKey(text, key);
    if (decoded) this.onKey?.(decoded);
  };
  private readonly resize = () => this.onResize?.();
  private readonly restore = () => this.close();
  constructor() {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        "请在交互式终端运行 npm run play（演示：npm run play -- --demo）。",
      );
    emitKeypressEvents(process.stdin);
    process.on("exit", this.restore);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", this.handle);
    process.stdout.on("resize", this.resize);
    process.stdout.write("\x1b[?1049h\x1b[?25l");
  }
  listen(onKey: (key: Key) => void, onResize: () => void): void {
    this.onKey = onKey;
    this.onResize = onResize;
  }
  draw(text: string): void {
    if (!this.closed && !this.reading)
      process.stdout.write("\x1b[H\x1b[2J" + text.replaceAll("\n", "\r\n"));
  }
  async input(frame: () => string): Promise<string | undefined> {
    this.reading = true;
    process.stdin.setRawMode(false);
    process.stdout.write(
      "\x1b[H\x1b[2J\x1b[?25h" + frame().replaceAll("\n", "\r\n") + "\r\n",
    );
    // This client already requires ANSI; TERM=dumb disables readline editing.
    const previousTerm = process.env.TERM;
    if (previousTerm === "dumb") process.env.TERM = "xterm";
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      escapeCodeTimeout: 150,
    });
    this.line = rl;
    const onInputKey = (_text: string, key: NodeKey) => {
      if (key.name === "escape") this.cancel?.();
    };
    const resize = () => {
      process.stdout.write(
        "\x1b[H\x1b[2J" + frame().replaceAll("\n", "\r\n") + "\r\n",
      );
      rl.prompt(true);
    };
    process.stdin.on("keypress", onInputKey);
    process.stdout.on("resize", resize);
    try {
      return await new Promise((resolve) => {
        let settled = false;
        const finish = (value: string | undefined) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        this.cancel = () => finish(undefined);
        rl.on("SIGINT", () => this.onKey?.("quit"));
        rl.on("close", () => finish(undefined));
        rl.question("> ", (value) => finish(value.trim() ? value : undefined));
      });
    } finally {
      this.cancel = undefined;
      process.stdin.removeListener("keypress", onInputKey);
      process.stdout.removeListener("resize", resize);
      rl.close();
      if (previousTerm === "dumb") process.env.TERM = previousTerm;
      this.line = undefined;
      this.reading = false;
      if (!this.closed) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdout.write("\x1b[?25l");
      }
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancel?.();
    this.line?.close();
    process.stdin.removeListener("keypress", this.handle);
    process.stdout.removeListener("resize", this.resize);
    process.removeListener("exit", this.restore);
    process.stdin.setRawMode(this.wasRaw);
    process.stdin.pause();
    process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
  }
}
