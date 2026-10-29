import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translate, type UILanguage } from './catalog';
const Context = createContext({
  language: 'en' as UILanguage,
  setLanguage: (_language: UILanguage, _persist = true) => {},
  hasPreference: false,
});
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setValue] = useState<UILanguage>(() => {
    try {
      const saved = localStorage.getItem('chatspin.uiLanguage');
      return ['en', 'es', 'ru', 'de'].includes(saved || '') ? (saved as UILanguage) : 'en';
    } catch {
      return 'en';
    }
  });
  const [hasPreference, setPreference] = useState(() => {
    try {
      return !!localStorage.getItem('chatspin.uiLanguage');
    } catch {
      return false;
    }
  });
  const setLanguage = (value: UILanguage, persist = true) => {
    setValue(value);
    if (persist) {
      setPreference(true);
      try {
        localStorage.setItem('chatspin.uiLanguage', value);
      } catch {}
    }
  };
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = {
      en: 'ChatSpin — Give your community a turn',
      es: 'ChatSpin — Dale un turno a tu comunidad',
      ru: 'ChatSpin — Дайте слово своему сообществу',
      de: 'ChatSpin — Gib deiner Community eine Stimme',
    }[language];
  }, [language]);
  return (
    <Context.Provider value={{ language, setLanguage, hasPreference }}>{children}</Context.Provider>
  );
}
export function useI18n() {
  const context = useContext(Context);
  return {
    ...context,
    t: (message: string, values?: Record<string, unknown>) =>
      translate(message, context.language, values),
    formatDate: (date: Date) =>
      date.toLocaleString({ en: 'en-US', es: 'es-ES', ru: 'ru-RU', de: 'de-DE' }[context.language]),
  };
}
