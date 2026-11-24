import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ConnectionListItem from '../../components/social/ConnectionListItem';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { useAuth } from '../../auth/AuthContext';
import { useTracking } from '../../tracking/TrackingContext';
import {
  cancelFollowRequest,
  listFollowConnections,
} from '../../services/supabase/socialGraph';
import { followUser, unfollowUser } from '../../services/supabase/social';
import { RELATIONSHIP, resolveRelationshipAction } from '../../services/supabase/socialRules';
import { colors, spacing, typography } from '../../theme';

function normalizeDirection(value) {
  return value === 'following' ? 'following' : 'followers';
}

export default function ConnectionsScreen() {
  const { session } = useAuth();
  const params = useLocalSearchParams();
  const userId = String(params.userId || session?.user?.id || '');
  const direction = normalizeDirection(
    Array.isArray(params.direction) ? params.direction[0] : params.direction
  );

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace('/sign-in');
    }
  }, [session?.user?.id]);

  if (!session?.user?.id || !userId) {
    return null;
  }

  return (
    <ConnectionsBody
      key={`${session.user.id}:${userId}:${direction}`}
      userId={userId}
      direction={direction}
    />
  );
}

function ConnectionsBody({ userId, direction }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { demoMode } = useTracking();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const [actionId, setActionId] = useState(null);
  const requestSeq = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: direction === 'following' ? t('social.followingCount') : t('social.followers'),
    });
  }, [direction, navigation, t]);

  const load = useCallback(async ({ reset = false, soft = false } = {}) => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (reset && !soft) setLoading(true);
    if (soft) setRefreshing(true);
    const nextOffset = reset ? 0 : offsetRef.current;
    try {
      const result = await listFollowConnections({
        userId,
        direction,
        offset: nextOffset,
      });
      if (requestSeq.current !== seq) return;
      setItems((current) => (reset ? result.items : [...current, ...result.items]));
      offsetRef.current = reset ? result.items.length : nextOffset + result.items.length;
      setHasMore(result.hasMore);
      setError(null);
    } catch (requestError) {
      if (requestSeq.current !== seq) return;
      if (reset) setItems([]);
      setError(requestError);
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [direction, userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listFollowConnections({
          userId,
          direction,
          offset: 0,
        });
        if (cancelled) return;
        setItems(result.items);
        offsetRef.current = result.items.length;
        setHasMore(result.hasMore);
        setError(null);
      } catch (requestError) {
        if (cancelled) return;
        setItems([]);
        setError(requestError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [direction, userId]);

  const onAction = async (item) => {
    if (!item?.userId || demoMode) {
      if (demoMode) {
        Alert.alert(t('social.demoBlockedTitle'), t('social.demoBlockedBody'));
      }
      return;
    }
    setActionId(item.userId);
    try {
      const action = item.action;
      if (action === RELATIONSHIP.FOLLOWING) {
        await unfollowUser(item.userId);
        setItems((current) => current.map((row) => (
          row.userId === item.userId
            ? {
              ...row,
              relationship: { ...row.relationship, isFollowing: false, outgoingRequestId: null },
              action: resolveRelationshipAction({
                ...row.relationship,
                isFollowing: false,
                outgoingRequestId: null,
              }),
            }
            : row
        )));
      } else if (action === RELATIONSHIP.REQUESTED) {
        await cancelFollowRequest(item.userId);
        setItems((current) => current.map((row) => (
          row.userId === item.userId
            ? {
              ...row,
              relationship: { ...row.relationship, outgoingRequestId: null },
              action: resolveRelationshipAction({
                ...row.relationship,
                outgoingRequestId: null,
              }),
            }
            : row
        )));
      } else {
        const result = await followUser(item.userId);
        setItems((current) => current.map((row) => {
          if (row.userId !== item.userId) return row;
          const relationship = {
            ...row.relationship,
            isFollowing: Boolean(result.isFollowing),
            outgoingRequestId: result.requestId || null,
          };
          return {
            ...row,
            relationship,
            action: resolveRelationshipAction(relationship),
          };
        }));
      }
    } catch (requestError) {
      Alert.alert(
        t('social.followErrorTitle'),
        t(`social.errors.${requestError.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>
          {t(`social.errors.${error.code}`, { defaultValue: t('social.errors.generic') })}
        </Text>
        <PrimaryButton label={t('common.retry')} onPress={() => load({ reset: true })} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      data={items}
      keyExtractor={(item) => item.userId}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ reset: true, soft: true })}
          tintColor={colors.primary}
        />
      )}
      contentContainerStyle={items.length ? styles.list : styles.emptyWrap}
      ListEmptyComponent={(
        <Text style={styles.message}>
          {direction === 'following' ? t('social.connectionsEmptyFollowing') : t('social.connectionsEmptyFollowers')}
        </Text>
      )}
      renderItem={({ item }) => (
        <ConnectionListItem
          item={item}
          actionLoading={actionId === item.userId}
          onPress={(connection) => {
            if (!connection?.username) return;
            router.push(`/user/${encodeURIComponent(connection.username)}`);
          }}
          onAction={onAction}
        />
      )}
      onEndReached={() => {
        if (!hasMore || loadingMore || loading) return;
        setLoadingMore(true);
        load({ reset: false });
      }}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        loadingMore ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  loader: {
    marginVertical: spacing.md,
  },
});
