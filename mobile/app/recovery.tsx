import { useStore } from '../src/store';
import { FlowShell } from '@atrium/ui-native';
import { RecoveryKeyStep } from '../src/components/RecoveryKeyStep';

/** The screen right after sign-up (and recovery): the recovery key to copy or save, the last step of signing up. */
export default function Recovery() {
  const key = useStore((s) => s.recoveryKey) ?? '';
  const name = useStore((s) => s.data?.me.name ?? '');
  const serverName = useStore((s) => s.data?.serverName ?? 'Atrium');
  return (
    <FlowShell fill={1}>
      <RecoveryKeyStep value={key} nick={name} place={serverName} onNext={() => useStore.setState({ recoveryKey: null })} />
    </FlowShell>
  );
}
