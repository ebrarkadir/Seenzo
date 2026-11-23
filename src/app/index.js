import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../auth/AuthContext';
import AuthGateway from '../components/auth/AuthGateway';
import { startupLog } from '../diagnostics/startup';
import { colors } from '../theme';
import { useTracking } from '../tracking/TrackingContext';

/**
 * Entry route. Always render a real view (empty placeholder or AuthGateway).
 * Do not mount a stack jump cover as the guest/entry screen — on Android
 * native-stack + Fabric that can leave an opaque full-window Surface above
 * the real UI (a11y tree visible, screencap black).
 */
export default function Index() {
  const { ready: authReady, session } = useAuth();
  const { ready, onboardingComplete } = useTracking();
  const signedIn = Boolean(session?.user?.id);

  useEffect(() => {
    if (!authReady || !ready) {
      return;
    }
    if (onboardingComplete) {
      startupLog('index_redirect', { to: 'tabs' });
      router.replace('/(tabs)');
      return;
    }
    if (signedIn) {
      startupLog('index_redirect', { to: 'onboarding' });
      router.replace('/onboarding');
    }
  }, [authReady, onboardingComplete, ready, signedIn]);

  if (!authReady || !ready) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  if (onboardingComplete || signedIn) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  startupLog('index_render', { branch: 'gateway' });
  return <AuthGateway />;
}
