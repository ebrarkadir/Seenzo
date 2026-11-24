import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import RelationshipButton from './RelationshipButton';
import { followUser, unfollowUser } from '../../services/supabase/social';
import {
  cancelFollowRequest,
  getSocialRelationship,
} from '../../services/supabase/socialGraph';
import {
  RELATIONSHIP,
  emptyRelationship,
  resolveRelationshipAction,
} from '../../services/supabase/socialRules';
import { colors, radii, spacing, typography } from '../../theme';

function InlineRelationshipControl({ userId, demoBlocked }) {
  const { t } = useTranslation();
  const [relationship, setRelationship] = useState(emptyRelationship());
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    getSocialRelationship(userId)
      .then((next) => {
        if (active) setRelationship(next);
      })
      .catch(() => {
        if (active) setRelationship(emptyRelationship());
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const action = resolveRelationshipAction(relationship);

  const onPress = async () => {
    if (demoBlocked?.()) return;
    setLoading(true);
    try {
      if (action === RELATIONSHIP.FOLLOWING) {
        await unfollowUser(userId);
        setRelationship((current) => ({ ...current, isFollowing: false, outgoingRequestId: null }));
      } else if (action === RELATIONSHIP.REQUESTED) {
        await cancelFollowRequest(userId);
        setRelationship((current) => ({ ...current, outgoingRequestId: null }));
      } else {
        const result = await followUser(userId);
        setRelationship((current) => ({
          ...current,
          isFollowing: Boolean(result.isFollowing),
          outgoingRequestId: result.requestId || null,
        }));
      }
    } catch (error) {
      Alert.alert(
        t('social.followErrorTitle'),
        t(`social.errors.${error.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return null;
  }

  return (
    <RelationshipButton
      compact
      action={action}
      loading={loading}
      onPress={onPress}
    />
  );
}

export default function UserSearchResult({
  profile,
  onPress,
  showFollow = false,
  demoBlocked,
}) {
  const displayName = profile?.displayName || profile?.username || '';
  const username = profile?.username ? `@${profile.username}` : '';
  const privateDiscoverable = profile && !profile.isPublic && profile.allowProfileDiscovery;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${displayName} ${username}`.trim()}
        onPress={() => onPress?.(profile)}
        style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
      >
        {profile?.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={20} color={colors.primary} />
          </View>
        )}
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.username} numberOfLines={1}>{username}</Text>
          {privateDiscoverable ? (
            <Text style={styles.meta}>Private</Text>
          ) : null}
        </View>
        {!showFollow ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        ) : null}
      </Pressable>
      {showFollow && profile?.userId ? (
        <InlineRelationshipControl key={profile.userId} userId={profile.userId} demoBlocked={demoBlocked} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  pressed: {
    opacity: 0.88,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceElevated,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
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
  name: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  username: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  meta: {
    ...typography.label,
    color: colors.textMuted,
  },
});
