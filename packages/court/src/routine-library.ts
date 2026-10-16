export type RoutineEntry = {
  readonly key: string;
  readonly source: string;
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly modernTitle: string;
  readonly text: string;
  readonly modernText: string;
  readonly gloss: string;
  readonly season: "不限" | "四月" | "五月" | "六月";
  readonly credibility: "据实" | "化用" | "虚构";
  readonly citation: string;
  readonly authorNote: string;
};

/** A lazy server loader lets saved facts replay without reading the library. */
export type RoutineLibraryInput =
  readonly RoutineEntry[] | (() => Promise<readonly RoutineEntry[]>);

export type RoutineLibrary = {
  readonly entries: readonly RoutineEntry[];
  readonly warnings: readonly string[];
};

const fields = new Set([
  "标题",
  "现代标题",
  "正文",
  "现代正文",
  "归纳",
  "时令",
  "可信度",
  "出处",
  "作者注",
]);

/** File order determines which duplicate survives; the Node loader sorts names. */
export function parseRoutineLibrary(
  files: readonly { readonly name: string; readonly text: string }[],
): RoutineLibrary {
  const entries: RoutineEntry[] = [];
  const warnings: string[] = [];
  const titles = new Map<string, string>();
  const keys = new Set<string>();
  for (const file of files) {
    const source = file.name.split(" - ")[0]!;
    const blocks = [
      ...file.text.matchAll(/^###\s+(R\d+)\s*·\s*([^\r\n]+)\r?$/gm),
    ];
    for (const [index, heading] of blocks.entries()) {
      const id = heading[1]!;
      const key = `${source}/${id}`;
      const location = `${file.name}: ${key}`;
      const block = file.text.slice(
        heading.index + heading[0].length,
        blocks[index + 1]?.index ?? file.text.length,
      );
      const values: Record<string, string> = {};
      for (const match of block.matchAll(
        /^\s*-\s*([^：\r\n]+)：([^\r\n]*)/gm,
      )) {
        const field = match[1]!.trim();
        if (fields.has(field)) values[field] = match[2]!.trim();
      }
      const errors: string[] = [];
      for (const field of fields) {
        if (field !== "作者注" && !values[field])
          errors.push(`缺少必填字段「${field}」`);
        if (/[0-9０-９]/u.test(values[field] ?? ""))
          errors.push(`「${field}」出现阿拉伯数字`);
      }
      if (!["不限", "四月", "五月", "六月"].includes(values.时令 ?? ""))
        errors.push("时令不在允许值内");
      if (!["据实", "化用", "虚构"].includes(values.可信度 ?? ""))
        errors.push("可信度不在允许值内");
      // The prompt only caps the formal register; modern versions run longer.
      for (const field of ["标题", "现代标题", "正文", "现代正文"]) {
        const limit = field.includes("标题") ? 20 : 120;
        const length = [...(values[field] ?? "")].length;
        if (length <= limit) continue;
        if (field.startsWith("现代"))
          warnings.push(
            `${location}: 「${field}」${length}字，超过${limit}字（仅警告）`,
          );
        else errors.push(`「${field}」${length}字，超过${limit}字`);
      }
      const noteLength = [...(values.作者注 ?? "")].length;
      if (noteLength > 60)
        warnings.push(`${location}: 作者注${noteLength}字，超过60字（仅警告）`);
      if (keys.has(key)) errors.push("来源/编号重复");
      const previous = titles.get(values.标题 ?? "");
      if (previous) errors.push(`标题重复，保留先出现的 ${previous}`);
      if (errors.length) {
        warnings.push(`${location}: 跳过：${errors.join("；")}`);
        continue;
      }
      const entry: RoutineEntry = {
        key,
        source,
        id,
        category: heading[2]!.trim(),
        title: values.标题!,
        modernTitle: values.现代标题!,
        text: values.正文!,
        modernText: values.现代正文!,
        gloss: values.归纳!,
        season: values.时令 as RoutineEntry["season"],
        credibility: values.可信度 as RoutineEntry["credibility"],
        citation: values.出处!,
        authorNote: values.作者注 ?? "",
      };
      entries.push(entry);
      keys.add(key);
      titles.set(entry.title, key);
    }
  }
  return { entries, warnings };
}
