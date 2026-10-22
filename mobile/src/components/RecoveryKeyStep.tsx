import { useState } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useT } from '../i18n';
import { Text } from '../text';
import { haptic } from '../haptics';
import { type } from '../theme';
import { FlowPrimary, FlowStep, TextAction } from '@gomex/ui-native';

/**
 * The recovery key, shown once (DESIGN.md flow look): big, to copy or save through the share sheet; "Next" opens once
 * it's been copied or saved, and the action used says so. No tick box to tick instead. After sign-up, after recovery,
 * and in "Your own server".
 */
export function RecoveryKeyStep({ value, nick, place, onNext, busy = false }: { value: string; nick: string; place: string; onNext: () => void; busy?: boolean }) {
  const { t } = useT();
  const [kept, setKept] = useState<'copied' | 'saved' | null>(null);
  async function save() {
    const result = await Share.share({ message: [`Atrium · ${place}`, t('setup.key.fileNick', { nick }), t('setup.key.fileKey', { key: value })].join('\n') });
    if (result.action === Share.sharedAction) setKept('saved');
  }
  return (
    <FlowStep title={t('setup.key.title')} sub={t('account.key.hint')} actions={<FlowPrimary busy={busy} disabled={!kept} onPress={onNext}>{t('setup.next')}</FlowPrimary>}>
      <Text selectable style={{ fontSize: type.key.size, lineHeight: type.key.line, letterSpacing: type.key.tracking, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <View style={{ flexDirection: 'row', gap: 24 }}>
        <TextAction left onPress={() => { void Clipboard.setStringAsync(value); haptic.tap(); setKept('copied'); }}>{kept === 'copied' ? t('common.copy.done') : t('common.copy.label')}</TextAction>
        <TextAction left onPress={() => void save()}>{kept === 'saved' ? t('setup.key.downloaded') : t('setup.key.download')}</TextAction>
      </View>
    </FlowStep>
  );
}
