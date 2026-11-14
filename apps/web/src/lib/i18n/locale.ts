import { writable, get } from "svelte/store";

export type Locale = "ja" | "en";

const STORAGE_KEY = "care-audit-locale";

function readInitial(): Locale {
  if (typeof localStorage === "undefined") return "ja";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "en" ? "en" : "ja";
}

export const locale = writable<Locale>(readInitial());

export function getLocale(): Locale {
  return get(locale);
}

export function setLocale(next: Locale) {
  locale.set(next);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, next);
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
}

if (typeof document !== "undefined") {
  document.documentElement.lang = getLocale();
}
