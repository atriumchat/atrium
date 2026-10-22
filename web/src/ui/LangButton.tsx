import { getLang, setLang } from '../i18n';
import { GlobeIcon } from './icons';

/**
 * The language switch before you're signed in, in a flow's corner (FlowShell `corner`), as on the landing: a globe and
 * the other language, which it switches to and remembers. Signed in, the settings have the full choice.
 */
export function LangButton() {
  const other = getLang() === 'ru' ? 'en' : 'ru';
  return (
    <button type="button" className="flow-corner-button" onClick={() => setLang(other)} aria-label={other === 'en' ? 'English' : 'Русский'}>
      <GlobeIcon size={16} />
      {other.toUpperCase()}
    </button>
  );
}
