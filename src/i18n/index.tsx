import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { zh } from './zh.ts';
import { en, type Messages } from './en.ts';

export type Lang = 'zh' | 'en';

const MESSAGES: Record<Lang, Messages> = { zh, en };

/** Flattens the message tree into the union of dotted key paths. */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

export type MessageParams = Record<string, string | number>;

function lookup(lang: Lang, key: string): string {
  const parts = key.split('.');
  let node: unknown = MESSAGES[lang];
  for (const p of parts) {
    if (node === null || typeof node !== 'object') return key;
    node = (node as Record<string, unknown>)[p];
  }
  return typeof node === 'string' ? node : key;
}

/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

const LOCALES: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US' };

export interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  /** Locale-aware number formatting, used everywhere a value is displayed. */
  n: (value: number | null | undefined, digits?: number) => string;
  /** Compact form for tiles and axes (1.2万 / 1.2K). */
  nCompact: (value: number | null | undefined) => string;
  pct: (value: number | null | undefined, digits?: number) => string;
  d: (value: number | Date | null | undefined, withTime?: boolean) => string;
  locale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = 'datalens.lang';

function readInitialLang(): Lang {
  if (typeof window === 'undefined') return 'zh';
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'zh') return fromUrl;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    /* storage may be unavailable in private mode */
  }
  // Fall back to the browser's preference, defaulting to Chinese for zh-* and
  // for anything unrecognised.
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage may be unavailable in private mode */
    }
    // Keep the URL shareable in the chosen language without adding a history entry.
    const url = new URL(window.location.href);
    if (url.searchParams.get('lang') !== l) {
      url.searchParams.set('lang', l);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const toggleLang = useCallback(() => setLang(lang === 'zh' ? 'en' : 'zh'), [lang, setLang]);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title =
      lang === 'zh' ? 'DataLens · 可视化 pandas' : 'DataLens · A visual pandas';
  }, [lang]);

  const value = useMemo<I18nValue>(() => {
    const locale = LOCALES[lang];
    const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
    const nf0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const nfCompact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    const df = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const dtf = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      lang,
      setLang,
      toggleLang,
      locale,
      t: (key, params) => interpolate(lookup(lang, key), params),
      n: (v, digits) => {
        if (v === null || v === undefined || !Number.isFinite(v)) return '—';
        if (digits === 0) return nf0.format(v);
        if (digits !== undefined) {
          return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
        }
        return nf.format(v);
      },
      nCompact: (v) => {
        if (v === null || v === undefined || !Number.isFinite(v)) return '—';
        return nfCompact.format(v);
      },
      pct: (v, digits) => {
        if (v === null || v === undefined || !Number.isFinite(v)) return '—';
        return new Intl.NumberFormat(locale, {
          style: 'percent',
          maximumFractionDigits: digits ?? 1,
        }).format(v);
      },
      d: (v, withTime) => {
        if (v === null || v === undefined) return '—';
        const date = v instanceof Date ? v : new Date(v);
        if (Number.isNaN(date.getTime())) return '—';
        return withTime ? dtf.format(date) : df.format(date);
      },
    };
  }, [lang, setLang, toggleLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Convenience hook for components that only need `t`. */
export function useT() {
  return useI18n().t;
}
