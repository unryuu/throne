/**
 * Shown while the court thinks. The emperor sits in Xiyuan and cannot know who
 * is busy, so waits show only the palace around him and how long he has waited.
 */
const always = [
  "内阁值房灯还亮着……",
  "廊下的风吹动了帘角……",
  "远处传来更夫的梆声……",
  "小内侍换过一盏热茶……",
  "西苑檐前落下几声鸟鸣……",
  "精舍里的炉烟一缕一缕往上走……",
  "铜壶滴漏，又过了一刻……",
  "太液池上起了一层薄雾……",
  "玉熙宫的磬声远远传来……",
  "宫道上一盏灯笼慢慢过去了……",
  "烛花轻轻爆了一下……",
  "案头的朱砂渐渐干了……",
  "午门外的车马声稀了……",
  "宫墙上的乌鸦叫了两声……",
  "值夜的校尉换了一班……",
  "丹房的炉火还没有熄……",
  "一阵风过，檐下铁马叮当……",
  "御药房送来的汤药搁凉了……",
  "香篆烧到了一半……",
  "窗纸上树影晃了晃……",
];

const byMonth: readonly (readonly string[])[] = [
  ["宫墙边的槐花开了……", "柳絮飘进了廊下……", "新贡的茶在廊下煎着……"],
  ["殿角挂起了菖蒲……", "闷雷在西山那边滚过……", "艾草的气味还没散……"],
  ["太液池的荷花开了……", "树上的蝉叫个不停……", "一阵急雨打在琉璃瓦上……"],
];

/** Lines for a court time (shichen units, 12 a day, months of 30 days). */
export function atmosphereLines(time?: number): readonly string[] {
  const month = time === undefined ? -1 : Math.floor(time / 12 / 30);
  return [...always, ...(byMonth[month] ?? [])];
}

/** A line changes every four seconds; `seed` keeps each wait from opening alike. */
export function atmosphereLine(
  lines: readonly string[],
  elapsedMs: number,
  seed: number,
): string {
  const index = (seed + Math.floor(elapsedMs / 4000)) % lines.length;
  return lines[index]!;
}

export function waitedText(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes
    ? `已候 ${minutes} 分 ${seconds % 60} 秒`
    : `已候 ${seconds} 秒`;
}
