import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store';
import { Dialog } from '../ui/Dialog';
import { field, Primary, Quiet } from '../ui/settings';
import { getPreferredDevice, listDevices, setPreferredDevice } from './devices';
import { toggleCamera } from './voice';

/** The camera as the call would see it, before it goes on: the picture, the camera to use, and "Turn on camera". */
export function CameraPreview({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const inCall = useStore((s) => s.room !== null);
  const cameraOn = useStore((s) => s.cameraOn);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(() => getPreferredDevice('videoinput') ?? 'default');
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    setFailed(false);
    navigator.mediaDevices
      .getUserMedia({ video: deviceId === 'default' ? true : { deviceId: { exact: deviceId } } })
      .then(async (opened) => {
        if (stopped) return opened.getTracks().forEach((track) => track.stop());
        stream = opened;
        if (video.current) video.current.srcObject = opened;
        const list = await listDevices('videoinput', false);
        if (!stopped) setDevices(list.filter((device) => device.deviceId && device.deviceId !== 'default'));
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);

  return (
    <Dialog
      title={t('voice.camera.preview')}
      onClose={onClose}
      footer={
        <>
          <Quiet onClick={onClose}>{t('common.cancel')}</Quiet>
          {inCall && !cameraOn && (
            <Primary
              className="whitespace-nowrap"
              onPress={() => {
                onClose();
                void toggleCamera();
              }}
            >
              {t('voice.camera.on')}
            </Primary>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative aspect-video overflow-hidden rounded-row bg-black">
          <video ref={video} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
          {failed && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[14px] text-muted">{t('voice.err.camera')}</p>
          )}
        </div>
        {devices.length > 0 && (
          <select
            aria-label={t('voice.camera.choose')}
            value={deviceId}
            onChange={(event) => {
              setDeviceId(event.target.value);
              void setPreferredDevice('videoinput', event.target.value);
            }}
            className={field}
          >
            {deviceId === 'default' && <option value="default">{t('voice.devices.system')}</option>}
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || t('settings.device.unnamed')}
              </option>
            ))}
          </select>
        )}
      </div>
    </Dialog>
  );
}
