import type { Locale } from "antd/es/locale/index.js";
import * as enUSModule from "antd/es/locale/en_US.js";
import * as zhCNModule from "antd/es/locale/zh_CN.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { zhMessages, type MessageKey } from "./messages/zh-CN.js";
import { enMessages } from "./messages/en-US.js";
export type { MessageKey } from "./messages/zh-CN.js";

export type AppLocale = "en-US" | "zh-CN";

const enUS = enUSModule.default as unknown as Locale;
const zhCN = zhCNModule.default as unknown as Locale;

export type Translate = (key: MessageKey, variables?: Record<string, string | number>) => string;

const localeStorageKey = "compulsive.locale";

export function translate(
  locale: AppLocale,
  key: MessageKey,
  variables: Record<string, string | number> = {},
): string {
  const message = (locale === "zh-CN" ? zhMessages : enMessages)[key];
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in variables ? String(variables[name]) : placeholder,
  );
}

function detectLocale(): AppLocale {
  try {
    const stored = window.localStorage.getItem(localeStorageKey);
    if (stored === "en-US" || stored === "zh-CN") return stored;
  } catch {
    // The browser language remains a safe fallback when storage is unavailable.
  }
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

interface I18nContextValue {
  antdLocale: Locale;
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: Translate;
  formatDateTime: (value: string | number | Date) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(detectLocale);
  const setLocale = useCallback((nextLocale: AppLocale) => {
    try {
      window.localStorage.setItem(localeStorageKey, nextLocale);
    } catch {
      // The current session can still switch languages without persistence.
    }
    setLocaleState(nextLocale);
  }, []);
  const t = useCallback<Translate>((key, variables) => translate(locale, key, variables), [locale]);
  const value = useMemo<I18nContextValue>(
    () => ({
      antdLocale: locale === "zh-CN" ? zhCN : enUS,
      locale,
      setLocale,
      t,
      formatDateTime: (date) =>
        new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(
          new Date(date),
        ),
    }),
    [locale, setLocale, t],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("app.title");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t("app.description"));
  }, [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside LanguageProvider.");
  return context;
}
