// Registers the agent-shell `bash` (FEAT-0009): commands run against the court's
// fake terminal, never a real shell. COURT_SHELL_DIR holds world.json (the
// actor-visible input); state.json and transcript.jsonl are written back there.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const name = "court-shell";
export const inject = ["tools"];

const maxOutputChars = 20000;

export function apply(ctx) {
  const dir = process.env.COURT_SHELL_DIR;
  const module = process.env.COURT_SHELL_MODULE;
  if (!dir || !module)
    throw new Error("court-shell needs COURT_SHELL_DIR and COURT_SHELL_MODULE");
  let loaded;
  const load = async () => {
    if (loaded) return loaded;
    const shell = await import(pathToFileURL(module).href);
    const input = JSON.parse(await readFile(join(dir, "world.json"), "utf8"));
    loaded = {
      shell,
      input,
      files: shell.shellFiles(input),
      state: shell.emptyShellState,
    };
    return loaded;
  };
  let queue = Promise.resolve();

  ctx.tools.register({
    name: "bash",
    description: [
      "Run commands in a bash shell",
      '* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.',
      "* State is persistent across command calls and discussions with the user.",
      "* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.",
      "* Please avoid commands that may produce a very large amount of output.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    execute(args) {
      // Calls run one at a time so the queued intents stay in order.
      const run = queue.then(async () => {
        const world = await load();
        const result = world.shell.runShell(
          world.input,
          world.state,
          args.command,
          world.files,
        );
        world.state = result.state;
        await writeFile(join(dir, "state.json"), JSON.stringify(result.state));
        await appendFile(
          join(dir, "transcript.jsonl"),
          JSON.stringify({
            at: Date.now(),
            command: args.command,
            output: result.output,
            isError: result.isError,
          }) + "\n",
        );
        const text =
          result.output.length > maxOutputChars
            ? result.output.slice(0, maxOutputChars) +
              "\n<输出过长，已截断；请用 head、grep 或 sed -n 缩小范围>"
            : result.output;
        if (result.isError) throw new Error(text);
        return { text };
      });
      queue = run.catch(() => undefined);
      return run;
    },
  });
}
