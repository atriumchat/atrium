import { type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVoice } from '../voice';
import { colors } from '../theme';
import { CallPill } from './CallPill';

/** iOS 26 has the tab bar's accessory for the call; before it the call is a pill inside the tab. */
export const hasAccessory = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26;

/**
 * A tab's page: clear of the status bar at the top; the tab bar at the bottom is the system's, and the scroll views
 * inside clear it on their own (contentInsetAdjustmentBehavior). Before iOS 26 the call sits here, on the bar.
 */
export function TabScreen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const inCall = useVoice((s) => !!s.channelId);
  return (
    <View style={{ flex: 1, backgroundColor: colors.window, paddingTop: insets.top }}>
      {children}
      {!hasAccessory && inCall ? <SafeAreaView edges={['bottom']}><CallPill /></SafeAreaView> : null}
    </View>
  );
}
