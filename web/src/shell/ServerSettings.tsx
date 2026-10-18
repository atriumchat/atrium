import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { setChannels, showError, useStore } from '../store';
import { ServerMark } from '../ui/Logo';
import { IconCropper, centred, cropToBlob, loadImage, type Crop } from '../ui/IconCropper';
import { shortStamp } from '../chat/format';
import type { DeletedChannel } from '../types';
import { Primary, Quiet, Row, RowValue, Rows, Secondary, SubPage, field, fieldLabel, useSub } from '../ui/settings';

/**
 * The "Server" page of the settings, for the admin: the server's icon and name, as in the first-run setup. On the
 * phone one group of the settings page, the name a row of its own.
 */
export function ServerSettings() {
  const { t } = useT();
  const isMobile = useStore((s) => s.isMobile);
  if (isMobile) {
    return (
      <Rows title={t('settings.server.title')} className="mt-6">
        <IconRow />
        <NameRow />
        <TrashRow />
      </Rows>
    );
  }
  return (
    <>
      <Rows className="mt-6">
        <IconRow />
      </Rows>
      <NameField className="mt-6" />
      <Rows className="mt-6">
        <TrashRow />
      </Rows>
    </>
  );
}

const apply = (info: { serverName: string; serverIcon: string | null }) => useStore.setState(info);

/** The icon's row, as in the setup wizard; a picked picture opens its crop on its own. */
function IconRow() {
  const { t } = useT();
  const icon = useStore((s) => s.serverIcon);
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ image: HTMLImageElement; crop: Crop } | null>(null);
  // Kept apart from `picked`, so the picture stays while the crop's page slides away.
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return showError(t('settings.server.imageTooBig'));
    try {
      const image = await loadImage(file);
      if (picked) URL.revokeObjectURL(picked.image.src);
      setPicked({ image, crop: centred(image) });
      setCropping(true);
    } catch (e) {
      showError(e instanceof Error ? e.message : t('settings.server.imageOpenFailed'));
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('settings.server.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <Row icon={<ServerMark icon={icon} size={34} />} title={t('settings.server.icon')} value={icon ? t('settings.server.iconCustom') : t('settings.server.iconDefault')}>
        {icon && (
          <Quiet disabled={busy} onClick={() => run(async () => apply(await api.deleteServerIcon()))}>
            {t('settings.server.remove')}
          </Quiet>
        )}
        <Secondary onPress={() => input.current?.click()}>{icon ? t('settings.server.replace') : t('settings.server.pick')}</Secondary>
      </Row>
      <SubPage
        open={cropping && !!picked}
        title={t('settings.server.icon')}
        onClose={() => setCropping(false)}
        footer={
          picked && (
            <Primary
              isPending={busy}
              onPress={() =>
                run(async () => {
                  apply(await api.uploadServerIcon(await cropToBlob(picked.image, picked.crop)));
                  setCropping(false);
                })
              }
            >
              {t('settings.server.save')}
            </Primary>
          )
        }
      >
        {picked && (
          <IconCropper
            image={picked.image}
            crop={picked.crop}
            onChange={(crop) => setPicked({ ...picked, crop })}
            className="h-60 rounded-[12px] border border-white/[0.07] bg-black max-md:mt-2"
          />
        )}
      </SubPage>
    </>
  );
}

function NameRow() {
  const { t } = useT();
  const name = useStore((s) => s.serverName);
  const sub = useSub();
  return (
    <>
      <Row title={t('settings.server.name')} onPress={sub.show}>
        <RowValue>{name}</RowValue>
      </Row>
      <SubPage key={sub.key} open={sub.open} title={t('settings.server.name')} onClose={sub.hide}>
        <NameField onSaved={sub.hide} className="mt-2" />
      </SubPage>
    </>
  );
}

function NameField({ onSaved, className = '' }: { onSaved?: () => void; className?: string }) {
  const { t } = useT();
  const saved = useStore((s) => s.serverName);
  const id = useId();
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== '' && name.trim() !== saved;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const info = await api.renameServer(name);
      apply(info);
      setName(info.serverName);
      onSaved?.();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('settings.server.renameFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={className}>
      {/* On the phone this is a page of its own, titled the same. */}
      <label htmlFor={id} className={`${fieldLabel} max-md:sr-only`}>
        {t('settings.server.name')}
      </label>
      <div className="flex gap-2 max-md:flex-col">
        <input id={id} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={field} />
        {changed && (
          <Primary type="submit" isPending={busy} className="shrink-0">
            {t('settings.server.save')}
          </Primary>
        )}
      </div>
    </form>
  );
}

/** Only while a channel is in the trash: the count on the row, the channels inside, each with "Restore". */
function TrashRow() {
  const { t } = useT();
  const channels = useStore((s) => s.channels);
  const [trash, setTrash] = useState<DeletedChannel[]>([]);
  const sub = useSub();
  const { open, hide } = sub;
  // A deletion or a restore (here or on another device) changes the channel list; the trash follows.
  useEffect(() => {
    api.deletedChannels().then(setTrash, () => {});
  }, [channels]);
  // The last one brought back takes the row away, and the list with it.
  useEffect(() => {
    if (open && trash.length === 0) hide();
  }, [open, trash.length, hide]);

  return (
    <>
      {trash.length > 0 && (
        <Row title={t('settings.server.trash')} onPress={sub.show}>
          <RowValue>{trash.length}</RowValue>
        </Row>
      )}
      <SubPage open={open} title={t('settings.server.trash')} onClose={hide}>
        <Rows className="max-md:mt-2">
          {trash.map((c) => (
            <Row
              key={c.id}
              title={c.kind === 'text' ? `# ${c.name}` : c.name}
              value={`${shortStamp(c.deletedAt)} · ${t('settings.server.trashMessages', { n: c.messages })}`}
            >
              <Secondary
                onPress={() => api.restoreChannel(c.id).then(setChannels, (e) => showError(e instanceof Error ? e.message : t('settings.server.failed')))}
              >
                {t('settings.server.restore')}
              </Secondary>
            </Row>
          ))}
        </Rows>
      </SubPage>
    </>
  );
}
