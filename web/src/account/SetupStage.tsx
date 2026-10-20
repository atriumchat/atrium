import { useEffect, useState, type CSSProperties } from 'react';
import { t, useT } from '../i18n';
import { GomexMark } from '../ui/Logo';
import { CheckIcon, LinkIcon } from '../ui/icons';
import type { Facts } from './SetupScenes';

/**
 * The wizard's picture on a phone, where the desktop's filmed scenes don't fit: one object in the middle that turns
 * into the next as the steps go (the server's icon, the admin, the key, the invite, the room), made of the person's
 * own answers, inside a dial of 60 ticks that fills with the setup, like the landing's and the desktop installer's
 * clock. Behind it a glow in the step's colour. Purely a picture: everything here is aria-hidden.
 */

export type StageStep = 'intro' | 'code' | 'server' | 'admin' | 'key' | 'invite' | 'done';

const TICKS = 60;
const SIZE = 240;
const C = SIZE / 2;

const friends = () => [
  { name: t('setup.scene.friend1'), color: '#eb459e' },
  { name: t('setup.scene.friend2'), color: '#3ba55c' },
  { name: t('setup.scene.friend3'), color: '#faa61a' },
  { name: t('setup.scene.friend4'), color: '#9b59b6' },
];

const letter = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/** Counts up through `count` while `on`, holds the end two beats, and starts over. */
function useBeat(on: boolean, count: number, every: number) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!on) return setAt(0);
    setAt(0);
    const timer = setInterval(() => setAt((a) => (a + 1 >= count + 2 ? 0 : a + 1)), every);
    return () => clearInterval(timer);
  }, [on, count, every]);
  return at;
}

/** The dial: short ticks, every fifth longer; the filled ones white, the next one green and breathing. */
function Dial({ fill, intro }: { fill: number; intro: boolean }) {
  const on = Math.round(fill * TICKS);
  return (
    <svg className="dial" viewBox={`0 0 ${SIZE} ${SIZE}`}>
      {Array.from({ length: TICKS }, (_, i) => {
        const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
        const long = i % 5 === 0;
        const r1 = long ? 101 : 104;
        const r2 = 112;
        const cls = intro ? 'draw' : i < on ? 'on' : i === on && fill < 1 ? 'next' : '';
        return (
          <line
            key={i}
            className={cls}
            style={{ '--i': i } as CSSProperties}
            x1={C + r1 * Math.cos(a)}
            y1={C + r1 * Math.sin(a)}
            x2={C + r2 * Math.cos(a)}
            y2={C + r2 * Math.sin(a)}
          />
        );
      })}
    </svg>
  );
}

/** The key as a plate, its groups in two lines. */
function keyLines(key: string) {
  const groups = key.split('-');
  const half = groups.length > 4 ? Math.ceil(groups.length / 2) : 2;
  return [groups.slice(0, half), groups.slice(half)].filter((g) => g.length).map((g) => g.join('-'));
}

export function SetupStage({ step, facts, fill }: { step: StageStep; facts: Facts; fill: number }) {
  useT();
  const people = friends();
  const arrived = useBeat(step === 'invite', people.length, 900);
  const talk = useBeat(step === 'done', 9, 1000);
  const admin = facts.nick || t('setup.scene.admin');
  const room = [{ name: admin, color: facts.color }, ...people];
  const talking = room[talk % room.length].name;

  const tint =
    step === 'admin'
      ? facts.color
      : step === 'key'
        ? 'var(--pink)'
        : step === 'invite' || step === 'done'
          ? 'var(--here)'
          : '#ffffff';

  const caption: Record<StageStep, string> = {
    intro: '',
    code: facts.host,
    server: facts.serverName,
    admin,
    key: t('setup.key.title'),
    invite: facts.link || `${facts.host}/?invite=…`,
    done: facts.serverName,
  };

  const lines = keyLines(facts.key || 'XXXX-XXXX-XXXX-XXXX');
  const codeSlots = Array.from({ length: 10 }, (_, i) => facts.code[i] ?? '');

  return (
    <div className={`stage at-${step}`} aria-hidden="true" style={{ '--tint': tint } as CSSProperties}>
      <div className="glow" />
      <div className="orbit">
        {people.map((p, k) => (
          <span
            key={p.name}
            className={`friend${step === 'invite' && k < arrived ? ' in' : ''}`}
            style={{ '--k': k, background: p.color } as CSSProperties}
          >
            {letter(p.name)}
          </span>
        ))}
      </div>
      <div className="frame">
        <Dial fill={fill} intro={step === 'intro'} />
        <div className="core">
          <span className={`obj mark${step === 'intro' ? ' on' : ''}`}>
            <GomexMark size={92} />
          </span>
          <span className={`obj code${step === 'code' ? ' on' : ''}`}>
            {codeSlots.map((c, i) => (
              <i key={i} className={c ? 'has' : ''}>
                {c}
              </i>
            ))}
          </span>
          <span className={`obj server${step === 'server' ? ' on' : ''}`}>
            {facts.icon ? <img src={facts.icon} alt="" /> : <GomexMark size={64} />}
          </span>
          <span className={`obj admin${step === 'admin' ? ' on' : ''}`}>
            <span className="face" style={{ background: facts.color }}>
              {letter(admin)}
            </span>
            <span className="dots">
              {Array.from({ length: Math.min(facts.passwordLength, 16) }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          </span>
          <span className={`obj key${step === 'key' ? ' on' : ''}`}>
            <span className="plate">
              {lines.map((line, i) => (
                <b key={i}>{line}</b>
              ))}
            </span>
          </span>
          <span className={`obj invite${step === 'invite' ? ' on' : ''}`}>
            <span className="ticket">
              <LinkIcon size={26} />
            </span>
          </span>
          <span className={`obj room${step === 'done' ? ' on' : ''}`}>
            {room.map((p, k) => (
              <span
                key={p.name}
                className={`bub${p.name === talking ? ' talk' : ''}`}
                style={{ '--k': k, background: p.color } as CSSProperties}
              >
                {letter(p.name)}
              </span>
            ))}
            <span className="tick">
              <CheckIcon size={16} strokeWidth={3} />
            </span>
          </span>
        </div>
      </div>
      <p className="caption">
        <span key={step}>{caption[step]}</span>
      </p>
    </div>
  );
}
