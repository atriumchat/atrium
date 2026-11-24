import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TrackReference } from '@livekit/components-react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid';
import { Track } from 'livekit-client';
import { useT } from '../i18n';
import { showError } from '../store';
import { CallBarButton } from './CallControls';

type DocumentPip = { requestWindow(options: { width: number; height: number }): Promise<Window> };

export function StreamWindow({ trackRef, stage }: { trackRef: TrackReference; stage: RefObject<HTMLDivElement | null> }) {
  const { t } = useT();
  const documentPip = (window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;
  const [documentFailed, setDocumentFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const useDocument = !!documentPip && !documentFailed;
  const useVideo = document.pictureInPictureEnabled && !videoFailed;
  const popup = useRef<Window | null>(null);
  const activeVideo = useRef<HTMLVideoElement | null>(null);
  const lifecycle = useRef(0);
  const pending = useRef(false);
  const track = trackRef.publication.videoTrack;

  useEffect(() => () => {
    lifecycle.current++;
    popup.current?.close();
    const player = activeVideo.current;
    activeVideo.current = null;
    if (player && document.pictureInPictureElement === player) void document.exitPictureInPicture().catch(() => {});
  }, [track]);

  async function open() {
    if (pending.current || !track) return;
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    const generation = lifecycle.current;
    pending.current = true;
    try {
      if (useDocument) {
        const child = await documentPip.requestWindow({ width: 720, height: 405 });
        if (generation !== lifecycle.current) { child.close(); return; }
        popup.current = child;
        child.document.title = t(trackRef.source === Track.Source.ScreenShare ? 'voice.stream.live' : 'voice.call.title');
        child.document.body.style.cssText = 'margin:0;background:black';
        const player = child.document.createElement('video');
        player.muted = true;
        player.autoplay = true;
        player.playsInline = true;
        player.style.cssText = 'display:block;width:100vw;height:100vh;object-fit:contain';
        child.document.body.append(player);
        track.attach(player);
        child.addEventListener('pagehide', () => {
          track.detach(player);
          if (popup.current === child) popup.current = null;
        }, { once: true });
      } else if (useVideo) {
        const player = Array.from(stage.current?.querySelectorAll('video') ?? []).find((video) =>
          video.srcObject instanceof MediaStream && video.srcObject.getVideoTracks().includes(track.mediaStreamTrack));
        if (!player) throw new Error('Video is no longer on the call stage');
        activeVideo.current = player;
        await player.requestPictureInPicture();
        if (generation !== lifecycle.current && document.pictureInPictureElement === player) await document.exitPictureInPicture();
      }
    } catch {
      if (generation !== lifecycle.current) return;
      if (useDocument) setDocumentFailed(true);
      else if (useVideo) setVideoFailed(true);
      showError(t('voice.stream.windowError'));
    } finally {
      pending.current = false;
    }
  }

  if (!track || (!useDocument && !useVideo)) return null;
  return <CallBarButton label={t('voice.stream.window')} onPress={() => void open()}><ArrowTopRightOnSquareIcon /></CallBarButton>;
}
