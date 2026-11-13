import { Redirect } from 'expo-router';

import { useTracking } from '../tracking/TrackingContext';

export default function Index() {
  const { ready, onboardingComplete } = useTracking();

  if (!ready) {
    return null;
  }
  if (!onboardingComplete) {
    return <Redirect href="/onboarding" />;
  }
  return <Redirect href="/(tabs)" />;
}
