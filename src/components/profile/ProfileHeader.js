import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

const BANNER_HEIGHT = 132;
const AVATAR_SIZE = 88;

export default function ProfileHeader({
  profile,
  guest = false,
  readOnly = false,
  onEdit,
  onPressAvatar,
  onPressBanner,
  onImageError,
}) {
  const { t } = useTranslation();
  const editable = !guest && !readOnly;
  const displayName = guest
    ? t('profile.guestTitle')
    : (profile?.displayName || t('profile.unnamed'));
  const username = guest
    ? null
    : (profile?.username ? `@${profile.username}` : t('profile.usernameMissing'));
  const bio = guest ? t('profile.guestBody') : (profile?.bio || '');

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.editBanner')}
        disabled={!editable || !onPressBanner}
        onPress={onPressBanner}
        style={styles.bannerPress}
      >
        {profile?.bannerUrl ? (
          <Image
            source={{ uri: profile.bannerUrl }}
            style={styles.bannerImage}
            resizeMode="cover"
            onError={() => onImageError?.('banner')}
          />
        ) : (
          <View style={styles.bannerFallback}>
            <View style={styles.bannerGlow} />
          </View>
        )}
        {editable ? (
          <View style={styles.bannerCamera}>
            <Ionicons name="camera" size={16} color={colors.text} />
          </View>
        ) : null}
      </Pressable>

      <View style={styles.identityRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.editAvatar')}
          disabled={!editable || !onPressAvatar}
          onPress={onPressAvatar}
          style={styles.avatarWrap}
        >
          {profile?.avatarUrl ? (
            <Image
              source={{ uri: profile.avatarUrl }}
              style={styles.avatarImage}
              resizeMode="cover"
              onError={() => onImageError?.('avatar')}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Ionicons name="person" size={34} color={colors.primary} />
            </View>
          )}
          {editable ? (
            <View style={styles.avatarCamera}>
              <Ionicons name="camera" size={12} color={colors.onPrimary} />
            </View>
          ) : null}
        </Pressable>

        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            {editable && onEdit ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('profile.editProfile')}
                onPress={onEdit}
                hitSlop={8}
                style={styles.editChip}
              >
                <Text style={styles.editChipText}>{t('profile.editProfile')}</Text>
              </Pressable>
            ) : null}
          </View>
          {username ? <Text style={styles.username} numberOfLines={1}>{username}</Text> : null}
          {bio ? <Text style={styles.bio} numberOfLines={3}>{bio}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  bannerPress: {
    height: BANNER_HEIGHT,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  bannerFallback: {
    flex: 1,
    backgroundColor: '#121821',
    justifyContent: 'flex-end',
  },
  bannerGlow: {
    height: '70%',
    backgroundColor: 'rgba(121, 196, 255, 0.16)',
  },
  bannerCamera: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 16, 21, 0.72)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  identityRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: -44,
    paddingHorizontal: spacing.md,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  avatarCamera: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 48,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.subtitle,
    color: colors.text,
    flexShrink: 1,
  },
  editChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  editChipText: {
    ...typography.label,
    color: colors.primary,
  },
  username: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  bio: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
