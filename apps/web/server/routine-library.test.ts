import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadRoutineLibrary, routineLibraryReport } from "./routine-library.ts";

const block = (title: string) => `### R001 · 其他
- 标题：${title}
- 现代标题：呈报杂事
- 正文：谨奏杂事。
- 现代正文：向皇上报告一件杂事。
- 归纳：小事也得报。
- 时令：不限
- 可信度：虚构
- 出处：无
`;

it("loads only top-level markdown in filename order, with source/category/credibility counts and every warning", async () => {
  const path = await mkdtemp(join(tmpdir(), "routine-library-"));
  await mkdir(join(path, "drafts"));
  await Promise.all([
    writeFile(join(path, "b - 010.md"), block("甲奏")),
    writeFile(join(path, "a - 010.md"), block("甲奏")),
    writeFile(join(path, "b - 020.md"), block("乙奏")),
    writeFile(join(path, "a - 020.md"), block("丙奏")),
    writeFile(join(path, "drafts", "草稿.md"), block("未完稿")),
    writeFile(join(path, "说明.txt"), block("说明稿")),
  ]);
  const result = await loadRoutineLibrary(path);
  expect(result.entries.map((e) => e.key)).toEqual(["a/R001", "b/R001"]);
  expect(result.warnings).toHaveLength(2);
  expect(result.warnings.join()).toContain("来源/编号重复");
  const report = routineLibraryReport(result);
  expect(report).toContain("杂事奏疏库：加载 2 条");
  expect(report).toContain("来源：\n  a：1\n  b：1");
  expect(report).toContain("类别：\n  其他：2");
  expect(report).toContain("可信度：\n  虚构：2");
  for (const warning of result.warnings) expect(report).toContain(warning);
});
