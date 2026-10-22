import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Text, TextInput } from '../text';
import { colors } from '../theme';
import { ServerMark } from '../components/Logo';
import { BellIcon, SearchIcon, UsersIcon } from '../icons';
import { openFriends, openInbox } from '../nav';

/**
 * The header of the home and server tabs: the server (or `title`, home's own name, in its place), then its buttons;
 * `friends` adds Friends (on home). The same height on both, so switching tabs moves nothing.
 */
export function TabHeader({ title, friends = false }: { title?: string; friends?: boolean }) {
  const { t } = useT();
  const name = useStore((s) => s.data?.serverName);
  const icon = useStore((s) => s.data?.serverIcon);
  const incoming = useStore((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const mentions = useStore((s) => Object.values(s.data?.mentions ?? {}).reduce((n, m) => n + m, 0));
  return (
    <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 }}>
      {title ? null : <ServerMark icon={icon} size={36} />}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 24, fontWeight: '700' }}>{title ?? name ?? 'Gomex'}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {friends ? <HeaderButton label={t('shell.home.friends')} count={incoming} onPress={openFriends}><UsersIcon size={21} /></HeaderButton> : null}
        <HeaderButton label={mentions ? t('people.inbox.titleNew', { n: mentions }) : t('people.inbox.title')} count={mentions} onPress={openInbox}><BellIcon size={21} /></HeaderButton>
      </View>
    </View>
  );
}

/**
 * The search under a tab's header: one row on every tab, the same height and field, so switching tabs moves nothing.
 * `aside`: a round button at its right (the server's invite).
 */
export function SearchRow({ value, onChange, placeholder, aside }: { value: string; onChange: (value: string) => void; placeholder: string; aside?: ReactNode }) {
  return (
    <View style={{ height: 72, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
      <View style={{ flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24, paddingHorizontal: 16, backgroundColor: colors.graphite }}>
        <SearchIcon size={16} color={colors.faint} />
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={placeholder} returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} autoCapitalize="none" style={{ flex: 1, fontSize: 17, color: colors.text, height: 48 }} />
      </View>
      {aside}
    </View>
  );
}

/** A round icon button of the header, with a red count in its corner. */
function HeaderButton({ label, count, onPress, children }: { label: string; count: number; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)' })}
    >
      {children}
      {count > 0 && (
        <View style={{ position: 'absolute', right: -4, top: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.window, alignItems: 'center', justifyContent: 'center', boxSizing: 'content-box' }}>
          <Text style={{ fontSize: 11, fontWeight: '500', lineHeight: 14 }}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}
