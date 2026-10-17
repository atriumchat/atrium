import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { closeDetail, dmTitle, isDmId, openDm, openFriends, openPicker, openTab, selectChannel, useStore, voiceMembers, type MobileTab } from '../store';
import { leaveVoice, toggleMute } from '../voice/voice';
import { logout } from '../account/session';
import { HomeContent, homeBadgeCount, serverBadgeCount, ServerContent } from './Content';
import { Sidebar } from './Sidebar';
import { Badge, FeedDm, useDmList } from './HomeSidebar';
import { PeopleRow, RoomCircles } from '../people/WhoWhere';
import { InboxButton } from '../people/Inbox';
import { ProfileCard } from '../people/UserProfile';
import { EmptyState } from '../ui/Illustrations';
import { InviteCardButton } from '../people/Invites';
import { Avatar } from '../ui/Avatar';
import { CallDuration } from '../voice/CallDuration';
import { ServerMark } from '../ui/Logo';
import { RoundButton } from '../ui/ui';
import { UpdateBanner } from './UpdateBanner';
import { SettingsDialog } from './SettingsDialog';
import { BypassHint } from '../voice/Bypass';
import { useCallStats } from '../voice/stats';
import { ChevronRightIcon, GearIcon, HomeFilledIcon, HomeIcon, LogoutIcon, MicIcon, MicSlashIcon, PhoneDownIcon, PlusIcon, SignalIcon, UsersIcon } from '../ui/icons';

const PUSH_MS = 280;
const PUSH_EASE = 'cubic-bezier(.2,.8,.2,1)';

/**
 * Phone layout: three tabs at the bottom (home, server, you) that switch instantly, and conversations that
 * slide in from the right over everything — tab bar included — and slide back out, as in any native app.
 * The screen underneath drifts left and dims a little; a swipe from the left edge takes the chat back
 * with your finger. In a call, a pill floats over the tab bar (a slim strip on top inside a conversation).
 */
export function MobileShell() {
  const detail = useStore((s) => s.mobileDetail);
  const tab = useStore((s) => s.mobileTab);
  const mode = useStore((s) => s.mode);
  const push = usePush(detail);

  return (
    <div className="relative h-dvh overflow-hidden bg-window">
      <div ref={push.underRef} className="absolute inset-0 flex flex-col pt-[env(safe-area-inset-top)]" aria-hidden={detail}>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* The three tabs stay mounted and are only hidden: switching is instant, nothing reloads or blinks,
              and each keeps its scroll. */}
          {(['home', 'server', 'you'] as const).map((id) => (
            <div key={id} className={`absolute inset-0 flex flex-col ${tab === id ? '' : 'invisible pointer-events-none'}`} aria-hidden={tab !== id}>
              {id === 'home' ? <HomeTab /> : id === 'server' ? <ServerTab /> : <YouTab />}
            </div>
          ))}
        </div>
        <UpdateBanner />
        <CallPill />
        <TabBar />
        <div ref={push.dimRef} className="pointer-events-none absolute inset-0 bg-black opacity-0" />
      </div>
      {push.mounted && (
        <div
          ref={push.overRef}
          className="absolute inset-0 flex flex-col bg-window pt-[env(safe-area-inset-top)] shadow-[-12px_0_32px_rgba(0,0,0,0.45)]"
          {...push.swipe}
        >
          <CallBar />
          <div className="flex min-h-0 flex-1 flex-col">{mode === 'home' ? <HomeContent /> : <ServerContent />}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The push / pop between a tab and a conversation. Positions are written straight to the elements (not
 * through React state) so a swipe follows the finger at full frame rate.
 */
function usePush(open: boolean) {
  const overRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const drag = useRef<{ x: number; t: number; dx: number } | null>(null);
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // p: 0 = the tab, 1 = the conversation fully in.
  const apply = useCallback(
    (p: number, animate: boolean) => {
      const t = animate && !reduce ? `${PUSH_MS}ms ${PUSH_EASE}` : '0ms';
      const over = overRef.current;
      const under = underRef.current;
      const dim = dimRef.current;
      if (over) {
        over.style.transition = `transform ${t}`;
        over.style.transform = `translate3d(${(1 - p) * 100}%, 0, 0)`;
      }
      if (under) {
        under.style.transition = `transform ${t}`;
        under.style.transform = `translate3d(${-22 * p}%, 0, 0)`;
      }
      if (dim) {
        dim.style.transition = `opacity ${t}`;
        dim.style.opacity = String(0.35 * p);
      }
    },
    [reduce],
  );

  useEffect(() => {
    if (open) setMounted(true);
    else {
      apply(0, true);
      const timer = setTimeout(() => setMounted(false), reduce ? 0 : PUSH_MS + 40);
      return () => clearTimeout(timer);
    }
  }, [open, apply, reduce]);

  // Entering: place it off-screen to the right, make the browser take that in, then slide it in — all
  // before the first paint, so there's no frame of waiting.
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    apply(0, false);
    void overRef.current?.offsetWidth;
    apply(1, true);
  }, [open, mounted, apply]);

  const swipe = {
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      // Only from the left edge, like iOS's back gesture.
      drag.current = touch.clientX < 28 ? { x: touch.clientX, t: performance.now(), dx: 0 } : null;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!drag.current) return;
      const dx = Math.max(0, e.touches[0].clientX - drag.current.x);
      drag.current.dx = dx;
      apply(1 - dx / window.innerWidth, false);
    },
    onTouchEnd: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const speed = d.dx / Math.max(1, performance.now() - d.t);
      if (d.dx > window.innerWidth / 3 || (speed > 0.5 && d.dx > 30)) closeDetail();
      else apply(1, true);
    },
  };

  return { mounted, overRef, underRef, dimRef, swipe };
}

/** Where the call is and what it's called: a room, or the person / group for a call in DMs. */
function useCallPlace() {
  const id = useStore((s) => s.voiceChannelId);
  const name = useStore((s) => {
    const channel = s.channels.find((c) => c.id === s.voiceChannelId);
    if (channel) return channel.name;
    const dm = s.dms.find((d) => d.id === s.voiceChannelId);
    return dm ? dmTitle(dm, s.users, s.me?.id) : '';
  });
  const open = () => id && (isDmId(id) ? openDm(id) : selectChannel(id));
  return { id, name, open };
}

/**
 * The call you're in, floating over the tab bar on the tab screens: faces, the room and its timer, the mic
 * and hang-up. Tap it to go back to the call.
 */
function CallPill() {
  const { id, name, open } = useCallPlace();
  const status = useStore((s) => s.voiceStatus);
  const micOff = useStore((s) => s.muted || s.deafened);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const voiceState = useStore((s) => s.voiceState);
  const stats = useCallStats(!!id);
  if (!id) return null;
  const connected = status === 'connected';
  const inside = voiceMembers(voiceState, id).map((e) => e.userId);
  const faces = meId ? [meId, ...inside.filter((u) => u !== meId)] : inside;

  return (
    <div className="shrink-0 px-4 pt-2">
      <BypassHint stats={stats} />
      <div className="mt-2 flex h-14 items-center gap-2.5 rounded-full border-[0.5px] border-white/10 bg-default pl-2.5 pr-1.5">
        <button onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex shrink-0 -space-x-2.5">
            {faces.slice(0, 3).map((u) => (
              <span key={u} className="rounded-full ring-2 ring-[var(--default)]">
                <Avatar user={users[u]} size={30} />
              </span>
            ))}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold leading-5">{name}</span>
            <span className={`block text-[12px] leading-4 tabular-nums ${connected ? 'text-success' : 'text-warning'}`}>
              {connected ? (
                <>
                  в голосе · <CallDuration />
                </>
              ) : (
                'подключение…'
              )}
            </span>
          </span>
        </button>
        <RoundButton tone={micOff ? 'on' : 'plain'} alert={micOff} label={micOff ? 'Включить микрофон' : 'Выключить микрофон'} onPress={toggleMute}>
          {micOff ? <MicSlashIcon /> : <MicIcon />}
        </RoundButton>
        <RoundButton tone="danger" label="Отключиться" onPress={() => leaveVoice()}>
          <PhoneDownIcon />
        </RoundButton>
      </div>
    </div>
  );
}

/** Inside a conversation (no tab bar there): a slim "voice connected" strip on top; tap it to go back to the call. */
function CallBar() {
  const { id, name, open } = useCallPlace();
  const status = useStore((s) => s.voiceStatus);
  const micOff = useStore((s) => s.muted || s.deafened);
  const viewing = useStore((s) => s.mobileDetail && (s.mode === 'server' ? s.selectedChannelId : s.homeView) === s.voiceChannelId);
  // Hidden while you're looking at the call itself: no stats to poll then.
  const stats = useCallStats(!!id && !viewing);
  if (!id || viewing) return null;
  const connected = status === 'connected';

  return (
    <div className="shrink-0 border-b border-separator bg-success/10 py-1.5 pl-3 pr-2">
    <div className="flex items-center gap-2">
      <button onClick={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <SignalIcon size={18} className={connected ? 'text-success' : 'text-warning'} />
        <span className="min-w-0">
          <span className={`block text-[14px] font-medium leading-5 ${connected ? 'text-success' : 'text-warning'}`}>
            {connected ? 'Голос подключён' : 'Подключение…'}
          </span>
          <span className="block truncate text-[12px] tabular-nums text-muted">
            {name}
            {connected && (
              <>
                {' · '}
                <CallDuration />
              </>
            )}
          </span>
        </span>
      </button>
      <RoundButton size="sm" tone={micOff ? 'on' : 'plain'} alert={micOff} label={micOff ? 'Включить микрофон' : 'Выключить микрофон'} onPress={toggleMute}>
        {micOff ? <MicSlashIcon /> : <MicIcon />}
      </RoundButton>
      <RoundButton size="sm" tone="danger" label="Отключиться" onPress={() => leaveVoice()}>
        <PhoneDownIcon />
      </RoundButton>
    </div>
    <BypassHint stats={stats} />
    </div>
  );
}

/** The same header on the home and server tabs, so switching between them doesn't shift anything. */
function TabHeader() {
  const serverName = useStore((s) => s.serverName);
  const serverIcon = useStore((s) => s.serverIcon);
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-4">
      <ServerMark icon={serverIcon} size={36} />
      <h1 className="min-w-0 flex-1 truncate text-[24px] font-bold">{serverName}</h1>
      <InboxButton />
    </header>
  );
}

function ServerTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabHeader />
      <Sidebar />
    </div>
  );
}

/**
 * The phone's home: the server's live rooms as circles, who is where, then one feed of everything new —
 * DMs, groups, and channels while they have something unread.
 */
function HomeTab() {
  const incoming = useStore((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const dms = useDmList();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabHeader />
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto pb-4 pt-2">
        <div className="px-3">
          <RoomCircles />
        </div>
        <PeopleRow />
        {/* Friends on a row of its own, as on the computer; "+" belongs to the messages header only. */}
        <div className="px-3">
          <button onClick={openFriends} className="flex h-12 w-full items-center gap-3 rounded-full bg-default px-4 text-left transition-colors active:bg-[#28282d]">
            <UsersIcon size={20} />
            <span className="flex-1 text-[16px] font-medium">Друзья</span>
            {incoming > 0 && <Badge count={incoming} />}
            <ChevronRightIcon size={18} className="text-muted" />
          </button>
        </div>
        {/* Same insets as the server tab's list: titles at 24px, rows at 12px. */}
        <section className="px-3">
          <div className="flex items-center justify-between pb-1 pl-3">
            <h2 className="text-[17px] font-semibold">Личные сообщения</h2>
            <RoundButton size="sm" tone="ghost" label="Новая группа" onPress={() => openPicker({ mode: 'create' })}>
              <PlusIcon />
            </RoundButton>
          </div>
          {dms.length === 0 ? <EmptyState title="Пока пусто" text="Лички и группы" /> : dms.map((dm) => <FeedDm key={dm.id} dm={dm} big />)}
        </section>
      </div>
    </div>
  );
}

function SettingsRow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="mt-4 flex h-12 w-full items-center gap-3 rounded-full bg-default px-4 text-left transition-colors active:bg-[#28282d]">
        <GearIcon size={20} />
        <span className="flex-1 text-[16px] font-medium">Настройки</span>
        <ChevronRightIcon size={18} className="text-muted" />
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function YouTab() {
  const meId = useStore((s) => s.me?.id);
  if (!meId) return null;
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
      <div className="overflow-hidden rounded-[20px] bg-overlay">
        <ProfileCard userId={meId} onClose={() => {}} />
      </div>
      <SettingsRow />
      <InviteCardButton />
      <Button variant="danger-soft" fullWidth onPress={logout} className="mt-4 h-12 rounded-[14px] text-[16px] [&_svg]:size-5">
        <LogoutIcon />
        Выйти
      </Button>
    </div>
  );
}

/**
 * Floating tab bar: one graphite pill with the server, messages and you (your avatar); the open tab opens
 * up into a lighter segment with its name.
 */
function TabBar() {
  const serverUnread = useStore(serverBadgeCount);
  const homeBadge = useStore(homeBadgeCount);
  const me = useStore((s) => s.me);
  const serverIcon = useStore((s) => s.serverIcon);
  return (
    <nav className="shrink-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
      <div className="flex h-16 items-center gap-1 rounded-full border-[0.5px] border-white/10 bg-default p-1.5">
        <Tab id="home" label="Главная" badge={homeBadge} icon={(on) => (on ? <HomeFilledIcon size={24} /> : <HomeIcon size={24} />)} />
        <Tab id="server" label="Сервер" badge={serverUnread} icon={(on) => <ServerMark icon={serverIcon} size={24} filled={on} />} />
        <Tab id="you" label="Вы" icon={() => <Avatar user={me ?? undefined} size={28} ringBg="var(--default)" />} />
      </div>
    </nav>
  );
}

function Tab({ id, label, icon, badge = 0 }: { id: MobileTab; label: string; icon: (active: boolean) => ReactNode; badge?: number }) {
  const active = useStore((s) => s.mobileTab === id);
  // The name is always there and just unfolds (width and fade), so the open segment grows smoothly and the
  // other tabs slide along instead of jumping.
  return (
    <button
      onClick={() => openTab(id)}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`flex h-full min-w-0 flex-auto items-center justify-center rounded-full px-3 transition-[background-color,color] duration-300 ${
        active ? 'bg-surface-tertiary text-foreground' : 'text-muted'
      }`}
    >
      <span className="relative flex shrink-0 items-center">
        {icon(active)}
        {badge > 0 && (
          <span className="absolute -right-3 -top-2">
            <Badge count={badge} />
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={`overflow-hidden whitespace-nowrap text-[15px] font-medium transition-[max-width,opacity,margin] duration-[350ms] ease-[cubic-bezier(.2,.8,.2,1)] ${
          active ? 'ml-2 max-w-[120px] opacity-100' : 'ml-0 max-w-0 opacity-0'
        }`}
      >
        {label}
      </span>
    </button>
  );
}
