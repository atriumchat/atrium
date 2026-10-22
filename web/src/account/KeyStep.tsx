import { useState } from 'react';
import { FlowPrimary, FlowStep, TextAction } from '@atrium/ui-web';
import { downloadKey, type NewKey } from './RecoveryKey';
import { useT } from '../i18n';

/**
 * The recovery key, shown once, in the flow look (as the phone's RecoveryKeyStep): big, to copy or download as a
 * file; "Next" opens once it's been copied or downloaded, and the action used says so. No tick box to tick instead.
 * After sign-up, after a recovery or a reset link (they spend the old key), and in the server's setup wizard.
 */
export function KeyStep({ value, title, sub, error, onNext }: { value: NewKey; title: string; sub: string; error?: string | null; onNext: () => void }) {
  const { t } = useT();
  const [kept, setKept] = useState<'copied' | 'downloaded' | null>(null);

  async function copy() {
    await navigator.clipboard.writeText(value.key).catch(() => undefined);
    setKept('copied');
  }

  return (
    <FlowStep title={title} sub={sub} error={error} onSubmit={() => kept && onNext()} actions={<FlowPrimary type="submit" disabled={!kept}>{t('setup.next')}</FlowPrimary>}>
      <p className="flow-big">{value.key}</p>
      <div className="flow-actions">
        <TextAction left onPress={() => void copy()}>{kept === 'copied' ? t('common.copy.done') : t('common.copy.label')}</TextAction>
        <TextAction left onPress={() => (downloadKey(value), setKept('downloaded'))}>{kept === 'downloaded' ? t('setup.key.downloaded') : t('setup.key.download')}</TextAction>
      </div>
    </FlowStep>
  );
}
