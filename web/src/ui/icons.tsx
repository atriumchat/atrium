import { useId, type ReactNode, type SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function Svg({ size = 20, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

function icon(paths: ReactNode) {
  return function Icon(props: IconProps) {
    return <Svg {...props}>{paths}</Svg>;
  };
}

/** Muted variant: the glyph is cut where the slash crosses it. */
function slashed(paths: ReactNode) {
  return function SlashedIcon(props: IconProps) {
    const id = `m-${useId().replace(/:/g, '')}`;
    return (
      <Svg {...props}>
        <defs>
          <mask id={id}>
            <rect width="24" height="24" fill="white" stroke="none" />
            <path d="M3 3l18 18" stroke="black" strokeWidth={5.5} />
          </mask>
        </defs>
        <g mask={`url(#${id})`}>{paths}</g>
        <path d="M3 3l18 18" />
      </Svg>
    );
  };
}

const mic = (
  <>
    <rect x="8.5" y="2" width="7" height="12.5" rx="3.5" fill="currentColor" stroke="none" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3.5" />
  </>
);

const headphones = (
  <>
    <path d="M3.5 15v-3a8.5 8.5 0 0 1 17 0v3" />
    <rect x="2.5" y="13.5" width="5.5" height="8" rx="2.2" fill="currentColor" stroke="none" />
    <rect x="16" y="13.5" width="5.5" height="8" rx="2.2" fill="currentColor" stroke="none" />
  </>
);

const video = (
  <>
    <rect x="1.5" y="6" width="14" height="12" rx="3" fill="currentColor" stroke="none" />
    <path d="M17 10.3 21.4 7.6a.6.6 0 0 1 .9.5v7.8a.6.6 0 0 1-.9.5L17 13.7z" fill="currentColor" stroke="none" />
  </>
);

export const MicIcon = icon(mic);
export const MicSlashIcon = slashed(mic);
export const HeadphonesIcon = icon(headphones);
export const HeadphonesSlashIcon = slashed(headphones);
export const VideoIcon = icon(video);
export const VideoSlashIcon = slashed(video);

export const HashIcon = icon(<path d="M4.5 9h15M4 15h15M10 3.5 8 20.5M16 3.5l-2 17" />);

const bell = <path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9zM10.2 20.5a2 2 0 0 0 3.6 0" />;
export const BellIcon = icon(bell);
export const BellSlashIcon = slashed(bell);

export const SpeakerIcon = icon(
  <>
    <path d="M3 9.2h3.6L11.2 5v14l-4.6-4.2H3z" fill="currentColor" strokeWidth={1.5} />
    <path d="M15 9a4.2 4.2 0 0 1 0 6" />
    <path d="M18 6.3a8 8 0 0 1 0 11.4" />
  </>,
);

export const ScreenIcon = icon(
  <>
    <rect x="2" y="3.5" width="20" height="14" rx="3" />
    <path d="M8.5 21h7" />
    <path d="M12 14V7.5m0 0-3 3m3-3 3 3" />
  </>,
);

export const PhoneDownIcon = icon(
  <path
    transform="translate(12 12) rotate(135) scale(0.82) translate(-12 -12)"
    fill="currentColor"
    stroke="none"
    d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
  />,
);

/** Handset, upright: start or answer a call. */
export const PhoneIcon = icon(
  <path
    transform="translate(12 12) scale(0.86) translate(-12 -12)"
    fill="currentColor"
    stroke="none"
    d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
  />,
);

/** "Voice connected" signal bars. */
export const SignalIcon = icon(
  <>
    <path d="M4 20h0" strokeWidth={3} />
    <path d="M4 14a6 6 0 0 1 6 6" />
    <path d="M4 8a12 12 0 0 1 12 12" />
    <path d="M4 2.5a17.5 17.5 0 0 1 17.5 17.5" />
  </>,
);

export const GearIcon = icon(
  <>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const UsersIcon = icon(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);

/** The home's active state: a solid house with the door cut out. */
export const HomeFilledIcon = icon(
  <path
    fillRule="evenodd"
    fill="currentColor"
    stroke="none"
    d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19zM9.6 20.5v-5.3h4.8v5.3z"
  />,
);
export const HomeIcon = icon(<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.7H9.2v5.7H5A1.5 1.5 0 0 1 3.5 19z" />);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const ArrowUpIcon = icon(<path d="M12 19V5m-6.5 6.5L12 5l6.5 6.5" />);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
/** App mark: a filled chat bubble. */
export const BubbleIcon = icon(
  <path
    fill="currentColor"
    stroke="none"
    d="M6 3.5h12A3.5 3.5 0 0 1 21.5 7v8a3.5 3.5 0 0 1-3.5 3.5h-6.2l-4.4 3.3a.8.8 0 0 1-1.3-.64V18.5H6A3.5 3.5 0 0 1 2.5 15V7A3.5 3.5 0 0 1 6 3.5z"
  />,
);
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);
export const ChevronLeftIcon = icon(<path d="m15 18-6-6 6-6" />);
export const ChevronRightIcon = icon(<path d="m9 18 6-6-6-6" />);
export const DotsIcon = icon(
  <>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </>,
);
export const CheckIcon = icon(<path d="M20 6 9 17l-5-5" />);
export const XIcon = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const PencilIcon = icon(<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />);
export const TrashIcon = icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />);
export const CameraIcon = icon(
  <>
    <path d="M4 8h3l1.6-2.4A1.4 1.4 0 0 1 9.8 5h4.4a1.4 1.4 0 0 1 1.2.6L17 8h3a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 8z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </>,
);
export const UserPlusIcon = icon(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </>,
);
export const DownloadIcon = icon(<path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />);
export const CopyIcon = icon(
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="3" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </>,
);
export const LinkIcon = icon(
  <>
    <path d="M10 13.5a4.5 4.5 0 0 0 6.4.3l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1.8 1.8" />
    <path d="M14 10.5a4.5 4.5 0 0 0-6.4-.3l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.8-1.8" />
  </>,
);
export const ExternalLinkIcon = icon(
  <>
    <path d="M14.5 3.5h6v6M20.5 3.5 11 13" />
    <path d="M18.5 14v4a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V8A2.5 2.5 0 0 1 6 5.5h4" />
  </>,
);
/** Safari's Share: a box open at the top, the arrow out of it. */
export const ShareIcon = icon(<path d="M12 3v12M8 7l4-4 4 4M8.5 10H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-2" />);
export const PlusSquareIcon = icon(<path d="M12 8.5v7M8.5 12h7M7 3.5h10A3.5 3.5 0 0 1 20.5 7v10a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 17V7A3.5 3.5 0 0 1 7 3.5z" />);
export const RefreshIcon = icon(<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.6 4.5M20 20v-3.5h-3.5" />);
export const ExpandIcon = icon(<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />);
export const LogoutIcon = icon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </>,
);
export const ReplyIcon = icon(<path d="M10 9 5 13.5 10 18M5 13.5h9a5 5 0 0 0 5-5V6" />);
export const SmileIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
  </>,
);
export const PaperclipIcon = icon(<path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6" />);
export const AtIcon = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </>,
);
export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <ellipse cx="12" cy="12" rx="4" ry="9" />
    <path d="M3 12h18" />
    <path d="M4.5 7.5h15" />
    <path d="M4.5 16.5h15" />
  </>,
);
export const UserIcon = icon(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
  </>,
);
