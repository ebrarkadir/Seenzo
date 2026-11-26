import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, spacing, typography } from '../../theme';

const HEART = '#E891A3';
const DURATION = 180;

/**
 * Premium heart control for shared review activities.
 * Optimistic UI lives in the parent; this component owns scale feedback.
 */
export default function ReviewLikeButton({
  liked = false,
  likeCount = 0,
  disabled = false,
  busy = false,
  onPress,
}) {
  const { t } = useTranslation();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((enabled) => {
      if (active) setReduceMotion(Boolean(enabled));
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(Boolean(enabled))
    );
    return () => {
      active = false;
      sub?.remove?.();
    };
  }, []);

  const animate = () => {
    if (reduceMotion) return;
    scale.setValue(1);
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.18,
        duration: DURATION / 2,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: DURATION / 2,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const countLabel = Math.max(0, Number(likeCount) || 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(liked), disabled: disabled || busy }}
      accessibilityLabel={
        liked
          ? t('social.discussion.unlikeA11y', { count: countLabel })
          : t('social.discussion.likeA11y', { count: countLabel })
      }
      disabled={disabled || busy}
      onPress={() => {
        if (disabled || busy || typeof onPress !== 'function') return;
        animate();
        onPress();
      }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.hit,
        pressed && !disabled && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
    >
      <Animated.View style={[styles.row, { transform: [{ scale }] }]}>
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={20}
          color={liked ? HEART : colors.textSecondary}
        />
        <Text style={[styles.count, liked && styles.countLiked]}>
          {countLabel}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    opacity: 0.55,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  count: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    minWidth: 10,
  },
  countLiked: {
    color: HEART,
  },
});
