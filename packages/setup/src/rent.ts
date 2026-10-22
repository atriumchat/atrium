/**
 * "No server?": the VPS the apps rent for a person who has none (BACKLOG, «Какой VPS взять»): HostVDS, Russian cards
 * and SBP, billed by the hour. Their API is OpenStack: with the login and password from the host's Account → API page
 * the app creates the server itself, with its own SSH key in it, so there's no root password at all and nothing to
 * look for in the host's panel. Checked live 22.10: a server is up with a public IP in under 20 seconds.
 *
 * Strings in, strings out: the HTTP is the platform's (`Http`): fetch on the phone, the main process on the desktop.
 */
export const RENT = {
  host: 'HostVDS',
  url: 'https://hostvds.com',
  /** Straight to the pages of their panel a person needs: signing up, paying in, the API's login and password. */
  signUp: 'https://hostvds.com/sign-up',
  pay: 'https://hostvds.com/control/billing/make-payment',
  key: 'https://hostvds.com/control/account/api',
  api: 'https://os-api.hostvds.com',
  /** Helsinki: the closest to Russia of their places. */
  region: 'eu-north3',
  /** 1 core, 2 GB, 20 GB: "Тариф 2". */
  flavor: 'hostvds-2',
  image: 'Ubuntu-24.04-amd64',
  os: 'Ubuntu 24.04',
  /** Their own security group that lets everything in; the installer's ufw closes what Atrium doesn't use. */
  group: 'allow_all',
} as const;

export type HttpRequest = { method: 'GET' | 'POST' | 'DELETE'; url: string; body?: unknown; token?: string };
export type HttpAnswer = { status: number; token?: string; json: unknown };
export type Http = (request: HttpRequest) => Promise<HttpAnswer>;

/** The platform's fetch as `Http` (the phone; Node in the desktop's main process). */
export const fetchHttp: Http = async ({ method, url, body, token }) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Auth-Token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, token: res.headers.get('X-Subject-Token') ?? undefined, json };
};

/** The rent's stages, for the screen: signing in, the server being made, the server starting. */
export type RentStage = 'login' | 'create' | 'boot';
/** login: the API login or password is wrong; money: the host won't make a server (balance, limits); failed: other. */
export type RentError = { error: 'login' | 'money' | 'failed'; detail?: string };

type Catalog = { compute: string; image: string; network: string };
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

class Refused extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

async function call(http: Http, request: HttpRequest): Promise<HttpAnswer & { json: Json }> {
  const answer = await http(request);
  if (answer.status >= 400) {
    const json = (answer.json ?? {}) as Json;
    const inner = Object.values(json).find((v) => v && typeof v === 'object') as Json | undefined;
    throw new Refused(answer.status, String(inner?.message ?? json.message ?? json.error ?? answer.status).slice(0, 200));
  }
  return { ...answer, json: (answer.json ?? {}) as Json };
}

/** What a server needs to let the app in as root: its key, for root, on first boot (Ubuntu's own user gets it too). */
export function rootKeyUserData(publicKey: string) {
  const key = publicKey.trim().replace(/'/g, '');
  return [
    '#cloud-config',
    'disable_root: false',
    'ssh_pwauth: false',
    'runcmd:',
    '  - mkdir -p /root/.ssh && chmod 700 /root/.ssh',
    `  - grep -qF '${key}' /root/.ssh/authorized_keys 2>/dev/null || echo '${key}' >> /root/.ssh/authorized_keys`,
    '  - chmod 600 /root/.ssh/authorized_keys',
    '',
  ].join('\n');
}

// Plain ASCII in, so btoa (in browsers, React Native's Hermes and Node alike) takes it as is.
const toBase64 = (text: string) => btoa(text);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes a server in the person's HostVDS account and waits for its public IP. The app's own key goes in at creation
 * (`publicKey`, an OpenSSH line), so the install connects as root with it. A network that leaves the server without
 * an address is passed for the next one. Nothing is kept: the API password is used for this and forgotten.
 */
export async function rentServer(
  http: Http,
  { login, password, publicKey, onStage }: { login: string; password: string; publicKey: string; onStage?: (stage: RentStage) => void },
): Promise<{ ip: string; id: string } | RentError> {
  let token = '';
  let catalog: Catalog;
  try {
    onStage?.('login');
    const auth = await call(http, {
      method: 'POST',
      url: `${RENT.api}/identity/v3/auth/tokens`,
      body: {
        auth: {
          identity: { methods: ['password'], password: { user: { name: login.trim(), domain: { name: 'Default' }, password } } },
          scope: { project: { name: login.trim(), domain: { id: 'default' } } },
        },
      },
    });
    token = auth.token ?? '';
    const found: Partial<Catalog> = {};
    for (const service of (auth.json.token?.catalog ?? []) as Json[]) {
      const end = ((service.endpoints ?? []) as Json[]).find((e) => e.interface === 'public' && e.region_id === RENT.region);
      if (end && ['compute', 'image', 'network'].includes(service.type)) found[service.type as keyof Catalog] = end.url;
    }
    if (!token || !found.compute || !found.image || !found.network) return { error: 'failed', detail: 'no catalog' };
    catalog = found as Catalog;
  } catch (error) {
    if (error instanceof Refused && error.status === 401) return { error: 'login' };
    return { error: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }

  const { compute, image: images, network: networks } = catalog;
  const keyName = `atrium-${Date.now()}`;
  const get = (url: string) => call(http, { method: 'GET', url, token });
  try {
    onStage?.('create');
    const flavor = ((await get(`${compute}/flavors/detail`)).json.flavors as Json[]).find((f) => f.name === RENT.flavor)?.id;
    const image = ((await get(`${images}/v2/images?name=${encodeURIComponent(RENT.image)}`)).json.images as Json[])[0]?.id;
    const nets = ((await get(`${networks}/v2.0/networks?router:external=true`)).json.networks as Json[])
      .filter((n) => /^Internet-\d+$/.test(n.name))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!flavor || !image || !nets.length) return { error: 'failed', detail: 'no plan, image or network' };

    await call(http, { method: 'POST', url: `${compute}/os-keypairs`, token, body: { keypair: { name: keyName, public_key: publicKey.trim() } } });
    for (const net of nets.slice(0, 3)) {
      const made = await call(http, {
        method: 'POST',
        url: `${compute}/servers`,
        token,
        body: {
          server: {
            name: 'atrium',
            flavorRef: flavor,
            imageRef: image,
            networks: [{ uuid: net.id }],
            key_name: keyName,
            security_groups: [{ name: RENT.group }],
            user_data: toBase64(rootKeyUserData(publicKey)),
          },
        },
      });
      const id = String(made.json.server?.id ?? '');
      onStage?.('boot');
      for (let i = 0; i < 60; i++) {
        await pause(3000);
        const server = (await get(`${compute}/servers/${id}`)).json.server as Json;
        if (server.status === 'ACTIVE') {
          const ip = Object.values((server.addresses ?? {}) as Record<string, Json[]>)
            .flat()
            .map((a) => String(a.addr))
            .find((addr) => /^\d+\.\d+\.\d+\.\d+$/.test(addr));
          if (ip) return { ip, id };
          break;
        }
        if (server.status === 'ERROR') break;
      }
      // This network left it without an address: the server goes, the next network is tried.
      await call(http, { method: 'DELETE', url: `${compute}/servers/${id}`, token }).catch(() => undefined);
    }
    return { error: 'failed', detail: 'no server came up' };
  } catch (error) {
    if (error instanceof Refused && (error.status === 402 || error.status === 403 || /balance|fund|money|quota|limit/i.test(error.detail))) {
      return { error: 'money', detail: error.detail };
    }
    return { error: 'failed', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    // The key is in the server by now; the account doesn't need to keep it.
    await call(http, { method: 'DELETE', url: `${compute}/os-keypairs/${keyName}`, token }).catch(() => undefined);
  }
}
