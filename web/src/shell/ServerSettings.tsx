import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { setChannels, showError, useStore } from '../store';
import { ServerMark } from '../ui/Logo';
import { IconCropper, centred, cropToBlob, loadImage, type Crop } from '../ui/IconCropper';
import { plural, shortStamp } from '../chat/format';
import type { DeletedChannel } from '../types';
import { Primary, Quiet, Row, RowValue, Rows, Secondary, SubPage, field, fieldLabel, useSub } from '../ui/settings';

/**
 * The "Сервер" page of the settings, for the admin: the server's icon and name, as in the first-run setup. On the
 * phone one group of the settings page, the name a row of its own.
 */
export function ServerSettings() {
  const isMobile = useStore((s) => s.isMobile);
  if (isMobile) {
    return (
      <Rows title="Сервер" className="mt-6">
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
  const icon = useStore((s) => s.serverIcon);
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ image: HTMLImageElement; crop: Crop } | null>(null);
  // Kept apart from `picked`, so the picture stays while the crop's page slides away.
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return showError('Картинка больше 8 МБ');
    try {
      const image = await loadImage(file);
      if (picked) URL.revokeObjectURL(picked.image.src);
      setPicked({ image, crop: centred(image) });
      setCropping(true);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не получилось открыть картинку');
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <Row icon={<ServerMark icon={icon} size={34} />} title="Значок" value={icon ? 'Свой' : 'Знак Gomex'}>
        {icon && (
          <Quiet disabled={busy} onClick={() => run(async () => apply(await api.deleteServerIcon()))}>
            Убрать
          </Quiet>
        )}
        <Secondary onPress={() => input.current?.click()}>{icon ? 'Заменить' : 'Выбрать'}</Secondary>
      </Row>
      <SubPage
        open={cropping && !!picked}
        title="Значок"
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
              Сохранить
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
  const name = useStore((s) => s.serverName);
  const sub = useSub();
  return (
    <>
      <Row title="Название" onPress={sub.show}>
        <RowValue>{name}</RowValue>
      </Row>
      <SubPage key={sub.key} open={sub.open} title="Название" onClose={sub.hide}>
        <NameField onSaved={sub.hide} className="mt-2" />
      </SubPage>
    </>
  );
}

function NameField({ onSaved, className = '' }: { onSaved?: () => void; className?: string }) {
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
      showError(err instanceof Error ? err.message : 'Не удалось переименовать');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={className}>
      {/* On the phone this is a page of its own, titled the same. */}
      <label htmlFor={id} className={`${fieldLabel} max-md:sr-only`}>
        Название
      </label>
      <div className="flex gap-2 max-md:flex-col">
        <input id={id} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={field} />
        {changed && (
          <Primary type="submit" isPending={busy} className="shrink-0">
            Сохранить
          </Primary>
        )}
      </div>
    </form>
  );
}

/** Only while a channel is in the trash: the count on the row, the channels inside, each with «Вернуть». */
function TrashRow() {
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
        <Row title="Удалённые каналы" onPress={sub.show}>
          <RowValue>{trash.length}</RowValue>
        </Row>
      )}
      <SubPage open={open} title="Удалённые каналы" onClose={hide}>
        <Rows className="max-md:mt-2">
          {trash.map((c) => (
            <Row
              key={c.id}
              title={c.kind === 'text' ? `# ${c.name}` : c.name}
              value={`${shortStamp(c.deletedAt)} · ${c.messages} ${plural(c.messages, ['сообщение', 'сообщения', 'сообщений'])}`}
            >
              <Secondary
                onPress={() => api.restoreChannel(c.id).then(setChannels, (e) => showError(e instanceof Error ? e.message : 'Не получилось'))}
              >
                Вернуть
              </Secondary>
            </Row>
          ))}
        </Rows>
      </SubPage>
    </>
  );
}
