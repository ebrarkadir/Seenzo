import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ActivityFeedEmptyState from './ActivityFeedEmptyState';
import ActivityFeedHeader from './ActivityFeedHeader';
import ActivityFeedItem from './ActivityFeedItem';
import FollowingAccountsStrip from './FollowingAccountsStrip';
import PrimaryButton from '../ui/PrimaryButton';
import {
  isSocialV3UnavailableError,
  listFollowingActivity,
  SOCIAL_ACTIVITY_PAGE_SIZE,
} from '../../services/supabase/socialActivity';
import { colors, spacing, typography } from '../../theme';

function openProfile(item) {
  const username = item?.username || item?.actor?.username;
  if (username) {
    router.push(`/user/${encodeURIComponent(username)}`);
  }
}

export default function FriendsActivityFeed({
  userId,
  followingItems,
  followingLoading,
  followingError,
  onRetryFollowing,
  onFindPeople,
  onRefreshFollowing,
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef({ createdAt: null, id: null });
  const requestSeq = useRef(0);

  const loadFeed = useCallback(async ({ reset = false, soft = false } = {}) => {
    if (!userId) {
      setItems([]);
      setError(null);
      setUnavailable(false);
      setHasMore(false);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (soft) {
      setRefreshing(true);
    } else if (!reset) {
      setLoadingMore(true);
    }
    try {
      const result = await listFollowingActivity({
        limit: SOCIAL_ACTIVITY_PAGE_SIZE,
        cursorCreatedAt: reset ? null : cursorRef.current.createdAt,
        cursorId: reset ? null : cursorRef.current.id,
      });
      if (requestSeq.current !== seq) return;
      setItems((current) => (reset ? result.items : [...current, ...result.items]));
      cursorRef.current = {
        createdAt: result.cursorCreatedAt,
        id: result.cursorId,
      };
      setHasMore(result.hasMore);
      setError(null);
      setUnavailable(false);
    } catch (requestError) {
      if (requestSeq.current !== seq) return;
      if (isSocialV3UnavailableError(requestError)) {
        setUnavailable(true);
        if (reset) setItems([]);
        setError(null);
      } else {
        setError(requestError);
        if (reset) setItems([]);
      }
      setHasMore(false);
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      cursorRef.current = { createdAt: null, id: null };
      const timer = setTimeout(() => {
        if (!active) {
          return;
        }
        loadFeed({ reset: true });
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [loadFeed])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      onRefreshFollowing?.(),
      (async () => {
        cursorRef.current = { createdAt: null, id: null };
        await loadFeed({ reset: true, soft: true });
      })(),
    ]);
  };

  const followingCount = followingItems?.length || 0;
  const showCircleEmpty = !followingLoading && !followingError && followingCount === 0;
  const showActivityEmpty = !loading && !error && !unavailable && followingCount > 0 && items.length === 0;

  const header = (
    <View>
      {followingLoading && followingCount === 0 ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      {followingError ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>{t('social.followingLoadErrorTitle')}</Text>
          <Text style={styles.errorBody}>{t('social.followingLoadErrorBody')}</Text>
          <PrimaryButton
            label={t('common.retry')}
            onPress={onRetryFollowing}
            style={styles.retryButton}
          />
        </View>
      ) : null}

      {!followingError && followingCount > 0 ? (
        <FollowingAccountsStrip
          items={followingItems}
          onPressAccount={openProfile}
          onSeeAll={() => router.push({
            pathname: '/users/connections',
            params: { userId, direction: 'following' },
          })}
        />
      ) : null}

      <ActivityFeedHeader
        title={t('social.feedHeaderTitle')}
        subtitle={t('social.feedHeaderSubtitle')}
      />

      {showCircleEmpty ? (
        <ActivityFeedEmptyState
          title={t('social.feedEmptyTitle')}
          description={t('social.feedEmptyBody')}
          primaryLabel={t('social.findPeople')}
          onPrimary={onFindPeople}
        />
      ) : null}

      {unavailable && followingCount > 0 ? (
        <ActivityFeedEmptyState
          compact
          title={t('social.activityEmptyTitle')}
          description={t('social.activityUnavailableBody')}
        />
      ) : null}

      {error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>{t('social.activityLoadErrorTitle')}</Text>
          <Text style={styles.errorBody}>{t('social.activityLoadErrorBody')}</Text>
          <PrimaryButton
            label={t('common.retry')}
            onPress={() => {
              cursorRef.current = { createdAt: null, id: null };
              loadFeed({ reset: true });
            }}
            style={styles.retryButton}
          />
        </View>
      ) : null}

      {loading && items.length === 0 && followingCount > 0 && !unavailable ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      {showActivityEmpty ? (
        <ActivityFeedEmptyState
          compact
          title={t('social.activityEmptyTitle')}
          description={t('social.activityEmptyBody')}
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={showCircleEmpty || unavailable ? [] : items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing || Boolean(followingLoading && followingCount > 0)}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      )}
      ListHeaderComponent={header}
      onEndReached={() => {
        if (!hasMore || loadingMore || loading || unavailable || showCircleEmpty) {
          return;
        }
        loadFeed({ reset: false });
      }}
      onEndReachedThreshold={0.4}
      ListFooterComponent={loadingMore ? (
        <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
      ) : null}
      renderItem={({ item }) => <ActivityFeedItem item={item} />}
      ListEmptyComponent={null}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  loadingBlock: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  errorBlock: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    alignItems: 'center',
  },
  errorTitle: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
  },
  errorBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    alignSelf: 'center',
    minWidth: 160,
  },
  footerLoader: {
    marginVertical: spacing.md,
  },
});
