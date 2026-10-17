import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GomexMark } from '../ui/Logo';
import { HashIcon, HomeIcon, SearchIcon, SpeakerIcon } from '../ui/icons';

/**
 * The wizard's right half, as in the desktop app's "Свой сервер" (desktop/onboarding.js): what the step is about,
 * filmed like Linear's onboarding — a camera close over a whole screen of Gomex at work, never showing its edges,
 * from two angles with hard cuts, dim, the spot that matters sharp and the rest soft. Each screen is drawn from the
 * person's own answers (the server's name and icon, the nick, the key, the link) and stays alive: messages come
 * in, friends arrive, a highlight walks.
 */

export type SceneName = 'code' | 'server' | 'admin' | 'key' | 'invite' | 'room';

/** What has been typed so far, for the pictures. */
export type Facts = {
  /** app.example.com: where this page is open. */
  host: string;
  code: string;
  serverName: string;
  /** The icon as it will look (a preview of the crop or the uploaded one), or null for Gomex's mark. */
  icon: string | null;
  nick: string;
  /** The admin's colour, once the account exists. */
  color: string;
  passwordLength: number;
  key: string;
  /** The invite link, without https://. */
  link: string;
};

const FRIENDS = [
  { name: 'Аня', color: '#eb459e' },
  { name: 'Дима', color: '#3ba55c' },
  { name: 'Лёша', color: '#faa61a' },
  { name: 'Катя', color: '#9b59b6' },
];

const letter = (name: string) => name.trim().charAt(0).toUpperCase() || '?';
const dots = (n: number) => '•'.repeat(Math.max(8, Math.min(n, 16)));

const LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="10.5" width="15" height="10" rx="3" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);

/* ---------- the pieces screens are made of ---------- */

/** A browser with its tabs down the side, Gomex open in it on this very address. */
function Browser({ host, children }: { host: string; children: ReactNode }) {
  return (
    <>
      <div className="side">
        <div className="lights">
          <i />
          <i />
          <i />
        </div>
        <p className="url">
          {LOCK}
          <span>{host}</span>
        </p>
        <p className="tabrow on">
          <span className="favicon">
            <GomexMark size={20} />
          </span>
          Gomex
        </p>
        <p className="tabrow">
          <span className="favicon">П</span>Почта
        </p>
        <p className="tabrow">
          <span className="favicon">М</span>Музыка
        </p>
        <p className="tabrow">
          <span className="favicon">+</span>Новая вкладка
        </p>
      </div>
      <div className="page">{children}</div>
    </>
  );
}

function Face({ name, color, small = false, here = false }: { name: string; color: string; small?: boolean; here?: boolean }) {
  return (
    <span className={`face${small ? ' small' : ''}${here ? ' here' : ''}`} style={{ background: color }}>
      {letter(name)}
    </span>
  );
}

/** The server's circle in the rail: its icon, or the white circle with Gomex's mark. */
function ServerCircle({ icon }: { icon: string | null }) {
  return <span className="circle on">{icon ? <img src={icon} alt="" /> : <GomexMark size={28} />}</span>;
}

/** Gomex on the server's side: the rail, the channel list (or `list`), your card, and `main`. */
function App({ facts, list, main, tip = false }: { facts: Facts; list?: ReactNode; main: ReactNode; tip?: boolean }) {
  const nick = facts.nick || 'Админ';
  return (
    <div className="app">
      <div className="panel rail">
        <span className="circle">
          <HomeIcon size={26} />
        </span>
        <span className="spot">
          <span className="pin" />
          <ServerCircle icon={facts.icon} />
          {tip && <span className="tip focus">{facts.serverName}</span>}
        </span>
      </div>
      <div className="panel list">
        <p className="find">
          <SearchIcon size={18} />
          Найти канал
        </p>
        {list ?? <Channels />}
        <div className="me">
          <Face name={nick} color={facts.color} here />
          <p>
            {nick}
            <small>В сети</small>
          </p>
        </div>
      </div>
      <div className="panel main">{main}</div>
    </div>
  );
}

function Channels({ room }: { room?: ReactNode }) {
  return (
    <>
      <p className="sect">Текстовые каналы</p>
      <p className={`chan${room ? '' : ' on'}`}>
        <i>#</i>общий
      </p>
      <p className="chan">
        <i>#</i>игры
      </p>
      <p className="chan">
        <i>#</i>мемы
      </p>
      <p className="sect" style={{ marginTop: 18 }}>
        Голосовые комнаты
      </p>
      {room ?? (
        <p className="chan">
          <SpeakerIcon size={18} className="opacity-60" />
          Общий
        </p>
      )}
      <p className="chan">
        <SpeakerIcon size={18} className="opacity-60" />
        Катка
      </p>
    </>
  );
}

const CHAT = [
  { ...FRIENDS[0], text: 'ну что, сегодня в 9?' },
  { ...FRIENDS[1], text: 'я за' },
  { ...FRIENDS[2], text: 'кто в Катку?' },
  { ...FRIENDS[3], text: 'зашла 🔥' },
  { ...FRIENDS[0], text: 'го' },
  { ...FRIENDS[1], text: 'через 5 мин' },
];

function Chat({ at }: { at: number }) {
  return (
    <>
      <p className="head">
        <HashIcon size={20} className="opacity-50" />
        общий
      </p>
      <div className="chat">
        {CHAT.map((m, k) => (
          <div key={k} className={`msg${k > at ? ' later' : ''}`}>
            <Face name={m.name} color={m.color} />
            <p>
              <b>{m.name}</b>
              <span>{m.text}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="compose">Написать в #общий</p>
    </>
  );
}

/** The sign-in page as Login draws it, its form being `children`. */
function SignIn({ icon, children }: { icon: string | null; children: ReactNode }) {
  return (
    <div className="signin">
      <span className="big">{icon ? <img src={icon} alt="" /> : <GomexMark size={84} />}</span>
      <h2>
        Gomex.
        <br />
        Свои люди, свои звонки.
      </h2>
      <form>{children}</form>
    </div>
  );
}

/* ---------- the scenes ---------- */

function useLive(on: boolean, count: number, every: number, from = 1) {
  // Steps through `count` things while the scene is on; past the last one everything stays for two beats, then
  // starts over with `from` of them there from the start.
  const [at, setAt] = useState(from - 1);
  useEffect(() => {
    if (!on) return;
    setAt(from - 1);
    const timer = setInterval(() => setAt((a) => (a + 1 >= count + 2 ? from - 1 : a + 1)), every);
    return () => clearInterval(timer);
  }, [on, count, every, from]);
  return at;
}

const CHECKS = ['Проверка сервера', 'Docker', 'SSH только по ключу', 'Файлы Gomex', 'Запуск', 'HTTPS-сертификаты'];

/** The installer's last screen: its steps done, and the link with the setup code in a box. */
function CodeScene({ facts, on }: { facts: Facts; on: boolean }) {
  const at = useLive(on, CHECKS.length, 1300);
  const domain = facts.host.replace(/^app\./, '');
  const rows: [ReactNode, string?][] = [
    [
      <>
        <span className="k">$</span> ssh root@{domain}
      </>,
    ],
    ['Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-45-generic x86_64)', 'dim'],
    [' * Documentation:  https://help.ubuntu.com', 'dim'],
    [' System load:  0.08               Processes:             112', 'dim'],
    [' Memory usage: 9%                 Swap usage:            0%', 'dim'],
    [
      <>
        <span className="k">root@vps:~#</span> curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh
      </>,
    ],
    ['Gomex'],
    ...CHECKS.map((text, k): [ReactNode, string] => [
      <>
        <b className="ok">✓</b> {text}
      </>,
      k === at ? 'hl-green' : '',
    ]),
  ];
  return (
    <Scene on={on} kind="term">
      {rows.map(([html, cls = ''], i) => (
        <p key={i} className={`ln ${cls}`}>
          <i>{i + 1}</i>
          <span>{html}</span>
        </p>
      ))}
      <p className="ln focus">
        <i />
        <span className="box">
          https://{facts.host}/?setup={facts.code || '…'}
        </span>
      </p>
      <div className="log" />
    </Scene>
  );
}

function ServerScene({ facts, on }: { facts: Facts; on: boolean }) {
  const at = useLive(on, CHAT.length, 1400, 3);
  return (
    <Scene on={on} kind="browser">
      <Browser host={facts.host}>
        <App facts={facts} tip main={<Chat at={at} />} />
      </Browser>
    </Scene>
  );
}

function AdminScene({ facts, on }: { facts: Facts; on: boolean }) {
  return (
    <Scene on={on} kind="browser">
      <Browser host={facts.host}>
        <SignIn icon={facts.icon}>
          <div className="switch-two">
            <span className="on">Вход</span>
            <span>Регистрация</span>
          </div>
          <label>
            Ник
            <span className="well focus">
              <span className="caret">{facts.nick}</span>
            </span>
          </label>
          <label>
            Пароль
            <span className="well dots">{dots(facts.passwordLength)}</span>
          </label>
          <p className="go">Войти</p>
        </SignIn>
      </Browser>
    </Scene>
  );
}

function KeyScene({ facts, on }: { facts: Facts; on: boolean }) {
  return (
    <Scene on={on} kind="browser">
      <Browser host={facts.host}>
        <SignIn icon={facts.icon}>
          <h3>Восстановить доступ</h3>
          <label>
            Ник
            <span className="well">{facts.nick || 'Админ'}</span>
          </label>
          <label>
            Ключ восстановления
            <span className="well mono focus">{facts.key || 'XXXX-XXXX-XXXX-XXXX'}</span>
          </label>
          <label>
            Новый пароль
            <span className="well dots">{dots(10)}</span>
          </label>
          <p className="go">Сменить пароль и войти</p>
        </SignIn>
      </Browser>
    </Scene>
  );
}

/** The invite window over the app: friends coming in by the link one by one. */
function InviteScene({ facts, on }: { facts: Facts; on: boolean }) {
  const at = useLive(on, FRIENDS.length, 1500, 0);
  return (
    <Scene on={on} kind="browser">
      <Browser host={facts.host}>
        <App facts={facts} main={<Chat at={2} />} />
        <div className="veil">
          <div className="dialog">
            <h3>Пригласить друзей</h3>
            <p className="gray">Gomex — только по приглашениям. Ссылка админа без лимита.</p>
            <p className="tiny">Пришли по ссылке</p>
            {FRIENDS.map((f, k) => (
              <p key={f.name} className={`came${k > at ? ' later' : ''}`}>
                <Face name={f.name} color={f.color} />
                <span>{f.name}</span>
                <em>в друзьях</em>
              </p>
            ))}
            <p className="tiny">Ссылка-приглашение</p>
            <p className="linkbox focus">
              <span>{facts.link || `${facts.host}/?invite=…`}</span>
              <b>Скопировать</b>
            </p>
          </div>
        </div>
      </Browser>
    </Scene>
  );
}

/** The server at work: the admin in «Общий», friends dropping in, whoever talks ringed green. */
function RoomScene({ facts, on }: { facts: Facts; on: boolean }) {
  const people = [{ name: facts.nick || 'Админ', color: facts.color }, ...FRIENDS];
  const at = useLive(on, people.length, 1500);
  const talk = useLive(on, 7, 1100);
  const here = people.slice(0, Math.min(at + 1, people.length));
  const talking = here.length ? here[talk % here.length].name : '';
  const room = (
    <>
      <p className="chan on">
        <SpeakerIcon size={18} className="text-[#30d158]" />
        Общий
      </p>
      {people.map((p, k) => (
        <p key={p.name} className={`who${k > at ? ' later' : ''}`}>
          <Face name={p.name} color={p.color} small />
          {p.name}
        </p>
      ))}
    </>
  );
  return (
    <Scene on={on} kind="browser">
      <Browser host={facts.host}>
        <App
          facts={facts}
          list={<Channels room={room} />}
          main={
            <>
              <p className="head">
                <SpeakerIcon size={20} className="opacity-50" />
                Общий
              </p>
              <div className="room">
                <div className="bubbles focus">
                  {people.map((p, k) => (
                    <span key={p.name} className={`bub${k > at ? ' later' : ''}${p.name === talking ? ' talk' : ''}`} style={{ background: p.color }}>
                      {letter(p.name)}
                    </span>
                  ))}
                </div>
                <div className="controls">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i className="end" />
                </div>
              </div>
            </>
          }
        />
      </Browser>
    </Scene>
  );
}

/* ---------- the cameras ---------- */

/** Where `el` sits inside `root`, in its untransformed layout. */
function offsetIn(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = el; node && node !== root; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

/** Puts the scene's highlighted spot in the middle of the frame and the cameras' focus on it. Needs layout. */
function frame(scene: HTMLElement) {
  const ui = scene.querySelector<HTMLElement>('.shot .sharp');
  if (!ui?.offsetHeight) return;
  const focus = [...ui.querySelectorAll<HTMLElement>('.focus')].pop();
  if (!focus) return;
  const at = offsetIn(focus, ui);
  // A little right of the spot's start, so the screen's left edge stays out of the frame.
  scene.style.setProperty('--fx', `${Math.round(at.x + Math.min(focus.offsetWidth * 0.5, 320))}px`);
  scene.style.setProperty('--fy', `${Math.round(at.y + focus.offsetHeight / 2)}px`);
}

/** One screen filmed from two angles; each camera holds a soft copy and a sharp one around the focus. */
function Scene({ on, kind, children }: { on: boolean; kind: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!on) return;
    const scene = ref.current!;
    const reframe = () => frame(scene);
    reframe();
    void document.fonts?.ready.then(reframe);
    window.addEventListener('resize', reframe);
    return () => window.removeEventListener('resize', reframe);
  }, [on]);
  return (
    <div ref={ref} className={`scene${on ? ' on' : ''}`}>
      {(['a', 'b'] as const).map((angle) => (
        <div key={angle} className={`shot ${angle}`}>
          <div className={`ui ${kind} soft`}>{children}</div>
          <div className={`ui ${kind} sharp`}>{children}</div>
        </div>
      ))}
    </div>
  );
}

// Each scene keeps its live state itself and hands the one screen to its cameras, so all four copies take every
// step at once and the cameras agree.
const SCENES: Record<SceneName, (props: { facts: Facts; on: boolean }) => ReactNode> = {
  code: CodeScene,
  server: ServerScene,
  admin: AdminScene,
  key: KeyScene,
  invite: InviteScene,
  room: RoomScene,
};

/** Development only: #t=7000 stops the cameras at that moment of their 10 s loop, to look at one frame. */
function useStill() {
  useEffect(() => {
    const at = import.meta.env.DEV ? Number(window.location.hash.match(/t=(\d+)/)?.[1]) : 0;
    if (!at) return;
    const timer = setTimeout(() => {
      for (const a of document.getAnimations()) {
        if ((a as CSSAnimation).animationName?.startsWith('setup-shot')) {
          a.pause();
          a.currentTime = at;
        }
      }
    }, 600);
    return () => clearTimeout(timer);
  }, []);
}

export function SetupScenes({ scene, facts }: { scene: SceneName; facts: Facts }) {
  useStill();
  // A scene is drawn from the first time it's shown on, so the one before can fade out under the next.
  const [shown, setShown] = useState<SceneName[]>([scene]);
  useEffect(() => setShown((s) => (s.includes(scene) ? s : [...s, scene])), [scene]);
  return (
    <aside className="right" aria-hidden="true">
      {shown.map((name) => {
        const Drawn = SCENES[name];
        return <Drawn key={name} facts={facts} on={name === scene} />;
      })}
    </aside>
  );
}
