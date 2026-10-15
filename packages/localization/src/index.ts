import { en, zhCN, type MessageKey } from "./catalogs.ts";

export type Locale = "zh-CN" | "en";
export type TranslationParameters = Readonly<Record<string, string | number>>;
export type Translator = (
  key: MessageKey,
  parameters?: TranslationParameters,
) => string;

export const defaultLocale: Locale = "zh-CN";
export const supportedLocales: readonly Locale[] = ["zh-CN", "en"];

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  "zh-CN": zhCN,
  en,
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && supportedLocales.includes(value as Locale)
  );
}

export function createTranslator(locale: Locale): Translator {
  return (key, parameters = {}) => {
    const template = catalogs[locale][key] ?? en[key];
    return template.replace(/\{([a-zA-Z0-9_]+)\}/gu, (match, name: string) => {
      const value = parameters[name];
      return value === undefined ? match : String(value);
    });
  };
}

export function translateToken(translator: Translator, value: string): string {
  const key = `token.${value}` as MessageKey;
  return key in en ? translator(key) : value.replaceAll("_", " ");
}

export type { MessageKey } from "./catalogs.ts";

export function courtGlossary(
  t: Translator,
): readonly { readonly term: string; readonly definition: string }[] {
  return (
    [
      "follow",
      "draft",
      "hold",
      "rescript",
      "custom",
      "special",
      "reprimand",
      "arrest",
      "question",
      "seclusion",
      "directorate",
      "bureau",
      "guard",
      "rumor",
      "brief",
      "energy",
    ] as const
  ).map((key) => ({
    term: t(`court.glossary.${key}`),
    definition: t(`court.glossary.${key}.definition`),
  }));
}
