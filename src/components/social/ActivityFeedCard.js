import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Artwork from '../../services/artwork/Artwork';
import { colors, radii, spacing, typography } from '../../theme';
import SpoilerReviewBlock from './SpoilerReviewBlock';

const POSTER_WIDTH = 56;
const POSTER_HEIGHT = 84;

/**
 * Presentational card for friends-activity items.
 * Render only real API payloads — never fabricate activity.
 *
 * Supported activityType values (Social V3):
 * movie_watched | episode_watched | movie_rated | show_rated | episode_rated
 */
export default function ActivityFeedCard({
  id,
  avatarUrl,
  username,
  displayName,
  actionLabel,
  relativeTime,
  posterUrl,
  posterPath,
  mediaTitle,
  mediaMeta,
  ratingLabel,
  rating,
  reviewText = null,
  reviewContainsSpoilers = false,
  onPressUser,
  onPressMedia,
}) {
  const name = displayName || username || '';
  const handle = username ? `@${username}` : '';
  const score = ratingLabel || (rating != null ? `${rating}/10` : null);
  const hasArtwork = Boolean(posterPath || posterUrl);

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        onPress={onPressUser}
        style={styles.userRow}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={18} color={colors.primary} />
          </View>
        )}
        <View style={styles.userCopy}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.action} numberOfLines={2}>
            {actionLabel}
            {relativeTime ? <Text style={styles.time}>{` · ${relativeTime}`}</Text> : null}
          </Text>
          {handle ? <Text style={styles.handle} numberOfLines={1}>{handle}</Text> : null}
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={mediaTitle}
        onPress={onPressMedia}
        style={styles.mediaRow}
      >
        {hasArtwork ? (
          <Artwork
            uri={posterUrl}
            posterPath={posterPath}
            width={POSTER_WIDTH}
            height={POSTER_HEIGHT}
            radius={radii.sm}
          />
        ) : (
          <View style={[styles.poster, styles.posterFallback]}>
            <Ionicons name="film-outline" size={22} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.mediaCopy}>
          <Text style={styles.mediaTitle} numberOfLines={2}>{mediaTitle}</Text>
          {mediaMeta ? (
            <Text style={styles.mediaMeta} numberOfLines={2}>{mediaMeta}</Text>
          ) : null}
          {score ? (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color={colors.primary} />
              <Text style={styles.rating}>{score}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {reviewText ? (
        <SpoilerReviewBlock
          resetKey={id}
          reviewText={reviewText}
          containsSpoilers={Boolean(reviewContainsSpoilers)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceElevated,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  action: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  time: {
    color: colors.textMuted,
  },
  handle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  mediaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  poster: {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  mediaCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 4,
  },
  mediaTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  mediaMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  rating: {
    ...typography.label,
    color: colors.primary,
  },
});
