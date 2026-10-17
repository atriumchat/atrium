import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { api } from '../api';
import { showError, useStore } from '../store';
import { ServerMark } from '../ui/Logo';
import { IconCropper, centred, cropToBlob, loadImage, type Crop } from '../ui/IconCropper';

/** The "Сервер" page of the settings, for the admin: the server's icon and name, as set in the first-run setup. */
export function ServerSettings() {
  return (
    <>
      <IconSection />
      <NameSection />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-[15px] font-medium">{title}</h3>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  );
}

const field = 'h-11 w-full rounded-full bg-surface-tertiary px-4 text-[15px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus';
const white = 'h-11 rounded-full px-5 text-[15px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]';
const quiet = 'h-11 rounded-full px-4 text-[15px] text-muted hover:bg-white/10 hover:text-foreground';

const apply = (info: { serverName: string; serverIcon: string | null }) => useStore.setState(info);

function IconSection() {
  const icon = useStore((s) => s.serverIcon);
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ image: HTMLImageElement; crop: Crop } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return showError('Картинка больше 8 МБ');
    try {
      const image = await loadImage(file);
      setPicked({ image, crop: centred(image) });
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не получилось открыть картинку');
    }
  }

  function drop() {
    if (picked) URL.revokeObjectURL(picked.image.src);
    setPicked(null);
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
    <Section title="Значок">
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {picked ? (
        <>
          <div className="w-full max-w-[420px]">
            <IconCropper image={picked.image} crop={picked.crop} onChange={(crop) => setPicked({ ...picked, crop })} className="h-64 rounded-[24px] bg-black" />
          </div>
          <div className="mt-1 flex gap-2">
            <Button
              isPending={busy}
              onPress={() =>
                run(async () => {
                  apply(await api.uploadServerIcon(await cropToBlob(picked.image, picked.crop)));
                  drop();
                })
              }
              className={white}
            >
              Сохранить
            </Button>
            <button type="button" onClick={drop} className={quiet}>
              Отмена
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-4">
          <ServerMark icon={icon} size={64} />
          <Button onPress={() => input.current?.click()} className={white}>
            {icon ? 'Заменить' : 'Загрузить'}
          </Button>
          {icon && (
            <button type="button" disabled={busy} onClick={() => run(async () => apply(await api.deleteServerIcon()))} className={quiet}>
              Убрать
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function NameSection() {
  const saved = useStore((s) => s.serverName);
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
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Не удалось переименовать');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Название">
      <form onSubmit={submit} className="flex gap-2">
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Название сервера" className={field} />
        {changed && (
          <Button type="submit" isPending={busy} className={white}>
            Сохранить
          </Button>
        )}
      </form>
    </Section>
  );
}
