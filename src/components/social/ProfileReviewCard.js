import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import SpoilerReviewBlock from './SpoilerReviewBlock';
import PosterThumb from '../ui/PosterThumb';
import {
  hydrateActivityMedia,
  resolveActivityMediaSync,
} from '../../services/supabase/activityFeedMedia';
import { formatActivityRating } from '../../services/supabase/activityFeedPresentation';
import { colors, radii, spacing, typography } from '../../theme';

function toActivityShape(item) {
  return {
    activityType: item.mediaType === 'movie'
      ? 'movie_rated'
      : item.mediaType === 'show'
        ? 'show_rated'
        : 'episode_rated',
    mediaType: item.mediaType,
    mediaId: item.mediaId,
    showMediaId: item.showMediaId,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
  };
}

/**
 * Compact poster-led review row for profile Reviews sections.
 */
export default function ProfileReviewCard({
  item,
  showPrivacyBadge = false,
  onPressMedia,
  onPressDiscussion,
}) {
  const { t } = useTranslation();
  const activity = toActivityShape(item);
  const local = resolveActivityMediaSync(activity);
  const hydrateKey = local.hydrateTarget
    ? `${local.hydrateTarget.kind}:${local.hydrateTarget.traktId}`
    : null;
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    if (!local.hydrateTarget || !hydrateKey) return undefined;
    let active = true;
    hydrateActivityMedia(local.hydrateTarget).then((next) => {
      if (active && next) setRemote(next);
    });
    return () => {
      active = false;
    };
  }, [hydrateKey, local.hydrateTarget]);

  const title = (!local.title || local.title === item.mediaId)
    ? (remote?.title || local.title)
    : local.title;
  const meta = local.meta || remote?.meta || null;
  const posterPath = local.posterPath || remote?.posterPath || null;
  const posterUri = local.posterUri || remote?.posterUri || null;
  const score = formatActivityRating(item.rating);
  const excerpt = item.reviewText?.length > 160
    ? `${item.reviewText.slice(0, 157).trim()}…`
    : item.reviewText;
  const canOpenDiscussion = Boolean(item.activityId && item.isPublished);

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPressMedia}
        style={styles.mediaRow}
      >
        <PosterThumb
          uri={posterUri}
          posterPath={posterPath}
          width={52}
          height={78}
        />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
          <View style={styles.metaRow}>
            {score ? (
              <Text style={styles.rating}>★ {score}</Text>
            ) : null}
            {item.relativeTime ? (
              <Text style={styles.time}>{item.relativeTime}</Text>
            ) : null}
          </View>
          {showPrivacyBadge ? (
            <Text style={[styles.badge, item.isPublished ? styles.badgePublic : styles.badgePrivate]}>
              {item.isPublished
                ? t('social.profileReviews.published')
                : t('social.profileReviews.private')}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <SpoilerReviewBlock
        resetKey={item.id}
        reviewText={excerpt}
        containsSpoilers={Boolean(item.containsSpoilers)}
      />

      <View style={styles.footer}>
        {item.interactionsEnabled ? (
          <View style={styles.counts}>
            <View style={styles.countItem}>
              <Ionicons name="heart-outline" size={14} color={colors.textMuted} />
              <Text style={styles.countText}>{item.likeCount || 0}</Text>
            </View>
            <View style={styles.countItem}>
              <Ionicons name="chatbubble-outline" size={14} color={colors.textMuted} />
              <Text style={styles.countText}>{item.commentCount || 0}</Text>
            </View>
          </View>
        ) : <View />}
        {canOpenDiscussion ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.profileReviews.openDiscussionA11y')}
            onPress={onPressDiscussion}
            hitSlop={8}
          >
            <Text style={styles.discussion}>{t('social.profileReviews.openDiscussion')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  mediaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    justifyContent: 'center',
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  rating: {
    ...typography.label,
    color: colors.primary,
  },
  time: {
    ...typography.label,
    color: colors.textMuted,
  },
  badge: {
    ...typography.label,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  badgePublic: {
    color: colors.primary,
  },
  badgePrivate: {
    color: colors.textMuted,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  counts: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  countItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  countText: {
    ...typography.label,
    color: colors.textMuted,
  },
  discussion: {
    ...typography.label,
    color: colors.primary,
  },
});
