import { describe, expect, it } from "vitest";
import type { JsonObject } from "@throne/shared-types";
import { at } from "./calendar.ts";
import { createInitialState, ids } from "./jiajing.ts";
import { buildNpcInput, courtDecisionSchema, type CourtModel } from "./npc.ts";
import { startCourtSession } from "./session.ts";
import {
  emptyShellState,
  runShell,
  shellDecision,
  shellFiles,
  shellGreeting,
  shellLimits,
  type ShellState,
} from "./shell.ts";

const input: JsonObject = {
  runId: "r",
  decisionEpisodeId: "court:zheng-bichang:2",
  actorId: "actor:zheng-bichang",
  self: { name: "郑泌昌", office: "浙江巡抚", status: "在任" },
  documentKinds: ["memorial", "letter"],
  capabilities: [
    {
      id: "repair_dike",
      description: "调民夫修某县大堤。",
      parameters: '{"countyId":"chunan|jiande|tonglu"}',
    },
    {
      id: "buy_land",
      description: "收买稻田。",
      parameters:
        '{"countyId":"chunan|jiande|tonglu","mu":收买万亩数(1-30),"price":"fair|low"}',
    },
  ],
  contacts: [
    { id: "actor:yang-jinshui", name: "杨金水", office: "织造局监正" },
    { id: "actor:hu-zongxian", name: "胡宗宪", office: "浙直总督" },
  ],
  log: [
    {
      n: 1,
      at: "四月初一",
      type: "received",
      from: "严世蕃",
      text: "改稻为桑务必今年办成。",
    },
    {
      n: 2,
      at: "四月初十",
      type: "you_decided",
      inner: "先修堤。",
      documentsSent: [],
    },
    {
      n: 3,
      at: "四月十二",
      type: "received",
      from: "胡宗宪",
      text: "各属江堤着即督夫修固。",
    },
  ],
  now: "嘉靖三十九年四月十三 辰时",
  newFromLogEntry: 3,
  resources: { provincialGranary: 0 },
  provinceReports: [{ county: "淳安", paddyMu: 3.7, unrest: 0 }],
  policyKnownToYou: "圣旨已准改稻为桑",
};

function session() {
  let state: ShellState = emptyShellState;
  return {
    run(command: string) {
      const result = runShell(input, state, command);
      state = result.state;
      return result;
    },
    get state() {
      return state;
    },
  };
}

describe("agent shell", () => {
  it("lays the actor-visible input out as files and greets with the news", () => {
    const files = shellFiles(input);
    expect([...files.keys()].sort()).toEqual([
      "/abilities.txt",
      "/contacts.txt",
      "/log/0001-received.txt",
      "/log/0002-you_decided.txt",
      "/log/0003-received.txt",
      "/policy.txt",
      "/profile.txt",
      "/province/淳安.txt",
      "/resources.txt",
    ]);
    expect(files.get("/log/0003-received.txt")).toContain(
      "text: 各属江堤着即督夫修固。",
    );
    const greeting = shellGreeting(input);
    expect(greeting).toContain("新的经历有 1 条，从 log/0003 起");
    expect(greeting).toContain("$ help");
  });

  it("answers the usual read-only commands, pipes and chains", () => {
    const s = session();
    expect(s.run("ls").output).toBe(
      [
        "abilities.txt",
        "contacts.txt",
        "log/",
        "policy.txt",
        "profile.txt",
        "province/",
        "resources.txt",
      ].join("\n"),
    );
    expect(s.run("grep -l 胡宗宪 log/*").output).toBe("log/0003-received.txt");
    expect(s.run("ls log | tail -n 1").output).toBe("0003-received.txt");
    expect(s.run("cd log && cat 0001* | grep -c 桑").output).toBe("1");
    expect(s.run("pwd").output).toBe("/log");
    expect(s.run("cat ../policy.txt").output).toBe("圣旨已准改稻为桑");
    expect(s.run("grep 不存在 ../policy.txt || echo 没有").output).toBe("没有");
    expect(s.run("rm -rf /").output).toContain("command not found");
    const redirected = s.run("echo x > a.txt");
    expect(redirected.isError).toBe(true);
    expect(redirected.output).toContain("只读文件系统");
  });

  it("runs the loops and globs a model reaches for first", () => {
    const s = session();
    expect(
      s.run(
        'for f in log/000[1-2]*; do echo "== $f"; head -n 1 "$f"; done 2>/dev/null',
      ).output,
    ).toBe(
      [
        "== log/0001-received.txt",
        "at: 四月初一",
        "== log/0002-you_decided.txt",
        "at: 四月初十",
      ].join("\n"),
    );
    expect(
      s.run("cd province && for f in *; do cat $f | grep -c unrest; done")
        .output,
    ).toBe("1");
    expect(s.run("for x in a b\ndo\n  echo $x\ndone | tail -n 1").output).toBe(
      "b",
    );
    expect(s.run("for f in a; do echo $(ls); done").output).toBe("淳安.txt");
    expect(s.run("for f in a; echo $f").output).toContain("for 的写法");
  });

  it("handles the habits seen in the first terminal playtest", () => {
    const s = session();
    expect(s.run("send 2>&1 | head -n 1").output).toContain("用法：send");
    expect(s.run("ls log/ province/ 2>/dev/null").isError).toBe(false);
    expect(s.run("bash -c 'cat policy.txt'").output).toBe("圣旨已准改稻为桑");
    expect(
      s.run("cat > /tmp/letter1.txt <<'EOF'\n堤工紧要，\n乞速拨银。\nEOF")
        .output,
    ).toBe("(无输出)");
    expect(
      s.run("echo 又及 >> /tmp/letter1.txt && cat /tmp/letter1.txt").output,
    ).toBe("堤工紧要，\n乞速拨银。\n又及");
    expect(
      s.run(
        'send letter --to 杨金水 --subject 修堤 < /tmp/letter1.txt && send memorial --subject 疏 --text "$(head -n 1 /tmp/letter1.txt)"',
      ).isError,
    ).toBe(false);
    expect(s.state.documents.map((d) => d.text)).toEqual([
      "堤工紧要，\n乞速拨银。\n又及",
      "堤工紧要，",
    ]);
    expect(s.run("echo x > profile.txt").output).toContain("只读文件系统");
    expect(s.run("ls /tmp").output).toBe("letter1.txt");
    expect(s.run("find . -name '*received*'").output).toBe(
      "./log/0001-received.txt\n./log/0003-received.txt",
    );
    expect(s.run("ls log | sort -r | head -n 1").output).toBe(
      "0003-received.txt",
    );
    expect(s.run("for f in `ls province`; do echo $f; done").output).toBe(
      "淳安.txt",
    );
    expect(s.run("false; echo $?").output).toBe("1");
    expect(s.run("cd log; cat profile.txt").output).toContain(
      "当前目录 /log，cd / 回到起点",
    );
    expect(s.run("which send pending").output).toBe(
      "send: 终端内置命令\npending: 终端内置命令",
    );
    expect(s.run("env | grep PWD").output).toBe("PWD=/log");
  });

  it("queues letters, memorials and deeds within the day's limits", () => {
    const s = session();
    const letter = s.run(
      [
        "send letter --to actor:yang-jinshui,胡宗宪 --subject '商修堤' <<'EOF'",
        "堤工紧要，",
        "乞速拨银。",
        "EOF",
      ].join("\n"),
    );
    expect(letter.isError).toBe(false);
    expect(s.state.documents[0]).toEqual({
      kind: "letter",
      to: ["actor:yang-jinshui", "actor:hu-zongxian"],
      subject: "商修堤",
      text: "堤工紧要，\n乞速拨银。",
    });
    expect(
      s.run("send letter --to 沈一石 --subject x --text y").output,
    ).toContain("无此收件人：沈一石");
    expect(s.run("send secret_memorial --subject x --text y").output).toContain(
      "没有 secret_memorial 这种文书渠道",
    );
    expect(
      s.run('send memorial --subject "修堤疏" --text "臣已督修。"').isError,
    ).toBe(false);
    expect(s.run("act repair_dike --countyId xx").output).toContain(
      "--countyId 只能是 chunan、jiande、tonglu",
    );
    expect(
      s.run("act buy_land --countyId chunan --price low").output,
    ).toContain("缺少 --mu");
    expect(
      s.run(
        "act buy_land --countyId chunan --mu 10 --price fair --description 平价",
      ).isError,
    ).toBe(false);
    expect(s.state.actions[0]).toEqual({
      capabilityId: "buy_land",
      parameters: { countyId: "chunan", mu: 10, price: "fair" },
      description: "平价",
    });
    s.run("send memorial --subject 三 --text 三");
    expect(s.run("send memorial --subject 四 --text 四").output).toContain(
      `今天已排了 ${shellLimits.documents} 份文书`,
    );
    expect(s.run("cancel D2").output).toBe("已撤回 D2。");
    expect(s.run("pending").output).toContain("文书 2/3");

    expect(() => shellDecision(s.state)).toThrow("never ran end");
    expect(s.run("end --text '  先把堤修上。 '").output).toBe(
      "今日收笔：文书 2 份，办事 1 件。",
    );
    expect(s.run("ls").output).toBe("今天已经收笔了。");
    const decision = courtDecisionSchema.parse(shellDecision(s.state));
    expect(decision.inner).toBe("先把堤修上。");
    expect(decision.documents.map((d) => d.subject)).toEqual(["商修堤", "三"]);
    expect(decision.actions).toHaveLength(1);
  });

  it("ends the day after the command budget", () => {
    let state: ShellState = {
      ...emptyShellState,
      commands: shellLimits.commands,
    };
    const result = runShell(input, state, "ls");
    state = result.state;
    expect(result.isError).toBe(true);
    expect(result.output).toContain("天色已晚");
    expect(state.commands).toBe(shellLimits.commands);
    const ended = runShell(input, state, "end <<'EOF'\n累了。\nEOF");
    expect(ended.isError).toBe(false);
    expect(ended.state.inner).toBe("累了。");
  });
});

type Commands = (input: JsonObject, count: number) => string[];

/** A court model that plays every actor through the terminal with fixed commands. */
function terminalModel(scripts: Record<string, Commands>): CourtModel {
  return async (request) => {
    const input = JSON.parse(request.prompt.split("\n\n")[1]!) as JsonObject;
    const count = Number(request.decisionEpisodeId.split(":").at(-1));
    let state: ShellState = emptyShellState;
    for (const command of [
      ...(scripts[String(input.actorId)]?.(input, count) ?? []),
      "end --text 今日无话。",
    ]) {
      const result = runShell(input, state, command);
      if (result.isError) throw new Error(`${command}: ${result.output}`);
      state = result.state;
    }
    return JSON.stringify(shellDecision(state));
  };
}

const ids_ = (input: JsonObject, key: string, idKey: string) =>
  ((input[key] as JsonObject[] | undefined) ?? []).map((x) => String(x[idKey]));

describe("terminal days in a whole court run", () => {
  it("keeps the whole log for a terminal day", () => {
    const base = createInitialState("r");
    const state = {
      ...base,
      observations: Array.from({ length: 200 }, (_, i) => ({
        id: `obs-${i}`,
        actorId: ids.zheng,
        at: at(Math.floor(i / 12), i % 12),
        kind: "rumour",
        payload: { text: `传闻${i}` },
      })),
    };
    const log = (full: boolean) =>
      (
        buildNpcInput(state, ids.zheng, 300, "r", "zh-CN", full)
          .log as JsonObject[]
      ).length;
    expect(log(false)).toBeLessThan(200);
    expect(log(true)).toBe(200);
  });

  it("lets every role do its duty through the terminal", async () => {
    const model = terminalModel({
      [ids.yanSong]: (input) =>
        ids_(input, "memorialsAwaitingYourDraft", "memorialId").map(
          (id) => `draft ${id} --edict acknowledge --text 知道了。`,
        ),
      [ids.lvFang]: (input, count) => [
        ...ids_(input, "inbox", "documentId").map(
          (id) => `dispose ${id} present`,
        ),
        ...(count === 1 ? ["report --text 浙江诸事，奴婢都盯着。"] : []),
      ],
      [ids.luBing]: (input) =>
        ids_(input, "reportsAwaitingRouting", "reportId").map(
          (id) => `route ${id} directorate --note 照实转呈`,
        ),
      [ids.zheng]: (_input, count) =>
        count === 1
          ? [
              "cat abilities.txt | grep -c breach_dike",
              "send memorial --subject 奉旨督办改稻为桑疏 --text 臣已督率各县。",
              "act breach_dike --countyId jiande",
            ]
          : [],
    });
    const session = await startCourtSession({
      runId: "11111111-2222-3333-4444-555555555555",
      language: "zh-CN",
      model,
    });
    for (let i = 0; !session.complete && i < 120; i += 1) {
      const view = session.view;
      await session.submit({
        audienceId: view.audience!.id,
        items: view.audience!.documents.map((d) =>
          d.draft
            ? { documentId: d.id, disposition: "follow_draft" as const }
            : {
                documentId: d.id,
                disposition: "custom" as const,
                edict: { kind: "acknowledge" as const, params: {} },
              },
        ),
        specials:
          i === 3
            ? [
                {
                  edict: {
                    kind: "order_inquiry" as const,
                    params: { countyId: "jiande", agent: "jinyiwei" },
                  },
                },
              ]
            : [],
      });
    }
    expect(session.complete).toBe(true);
    const state = session.state;
    const zheng = state.decisions.find((d) => d.actorId === ids.zheng)!;
    expect(zheng.documentIds).toHaveLength(1);
    expect(
      zheng.actionIds.map((id) => state.actions[id]!.capabilityId),
    ).toEqual(["breach_dike"]);
    expect(
      Object.values(state.documents).some(
        (d) =>
          d.subject === "奉旨督办改稻为桑疏" &&
          d.draft?.edict.kind === "acknowledge",
      ),
    ).toBe(true);
    const report = Object.values(state.documents).find(
      (d) => d.fromId === ids.jinyiwei,
    )!;
    expect(report.route).toMatchObject({
      channel: "directorate",
      note: "照实转呈",
    });
    expect(
      Object.values(state.documents).some(
        (d) => d.directorate?.action === "present",
      ),
    ).toBe(true);
    expect(state.decisions.every((d) => d.rejected.length === 0)).toBe(true);
  });
});
