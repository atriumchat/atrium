import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { addDm, messageUser, showError, useStore } from '../src/store';
import { useT } from '../src/i18n';
import { Text, TextInput } from '../src/text';
import { colors } from '../src/theme';
import { Avatar } from '../src/components/Avatar';
import { EmptyState } from '../src/components/LineArt';
import { CheckIcon, SearchIcon } from '../src/icons';
import { openChat } from '../src/nav';
import { haptic } from '../src/haptics';

const MAX_MEMBERS = 10;

/** New group, or add people to this DM / group: pick friends in a native sheet. */
export default function GroupPicker() {
  const { dmId } = useLocalSearchParams<{ dmId?: string }>();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const friends = useStore((s) => s.friends);
  const users = useStore((s) => s.users);
  const dm = useStore((s) => (dmId ? s.dms.find((d) => d.id === dmId) : undefined));
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const inside = new Set(dm?.members ?? []);
  const q = filter.trim().toLowerCase();
  const candidates = friends.filter((f) => f.status === 'friend' && !inside.has(f.userId)).map((f) => users[f.userId]).filter((u): u is NonNullable<typeof u> => !!u && (!q || u.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const base = dm ? dm.members.length : 1;
  const left = MAX_MEMBERS - base - selected.length;
  const addingToGroup = dm?.kind === 'group';
  const title = addingToGroup ? t('people.picker.addToGroup') : dmId ? t('people.picker.createGroup') : t('people.picker.newGroup');
  const action = addingToGroup ? t('people.picker.add') : !dmId && selected.length <= 1 ? t('people.picker.openChat') : t('people.picker.createGroup');
  const toggle = (id: string) => { haptic.select(); setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : left > 0 ? [...list, id] : list)); };
  async function submit() {
    setBusy(true);
    try {
      if (!dmId && selected.length === 1) { const d = await messageUser(selected[0]!); router.back(); if (d) setTimeout(() => openChat(d.id), 50); }
      else if (addingToGroup && dm) { addDm(await api.addGroupMembers(dm.id, selected)); router.back(); }
      else {
        // A new group: from scratch, or the people of a 1:1 DM plus the new ones.
        const group = await api.createGroup([...(dm?.userId ? [dm.userId] : []), ...selected]);
        addDm(group); router.back(); setTimeout(() => openChat(group.id), 50);
      }
    } catch (e) { showError(e instanceof Error ? e.message : t('people.failed')); } finally { setBusy(false); }
  }
  return (
    // Exactly a header and a list, side by side in the sheet: that is the one layout a native form sheet sizes
    // right. Anything else around the list (a title above it, buttons under it) ended up drawn under the rows.
    <>
      <View collapsable={false} style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ height: 36, justifyContent: 'center', paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 })}><Text style={{ fontSize: 17, color: colors.muted }}>{t('people.picker.cancel')}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy || selected.length === 0} onPress={() => void submit()} style={({ pressed }) => ({ height: 36, minWidth: 80, borderRadius: 18, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: selected.length ? (pressed ? '#e7e7ea' : '#fff') : colors.tertiary })}>{busy ? <ActivityIndicator color="#000" /> : <Text style={{ fontSize: 16, fontWeight: '500', color: selected.length ? '#000' : colors.faint }}>{action}</Text>}</Pressable>
        </View>
        <Text style={{ marginTop: 8, fontSize: 22, fontWeight: '700' }}>{title}</Text>
        <Text style={{ marginTop: 2, fontSize: 14, color: colors.muted }}>{left > 0 ? t('people.picker.canAdd', { n: left }) : t('people.picker.full')}</Text>
        <View style={{ marginTop: 12, marginBottom: 8, height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, backgroundColor: colors.graphite, paddingHorizontal: 14 }}>
          <SearchIcon size={16} color={colors.muted} />
          <TextInput value={filter} onChangeText={setFilter} placeholder={t('people.picker.find')} accessibilityLabel={t('people.picker.find')} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, fontSize: 17, color: '#fff', height: 40 }} />
        </View>
      </View>
      <FlatList
        data={candidates}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: Math.max(16, insets.bottom) }}
        ListEmptyComponent={friends.some((f) => f.status === 'friend') ? <EmptyState compact art="search" title={t('people.picker.noResults')} text={t('people.picker.noResultsText')} plate={colors.overlay} /> : <EmptyState compact art="couch" title={t('people.friends.emptyFriends')} text={t('people.picker.onlyFriends')} plate={colors.overlay} />}
        renderItem={({ item: u }) => {
          const on = selected.includes(u.id);
          return (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => toggle(u.id)} style={({ pressed }) => ({ height: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 8, backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent' })}>
              <Avatar user={u} size={36} ringBg={colors.overlay} />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 17 }}>{u.name}</Text>
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? '#fff' : 'rgba(161,161,170,0.5)', backgroundColor: on ? '#fff' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{on ? <CheckIcon size={14} color="#000" strokeWidth={3} /> : null}</View>
            </Pressable>
          );
        }}
      />
    </>
  );
}
