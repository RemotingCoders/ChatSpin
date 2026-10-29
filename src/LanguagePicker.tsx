import type { UILanguage } from './catalog';
import { useI18n } from './i18n';
import type { Act } from './types';
export function LanguagePicker({ act, controller = false }: { act: Act; controller?: boolean }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="language-picker">
      <span className="language-picker-label">{t('Interface language')}</span>
      <select
        aria-label={t('Interface language')}
        value={language}
        onChange={async (e) => {
          const value = e.target.value as UILanguage;
          setLanguage(value);
          if (controller) await act('ui-language', { value });
        }}
      >
        <option value="en">English</option>
        <option value="es">Español</option>
        <option value="ru">Русский</option>
        <option value="de">Deutsch</option>
      </select>
    </label>
  );
}
