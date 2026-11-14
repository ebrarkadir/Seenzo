import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../auth/AuthContext';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { ready: authReady, email, signOut } = useAuth();
  const { shows, movies, demoMode, loadDemo, clearLocalData, restartOnboarding, syncStatus } = useTracking();
  const signedIn = Boolean(email);

  const stats = useMemo(() => {
    const showCount = Object.keys(shows).length;
    const movieCount = Object.values(movies).filter((entry) => entry.watched).length;
    const episodeCount = Object.values(shows).reduce(
      (sum, entry) => sum + (entry.watchedEpisodeIds || []).length,
      0
    );
    return { showCount, movieCount, episodeCount };
  }, [movies, shows]);

  const confirm = (title, message, onConfirm) => {
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: onConfirm },
    ]);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={28} color={colors.primary} />
        </View>
        <View style={styles.identityCopy}>
          <Text style={styles.name}>{signedIn ? email : t('profile.guestTitle')}</Text>
          <Text style={styles.note}>{signedIn ? t('profile.localNote') : t('profile.guestBody')}</Text>
        </View>
      </View>
      {authReady && !signedIn ? (
        <View style={styles.actions}>
          <PrimaryButton label={t('profile.signIn')} onPress={() => router.push('/sign-in')} />
          <PrimaryButton label={t('profile.createAccount')} variant="secondary" onPress={() => router.push('/sign-up')} />
        </View>
      ) : null}
      {signedIn ? (
        <View style={styles.panel}>
          <Text style={styles.kicker}>{t('profile.account')}</Text>
          <Text style={styles.panelBody}>{email}</Text>
          <Text style={styles.panelBody}>
            {t(syncStatus === 'saving' ? 'profile.syncSaving' : syncStatus === 'error' ? 'sync.error' : 'profile.syncSaved')}
          </Text>
          <PrimaryButton
            label={t('profile.logout')}
            variant="secondary"
            onPress={() => confirm(t('profile.logoutTitle'), t('profile.logoutMessage'), () => {
              signOut();
            })}
          />
        </View>
      ) : null}
      <View style={styles.stats}>
        <Stat value={stats.showCount} label={t('profile.statShows')} />
        <Stat value={stats.movieCount} label={t('profile.statMovies')} />
        <Stat value={stats.episodeCount} label={t('profile.statEpisodes')} />
      </View>
      <Pressable accessibilityRole="button" style={styles.link} onPress={() => router.push('/archive/shows')}>
        <Text style={styles.linkTitle}>{t('profile.myShows')}</Text>
        <Text style={styles.linkMeta}>{t('profile.myShowsMeta', { count: Object.keys(shows).length })}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.link} onPress={() => router.push('/archive/movies')}>
        <Text style={styles.linkTitle}>{t('profile.watchedMovies')}</Text>
        <Text style={styles.linkMeta}>{t('profile.watchedMoviesMeta', { count: stats.movieCount })}</Text>
      </Pressable>
      <View style={styles.panel}>
        <Text style={styles.kicker}>{t('profile.demoKicker')}</Text>
        <Text style={styles.panelTitle}>{t('profile.demoTitle')}</Text>
        <Text style={styles.panelBody}>{t('profile.demoNote')}</Text>
        <Text style={styles.panelBody}>{t('profile.traktAttribution')}</Text>
        <Text style={styles.mode}>{demoMode ? t('profile.demoOn') : t('profile.demoOff')}</Text>
        <PrimaryButton
          label={t('profile.loadDemo')}
          onPress={() => confirm(t('profile.loadDemoTitle'), t('profile.loadDemoMessage'), () => {
            loadDemo();
            router.replace('/(tabs)');
          })}
        />
        <PrimaryButton
          label={t('profile.clearData')}
          variant="secondary"
          onPress={() => confirm(t('profile.clearTitle'), t(signedIn ? 'profile.clearAccountMessage' : 'profile.clearMessage'), clearLocalData)}
        />
        <PrimaryButton
          label={t('profile.restartOnboarding')}
          variant="secondary"
          onPress={() => confirm(t('profile.restartTitle'), t('profile.restartMessage'), () => {
            restartOnboarding();
            router.replace('/onboarding');
          })}
        />
        <PrimaryButton
          label={t('profile.traktTest')}
          variant="secondary"
          onPress={() => router.push('/trakt-test')}
        />
      </View>
    </ScrollView>
  );
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  identityCopy: {
    flex: 1,
    gap: 4,
  },
  actions: {
    gap: spacing.sm,
  },
  name: {
    ...typography.title,
    color: colors.text,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stat: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  statValue: {
    ...typography.subtitle,
    color: colors.text,
  },
  statLabel: {
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  link: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  linkTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  linkMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  panel: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  kicker: {
    ...typography.label,
    color: colors.primary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  panelTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  panelBody: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  mode: {
    ...typography.label,
    color: colors.text,
  },
});
