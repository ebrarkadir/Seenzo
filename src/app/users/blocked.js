import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PrimaryButton from '../../components/ui/PrimaryButton';
import { useAuth } from '../../auth/AuthContext';
import { useTracking } from '../../tracking/TrackingContext';
import {
  BLOCKED_USERS_PAGE_SIZE,
  listBlockedUsers,
  unblockUser,
} from '../../services/supabase/socialBlocks';
import { colors, radii, spacing, typography } from '../../theme';

export default function BlockedUsersScreen() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace('/sign-in');
    }
  }, [session?.user?.id]);

  if (!session?.user?.id) {
    return null;
  }

  return <BlockedUsersBody key={session.user.id} />;
}

function BlockedUsersBody() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { demoMode } = useTracking();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [actionId, setActionId] = useState(null);
  const offsetRef = useRef(0);
  const requestSeq = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('social.block.listTitle'),
    });
  }, [navigation, t]);

  const load = useCallback(async ({ reset = false, soft = false } = {}) => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (reset && !soft) setLoading(true);
    if (soft) setRefreshing(true);
    const nextOffset = reset ? 0 : offsetRef.current;
    try {
      const result = await listBlockedUsers({
        offset: nextOffset,
        limit: BLOCKED_USERS_PAGE_SIZE,
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listBlockedUsers({ offset: 0 });
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
  }, []);

  const onUnblock = (item) => {
    if (!item?.userId) return;
    if (demoMode) {
      Alert.alert(t('social.demoBlockedTitle'), t('social.block.demoBlockedBody'));
      return;
    }
    Alert.alert(
      t('social.block.unblockTitle'),
      t('social.block.unblockBody', { user: item.displayName || item.username || '' }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('social.block.unblockAction'),
          onPress: async () => {
            setActionId(item.userId);
            try {
              await unblockUser(item.userId);
              setItems((current) => current.filter((row) => row.userId !== item.userId));
            } catch (requestError) {
              Alert.alert(
                t('social.block.errorTitle'),
                t(`social.errors.${requestError.code}`, {
                  defaultValue: t('social.errors.generic'),
                })
              );
            } finally {
              setActionId(null);
            }
          },
        },
      ]
    );
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
        <View style={styles.emptyInner}>
          <Text style={styles.emptyTitle}>{t('social.block.emptyTitle')}</Text>
          <Text style={styles.message}>{t('social.block.emptyBody')}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <BlockedUserRow
          item={item}
          actionLoading={actionId === item.userId}
          onUnblock={() => onUnblock(item)}
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

function BlockedUserRow({ item, onUnblock, actionLoading }) {
  const { t } = useTranslation();
  const displayName = item?.displayName || item?.username || '';
  const username = item?.username ? `@${item.username}` : '';

  return (
    <View style={styles.row}>
      <View style={styles.identity}>
        {item?.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={20} color={colors.primary} />
          </View>
        )}
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          {username ? (
            <Text style={styles.username} numberOfLines={1}>{username}</Text>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('social.block.unblockAction')}
        disabled={actionLoading}
        onPress={onUnblock}
        style={({ pressed }) => [
          styles.unblockChip,
          (pressed || actionLoading) && styles.unblockPressed,
        ]}
      >
        <Text style={styles.unblockText}>
          {actionLoading ? t('common.loading') : t('social.block.unblockAction')}
        </Text>
      </Pressable>
    </View>
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
  emptyInner: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  emptyTitle: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  username: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  unblockChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  unblockPressed: {
    opacity: 0.75,
  },
  unblockText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
});
