import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import NotificationRow from '../../components/social/NotificationRow';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { useAuth } from '../../auth/AuthContext';
import { useTracking } from '../../tracking/TrackingContext';
import { followUser } from '../../services/supabase/social';
import {
  acceptFollowRequest,
  listSocialNotifications,
  markAllSocialNotificationsRead,
  markSocialNotificationRead,
  rejectFollowRequest,
} from '../../services/supabase/socialGraph';
import {
  isInteractionNotificationType,
  resolveReviewDiscussionTarget,
} from '../../services/supabase/socialInteractions';
import { colors, radii, spacing, typography } from '../../theme';

export default function SocialNotificationsScreen() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace('/sign-in');
    }
  }, [session?.user?.id]);

  if (!session?.user?.id) {
    return null;
  }

  return <NotificationsBody key={session.user.id} />;
}

function NotificationsBody() {
  const { t } = useTranslation();
  const { demoMode } = useTracking();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const [actionId, setActionId] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(async ({ reset = false, soft = false } = {}) => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (reset && !soft) setLoading(true);
    if (soft) setRefreshing(true);
    const nextOffset = reset ? 0 : offsetRef.current;
    try {
      const result = await listSocialNotifications({ offset: nextOffset });
      if (requestSeq.current !== seq) return;
      setItems((current) => (reset ? result.items : [...current, ...result.items]));
      offsetRef.current = reset ? result.items.length : nextOffset + result.items.length;
      setHasMore(result.hasMore);
      setError(null);
      setUnavailable(false);
    } catch (requestError) {
      if (requestSeq.current !== seq) return;
      if (requestError?.code === 'social_v2_unavailable') {
        setUnavailable(true);
        setItems([]);
        setError(null);
      } else {
        if (reset) setItems([]);
        setError(requestError);
      }
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listSocialNotifications({ offset: 0 });
        if (cancelled) return;
        setItems(result.items);
        offsetRef.current = result.items.length;
        setHasMore(result.hasMore);
        setError(null);
        setUnavailable(false);
      } catch (requestError) {
        if (cancelled) return;
        if (requestError?.code === 'social_v2_unavailable') {
          setUnavailable(true);
          setItems([]);
          setError(null);
        } else {
          setItems([]);
          setError(requestError);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const guardDemo = () => {
    if (!demoMode) return false;
    Alert.alert(t('social.demoBlockedTitle'), t('social.demoBlockedBody'));
    return true;
  };

  const onMarkAll = async () => {
    try {
      await markAllSocialNotificationsRead();
      setItems((current) => current.map((item) => ({
        ...item,
        unread: false,
        readAt: item.readAt || new Date().toISOString(),
      })));
    } catch (requestError) {
      Alert.alert(
        t('social.notificationsErrorTitle'),
        t(`social.errors.${requestError.code}`, { defaultValue: t('social.errors.generic') })
      );
    }
  };

  const openActor = async (item) => {
    if (item?.unread) {
      try {
        await markSocialNotificationRead(item.id);
        setItems((current) => current.map((row) => (
          row.id === item.id
            ? { ...row, unread: false, readAt: row.readAt || new Date().toISOString() }
            : row
        )));
      } catch {
        // Non-blocking.
      }
    }
    if (isInteractionNotificationType(item?.type) && item?.entityId) {
      try {
        const activityId = await resolveReviewDiscussionTarget({
          entityType: item.entityType,
          entityId: item.entityId,
        });
        router.push(`/social/discussion?activityId=${encodeURIComponent(activityId)}`);
        return;
      } catch {
        Alert.alert(
          t('social.discussion.goneTitle'),
          t('social.discussion.goneBody')
        );
        return;
      }
    }
    if (item?.actor?.username) {
      router.push(`/user/${encodeURIComponent(item.actor.username)}`);
    }
  };

  const onAccept = async (item) => {
    if (guardDemo() || !item?.entityId) return;
    setActionId(item.id);
    try {
      await acceptFollowRequest(item.entityId);
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (requestError) {
      Alert.alert(
        t('social.followErrorTitle'),
        t(`social.errors.${requestError.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setActionId(null);
    }
  };

  const onReject = async (item) => {
    if (guardDemo() || !item?.entityId) return;
    setActionId(item.id);
    try {
      await rejectFollowRequest(item.entityId);
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (requestError) {
      Alert.alert(
        t('social.followErrorTitle'),
        t(`social.errors.${requestError.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setActionId(null);
    }
  };

  const onFollowBack = async (item) => {
    if (guardDemo() || !item?.actor?.userId) return;
    setActionId(item.id);
    try {
      await followUser(item.actor.userId);
      await markSocialNotificationRead(item.id);
      setItems((current) => current.map((row) => (
        row.id === item.id ? { ...row, unread: false } : row
      )));
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

  if (unavailable) {
    return (
      <View style={styles.centered}>
        <View style={styles.card}>
          <View style={styles.iconBadge}>
            <Ionicons name="notifications-outline" size={28} color={colors.primary} />
          </View>
          <Text style={styles.title}>{t('social.notificationsUnavailableTitle')}</Text>
          <Text style={styles.body}>{t('social.notificationsUnavailableBody')}</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>
          {t(`social.errors.${error.code}`, { defaultValue: t('social.errors.generic') })}
        </Text>
        <PrimaryButton label={t('common.retry')} onPress={() => load({ reset: true })} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {items.length ? (
        <Pressable accessibilityRole="button" onPress={onMarkAll} style={styles.markAll}>
          <Text style={styles.markAllLabel}>{t('social.notificationsMarkAll')}</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ reset: true, soft: true })}
            tintColor={colors.primary}
          />
        )}
        contentContainerStyle={items.length ? styles.list : styles.emptyWrap}
        ListEmptyComponent={(
          <View style={styles.card}>
            <View style={styles.iconBadge}>
              <Ionicons name="notifications-outline" size={28} color={colors.primary} />
            </View>
            <Text style={styles.title}>{t('social.notificationsEmptyTitle')}</Text>
            <Text style={styles.body}>{t('social.notificationsEmptyBody')}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <NotificationRow
            item={item}
            actionLoading={actionId === item.id}
            onPressActor={openActor}
            onAccept={onAccept}
            onReject={onReject}
            onFollowBack={onFollowBack}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    paddingBottom: spacing.xl,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  markAll: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  markAllLabel: {
    ...typography.label,
    color: colors.primary,
  },
  card: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  loader: {
    marginVertical: spacing.md,
  },
});
