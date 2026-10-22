import { ActionSheetIOS, Alert, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { getCredentials } from '../../src/api';
import { endSession, showError, useStore } from '../../src/store';
import { setLanguage, useLanguage, useT, type Lang } from '../../src/i18n';
import { colors } from '../../src/theme';
import { AtriumMark } from '../../src/components/Logo';
import { Row, RowIcon, RowValue, Rows } from '../../src/components/Settings';
import { GlobeIcon, LogoutIcon, UserPlusIcon } from '../../src/icons';
import { shareInvite } from '../../src/invite';

/** What's rarely touched, out of the "You" tab: the language, the invite, the server, and logging out. */
export default function Settings() {
  const { t } = useT();
  const isAdmin = useStore((s) => s.data?.isAdmin);
  const choice = useLanguage((s) => s.choice);
  function pickLanguage() {
    const options: [Lang | null, string][] = [[null, t('account.language.system')], ['ru', 'Русский'], ['en', 'English']];
    const labels = [...options.map((o) => (o[0] === choice ? `${o[1]} ✓` : o[1])), t('common.cancel')];
    ActionSheetIOS.showActionSheetWithOptions({ title: t('account.language'), options: labels, cancelButtonIndex: labels.length - 1, userInterfaceStyle: 'dark' }, (i) => {
      const picked = options[i];
      if (picked) setLanguage(picked[0]);
    });
  }
  const langLabel = choice === 'ru' ? 'Русский' : choice === 'en' ? 'English' : t('account.language.system');
  return (
    <ScrollView style={{ backgroundColor: colors.window }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 16 }}>
      <Stack.Screen options={{ title: t('m.settings') }} />
      <Rows>
        <Row icon={<RowIcon><GlobeIcon size={20} /></RowIcon>} title={t('account.language')} onPress={pickLanguage}>
          <RowValue>{langLabel}</RowValue>
        </Row>
        <Row icon={<RowIcon><UserPlusIcon size={20} /></RowIcon>} title={t('people.invite.title')} onPress={() => void shareInvite()} last={!isAdmin} />
        {isAdmin ? <Row icon={<RowIcon><AtriumMark size={18} /></RowIcon>} title={t('shell.you.server')} value={getCredentials()?.server.replace(/^https?:\/\//, '')} last /> : null}
      </Rows>
      <Rows>
        <Row
          icon={<RowIcon><LogoutIcon size={20} color={colors.danger} /></RowIcon>}
          title={t('shell.you.logout')}
          danger
          chevron={false}
          onPress={() => Alert.alert(t('m.logoutConfirm'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('shell.you.logout'), style: 'destructive', onPress: () => void endSession().catch(showError) }])}
          last
        />
      </Rows>
    </ScrollView>
  );
}
