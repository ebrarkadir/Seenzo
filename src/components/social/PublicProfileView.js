import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import FavoriteShelf from '../profile/FavoriteShelf';
import ProfileHeader from '../profile/ProfileHeader';
import RelationshipButton from './RelationshipButton';
import { RELATIONSHIP } from '../../services/supabase/socialRules';
import { colors, radii, spacing, typography } from '../../theme';

export default function PublicProfileView({
  profile,
  favorites,
  stats,
  followCounts,
  isSelf = false,
  limited = false,
  relationshipAction = RELATIONSHIP.FOLLOW,
  followLoading = false,
  onToggleFollow,
  onPressFollowers,
  onPressFollowing,
  onPressFavorite,
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <ProfileHeader profile={profile} readOnly />

      {limited ? (
        <Text style={styles.limitedNote}>{t('social.limitedProfileNote')}</Text>
      ) : null}

      <View style={styles.actions}>
        {isSelf ? (
          <Text style={styles.selfNote}>{t('social.thisIsYou')}</Text>
        ) : (
          <RelationshipButton
            action={relationshipAction}
            loading={followLoading}
            onPress={onToggleFollow}
          />
        )}
      </View>

      <View style={styles.counts}>
        <CountCard
          label={t('social.followers')}
          value={followCounts?.followers || 0}
          onPress={onPressFollowers}
        />
        <CountCard
          label={t('social.followingCount')}
          value={followCounts?.following || 0}
          onPress={onPressFollowing}
        />
      </View>

      {!limited ? (
        <>
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
        </>
      ) : null}
    </View>
  );
}

function CountCard({ label, value, onPress }) {
  const content = (
    <>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </>
  );
  if (!onPress) {
    return <View style={styles.countCard}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.countCard, pressed && styles.countPressed]}
    >
      {content}
    </Pressable>
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
  limitedNote: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
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
  countPressed: {
    opacity: 0.88,
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
