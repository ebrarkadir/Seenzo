import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ProfileReviewCard from './ProfileReviewCard';
import PrimaryButton from '../ui/PrimaryButton';
import {
  isSocialV5UnavailableError,
  listProfileReviews,
  PROFILE_REVIEW_FILTERS,
  PROFILE_REVIEWS_PAGE_SIZE,
} from '../../services/supabase/socialV5';
import { colors, radii, spacing, typography } from '../../theme';

function FilterChip({ label, active, onPress, disabled }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive, disabled && styles.disabled]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Profile Reviews section — Find People-style accordion.
 * Nested-scroll safe: uses Load more instead of an inner FlatList.
 * Cards stay hidden until the user expands the row.
 */
export default function ProfileReviewsSection({
  username,
  isOwner = false,
  enabled = true,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const cursorRef = useRef({ updatedAt: null, id: null });
  const requestSeq = useRef(0);
  const sectionKey = `${username || ''}:${isOwner ? 'owner' : 'other'}`;
  const [expandedKey, setExpandedKey] = useState(sectionKey);

  if (sectionKey !== expandedKey) {
    setExpandedKey(sectionKey);
    setExpanded(false);
  }

  const load = useCallback(async ({ reset = false } = {}) => {
    if (!enabled || !username) {
      setItems([]);
      setUnavailable(false);
      setError(null);
      setHasMore(false);
      setLoading(false);
      return;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const result = await listProfileReviews({
        username,
        mediaFilter: filter,
        limit: PROFILE_REVIEWS_PAGE_SIZE,
        cursorUpdatedAt: reset ? null : cursorRef.current.updatedAt,
        cursorId: reset ? null : cursorRef.current.id,
      });
      if (requestSeq.current !== seq) return;
      setItems((current) => (reset ? result.items : [...current, ...result.items]));
      cursorRef.current = {
        updatedAt: result.cursorUpdatedAt,
        id: result.cursorId,
      };
      setHasMore(result.hasMore);
      setError(null);
      setUnavailable(false);
    } catch (requestError) {
      if (requestSeq.current !== seq) return;
      if (isSocialV5UnavailableError(requestError)) {
        setUnavailable(true);
        if (reset) setItems([]);
        setError(null);
      } else {
        if (reset) setItems([]);
        setError(requestError);
      }
      setHasMore(false);
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [enabled, filter, username]);

  useEffect(() => {
    let cancelled = false;
    cursorRef.current = { updatedAt: null, id: null };
    (async () => {
      if (!enabled || !username) {
        if (!cancelled) {
          setItems([]);
          setUnavailable(false);
          setError(null);
          setHasMore(false);
          setLoading(false);
        }
        return;
      }
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      setLoading(true);
      try {
        const result = await listProfileReviews({
          username,
          mediaFilter: filter,
          limit: PROFILE_REVIEWS_PAGE_SIZE,
        });
        if (cancelled || requestSeq.current !== seq) return;
        setItems(result.items);
        cursorRef.current = {
          updatedAt: result.cursorUpdatedAt,
          id: result.cursorId,
        };
        setHasMore(result.hasMore);
        setError(null);
        setUnavailable(false);
      } catch (requestError) {
        if (cancelled || requestSeq.current !== seq) return;
        if (isSocialV5UnavailableError(requestError)) {
          setUnavailable(true);
          setItems([]);
          setError(null);
        } else {
          setItems([]);
          setError(requestError);
        }
        setHasMore(false);
      } finally {
        if (!cancelled && requestSeq.current === seq) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, filter, username]);

  if (!enabled || !username) {
    return null;
  }

  const openMedia = (item) => {
    if (!item?.mediaId) return;
    if (item.mediaType === 'movie') {
      router.push(`/movie/${encodeURIComponent(item.mediaId)}`);
      return;
    }
    const showId = item.mediaType === 'show' ? item.mediaId : item.showMediaId;
    if (showId) {
      router.push(`/show/${encodeURIComponent(showId)}`);
    }
  };

  const reviewCount = !loading && !error && !unavailable && !hasMore && items.length > 0
    ? items.length
    : null;
  const title = reviewCount != null
    ? t('social.profileReviews.titleWithCount', { count: reviewCount })
    : t('social.profileReviews.title');
  const subtitle = isOwner
    ? t('social.profileReviews.subtitleOwner')
    : t('social.profileReviews.subtitleOther');

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded
            ? t('social.profileReviews.collapseA11y')
            : t('social.profileReviews.expandA11y')
        }
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
      >
        <View style={styles.iconBadge}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.toggleTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.toggleSubtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        {loading && !expanded ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        )}
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <View style={styles.filters}>
            {PROFILE_REVIEW_FILTERS.map((key) => (
              <FilterChip
                key={key}
                label={t(`social.profileReviews.filters.${key}`)}
                active={filter === key}
                disabled={loading}
                onPress={() => {
                  if (filter === key) return;
                  setFilter(key);
                }}
              />
            ))}
          </View>

          {unavailable ? (
            <Text style={styles.emptyBody}>{t('social.profileReviews.unavailableBody')}</Text>
          ) : null}

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}

          {error && !loading ? (
            <View style={styles.centered}>
              <Text style={styles.emptyBody}>
                {t(`social.errors.${error?.code}`, { defaultValue: t('social.errors.generic') })}
              </Text>
              <PrimaryButton
                label={t('common.retry')}
                onPress={() => {
                  cursorRef.current = { updatedAt: null, id: null };
                  load({ reset: true });
                }}
                style={styles.retry}
              />
            </View>
          ) : null}

          {!loading && !error && !unavailable && items.length === 0 ? (
            <Text style={styles.emptyBody}>
              {isOwner
                ? t('social.profileReviews.emptyOwner')
                : t('social.profileReviews.emptyOther')}
            </Text>
          ) : null}

          {items.map((item) => (
            <ProfileReviewCard
              key={item.id}
              item={item}
              showPrivacyBadge={isOwner}
              onPressMedia={() => openMedia(item)}
              onPressDiscussion={() => {
                if (item.activityId) {
                  router.push(`/social/discussion?activityId=${encodeURIComponent(item.activityId)}`);
                }
              }}
            />
          ))}

          {hasMore && !loading && !unavailable ? (
            <PrimaryButton
              label={loadingMore ? t('common.loading') : t('common.loadMore')}
              variant="secondary"
              disabled={loadingMore}
              onPress={() => load({ reset: false })}
              style={styles.loadMore}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  toggleRow: {
    marginHorizontal: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.88,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  toggleTitle: {
    ...typography.label,
    color: colors.text,
    fontWeight: '700',
  },
  toggleSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  body: {
    gap: spacing.sm,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: 'rgba(121, 196, 255, 0.55)',
    backgroundColor: 'rgba(121, 196, 255, 0.14)',
  },
  chipText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.primary,
  },
  disabled: {
    opacity: 0.55,
  },
  centered: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  retry: {
    alignSelf: 'center',
  },
  loadMore: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
