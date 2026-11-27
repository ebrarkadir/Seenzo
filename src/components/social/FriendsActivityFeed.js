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
import ActivityFeedFilterRow from './ActivityFeedFilterRow';
import ActivityFeedHeader from './ActivityFeedHeader';
import ActivityFeedItem from './ActivityFeedItem';
import FollowingAccountsStrip from './FollowingAccountsStrip';
import PrimaryButton from '../ui/PrimaryButton';
import {
  isSocialV3UnavailableError,
  isSocialV5FeedUnavailableError,
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
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [filterUnavailable, setFilterUnavailable] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef({ createdAt: null, id: null });
  const filterRef = useRef(filter);
  const requestSeq = useRef(0);

  const loadFeed = useCallback(async ({
    reset = false,
    soft = false,
    nextFilter = filterRef.current,
  } = {}) => {
    if (!userId) {
      setItems([]);
      setError(null);
      setUnavailable(false);
      setFilterUnavailable(false);
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
    } else if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const result = await listFollowingActivity({
        limit: SOCIAL_ACTIVITY_PAGE_SIZE,
        cursorCreatedAt: reset ? null : cursorRef.current.createdAt,
        cursorId: reset ? null : cursorRef.current.id,
        filter: nextFilter,
      });
      if (requestSeq.current !== seq) return;
      setItems((current) => {
        if (reset) {
          return result.items;
        }
        const seen = new Set(current.map((row) => row.id));
        return [
          ...current,
          ...result.items.filter((row) => row?.id && !seen.has(row.id)),
        ];
      });
      cursorRef.current = {
        createdAt: result.cursorCreatedAt,
        id: result.cursorId,
      };
      setHasMore(result.hasMore);
      setError(null);
      setUnavailable(false);
      setFilterUnavailable(false);
    } catch (requestError) {
      if (requestSeq.current !== seq) return;
      if (isSocialV5FeedUnavailableError(requestError) && nextFilter !== 'all') {
        setFilterUnavailable(true);
        setItems([]);
        setError(null);
        setUnavailable(false);
        setHasMore(false);
      } else if (isSocialV3UnavailableError(requestError)) {
        setUnavailable(true);
        if (reset) setItems([]);
        setError(null);
        setFilterUnavailable(false);
        setHasMore(false);
      } else {
        setError(requestError);
        if (reset) setItems([]);
        setHasMore(false);
      }
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
        loadFeed({ reset: true, nextFilter: filterRef.current });
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
        await loadFeed({ reset: true, soft: true, nextFilter: filterRef.current });
      })(),
    ]);
  };

  const onChangeFilter = (next) => {
    filterRef.current = next;
    setFilter(next);
    cursorRef.current = { createdAt: null, id: null };
    setItems([]);
    loadFeed({ reset: true, nextFilter: next });
  };

  const followingCount = followingItems?.length || 0;
  const showCircleEmpty = !followingLoading && !followingError && followingCount === 0;
  const showActivityEmpty = !loading && !error && !unavailable && !filterUnavailable
    && followingCount > 0 && items.length === 0;

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

      {followingCount > 0 && !unavailable ? (
        <ActivityFeedFilterRow
          value={filter}
          disabled={loading && items.length === 0}
          onChange={onChangeFilter}
        />
      ) : null}

      {filterUnavailable ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorBody}>{t('social.feedFilterUnavailableBody')}</Text>
          <PrimaryButton
            label={t('social.feedFilters.all')}
            onPress={() => onChangeFilter('all')}
            style={styles.retryButton}
          />
        </View>
      ) : null}

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
              loadFeed({ reset: true, nextFilter: filterRef.current });
            }}
            style={styles.retryButton}
          />
        </View>
      ) : null}

      {loading && items.length === 0 && followingCount > 0 && !unavailable && !filterUnavailable ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      {showActivityEmpty ? (
        <ActivityFeedEmptyState
          compact
          title={t('social.activityEmptyTitle')}
          description={
            filter === 'all'
              ? t('social.activityEmptyBody')
              : t('social.feedFilterEmptyBody')
          }
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={showCircleEmpty || unavailable || filterUnavailable ? [] : items}
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
        if (!hasMore || loadingMore || loading || unavailable || filterUnavailable || showCircleEmpty) {
          return;
        }
        loadFeed({ reset: false, nextFilter: filterRef.current });
      }}
      onEndReachedThreshold={0.4}
      ListFooterComponent={loadingMore ? (
        <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
      ) : null}
      renderItem={({ item }) => (
        <ActivityFeedItem
          item={item}
          onInteractionChange={(activityId, next) => {
            setItems((current) => current.map((row) => {
              if (row.id !== activityId) return row;
              if (next?.unavailable) {
                return { ...row, interactionsEnabled: false };
              }
              return {
                ...row,
                likedByViewer: Boolean(next?.liked),
                likeCount: Math.max(0, Number(next?.likeCount) || 0),
              };
            }));
          }}
        />
      )}
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
    marginBottom: spacing.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  errorBody: {
    ...typography.body,
    color: colors.textSecondary,
  },
  retryButton: {
    alignSelf: 'flex-start',
  },
  footerLoader: {
    marginVertical: spacing.md,
  },
});
