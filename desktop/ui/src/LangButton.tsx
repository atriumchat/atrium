/** The globe in a window's corner, as on the landing and the web's sign-in: the other language, which it switches to. */
export function LangButton({ lang, onSwitch }: { lang: 'ru' | 'en'; onSwitch: (other: 'ru' | 'en') => void }) {
  const other = lang === 'ru' ? 'en' : 'ru';
  return (
    <button type="button" className="flow-corner-button" onClick={() => onSwitch(other)} aria-label={other === 'en' ? 'English' : 'Русский'}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
        <path d="M4.5 7.5h15" />
        <path d="M4.5 16.5h15" />
      </svg>
      {other.toUpperCase()}
    </button>
  );
}
