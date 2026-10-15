import { z } from "zod";

export const courtSettingsSchema = z.object({
  register: z.enum(["classical", "plain", "modern"]).default("classical"),
  summaries: z.boolean().default(true),
});
export type CourtSettings = Readonly<z.infer<typeof courtSettingsSchema>>;
export type CourtRegister = CourtSettings["register"];
export const registerInstruction = (register: CourtRegister = "classical") =>
  ({
    classical: "文书半文半白，内心与聊天用古代白话。",
    plain: "文书用浅白文言，内心与聊天用现代汉语。",
    modern:
      "标题、文书、批语、内心与聊天全部用现代汉语，保留官职与称谓，不用“谨奏、着即、毋得”等文言套话，也不用网络口语。如“臣谨奏，伏乞圣裁”写成“臣报告，请皇上决定”。",
  })[register];
