import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSetting, setSetting } from './db';
import { translate, type Lang, type StringKey } from './strings';

export type { Lang, StringKey } from './strings';

/**
 * App-wide display language, chosen once in Profile. Screens read strings
 * with `const { t } = useI18n()` and `t('key', { vars })` (src/strings.ts).
 */

const LANG_KEY = 'language';

type I18n = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (k, v) => translate('en', k, v) });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    getSetting(LANG_KEY)
      .then((v) => {
        if (v === 'sw' || v === 'en') setLangState(v);
      })
      .catch(() => {});
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    setSetting(LANG_KEY, next).catch(() => {});
  }, []);

  const t = useCallback((key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
