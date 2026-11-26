import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../auth/AuthContext';
import FavoritePickerModal from '../../components/profile/FavoritePickerModal';
import FavoriteShelf from '../../components/profile/FavoriteShelf';
import ProfileActivitySection from '../../components/profile/ProfileActivitySection';
import ProfileHeader from '../../components/profile/ProfileHeader';
import FindPeopleRow from '../../components/social/FindPeopleRow';
import FollowCountsRow from '../../components/social/FollowCountsRow';
import ProfileReviewsSection from '../../components/social/ProfileReviewsSection';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { useProfile } from '../../profile/ProfileContext';
import { fetchFollowCounts } from '../../services/supabase/social';
import { emptyFollowCounts } from '../../services/supabase/socialRules';
import { colors, radii, spacing, typography } from '../../theme';
import { countPersonalRatings } from '../../tracking/personalRatings';
import { isMovieWatchlisted } from '../../tracking/watchlist';
import { useTracking } from '../../tracking/TrackingContext';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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
    syncStatus,
  } = useTracking();
  const signedIn = Boolean(userId);
  const [editShows, setEditShows] = useState(false);
  const [editMovies, setEditMovies] = useState(false);
  const [picker, setPicker] = useState(null);
  const [followCounts, setFollowCounts] = useState(emptyFollowCounts());
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutWorking, setLogoutWorking] = useState(false);

  useEffect(() => {
    if (!signedIn || !userId) {
      return undefined;
    }
    let active = true;
    fetchFollowCounts(userId)
      .then((counts) => {
        if (active) setFollowCounts(counts);
      })
      .catch(() => {
        if (active) setFollowCounts(emptyFollowCounts());
      });
    return () => {
      active = false;
    };
  }, [signedIn, userId]);

  const visibleFollowCounts = signedIn ? followCounts : emptyFollowCounts();

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

  const bottomPad = Math.max(insets.bottom, spacing.sm) + 72;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
      >
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

        {signedIn ? (
          <FollowCountsRow
            followers={visibleFollowCounts.followers}
            following={visibleFollowCounts.following}
            onPressFollowers={() => router.push({
              pathname: '/users/connections',
              params: { userId, direction: 'followers' },
            })}
            onPressFollowing={() => router.push({
              pathname: '/users/connections',
              params: { userId, direction: 'following' },
            })}
          />
        ) : null}

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
            onPress={() => router.push({ pathname: '/(tabs)/social', params: { section: 'people' } })}
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

        {signedIn && profile?.username && !demoMode ? (
          <ProfileReviewsSection
            key={`reviews:${userId}:${profile.username}`}
            username={profile.username}
            isOwner
            enabled
          />
        ) : null}

        {setupUnavailable && signedIn ? (
          <Text style={styles.metaPad}>{t('profile.favoritesUnavailableBody')}</Text>
        ) : null}
        {saving ? <Text style={styles.metaPad}>{t('profile.saving')}</Text> : null}

        {signedIn ? (
          <View style={styles.panel}>
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
          </View>
        ) : null}

        <View style={styles.creditsBlock}>
          <Text style={styles.kicker}>{t('profile.creditsKicker')}</Text>
          <Text style={styles.panelBody}>{t('profile.traktAttribution')}</Text>
        </View>

        {signedIn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.logout')}
            onPress={() => {
              if (typeof __DEV__ !== 'undefined' && __DEV__) {
                console.log('[logout] button_pressed', { via: 'open_confirm' });
              }
              setLogoutConfirm(true);
            }}
            style={({ pressed }) => [styles.logoutRow, pressed && styles.logoutPressed]}
          >
            <View style={styles.logoutIconWrap}>
              <Ionicons name="log-out-outline" size={20} color={colors.textSecondary} />
            </View>
            <Text style={styles.logoutLabel}>{t('profile.logout')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal
        visible={logoutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!logoutWorking) {
            setLogoutConfirm(false);
          }
        }}
      >
        <View style={styles.confirmBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            style={styles.confirmDismiss}
            disabled={logoutWorking}
            onPress={() => setLogoutConfirm(false)}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.panelTitle}>{t('profile.logoutTitle')}</Text>
            <Text style={styles.panelBody}>{t('profile.logoutMessage')}</Text>
            <PrimaryButton
              label={logoutWorking ? t('auth.working') : t('common.confirm')}
              disabled={logoutWorking}
              onPress={async () => {
                if (logoutWorking) {
                  return;
                }
                setLogoutWorking(true);
                if (typeof __DEV__ !== 'undefined' && __DEV__) {
                  console.log('[logout] button_pressed', { via: 'in_app_confirm' });
                }
                try {
                  await signOut();
                  router.replace('/');
                } finally {
                  setLogoutWorking(false);
                  setLogoutConfirm(false);
                }
              }}
            />
            <PrimaryButton
              label={t('common.cancel')}
              variant="secondary"
              disabled={logoutWorking}
              onPress={() => setLogoutConfirm(false)}
            />
          </View>
        </View>
      </Modal>

      <FavoritePickerModal
        visible={Boolean(picker)}
        mediaType={picker?.mediaType || 'show'}
        selectedIds={(picker?.mediaType === 'movie' ? favorites.movies : favorites.shows).map((item) => item.mediaId)}
        onClose={() => setPicker(null)}
        onSelect={onSelectFavorite}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing.md,
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
  creditsBlock: {
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
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
  logoutRow: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  logoutPressed: {
    opacity: 0.75,
  },
  logoutIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  logoutLabel: {
    ...typography.body,
    color: colors.textSecondary,
    flex: 1,
  },
  confirmBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(12, 16, 21, 0.72)',
  },
  confirmDismiss: {
    flex: 1,
  },
  confirmCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.xl,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
});
