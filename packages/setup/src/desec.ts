/**
 * The deSEC side of a free address (name.dedyn.io), as data: what's sent, and what an answer means as an error code
 * the app words in its own language (own.desec.<code> on the phone). The requests themselves go out from the app.
 */

export const DESEC = 'https://desec.io/api/v1';

export type DesecError =
  | { code: 'down' | 'tooOften' | 'nameTaken' | 'denied' | 'gone' | 'noAccess' | 'savedRejected' | 'nameRule' | 'startOver' | 'cancelled' | 'linkExpired' }
  | { code: 'badEmail' | 'badName' | 'other' | 'accountDenied'; said: string }
  | { code: 'notAccepted'; status: number };

export type Answer = { status: number; json: any; text?: string };

/** The account, with the name in it; deSEC mails the link and asks the captcha on its page, not here. */
export const registerBody = ({ name, email, password }: { name: string; email: string; password: string }) => ({
  email: email.trim(),
  password,
  domain: `${name}.dedyn.io`,
  outreach_preference: false,
});

/** What a sign-up answer other than 202 means. */
export function registerError({ status, json }: Answer): DesecError {
  const body = json ?? {};
  const said = (field: string) => [body[field]].flat(2).filter((x: unknown) => typeof x === 'string').join(' ');
  if (status === 429) return { code: 'tooOften' };
  if (body.email) return { code: 'badEmail', said: said('email') };
  if (body.domain && /conflicts with an existing domain|disallowed by policy/i.test(said('domain'))) return { code: 'nameTaken' };
  if (body.domain) return { code: 'badName', said: said('domain') };
  if (body.code === 'registration_denied') return { code: 'denied' };
  return { code: 'other', said: JSON.stringify(body).slice(0, 160) };
}

/** What a refused sign-in with an account kept from before means. */
export function loginError({ status, json, text = '' }: Answer): DesecError {
  if (status === 429) return { code: 'tooOften' };
  const said = typeof json?.detail === 'string' ? json.detail : text.slice(0, 160);
  // deSEC answers a wrong password with 403 "Invalid username/password".
  if (status === 400 || status === 401 || /invalid username\/password/i.test(said)) return { code: 'savedRejected' };
  // Any other refusal in deSEC's own words (a locked account): the person can act on it.
  if (status === 403) return { code: 'accountDenied', said };
  return { code: 'other', said: `${status} ${said}` };
}

/** The name and everything under it (app., the relay) to the server's address. */
export const pointRecords = (ip: string) => [
  { subname: '', type: 'A', ttl: 3600, records: [ip] },
  { subname: '*', type: 'A', ttl: 3600, records: [ip] },
];

/** What an answer to pointing the name means: null when deSEC took it. */
export function pointError({ status }: Pick<Answer, 'status'>): DesecError | null {
  if (status === 200) return null;
  if (status === 404) return { code: 'gone' };
  if (status === 401 || status === 403) return { code: 'noAccess' };
  if (status === 429) return { code: 'tooOften' };
  return { code: 'notAccepted', status };
}
