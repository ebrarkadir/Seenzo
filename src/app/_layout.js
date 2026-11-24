import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider, useTranslation } from 'react-i18next';

import i18n from '../i18n';
import { loadMediaLibrary } from '../data/mediaLibrary';
import { startupLog } from '../diagnostics/startup';
import { colors, spacing, typography } from '../theme';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { resolveRootRedirect } from '../auth/sessionRouting';
import { logoutLog } from '../diagnostics/logout';
import { ProfileProvider } from '../profile/ProfileContext';
import { ReviewsProvider } from '../reviews/ReviewsContext';
import { TrackingProvider, useTracking } from '../tracking/TrackingContext';
import PrimaryButton from '../components/ui/PrimaryButton';

function RootStack() {
  const { t } = useTranslation();
  const {
    ready,
    onboardingComplete,
    demoMode,
    loadError,
    cacheRestored,
    syncStatus,
    retryLoad,
    retrySync,
  } = useTracking();
  const { ready: authReady, session, signOut } = useAuth();
  const signedIn = Boolean(session?.user?.id);
  const [catalogReady, setCatalogReady] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    startupLog('root_layout_mounted');
    loadMediaLibrary().finally(() => {
      setCatalogReady(true);
      startupLog('catalog_ready');
    });
  }, []);

  useEffect(() => {
    // Bridgeless Fabric does not emit ReactRootView CONTENT_APPEARED, so Expo's
    // auto-hide path is unreliable — release the native splash once gates open.
    if (!authReady || !ready || !catalogReady) {
      return;
    }
    startupLog('splash_hide');
    SplashScreen.hide();
  }, [authReady, catalogReady, ready]);

  useEffect(() => {
    startupLog('root_gate', {
      authReady,
      trackingReady: ready,
      catalogReady,
      signedIn,
      onboardingComplete,
      demoMode,
      route: segments[0] || 'none',
      loadError,
      cacheRestored,
    });
  }, [
    authReady,
    cacheRestored,
    catalogReady,
    demoMode,
    loadError,
    onboardingComplete,
    ready,
    segments,
    signedIn,
  ]);

  useEffect(() => {
    if (!authReady || !ready || (loadError && !cacheRestored)) {
      return;
    }
    const route = segments[0] || null;
    const decision = resolveRootRedirect({
      signedIn,
      onboardingComplete,
      demoMode,
      route,
    });
    logoutLog('root_redirect_decision', {
      signedIn,
      onboardingComplete,
      demoMode,
      route: route || 'none',
      action: decision.action,
      to: decision.to || 'none',
      reason: decision.reason,
    });
    if (decision.action === 'replace' && decision.to) {
      startupLog('redirect', { to: decision.to, reason: decision.reason });
      router.replace(decision.to);
    }
  }, [
    authReady,
    cacheRestored,
    demoMode,
    loadError,
    onboardingComplete,
    ready,
    router,
    segments,
    signedIn,
  ]);

  if (!authReady || !ready || !catalogReady) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.bootText}>{t('sync.loading')}</Text>
      </View>
    );
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
        // Fade leaves a full-window overlay View on Android Fabric that
        // intercepts touches while the gateway remains visible underneath.
        animation: 'none',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false, animation: 'none' }} />
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
      <Stack.Screen name="auth/callback" options={{ title: t('auth.callbackTitle'), headerBackVisible: false }} />
      <Stack.Screen name="edit-profile" options={{ title: t('profile.editProfile') }} />
      <Stack.Screen name="users/search" options={{ title: t('social.searchTitle') }} />
      <Stack.Screen name="users/connections" options={{ title: t('social.connectionsTitle') }} />
      <Stack.Screen name="social/notifications" options={{ title: t('social.notificationsTitle') }} />
      <Stack.Screen name="user/[username]" options={{ title: t('social.profileTitle') }} />
      <Stack.Screen name="personal-ratings" options={{ title: t('personalRatings.title') }} />
      <Stack.Screen name="insights" options={{ title: t('insights.title') }} />
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
  boot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  bootText: {
    ...typography.body,
    color: colors.textSecondary,
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
          <ProfileProvider>
            <ReviewsProvider>
              <StatusBar style="light" />
              <RootStack />
            </ReviewsProvider>
          </ProfileProvider>
        </TrackingProvider>
      </AuthProvider>
    </I18nextProvider>
  );
}
