import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../auth/AuthContext';
import { resolveSessionDestination } from '../auth/sessionRouting';
import AuthGateway from '../components/auth/AuthGateway';
import { logoutLog } from '../diagnostics/logout';
import { startupLog } from '../diagnostics/startup';
import { colors } from '../theme';
import { useTracking } from '../tracking/TrackingContext';

/**
 * Entry route. Always render a real view (empty placeholder or AuthGateway).
 * Signed-out users always see AuthGateway unless explicit demoMode is on.
 */
export default function Index() {
  const { ready: authReady, session } = useAuth();
  const { ready, onboardingComplete, demoMode } = useTracking();
  const signedIn = Boolean(session?.user?.id);
  const destination = resolveSessionDestination({
    signedIn,
    onboardingComplete,
    demoMode,
  });

  useEffect(() => {
    if (!authReady || !ready) {
      return;
    }
    if (destination === 'tabs') {
      startupLog('index_redirect', { to: 'tabs', demoMode });
      router.replace('/(tabs)');
      return;
    }
    if (destination === 'onboarding') {
      startupLog('index_redirect', { to: 'onboarding' });
      router.replace('/onboarding');
      return;
    }
    logoutLog('index_gateway', {
      signedIn,
      onboardingComplete,
      demoMode,
    });
  }, [authReady, demoMode, destination, onboardingComplete, ready, signedIn]);

  if (!authReady || !ready) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  if (destination !== 'gateway') {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  startupLog('index_render', { branch: 'gateway' });
  return <AuthGateway />;
}
