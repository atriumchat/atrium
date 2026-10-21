/** What a person types into the flows, checked the same way everywhere before anything is sent. */

/** A free name under dedyn.io: letters, digits and inner hyphens, 3 to 63 long. */
export const NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
export const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Something@something.zone, with no spaces: enough to catch a slip before deSEC sends a letter nowhere. */
export const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
export const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+:[0-9a-f:]+$/i;

/** A server's address as typed: an IP, or a host name. */
export const hostOk = (value: string) => {
  const v = value.trim();
  return IPV4.test(v) || IPV6.test(v) || DOMAIN.test(v.toLowerCase());
};

/** The free name out of what was typed: lower case, no spaces, without a pasted ".dedyn.io". */
export const freeName = (value: string) => value.replace(/\s/g, '').toLowerCase().replace(/\.dedyn\.io$/, '');
export const nameOk = (value: string) => NAME.test(freeName(value));
export const emailOk = (value: string) => EMAIL.test(value.trim());
export const domainOk = (value: string) => DOMAIN.test(value.trim().toLowerCase());

/** The setup code install.sh makes: 10 letters and digits (INVITE_CODE in .env). */
export const CODE_LENGTH = 10;

/** The code out of anything pasted: the whole link from the installer, or the code itself. */
export function codeFrom(text: string) {
  let value = text.trim();
  try {
    value = new URL(value).searchParams.get('setup') ?? value;
  } catch {
    // Not a link: the code itself.
  }
  return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export const MIN_PASSWORD = 8;

/** The admin's nick and password, twice: ready when all three hold, a mismatch once the repeat is as long as the first. */
export function adminForm(nick: string, password: string, repeat: string) {
  return {
    ready: !!nick.trim() && password.length >= MIN_PASSWORD && repeat === password,
    mismatch: repeat !== '' && repeat.length >= password.length && repeat !== password,
  };
}
