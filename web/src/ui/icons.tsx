import { useId, type ComponentType, type SVGProps } from 'react';
import * as Solid from '@heroicons/react/24/solid';

type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'children'>;
type IconProps = GlyphProps & { size?: number };
type Glyph = ComponentType<GlyphProps>;

function solid(Icon: Glyph) {
  return function SolidIcon({ size = 20, ...props }: IconProps) {
    return <Icon width={size} height={size} aria-hidden="true" {...props} />;
  };
}

function slashed(Icon: Glyph) {
  return function SlashedIcon({ size = 20, ...props }: IconProps) {
    const id = useId();
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <defs>
          <mask id={id}>
            <rect width="24" height="24" fill="white" />
            <rect x="9.5" y="-2" width="5" height="28" transform="rotate(-45 12 12)" fill="black" />
          </mask>
        </defs>
        <g mask={`url(#${id})`}><Icon style={{ width: 24, height: 24 }} /></g>
        <rect x="11" y="-1" width="2" height="26" rx="1" transform="rotate(-45 12 12)" />
      </svg>
    );
  };
}

function locked(Icon: Glyph) {
  return function LockedIcon({ size = 20, ...props }: IconProps) {
    const id = useId();
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <defs>
          <mask id={id}>
            <rect width="24" height="24" fill="white" />
            {/* The cut-out around the lock: a rounded corner, so the glyph keeps its shape instead of being sliced. */}
            <rect x="10" y="9.5" width="15" height="15" rx="5.5" fill="black" />
          </mask>
        </defs>
        <g mask={`url(#${id})`}>
          <g transform="translate(0.5 0.5) scale(0.88)"><Icon style={{ width: 24, height: 24 }} /></g>
        </g>
        {/* The lock, drawn by hand: a heroicon this small loses its shape. */}
        <path d="M14.3 17.2v-1.9a3.2 3.2 0 0 1 6.4 0v1.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="12.1" y="17" width="10.8" height="6.9" rx="1.8" />
      </svg>
    );
  };
}

// Heroicons has no headphones glyph. Use a filled headband and cushions for the deafen control.
function HeadphonesGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2.5A9.5 9.5 0 0 0 2.5 12v3h2.4v-3a7.1 7.1 0 1 1 14.2 0v3h2.4v-3A9.5 9.5 0 0 0 12 2.5Z" />
      <rect x="2.5" y="12" width="5.75" height="9.5" rx="2.5" />
      <rect x="15.75" y="12" width="5.75" height="9.5" rx="2.5" />
    </svg>
  );
}

export const MicIcon = solid(Solid.MicrophoneIcon);
export const MicSlashIcon = slashed(Solid.MicrophoneIcon);
export const HeadphonesIcon = solid(HeadphonesGlyph);
export const HeadphonesSlashIcon = slashed(HeadphonesGlyph);
export const VideoIcon = solid(Solid.VideoCameraIcon);
export const VideoSlashIcon = solid(Solid.VideoCameraSlashIcon);
export const HashIcon = solid(Solid.HashtagIcon);
export const HashLockIcon = locked(Solid.HashtagIcon);
export const BellIcon = solid(Solid.BellIcon);
export const BellSlashIcon = solid(Solid.BellSlashIcon);
export const SpeakerIcon = solid(Solid.SpeakerWaveIcon);
export const SpeakerLockIcon = locked(Solid.SpeakerWaveIcon);
export const SpeakerSlashIcon = solid(Solid.SpeakerXMarkIcon);
export const ScreenIcon = solid(Solid.ComputerDesktopIcon);
/** Vertical bars of a voice: the noise suppression button. */
export function WaveformIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
    </svg>
  );
}
/** The screen with a cross on it: what the share button shows while you are sharing. */
export function ScreenOffIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.25 5.25a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3V15a3 3 0 0 1-3 3h-3v.257c0 .597.237 1.17.659 1.591l.621.622a.75.75 0 0 1-.53 1.28h-9a.75.75 0 0 1-.53-1.28l.621-.622a2.25 2.25 0 0 0 .659-1.59V18h-3a3 3 0 0 1-3-3V5.25Zm1.5 0v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5Z"
      />
      <path d="M9.4 6.4l5.2 5.2M14.6 6.4l-5.2 5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
export const PhoneDownIcon = solid(Solid.PhoneXMarkIcon);
export const PhoneIcon = solid(Solid.PhoneIcon);
export const SignalIcon = solid(Solid.RssIcon);
export const GearIcon = solid(Solid.Cog6ToothIcon);
export const UsersIcon = solid(Solid.UsersIcon);
export const HomeIcon = solid(Solid.HomeIcon);
export const HomeFilledIcon = HomeIcon;
export const PlusIcon = solid(Solid.PlusIcon);
export const ArrowUpIcon = solid(Solid.ArrowUpIcon);
export const SearchIcon = solid(Solid.MagnifyingGlassIcon);
export const BubbleIcon = solid(Solid.ChatBubbleLeftIcon);
export const ChevronDownIcon = solid(Solid.ChevronDownIcon);
export const ChevronLeftIcon = solid(Solid.ChevronLeftIcon);
export const ChevronRightIcon = solid(Solid.ChevronRightIcon);
export const DotsIcon = solid(Solid.EllipsisHorizontalIcon);
export const DotsVerticalIcon = solid(Solid.EllipsisVerticalIcon);
export const CheckIcon = solid(Solid.CheckIcon);
export const XIcon = solid(Solid.XMarkIcon);
export const FolderIcon = solid(Solid.FolderIcon);
export const LockIcon = solid(Solid.LockClosedIcon);
export const ShieldIcon = solid(Solid.ShieldCheckIcon);
export const PencilIcon = solid(Solid.PencilIcon);
export const TrashIcon = solid(Solid.TrashIcon);
export const CameraIcon = solid(Solid.CameraIcon);
export const UserPlusIcon = solid(Solid.UserPlusIcon);
export const DownloadIcon = solid(Solid.ArrowDownTrayIcon);
export const CopyIcon = solid(Solid.DocumentDuplicateIcon);
export const LinkIcon = solid(Solid.LinkIcon);
export const ExternalLinkIcon = solid(Solid.ArrowTopRightOnSquareIcon);
export const ShareIcon = solid(Solid.ArrowUpOnSquareIcon);
export const PlusSquareIcon = solid(Solid.SquaresPlusIcon);
export const RefreshIcon = solid(Solid.ArrowPathIcon);
export const ExpandIcon = solid(Solid.ArrowsPointingOutIcon);
export const LogoutIcon = solid(Solid.ArrowRightStartOnRectangleIcon);
export const ReplyIcon = solid(Solid.ArrowUturnLeftIcon);
export const SmileIcon = solid(Solid.FaceSmileIcon);
export const PaperclipIcon = solid(Solid.PaperClipIcon);
export const AtIcon = solid(Solid.AtSymbolIcon);
export const GlobeIcon = solid(Solid.GlobeAltIcon);
export const UserIcon = solid(Solid.UserIcon);
export const SoundboardIcon = solid(Solid.MusicalNoteIcon);
export const StarIcon = solid(Solid.StarIcon);
export const StarFilledIcon = StarIcon;
export const PlayIcon = solid(Solid.PlayIcon);
export const StopIcon = solid(Solid.StopIcon);
export const PinIcon = solid(Solid.BookmarkIcon);
export const UnreadIcon = solid(Solid.InboxArrowDownIcon);
