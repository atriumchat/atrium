import { ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useStore } from '../../src/store';
import { useT } from '../../src/i18n';
import { Text } from '../../src/text';
import { colors } from '../../src/theme';
import { Avatar } from '../../src/components/Avatar';
import { Row, RowIcon, RowValue, Rows } from '../../src/components/Settings';
import { PencilIcon, UserIcon } from '../../src/icons';

export default function Profile() {
  const { t } = useT();
  const me = useStore((s) => s.data?.me);
  if (!me) return null;
  return (
    <ScrollView style={{ backgroundColor: colors.window }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16 }}>
      <Stack.Screen options={{ title: t('shell.you.profile') }} />
      <View style={{ alignItems: 'center', paddingTop: 16 }}>
        <Avatar user={me} size={96} ringBg={colors.window} />
        <Text numberOfLines={1} style={{ marginTop: 8, maxWidth: '100%', fontSize: 22, fontWeight: '700' }}>{me.name}</Text>
      </View>
      <Rows style={{ marginTop: 24 }}>
        <Row icon={<RowIcon><UserIcon size={20} /></RowIcon>} title={t('account.nick.title')}><RowValue>{me.name}</RowValue></Row>
        <Row icon={<RowIcon><PencilIcon size={20} /></RowIcon>} title={t('shell.you.bio')} value={me.bio || undefined} onPress={() => router.push('/you/bio')} last />
      </Rows>
    </ScrollView>
  );
}
