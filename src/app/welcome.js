import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../auth/AuthContext';
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
  const { ready, onboardingComplete } = useTracking();
  const signedIn = Boolean(session?.user?.id);

  useEffect(() => {
    if (!authReady || !ready) {
      return;
    }
    if (onboardingComplete) {
      router.replace('/(tabs)');
      return;
    }
    if (signedIn) {
      router.replace('/onboarding');
      return;
    }
    // Collapse duplicate gateway onto index to avoid stacked opaque screens.
    router.replace('/');
  }, [authReady, onboardingComplete, ready, signedIn]);

  useEffect(() => {
    startupLog('welcome_render', {
      authReady,
      trackingReady: ready,
      signedIn,
      onboardingComplete,
      branch: (!authReady || !ready || signedIn || onboardingComplete) ? 'empty' : 'gateway',
    });
  }, [authReady, onboardingComplete, ready, signedIn]);

  if (!authReady || !ready || signedIn || onboardingComplete) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return <AuthGateway />;
}
