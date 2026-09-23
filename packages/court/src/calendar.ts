import { simTime, type SimTime } from "@throne/shared-types";

/** One SimTime unit is one shichen; see ADR 0006. */
export const SHICHEN_PER_DAY = 12;
export const CHEN = 4;
export const WU = 6;

export const at = (day: number, shichen = 0): SimTime =>
  simTime(day * SHICHEN_PER_DAY + shichen);
export const dayOf = (time: number): number =>
  Math.floor(time / SHICHEN_PER_DAY);
export const days = (count: number): number => count * SHICHEN_PER_DAY;

/** Earliest time strictly after `time` that falls on the given shichen. */
export function nextShichen(time: number, shichen: number): SimTime {
  const sameDay = dayOf(time) * SHICHEN_PER_DAY + shichen;
  return simTime(sameDay > time ? sameDay : sameDay + SHICHEN_PER_DAY);
}

const numerals = [
  "",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
];
const shichenNames = "子丑寅卯辰巳午未申酉戌亥";

function chineseDay(day: number): string {
  if (day <= 10) return "初" + numerals[day];
  if (day < 20) return "十" + numerals[day - 10];
  if (day === 20) return "二十";
  if (day < 30) return "廿" + numerals[day - 20];
  return "三十";
}

/** Approximate calendar: the reign starts on 4/1 and every month has 30 days. */
export function formatCourtTime(time: number, locale: string): string {
  const day = dayOf(time);
  const month = 4 + Math.floor(day / 30);
  const date = (day % 30) + 1;
  const shichen = time % SHICHEN_PER_DAY;
  if (locale === "en")
    return `Jiajing 39, month ${month}, day ${date}, ${shichenNames[shichen]} hour`;
  return `嘉靖三十九年${numerals[month]}月${chineseDay(date)} ${shichenNames[shichen]}时`;
}

/** Deterministic value in [0, 1) derived from the run seed and a fixed key. */
export function roll(seed: string, key: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${seed}\u0000${key}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  return (hash >>> 0) / 0x1_0000_0000;
}
