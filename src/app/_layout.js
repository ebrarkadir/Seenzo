import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider, useTranslation } from 'react-i18next';

import i18n from '../i18n';
import { loadMediaLibrary } from '../data/mediaLibrary';
import { colors, spacing, typography } from '../theme';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { TrackingProvider, useTracking } from '../tracking/TrackingContext';
import PrimaryButton from '../components/ui/PrimaryButton';

function RootStack() {
  const { t } = useTranslation();
  const { ready, onboardingComplete, loadError, cacheRestored, syncStatus, retryLoad, retrySync } = useTracking();
  const { signOut } = useAuth();
  const [catalogReady, setCatalogReady] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    loadMediaLibrary().finally(() => setCatalogReady(true));
  }, []);

  useEffect(() => {
    if (!ready || onboardingComplete || (loadError && !cacheRestored)) {
      return;
    }
    const route = segments[0];
    if (route !== 'onboarding' && route !== 'sign-in' && route !== 'sign-up') {
      router.replace('/onboarding');
    }
  }, [cacheRestored, loadError, onboardingComplete, ready, router, segments]);

  if (!ready || !catalogReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (loadError && !cacheRestored) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedTitle}>{t('sync.loadError')}</Text>
        <PrimaryButton label={t('sync.loadRetry')} onPress={retryLoad} />
        <PrimaryButton label={t('profile.logout')} variant="secondary" onPress={() => signOut()} />
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      {syncStatus === 'error' ? (
        <View style={styles.syncError}>
          <Text style={styles.syncText}>{t('sync.error')}</Text>
          <PrimaryButton label={t('sync.retry')} onPress={retrySync} />
        </View>
      ) : null}
      <View style={styles.frame}>
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
      <Stack.Screen name="trakt-test" options={{ title: t('trakt.title') }} />
      <Stack.Screen name="show/[id]" options={{ title: '' }} />
      <Stack.Screen name="movie/[id]" options={{ title: '' }} />
      <Stack.Screen name="sign-in" options={{ title: t('auth.signInTitle') }} />
      <Stack.Screen name="sign-up" options={{ title: t('auth.signUpTitle') }} />
    </Stack>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: colors.background,
  },
  blocked: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  blockedTitle: {
    ...typography.body,
    color: colors.text,
  },
  syncError: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  syncText: {
    ...typography.caption,
    color: colors.status.dropped,
  },
});

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <TrackingProvider>
          <StatusBar style="light" />
          <RootStack />
        </TrackingProvider>
      </AuthProvider>
    </I18nextProvider>
  );
}
