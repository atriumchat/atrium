import { useState } from 'react';
import { Button } from '@heroui/react';
import { api } from '../api';
import { addDm, closePicker, messageUser, openDm, showError, useStore, type Picker } from '../store';
import { plural } from '../chat/format';
import { Avatar } from '../ui/Avatar';
import { Dialog } from '../ui/Dialog';
import { CheckIcon, SearchIcon } from '../ui/icons';

const MAX_MEMBERS = 10;

export function GroupPicker() {
  const picker = useStore((s) => s.picker);
  // Keyed so every opening starts with an empty selection.
  return picker ? <PickerDialog key={picker.mode === 'add' ? picker.dmId : 'create'} picker={picker} /> : null;
}

function PickerDialog({ picker }: { picker: Picker }) {
  const friends = useStore((s) => s.friends);
  const users = useStore((s) => s.users);
  const dm = useStore((s) => (picker.mode === 'add' ? s.dms.find((d) => d.id === picker.dmId) : undefined));
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const inside = new Set(dm?.members ?? []);
  const q = filter.trim().toLowerCase();
  const candidates = friends
    .filter((f) => f.status === 'friend' && !inside.has(f.userId))
    .map((f) => users[f.userId])
    .filter((u) => u && (!q || u.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  // You, plus the people already in the conversation.
  const base = dm ? dm.members.length : 1;
  const left = MAX_MEMBERS - base - selected.length;
  const addingToGroup = dm?.kind === 'group';
  const title = addingToGroup ? 'Добавить в группу' : picker.mode === 'add' ? 'Создать группу' : 'Новая группа';
  const action = addingToGroup ? 'Добавить' : picker.mode === 'create' && selected.length <= 1 ? 'Открыть чат' : 'Создать группу';

  function toggle(id: string) {
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : left > 0 ? [...list, id] : list));
  }

  async function submit() {
    setBusy(true);
    try {
      if (picker.mode === 'create' && selected.length === 1) {
        closePicker();
        await messageUser(selected[0]);
      } else if (addingToGroup && dm) {
        addDm(await api.addGroupMembers(dm.id, selected));
        closePicker();
      } else {
        // A new group: from scratch, or the people of a 1:1 DM plus the new ones.
        const group = await api.createGroup([...(dm?.userId ? [dm.userId] : []), ...selected]);
        addDm(group);
        closePicker();
        openDm(group.id);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      sheet
      title={title}
      subtitle={left > 0 ? `Можно добавить ещё ${left} ${plural(left, ['друга', 'друзей', 'друзей'])}` : 'В группе уже 10 человек — больше нельзя'}
      onClose={closePicker}
      footer={
        <>
          <Button variant="tertiary" onPress={closePicker} className="rounded-full">
            Отмена
          </Button>
          <Button onPress={submit} isPending={busy} isDisabled={selected.length === 0} className="rounded-full">
            {action}
          </Button>
        </>
      }
    >
      <label className="mb-2 flex h-10 items-center gap-2 rounded-[12px] bg-default px-3 text-muted focus-within:ring-2 focus-within:ring-focus">
        <SearchIcon size={16} />
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Найти друга"
          aria-label="Найти друга"
          className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted"
        />
      </label>
      {candidates.length === 0 ? (
        <p className="px-2 py-10 text-center text-[15px] text-muted">
          {friends.some((f) => f.status === 'friend') ? 'Никого не нашлось' : 'В группу можно позвать только друзей'}
        </p>
      ) : (
        <ul>
          {candidates.map((u) => {
            const on = selected.includes(u.id);
            return (
              <li key={u.id}>
                <button
                  onClick={() => toggle(u.id)}
                  aria-pressed={on}
                  className="flex h-12 w-full items-center gap-3 rounded-[12px] px-2 text-left hover:bg-default/60"
                >
                  <Avatar user={u} size={32} ringBg="var(--overlay)" />
                  <span className="min-w-0 flex-1 truncate text-[16px]">{u.name}</span>
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                      on ? 'border-accent bg-accent text-accent-foreground' : 'border-muted/50'
                    }`}
                  >
                    {on && <CheckIcon size={14} strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
