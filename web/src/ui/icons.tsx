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
            <rect x="12" width="12" height="14" rx="2.5" fill="black" />
          </mask>
        </defs>
        <g mask={`url(#${id})`}><Icon style={{ width: 24, height: 24 }} /></g>
        <Solid.LockClosedIcon x="12" y="1" style={{ width: 12, height: 12 }} />
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
