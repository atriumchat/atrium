import { useEffect, useState, type ReactNode } from 'react';
import { Tooltip } from '@heroui/react';
import { RoomAudioRenderer, RoomContext } from '@livekit/components-react';
import { openDm, openHome, openServer, useStore } from '../store';
import { useIsMobile } from '../hooks';
import { useT } from '../i18n';
import { desktop } from '../desktop';
import { startUpdateChecks } from '../updates';
import { firstRunNetCheck } from '../voice/netcheck';
import { warmUpHistory } from '../chat/history';
import { Sidebar } from './Sidebar';
import { HomeSidebar } from './HomeSidebar';
import { HomeFilledIcon, HomeIcon } from '../ui/icons';
import { DownloadRailButton } from './Downloads';
import { whereToUseNeeded } from '../account/WhereToUse';
import { UserPanel } from './UserPanel';
import { HomeContent, homeBadgeCount, serverBadgeCount, ServerContent } from './Content';
import { MobileShell } from './MobileShell';
import { CallRinger, IncomingCall } from '../voice/CallPanel';
import { GroupPicker } from '../people/GroupPicker';
import { AtriumMark } from '../ui/Logo';
import { UpdateBanner } from './UpdateBanner';
import { InviteBanner, prefetchInvite } from '../people/Invites';
import { ArtPlayground, Playground } from './Playground';

// Desktop app: clicking a message notification opens that conversation.
desktop?.onOpenConversation((id) => openDm(id));
startUpdateChecks();

export function Shell() {
  const room = useStore((s) => s.room);
  const deafened = useStore((s) => s.deafened);
  const isMobile = useIsMobile();

  useEffect(() => {
    useStore.setState({ isMobile });
  }, [isMobile]);

  // First run on this device: check that calls get through, and switch the bypass on if only it works.
  useEffect(() => {
    const timer = setTimeout(() => void firstRunNetCheck(), 1500);
    // Newest chats, the channels and your invite, fetched in the background so opening them is instant;
    // everyone's photo decoded ahead so avatars don't flash in.
    const warm = setTimeout(() => {
      void warmUpHistory();
      prefetchInvite();
      for (const u of Object.values(useStore.getState().users)) {
        if (u.avatarUrl) {
          const img = new Image();
          img.src = u.avatarUrl;
          img.decode().catch(() => undefined);
        }
      }
    }, 1200);
    return () => {
      clearTimeout(timer);
      clearTimeout(warm);
    };
  }, []);

  // Desktop app: unread count on the Dock / taskbar icon.
  const unreadTotal = useStore((s) => homeBadgeCount(s) + serverBadgeCount(s));
  useEffect(() => {
    desktop?.setBadge(unreadTotal);
  }, [unreadTotal]);

  // A file dropped outside a chat would make the browser navigate away to it.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  return (
    <RoomContext.Provider value={room ?? undefined}>
      {room && <RoomAudioRenderer muted={deafened} />}
      {isMobile ? <MobileShell /> : <DesktopShell />}
      <GroupPicker />
      <IncomingCall />
      <CallRinger />
    </RoomContext.Provider>
  );
}

/**
 * Full-bleed black window: the left column (server rail + channel or DM list, your card underneath) sits
 * straight on it, and the content is one near-black card with a hairline edge.
 */
function DesktopShell() {
  const mode = useStore((s) => s.mode);
  const playground = usePlayground();
  // Three panels on black with an 8px gap: the rail, the list with your card at its foot, and the content.
  // Modest 20px corners, no edge line; everything inside is concentric to them.
  const panel = 'overflow-hidden rounded-[20px] bg-window';
  return (
    <div className="flex h-full gap-2 bg-background p-2 [html[data-desktop]_&]:pt-0">
      <ServerRail className={`${panel} w-[72px] shrink-0`} />
      <div className={`${panel} flex w-[320px] shrink-0 flex-col pb-2`}>
        {/* Both lists stay mounted; switching home ↔ server only shows the other, so nothing reloads. */}
        <div className={mode === 'home' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <HomeSidebar />
        </div>
        <div className={mode === 'server' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <Sidebar />
        </div>
        <UpdateBanner />
        {/* On the home screen (people, not channels): as wide as your card underneath. */}
        {mode === 'home' && (
          <div className="shrink-0 px-2">
            <InviteBanner />
          </div>
        )}
        <UserPanel />
      </div>
      <main className={`${panel} flex min-w-0 flex-1 flex-col`}>
        {playground === 'art' ? <ArtPlayground /> : playground ? <Playground /> : mode === 'home' ? <HomeContent /> : <ServerContent />}
      </main>
    </div>
  );
}

/**
 * Development only: #bubbles in the address shows the call layouts with made-up talking, #art the line drawings
 * and every empty state.
 */
function usePlayground() {
  const which = () => (import.meta.env.DEV && (location.hash === '#bubbles' || location.hash === '#art') ? location.hash.slice(1) : null);
  const [on, setOn] = useState(which);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const sync = () => setOn(which());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return on;
}

function ServerRail({ className }: { className: string }) {
  const { t } = useT();
  const serverName = useStore((s) => s.serverName);
  const serverIcon = useStore((s) => s.serverIcon);
  const mode = useStore((s) => s.mode);
  const homeBadge = useStore(homeBadgeCount);
  const serverBadge = useStore(serverBadgeCount);

  return (
    <nav className={`flex flex-col items-center gap-2.5 pt-3 ${className}`}>
      <RailItem label={t('shell.tab.home')} active={mode === 'home'} badge={homeBadge} onPress={openHome}>
        <span
          className={`flex h-12 w-12 items-center justify-center ${mode === 'home' ? 'bg-white text-black' : 'bg-default group-hover:bg-[#28282d]'} ${railShape(mode === 'home')}`}
        >
          {mode === 'home' ? <HomeFilledIcon size={24} /> : <HomeIcon size={24} />}
        </span>
      </RailItem>
      <RailItem label={serverName} active={mode === 'server'} badge={mode === 'server' ? 0 : serverBadge} onPress={openServer}>
        {/* The server's own icon fills the circle; without one, Atrium's mark on the circle, as for home. */}
        {serverIcon ? (
          <img src={serverIcon} alt="" draggable={false} className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <span
            className={`flex h-12 w-12 items-center justify-center ${mode === 'server' ? 'bg-white text-black' : 'bg-default group-hover:bg-[#28282d]'} ${railShape(mode === 'server')}`}
          >
            <AtriumMark size={27} filled={mode === 'server'} />
          </span>
        )}
      </RailItem>
      {/* In a browser: get the app, at the foot of the rail as in Discord. */}
      {whereToUseNeeded() && (
        <div className="mt-auto pb-3">
          <DownloadRailButton />
        </div>
      )}
    </nav>
  );
}

// Round, always: the rail's circles sit 12 from a 36 corner, so 24 keeps them concentric.
const railShape = (_active: boolean) => 'rounded-full transition-colors duration-200 ease-out';

function RailItem(props: { label: string; active: boolean; badge?: number; onPress: () => void; children: ReactNode }) {
  return (
    <div className="group/rail relative flex w-full justify-center">
      <span
        className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-[height] duration-200 ease-out ${props.active ? 'h-10' : 'h-0 group-hover/rail:h-5'}`}
      />
      <Tooltip delay={0} closeDelay={0}>
        <Tooltip.Trigger>
          <button aria-label={props.label} aria-current={props.active || undefined} onClick={props.onPress} className="group relative rounded-full outline-none">
            {props.children}
            {!!props.badge && (
              <span className="absolute -bottom-0.5 -right-0.5 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-5 text-white ring-[3px] ring-[var(--app-side)]">
                {props.badge > 99 ? '99+' : props.badge}
              </span>
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="right">{props.label}</Tooltip.Content>
      </Tooltip>
    </div>
  );
}
