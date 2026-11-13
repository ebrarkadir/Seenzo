import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider, useTranslation } from 'react-i18next';

import i18n from '../i18n';
import { colors } from '../theme';
import { TrackingProvider, useTracking } from '../tracking/TrackingContext';

function RootStack() {
  const { t } = useTranslation();
  const { ready, onboardingComplete } = useTracking();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready || onboardingComplete) {
      return;
    }
    if (segments[0] !== 'onboarding') {
      router.replace('/onboarding');
    }
  }, [onboardingComplete, ready, router, segments]);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ headerShown: false }} />
      <Stack.Screen name="upcoming" options={{ title: t('upcoming.title') }} />
      <Stack.Screen name="archive/shows" options={{ title: t('archive.showsTitle') }} />
      <Stack.Screen name="archive/movies" options={{ title: t('archive.moviesTitle') }} />
      <Stack.Screen name="favorites" options={{ title: t('favorites.title') }} />
      <Stack.Screen name="show/[id]" options={{ title: '' }} />
      <Stack.Screen name="movie/[id]" options={{ title: '' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <TrackingProvider>
        <StatusBar style="light" />
        <RootStack />
      </TrackingProvider>
    </I18nextProvider>
  );
}
