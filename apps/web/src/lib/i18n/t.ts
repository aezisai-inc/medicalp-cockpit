import { derived } from "svelte/store";
import { locale } from "./locale";
import { ja, type MessageKey } from "./messages/ja";
import { en } from "./messages/en";

const catalogs = { ja, en } as const;

export function translate(
  loc: "ja" | "en",
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let s: string = catalogs[loc][key] ?? ja[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Reactive translator for Svelte templates: `$t('title')` */
export const t = derived(locale, ($loc) => {
  return (key: MessageKey, vars?: Record<string, string | number>) =>
    translate($loc, key, vars);
});
