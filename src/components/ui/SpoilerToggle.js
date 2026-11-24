import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const THUMB = 20;
const TRAVEL = TRACK_WIDTH - THUMB - 6;
const DURATION = 180;

const spoilerOn = {
  surface: 'rgba(232, 189, 100, 0.12)',
  border: 'rgba(232, 189, 100, 0.45)',
  iconBg: 'rgba(232, 189, 100, 0.18)',
  icon: '#E8BD64',
  track: 'rgba(232, 189, 100, 0.55)',
};

/**
 * Premium spoiler switch — not a checkbox.
 * Entire row is tappable; respects reduce-motion.
 */
export default function SpoilerToggle({
  value = false,
  disabled = false,
  onChange,
}) {
  const { t } = useTranslation();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [progress] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((enabled) => {
      if (active) {
        setReduceMotion(Boolean(enabled));
      }
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

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(value ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: DURATION,
      useNativeDriver: false,
    }).start();
  }, [progress, reduceMotion, value]);

  const thumbTranslate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [3, 3 + TRAVEL],
  });
  const borderColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, spoilerOn.border],
  });
  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.surfaceElevated, spoilerOn.surface],
  });
  const trackColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, spoilerOn.track],
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: Boolean(value), disabled }}
      accessibilityLabel={t('rating.spoiler.a11y')}
      disabled={disabled}
      onPress={() => {
        if (disabled || typeof onChange !== 'function') {
          return;
        }
        onChange(!value);
      }}
      style={({ pressed }) => [
        styles.hit,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Animated.View style={[styles.row, { borderColor, backgroundColor }]}>
        <View style={[styles.iconWrap, value && styles.iconWrapOn]}>
          <Ionicons
            name={value ? 'eye-off' : 'eye'}
            size={16}
            color={value ? spoilerOn.icon : colors.textMuted}
          />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{t('rating.spoiler.title')}</Text>
          <Text style={styles.subtitle}>
            {value ? t('rating.spoiler.subtitleOn') : t('rating.spoiler.subtitleOff')}
          </Text>
        </View>
        <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
          <Animated.View
            style={[
              styles.thumb,
              { transform: [{ translateX: thumbTranslate }] },
              value && styles.thumbOn,
            ]}
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    borderRadius: radii.lg,
  },
  pressed: {
    opacity: 0.92,
  },
  disabled: {
    opacity: 0.5,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrapOn: {
    backgroundColor: spoilerOn.iconBg,
    borderColor: spoilerOn.border,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.textSecondary,
  },
  thumbOn: {
    backgroundColor: colors.text,
  },
});
