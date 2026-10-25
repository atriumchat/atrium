import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Label, Switch, toast } from '@heroui/react';
import { api } from '../api';
import { useT } from '../i18n';
import { addUser, setChannels, showError, useStore } from '../store';
import { ServerMark } from '../ui/Logo';
import { Avatar } from '../ui/Avatar';
import { IconCropper, centred, cropToBlob, loadImage, type Crop } from '../ui/IconCropper';
import { shortStamp } from '../chat/format';
import type { DeletedChannel, DiscordChannel, DiscordPreview, EarlyAccess } from '../types';
import { Primary, Quiet, Row, RowFrame, RowValue, Rows, Secondary, SubPage, field, fieldLabel, useSub } from '../ui/settings';

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
        <ImportRow />
        <TrashRow />
        <RemovedRow />
        <EarlyRow />
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
        <ImportRow />
        <TrashRow />
        <RemovedRow />
        <EarlyRow />
      </Rows>
    </>
  );
}

const apply = (info: { serverName: string; serverIcon: string | null }) => useStore.setState(info);

/**
 * Early access: pre-releases for this server, and once a week the seven numbers under "What is sent", exactly as
 * they would go now. Off until the admin turns it on.
 */
function EarlyRow() {
  const { t } = useT();
  const [info, setInfo] = useState<EarlyAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const sub = useSub();
  useEffect(() => {
    api.earlyAccess().then(setInfo, () => {});
  }, []);
  if (!info) return null;
  const n = info.numbers;
  const rows: [string, string | number][] = [
    [t('settings.server.earlyId'), n.server],
    [t('settings.server.earlyVersion'), n.version],
    [t('settings.server.earlyDays'), n.days_since_install],
    [t('settings.server.earlyMembers'), n.members],
    [t('settings.server.earlyVoice3People'), n.voice3_people],
    [t('settings.server.earlyActive2d'), n.active2d],
    [t('settings.server.earlyVoice3Days'), n.voice3_days],
  ];
  return (
    <>
      <RowFrame>
        <Switch
          className="w-full"
          isSelected={info.enabled}
          isDisabled={busy}
          onChange={async (on) => {
            setBusy(true);
            try {
              setInfo(await api.setEarlyAccess(on));
            } catch (e) {
              showError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Switch.Content className="flex w-full items-center justify-between gap-3">
            <span className="min-w-0">
              <Label className="text-[14px] font-medium max-md:text-[16px] max-md:font-normal">{t('settings.server.early')}</Label>
              <span className="block text-[13px] leading-snug text-muted">{t('settings.server.earlyHint')}</span>
            </span>
            {/* Off, the track is a white tint: graphite would vanish in the phone's graphite cards. */}
            <Switch.Control className="shrink-0 [--switch-control-bg:rgb(255_255_255/0.16)]">
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </RowFrame>
      <Row title={t('settings.server.earlySent')} onPress={sub.show}>
        <RowValue>{info.lastSent ? shortStamp(info.lastSent.at) : t('settings.server.earlyNever')}</RowValue>
      </Row>
      <SubPage open={sub.open} title={t('settings.server.earlySent')} onClose={sub.hide}>
        <Rows className="max-md:mt-2">
          {rows.map(([title, value]) => (
            <Row key={title} title={title}>
              <RowValue>{value}</RowValue>
            </Row>
          ))}
        </Rows>
      </SubPage>
    </>
  );
}

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

/**
 * A Discord server's categories and channels, from its template link (Discord: Server Settings → Server Template):
 * the server reads the template, shows what it would make, everything ticked; "Move over" makes it.
 */
function ImportRow() {
  const { t } = useT();
  const sub = useSub();
  const id = useId();
  const [link, setLink] = useState('');
  const [found, setFound] = useState<DiscordPreview | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const [replaceEmpty, setReplaceEmpty] = useState(true);
  const [busy, setBusy] = useState(false);

  async function look(e: FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    setBusy(true);
    try {
      setFound(await api.discordPreview(link.trim()));
      setSkip([]);
    } catch (err) {
      showError(err instanceof Error ? err.message : t('settings.server.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function move() {
    setBusy(true);
    try {
      const done = await api.discordImport(link.trim(), skip, replaceEmpty);
      useStore.setState({ categories: done.categories });
      setChannels(done.channels);
      toast.success(t('settings.server.importDone', { n: done.added }));
      setFound(null);
      setLink('');
      sub.hide();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('settings.server.failed'));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: string) => setSkip((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const tick = (key: string, label: string, strong = false, inner = false) => (
    <label key={key} className={`flex h-10 cursor-pointer items-center gap-3 rounded-full px-3 text-[15px] hover:bg-white/[0.04] ${inner ? 'pl-9' : ''} ${strong ? 'font-medium' : 'text-muted'}`}>
      <input type="checkbox" checked={!skip.includes(key)} onChange={() => toggle(key)} className="h-4 w-4 accent-white" />
      <span className="truncate">{label}</span>
    </label>
  );
  const channel = (c: DiscordChannel, inner: boolean) => tick(c.key, c.kind === 'text' ? `# ${c.name}` : c.name, false, inner);

  return (
    <>
      <Row title={t('settings.server.import')} value={t('settings.server.importSub')} onPress={sub.show} />
      <SubPage
        key={sub.key}
        open={sub.open}
        title={t('settings.server.import')}
        onClose={sub.hide}
        footer={found ? <Primary onPress={move} isPending={busy}>{t('settings.server.importGo')}</Primary> : undefined}
      >
        <form onSubmit={look} className="mt-2">
          <label htmlFor={id} className={fieldLabel}>
            {t('settings.server.importLink')}
          </label>
          <div className="flex gap-2 max-md:flex-col">
            <input id={id} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://discord.new/…" autoCapitalize="off" spellCheck={false} className={field} />
            <Primary type="submit" isPending={busy && !found} isDisabled={!link.trim()} className="shrink-0">
              {t('settings.server.importLook')}
            </Primary>
          </div>
          <p className="mt-2 text-[13px] text-muted">{t('settings.server.importHow')}</p>
        </form>
        {found && (
          <div className="mt-6">
            {found.loose.length > 0 && (
              <div className="pb-2">
                <p className="px-3 pb-1 text-[13px] text-muted">{t('settings.server.importLoose')}</p>
                {found.loose.map((c) => channel(c, false))}
              </div>
            )}
            {found.categories.map((c) => (
              <div key={c.key} className="pb-2">
                {tick(c.key, c.name, true)}
                {!skip.includes(c.key) && c.channels.map((x) => channel(x, true))}
              </div>
            ))}
            {found.roles > 0 && <p className="px-3 pt-2 text-[13px] text-muted">{t('settings.server.importRoles', { n: found.roles })}</p>}
            <label className="mt-4 flex cursor-pointer items-center gap-3 px-3 text-[15px]">
              <input type="checkbox" checked={replaceEmpty} onChange={(e) => setReplaceEmpty(e.target.checked)} className="h-4 w-4 accent-white" />
              {t('settings.server.importReplace')}
            </label>
            <Primary onPress={move} isPending={busy} className="mt-6 max-md:hidden">
              {t('settings.server.importGo')}
            </Primary>
          </div>
        )}
      </SubPage>
    </>
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

/** Only while someone is off the server: who the admin removed, each with "Let back". */
function RemovedRow() {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const removed = Object.values(users).filter((u) => u.removed).sort((a, b) => a.name.localeCompare(b.name));
  const sub = useSub();
  const { open, hide } = sub;
  useEffect(() => {
    if (open && removed.length === 0) hide();
  }, [open, removed.length, hide]);

  return (
    <>
      {removed.length > 0 && (
        <Row title={t('settings.server.removed')} onPress={sub.show}>
          <RowValue>{removed.length}</RowValue>
        </Row>
      )}
      <SubPage open={open} title={t('settings.server.removed')} onClose={hide}>
        <Rows className="max-md:mt-2">
          {removed.map((u) => (
            <Row
              key={u.id}
              icon={<Avatar user={u} size={32} ringBg="var(--default)" />}
              title={u.name}
            >
              <Secondary onPress={() => api.letBack(u.id).then(addUser, (e) => showError(e instanceof Error ? e.message : t('settings.server.failed')))}>
                {t('people.admin.letBack')}
              </Secondary>
            </Row>
          ))}
        </Rows>
      </SubPage>
    </>
  );
}
