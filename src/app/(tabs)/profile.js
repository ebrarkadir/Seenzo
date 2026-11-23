import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../auth/AuthContext';
import FavoritePickerModal from '../../components/profile/FavoritePickerModal';
import FavoriteShelf from '../../components/profile/FavoriteShelf';
import ProfileActivitySection from '../../components/profile/ProfileActivitySection';
import ProfileHeader from '../../components/profile/ProfileHeader';
import FindPeopleRow from '../../components/social/FindPeopleRow';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { useProfile } from '../../profile/ProfileContext';
import { colors, radii, spacing, typography } from '../../theme';
import { countPersonalRatings } from '../../tracking/personalRatings';
import { isMovieWatchlisted } from '../../tracking/watchlist';
import { useTracking } from '../../tracking/TrackingContext';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { ready: authReady, email, signOut } = useAuth();
  const {
    userId,
    profile,
    favorites,
    loading,
    saving,
    setupUnavailable,
    setFavoriteAt,
    clearFavoriteAt,
    moveFavorite,
  } = useProfile();
  const {
    shows,
    movies,
    showRatings,
    episodeRatings,
    demoMode,
    loadDemo,
    clearLocalData,
    restartOnboarding,
    syncStatus,
  } = useTracking();
  const signedIn = Boolean(userId);
  const [editShows, setEditShows] = useState(false);
  const [editMovies, setEditMovies] = useState(false);
  const [picker, setPicker] = useState(null);

  const stats = useMemo(() => {
    if (signedIn && demoMode) {
      return {
        moviesWatched: 0,
        episodesWatched: 0,
        ratingsCount: 0,
        showsCount: 0,
        moviesToWatch: 0,
      };
    }
    const moviesWatched = Object.values(movies).filter((entry) => entry.watched).length;
    const moviesToWatch = Object.values(movies).filter((entry) => isMovieWatchlisted(entry)).length;
    const episodesWatched = Object.values(shows).reduce(
      (sum, entry) => sum + (entry.watchedEpisodeIds || []).length,
      0
    );
    return {
      moviesWatched,
      moviesToWatch,
      episodesWatched,
      showsCount: Object.keys(shows).length,
      ratingsCount: countPersonalRatings({ movies, shows, showRatings, episodeRatings }),
    };
  }, [demoMode, episodeRatings, movies, showRatings, shows, signedIn]);

  const confirm = (title, message, onConfirm) => {
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: onConfirm },
    ]);
  };

  const openPicker = (mediaType, position) => {
    if (!signedIn) {
      router.push('/sign-in');
      return;
    }
    if (setupUnavailable) {
      Alert.alert(t('profile.favoritesUnavailableTitle'), t('profile.favoritesUnavailableBody'));
      return;
    }
    setPicker({ mediaType, position });
  };

  const onSelectFavorite = async (media) => {
    if (!picker) {
      return;
    }
    try {
      await setFavoriteAt(picker.mediaType, media.id, picker.position);
      setPicker(null);
    } catch (error) {
      Alert.alert(t('profile.favoritesErrorTitle'), t(`profile.errors.${error.code}`, { defaultValue: t('profile.errors.generic') }));
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ProfileHeader
        guest={!signedIn}
        profile={profile}
        onEdit={() => router.push('/edit-profile')}
        onPressAvatar={() => router.push('/edit-profile')}
        onPressBanner={() => router.push('/edit-profile')}
      />

      {authReady && !signedIn ? (
        <View style={styles.sectionPad}>
          <PrimaryButton label={t('profile.signIn')} onPress={() => router.push('/sign-in')} />
          <PrimaryButton label={t('profile.createAccount')} variant="secondary" onPress={() => router.push('/sign-up')} />
        </View>
      ) : null}

      {loading ? <Text style={styles.metaPad}>{t('profile.loading')}</Text> : null}

      <ProfileActivitySection
        showsCount={stats.showsCount}
        episodesWatched={stats.episodesWatched}
        moviesWatched={stats.moviesWatched}
        moviesToWatch={stats.moviesToWatch}
        ratingsCount={stats.ratingsCount}
        onPressShows={() => router.push('/archive/shows')}
        onPressMovies={() => router.push('/archive/movies')}
        onPressRatings={() => router.push('/personal-ratings')}
        onPressInsights={() => router.push('/insights')}
      />

      {signedIn ? (
        <FindPeopleRow
          onPress={() => router.push('/users/search')}
        />
      ) : null}

      <FavoriteShelf
        title={t('profile.favoriteShows')}
        mediaType="show"
        items={favorites.shows}
        editing={editShows}
        onToggleEdit={() => {
          if (!signedIn) {
            router.push('/sign-in');
            return;
          }
          setEditShows((value) => !value);
        }}
        onPressEmpty={(position) => openPicker('show', position)}
        onPressFilled={(item) => router.push(`/show/${item.mediaId}`)}
        onRemove={(position) => clearFavoriteAt('show', position)}
        onMoveLeft={(position) => moveFavorite('show', position, position - 1)}
        onMoveRight={(position) => moveFavorite('show', position, position + 1)}
      />

      <FavoriteShelf
        title={t('profile.favoriteMovies')}
        mediaType="movie"
        items={favorites.movies}
        editing={editMovies}
        onToggleEdit={() => {
          if (!signedIn) {
            router.push('/sign-in');
            return;
          }
          setEditMovies((value) => !value);
        }}
        onPressEmpty={(position) => openPicker('movie', position)}
        onPressFilled={(item) => router.push(`/movie/${item.mediaId}`)}
        onRemove={(position) => clearFavoriteAt('movie', position)}
        onMoveLeft={(position) => moveFavorite('movie', position, position - 1)}
        onMoveRight={(position) => moveFavorite('movie', position, position + 1)}
      />

      {setupUnavailable && signedIn ? (
        <Text style={styles.metaPad}>{t('profile.favoritesUnavailableBody')}</Text>
      ) : null}
      {saving ? <Text style={styles.metaPad}>{t('profile.saving')}</Text> : null}

      <View style={styles.panel}>
        {signedIn ? (
          <>
            <Text style={styles.kicker}>{t('profile.accountSettings')}</Text>
            <Text style={styles.panelBody}>{email}</Text>
            <Text style={styles.panelBody}>
              {t(syncStatus === 'saving' ? 'profile.syncSaving' : syncStatus === 'error' ? 'sync.error' : 'profile.syncSaved')}
            </Text>
            <PrimaryButton
              label={t('profile.editProfile')}
              variant="secondary"
              onPress={() => router.push('/edit-profile')}
            />
            <PrimaryButton
              label={t('profile.logout')}
              variant="secondary"
              onPress={() => confirm(t('profile.logoutTitle'), t('profile.logoutMessage'), () => {
                signOut();
              })}
            />
          </>
        ) : null}

        <Text style={styles.kicker}>{t('profile.creditsKicker')}</Text>
        <Text style={styles.panelBody}>{t('profile.traktAttribution')}</Text>

        <Text style={styles.kicker}>{t('profile.demoKicker')}</Text>
        <Text style={styles.panelTitle}>{t('profile.demoTitle')}</Text>
        <Text style={styles.panelBody}>{t('profile.demoNote')}</Text>
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
            router.replace('/');
          })}
        />
        <PrimaryButton
          label={t('profile.traktTest')}
          variant="secondary"
          onPress={() => router.push('/trakt-test')}
        />
      </View>

      <FavoritePickerModal
        visible={Boolean(picker)}
        mediaType={picker?.mediaType || 'show'}
        selectedIds={(picker?.mediaType === 'movie' ? favorites.movies : favorites.shows).map((item) => item.mediaId)}
        onClose={() => setPicker(null)}
        onSelect={onSelectFavorite}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  sectionPad: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  metaPad: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
  },
  panel: {
    marginHorizontal: spacing.md,
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
