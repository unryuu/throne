import { formatCourtTime } from "@throne/court";
import type { CourtSnapshot } from "../../server/court-service.ts";
import type { RunChoice } from "../../tui/state.ts";

export type DeskMemory = {
  readonly runs: readonly RunChoice[];
  readonly packs: readonly string[];
  readonly warning: string;
};
export const memoryKey = "throne.desk";
export function recall(storage: Pick<Storage, "getItem">): DeskMemory {
  try {
    const raw = storage.getItem(memoryKey);
    if (!raw) {
      const id = storage.getItem("throne.courtRun");
      return {
        runs: id ? [{ id, label: "最近的御案" }] : [],
        packs: [],
        warning: "",
      };
    }
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("runs" in value) ||
      !("packs" in value) ||
      !Array.isArray(value.runs) ||
      !value.runs.every(
        (r: unknown) =>
          r &&
          typeof r === "object" &&
          "id" in r &&
          typeof r.id === "string" &&
          "label" in r &&
          typeof r.label === "string",
      ) ||
      !Array.isArray(value.packs) ||
      !value.packs.every((p: unknown) => typeof p === "string")
    )
      throw new Error("浏览器存档索引格式不正确");
    return { runs: value.runs, packs: value.packs, warning: "" };
  } catch (error) {
    return {
      runs: [],
      packs: [],
      warning: `无法读取浏览器存档索引：${String(error)}。服务端存档未删除。`,
    };
  }
}
export function remember(
  memory: DeskMemory,
  snapshot: CourtSnapshot,
  storage: Pick<Storage, "setItem">,
): DeskMemory {
  const next = {
    runs: [
      {
        id: snapshot.id,
        label: `${formatCourtTime(snapshot.view.time, "zh-CN")} · ${snapshot.status === "complete" ? "已落幕" : "未完"}`,
      },
      ...memory.runs.filter((r) => r.id !== snapshot.id),
    ],
    packs: [
      ...new Set([
        ...memory.packs,
        ...(snapshot.openingPackId ? [snapshot.openingPackId] : []),
      ]),
    ],
    warning: "",
  };
  try {
    storage.setItem(memoryKey, JSON.stringify(next));
    return next;
  } catch {
    return {
      ...next,
      warning:
        "浏览器无法保存存档入口。服务端已存档，请保留当前页面地址以便继续。",
    };
  }
}
