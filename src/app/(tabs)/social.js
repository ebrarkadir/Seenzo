import { useCallback, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import FriendsActivityFeed from '../../components/social/FriendsActivityFeed';
import PeopleDiscoveryPanel from '../../components/social/PeopleDiscoveryPanel';
import SocialSectionTabs from '../../components/social/SocialSectionTabs';
import { useAuth } from '../../auth/AuthContext';
import {
  getUnreadSocialNotificationCount,
  listFollowConnections,
} from '../../services/supabase/socialGraph';
import { colors, spacing, typography } from '../../theme';

function normalizeSection(value) {
  return value === 'people' ? 'people' : 'following';
}

export default function SocialScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const params = useLocalSearchParams();
  const section = normalizeSection(
    Array.isArray(params.section) ? params.section[0] : params.section
  );
  const [fade] = useState(() => new Animated.Value(1));
  const [unreadCount, setUnreadCount] = useState(0);
  const [followingItems, setFollowingItems] = useState([]);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [followingError, setFollowingError] = useState(null);
  const peopleAutoFocus = section === 'people';
  const userId = session?.user?.id || null;

  const sections = useMemo(() => ([
    { value: 'following', label: t('social.sectionFollowing') },
    { value: 'people', label: t('social.sectionPeople') },
  ]), [t]);

  const refreshUnread = useCallback(() => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }
    getUnreadSocialNotificationCount()
      .then((count) => setUnreadCount(count))
      .catch(() => setUnreadCount(0));
  }, [userId]);

  const loadFollowing = useCallback(async ({ soft = false } = {}) => {
    if (!userId) {
      setFollowingItems([]);
      setFollowingError(null);
      setFollowingLoading(false);
      return;
    }
    if (!soft) {
      setFollowingLoading(true);
    }
    try {
      const result = await listFollowConnections({
        userId,
        direction: 'following',
        offset: 0,
        limit: 24,
      });
      setFollowingItems(result.items || []);
      setFollowingError(null);
    } catch (error) {
      setFollowingError(error);
      if (!soft) {
        setFollowingItems([]);
      }
    } finally {
      setFollowingLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      refreshUnread();
      if (section === 'following') {
        loadFollowing();
      }
    }, [loadFollowing, refreshUnread, section])
  );

  const changeSection = (next) => {
    if (next === section) {
      return;
    }
    Animated.timing(fade, {
      toValue: 0,
      duration: 90,
      useNativeDriver: true,
    }).start(() => {
      router.setParams({ section: next });
      Animated.timing(fade, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }).start();
    });
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title} accessibilityRole="header">{t('social.homeTitle')}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.searchActionA11y')}
            hitSlop={10}
            onPress={() => changeSection('people')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
          >
            <Ionicons name="search" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.notificationsA11y')}
            hitSlop={10}
            onPress={() => router.push('/social/notifications')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {unreadCount > 0 ? <View style={styles.badge} /> : null}
          </Pressable>
        </View>
      </View>

      <SocialSectionTabs
        options={sections}
        value={section}
        onChange={changeSection}
      />

      <Animated.View style={[styles.body, { opacity: fade }]}>
        {section === 'following' ? (
          <FriendsActivityFeed
            key={userId || 'guest'}
            userId={userId}
            followingItems={followingItems}
            followingLoading={followingLoading}
            followingError={followingError}
            onRetryFollowing={() => loadFollowing()}
            onFindPeople={() => changeSection('people')}
            onRefreshFollowing={() => loadFollowing({ soft: true })}
          />
        ) : (
          <PeopleDiscoveryPanel autoFocus={peopleAutoFocus} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  iconPressed: {
    backgroundColor: colors.surfaceElevated,
  },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  body: {
    flex: 1,
  },
});
