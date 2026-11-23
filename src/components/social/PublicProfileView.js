import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import FavoriteShelf from '../profile/FavoriteShelf';
import ProfileHeader from '../profile/ProfileHeader';
import { colors, radii, spacing, typography } from '../../theme';
import FollowButton from './FollowButton';

export default function PublicProfileView({
  profile,
  favorites,
  stats,
  followCounts,
  isSelf = false,
  isFollowing = false,
  followLoading = false,
  onToggleFollow,
  onPressFavorite,
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <ProfileHeader profile={profile} readOnly />

      <View style={styles.actions}>
        {isSelf ? (
          <Text style={styles.selfNote}>{t('social.thisIsYou')}</Text>
        ) : (
          <FollowButton
            isFollowing={isFollowing}
            loading={followLoading}
            onPress={onToggleFollow}
          />
        )}
      </View>

      <View style={styles.counts}>
        <CountCard label={t('social.followers')} value={followCounts?.followers || 0} />
        <CountCard label={t('social.followingCount')} value={followCounts?.following || 0} />
      </View>

      <View style={styles.stats}>
        <CountCard label={t('social.statMovies')} value={stats?.moviesWatched || 0} />
        <CountCard label={t('social.statEpisodes')} value={stats?.episodesWatched || 0} />
        <CountCard label={t('social.statShows')} value={stats?.showsTracked || 0} />
      </View>

      <FavoriteShelf
        title={t('profile.favoriteShows')}
        mediaType="show"
        items={favorites?.shows || []}
        readOnly
        onPressFilled={(item) => onPressFavorite?.(item)}
      />
      <FavoriteShelf
        title={t('profile.favoriteMovies')}
        mediaType="movie"
        items={favorites?.movies || []}
        readOnly
        onPressFilled={(item) => onPressFavorite?.(item)}
      />
    </View>
  );
}

function CountCard({ label, value }) {
  return (
    <View style={styles.countCard}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  actions: {
    paddingHorizontal: spacing.md,
  },
  selfNote: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  counts: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  countCard: {
    flex: 1,
    gap: 2,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countValue: {
    ...typography.subtitle,
    color: colors.text,
  },
  countLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
