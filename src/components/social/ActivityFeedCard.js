import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Artwork from '../../services/artwork/Artwork';
import { colors, radii, spacing, typography } from '../../theme';
import ReviewInteractionBar from './ReviewInteractionBar';
import SpoilerReviewBlock from './SpoilerReviewBlock';

const POSTER_WIDTH = 44;
const POSTER_HEIGHT = 66;
const AVATAR = 28;

/**
 * Presentational card for friends-activity items.
 * Dense layout: smaller chrome, full review text (spoiler-gated), actions preserved.
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
  interactionsEnabled = false,
  likedByViewer = false,
  likeCount = 0,
  commentCount = 0,
  demoMode = false,
  canReport = false,
  onReport,
  onPressUser,
  onPressMedia,
  onOpenDiscussion,
  onInteractionChange,
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
            <Ionicons name="person" size={14} color={colors.primary} />
          </View>
        )}
        <View style={styles.userCopy}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            {relativeTime ? (
              <Text style={styles.time} numberOfLines={1}>{relativeTime}</Text>
            ) : null}
          </View>
          <Text style={styles.action} numberOfLines={1}>
            {actionLabel}
            {handle ? <Text style={styles.handle}>{` · ${handle}`}</Text> : null}
          </Text>
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
            <Ionicons name="film-outline" size={18} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.mediaCopy}>
          <Text style={styles.mediaTitle} numberOfLines={2}>{mediaTitle}</Text>
          {mediaMeta ? (
            <Text style={styles.mediaMeta} numberOfLines={1}>{mediaMeta}</Text>
          ) : null}
          {score ? (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={12} color={colors.primary} />
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
          compact
        />
      ) : null}

      {interactionsEnabled ? (
        <ReviewInteractionBar
          activityId={id}
          likedByViewer={likedByViewer}
          likeCount={likeCount}
          commentCount={commentCount}
          demoMode={demoMode}
          canReport={canReport}
          onReport={onReport}
          onOpenDiscussion={onOpenDiscussion}
          onInteractionChange={onInteractionChange}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: AVATAR,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceElevated,
  },
  avatarFallback: {
    width: AVATAR,
    height: AVATAR,
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
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  action: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  time: {
    ...typography.label,
    color: colors.textMuted,
    marginLeft: 'auto',
  },
  handle: {
    color: colors.textMuted,
  },
  mediaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
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
    gap: 2,
  },
  mediaTitle: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 18,
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
    gap: 3,
  },
  rating: {
    ...typography.label,
    color: colors.primary,
  },
});
