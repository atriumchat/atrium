import { GlobeAltIcon } from '@atrium/ui-web';

/** The globe in a window's corner, as on the landing and the web's sign-in: the other language, which it switches to. */
export function LangButton({ lang, onSwitch }: { lang: 'ru' | 'en'; onSwitch: (other: 'ru' | 'en') => void }) {
  const other = lang === 'ru' ? 'en' : 'ru';
  return (
    <button type="button" className="flow-corner-button" onClick={() => onSwitch(other)} aria-label={other === 'en' ? 'English' : 'Русский'}>
      <GlobeAltIcon width={16} height={16} aria-hidden="true" />
      {other.toUpperCase()}
    </button>
  );
}
