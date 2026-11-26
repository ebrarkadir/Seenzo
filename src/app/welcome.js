import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../auth/AuthContext';
import { resolveSessionDestination } from '../auth/sessionRouting';
import AuthGateway from '../components/auth/AuthGateway';
import { startupLog } from '../diagnostics/startup';
import { colors } from '../theme';
import { useTracking } from '../tracking/TrackingContext';

/**
 * Optional /welcome route (deep links / legacy). Prefer index for signed-out entry
 * so native-stack never keeps a blank Redirect screen above the gateway.
 */
export default function WelcomeGatewayScreen() {
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
      router.replace('/(tabs)');
      return;
    }
    if (destination === 'onboarding') {
      router.replace('/onboarding');
      return;
    }
    // Collapse duplicate gateway onto index to avoid stacked opaque screens.
    router.replace('/');
  }, [authReady, destination, ready]);

  useEffect(() => {
    startupLog('welcome_render', {
      authReady,
      trackingReady: ready,
      signedIn,
      onboardingComplete,
      demoMode,
      destination,
      branch: (!authReady || !ready || destination !== 'gateway') ? 'empty' : 'gateway',
    });
  }, [authReady, destination, demoMode, onboardingComplete, ready, signedIn]);

  if (!authReady || !ready || destination !== 'gateway') {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return <AuthGateway />;
}
