import { useEffect, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';
import { api } from '../src/api';
import { dmTitle, showError, useStore } from '../src/store';
import { useT, type TFn } from '../src/i18n';
import { Text } from '../src/text';
import { colors } from '../src/theme';
import { Avatar } from '../src/components/Avatar';
import { EmptyState } from '../src/components/LineArt';
import { AtIcon, ReplyIcon } from '../src/icons';
import { dateOnly, plainText, sameDay, timeOf } from '../src/format';
import { openChat } from '../src/nav';
import { router } from 'expo-router';
import type { InboxItem } from '../src/protocol';

/** Notifications: every message that mentions you or answers you, newest first. */
export default function Inbox() {
  const { t } = useT();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const total = useStore((s) => Object.values(s.data?.mentions ?? {}).reduce((n, m) => n + m, 0));
  useEffect(() => { api.inbox().then(setItems, (e) => showError(e instanceof Error ? e.message : t('people.inbox.loadFailed'))); }, [t]);

  async function readAll() {
    const mentions = useStore.getState().data?.mentions ?? {};
    const ids = Object.keys(mentions).filter((id) => (mentions[id] ?? 0) > 0);
    useStore.setState((s) => s.data ? { data: { ...s.data, mentions: Object.fromEntries(Object.keys(s.data.mentions).map((id) => [id, 0])), unread: { ...s.data.unread, ...Object.fromEntries(ids.map((id) => [id, 0])) } } } : s);
    setItems((list) => list?.map((i) => ({ ...i, unread: false })) ?? null);
    await Promise.all(ids.map((id) => api.markRead(id, Date.now()).catch(() => undefined)));
  }

  const groups: { title: string; data: InboxItem[] }[] = [];
  for (const item of items ?? []) {
    const title = dayLabel(item.createdAt, t);
    const last = groups[groups.length - 1];
    if (last?.title === title) last.data.push(item); else groups.push({ title, data: [item] });
  }
  const heading = (
    <View collapsable={false} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, paddingBottom: 4, paddingLeft: 20, paddingRight: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: '500' }}>{t('people.inbox.title')}</Text>
      {total > 0 ? <Pressable accessibilityRole="button" onPress={() => void readAll()} style={{ paddingHorizontal: 12, paddingVertical: 4 }}><Text style={{ fontSize: 14, color: colors.muted }}>{t('people.inbox.markRead')}</Text></Pressable> : null}
    </View>
  );
  // A header and then the list, nothing else: the one layout a native form sheet sizes right.
  if (items && items.length > 0) {
    return (
      <>
        {heading}
        <SectionList
          sections={groups}
          keyExtractor={(i) => i.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }}
          renderSectionHeader={({ section }) => <Text style={{ paddingHorizontal: 12, paddingBottom: 4, paddingTop: 12, fontSize: 13, fontWeight: '500', color: colors.muted }}>{section.title}</Text>}
          renderItem={({ item }) => <InboxRow item={item} onOpen={() => { router.back(); setTimeout(() => openChat(item.channelId), 50); }} />}
        />
      </>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.overlay }}>
      {heading}
      {items === null ? <Text style={{ paddingVertical: 40, textAlign: 'center', fontSize: 15, color: colors.muted }}>{t('people.inbox.loading')}</Text> : (
        <EmptyState compact art="tray" title={t('people.inbox.empty')} text={t('people.inbox.emptyText')} plate={colors.overlay} fill />
      )}
    </View>
  );
}

function dayLabel(ts: number, t: TFn) {
  const now = Date.now();
  if (sameDay(ts, now)) return t('people.inbox.today');
  if (sameDay(ts, now - 86_400_000)) return t('people.inbox.yesterday');
  return dateOnly(ts);
}

function InboxRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const author = users[item.userId];
  const where = useStore((s) => {
    if (!item.dm) return `#${s.data?.channels.find((c) => c.id === item.channelId)?.name ?? t('people.inbox.channel')}`;
    const dm = s.dms.find((d) => d.id === item.channelId);
    return dm ? dmTitle(dm, s.users, s.data?.me.id) : t('people.inbox.dms');
  });
  const answersMe = useStore((s) => !item.mentionsAll && !item.mentions?.includes(s.data?.me.id ?? '') && !!item.replyTo);
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : item.unread ? 'rgba(255,255,255,0.04)' : 'transparent' })}>
      <View style={{ marginTop: 2 }}>
        <Avatar user={author} size={40} ringBg={colors.overlay} />
        <View style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.overlay, alignItems: 'center', justifyContent: 'center', backgroundColor: answersMe ? colors.graphite : '#64a8ff' }}>
          {answersMe ? <ReplyIcon size={11} strokeWidth={2.6} /> : <AtIcon size={11} strokeWidth={2.6} color="#000" />}
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: item.unread ? '600' : '500' }}>{author?.name ?? t('people.inbox.someone')}</Text>
            <Text style={{ fontSize: 14, color: colors.muted }}> · {where}</Text>
          </Text>
          <Text style={{ fontSize: 13, color: colors.faint, fontVariant: ['tabular-nums'] }}>{timeOf(item.createdAt)}</Text>
          {item.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#64a8ff', alignSelf: 'center' }} /> : null}
        </View>
        <Text numberOfLines={2} style={{ marginTop: 2, fontSize: 15, lineHeight: 20, color: 'rgba(255,255,255,0.8)' }}>{plainText(item.content, users) || t('people.inbox.attachment')}</Text>
      </View>
    </Pressable>
  );
}
