import { useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';
import PrimaryButton from './PrimaryButton';
import {
  ratingDescriptorKey,
  starFillAt,
  starsFromRating,
  toggleStarRating,
} from './ratingPresentation';

const STAR_SIZE = 40;
const STAR_HIT = 52;

function StarGlyph({ fill }) {
  return (
    <View style={styles.starGlyph}>
      <Ionicons
        name="star"
        size={STAR_SIZE}
        color={colors.border}
        style={styles.starBase}
      />
      {fill >= 1 ? (
        <Ionicons name="star" size={STAR_SIZE} color={colors.primary} />
      ) : null}
      {fill === 0.5 ? (
        <View style={styles.starHalfClip}>
          <Ionicons name="star" size={STAR_SIZE} color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

function InteractiveStars({ rating, disabled, onSelectStar, accessibilityHint }) {
  const { t } = useTranslation();
  const [scales] = useState(() => [0, 1, 2, 3, 4].map(() => new Animated.Value(1)));

  const pulse = (index) => {
    const value = scales[index];
    value.setValue(1);
    Animated.sequence([
      Animated.timing(value, {
        toValue: 1.12,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.spring(value, {
        toValue: 1,
        friction: 5,
        tension: 160,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <View style={styles.stars} accessibilityRole="adjustable">
      {[1, 2, 3, 4, 5].map((starNumber) => {
        const fill = starFillAt(rating, starNumber);
        const fullScore = starNumber * 2;
        const halfScore = fullScore - 1;
        const selectedFull = rating === fullScore;
        const selectedHalf = rating === halfScore;
        let label = t('rating.starSetFull', {
          stars: starNumber,
          rating: fullScore,
        });
        if (selectedFull) {
          label = t('rating.starToggleHalf', {
            stars: starNumber - 0.5,
            rating: halfScore,
          });
        } else if (selectedHalf) {
          label = t('rating.starToggleFull', {
            stars: starNumber,
            rating: fullScore,
          });
        }
        return (
          <Animated.View
            key={starNumber}
            style={{ transform: [{ scale: scales[starNumber - 1] }] }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint={accessibilityHint}
              accessibilityState={{ selected: fill > 0, disabled }}
              disabled={disabled}
              hitSlop={4}
              onPress={() => {
                pulse(starNumber - 1);
                onSelectStar(starNumber);
              }}
              style={({ pressed }) => [
                styles.starHit,
                pressed && !disabled && styles.starPressed,
              ]}
            >
              <StarGlyph fill={fill} />
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

export default function RatingSheet({
  visible,
  title,
  mediaTitle,
  value,
  savedValue,
  saving = false,
  onChange,
  onClose,
  onSave,
  onRemove,
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [submitting, setSubmitting] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setSubmitting(false);
    }
  }

  const descriptorKey = ratingDescriptorKey(value);
  const busy = visible && (Boolean(saving) || submitting);
  const starCount = starsFromRating(value);
  const starLabel = value == null
    ? t('rating.none')
    : t('rating.starsOutOf', { stars: starCount });

  const runOnce = async (action) => {
    if (busy || typeof action !== 'function') {
      return;
    }
    setSubmitting(true);
    try {
      await action();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('rating.close')}
          style={styles.dismiss}
          onPress={busy ? undefined : onClose}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {mediaTitle ? (
                <Text style={styles.mediaTitle} numberOfLines={1}>{mediaTitle}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('rating.close')}
              hitSlop={10}
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View
            style={styles.scoreBlock}
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              value == null
                ? t('rating.none')
                : `${starLabel}. ${t('common.ratingValue', { rating: value })}`
            }
          >
            <Text style={styles.starsHeadline}>{starLabel}</Text>
            <Text style={styles.score}>
              {value == null ? '—' : value}
              <Text style={styles.scoreSuffix}> / 10</Text>
            </Text>
            <Text style={styles.descriptor}>
              {t(`rating.descriptors.${descriptorKey}`, { defaultValue: t('rating.none') })}
            </Text>
          </View>

          <InteractiveStars
            rating={value}
            disabled={busy}
            accessibilityHint={t('rating.starHint')}
            onSelectStar={(starNumber) => {
              if (typeof onChange !== 'function') {
                return;
              }
              onChange(toggleStarRating(value, starNumber));
            }}
          />

          <PrimaryButton
            label={busy ? t('rating.saving') : t('rating.save')}
            onPress={() => runOnce(onSave)}
            disabled={busy || value == null}
          />
          {savedValue != null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('rating.remove')}
              disabled={busy}
              onPress={() => runOnce(onRemove)}
              style={({ pressed }) => [styles.removeAction, pressed && !busy && styles.removePressed]}
            >
              <Text style={styles.removeText}>{t('rating.remove')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(12, 16, 21, 0.72)',
  },
  dismiss: {
    flex: 1,
  },
  sheet: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
  },
  mediaTitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closePressed: {
    opacity: 0.8,
  },
  scoreBlock: {
    alignItems: 'center',
    gap: 2,
  },
  starsHeadline: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  score: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '700',
    color: colors.primary,
  },
  scoreSuffix: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  descriptor: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  stars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: spacing.xs,
  },
  starHit: {
    width: STAR_HIT,
    height: STAR_HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starPressed: {
    opacity: 0.88,
  },
  starGlyph: {
    width: STAR_SIZE,
    height: STAR_SIZE,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  starBase: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  starHalfClip: {
    width: STAR_SIZE / 2,
    height: STAR_SIZE,
    overflow: 'hidden',
  },
  removeAction: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePressed: {
    opacity: 0.75,
  },
  removeText: {
    ...typography.label,
    color: colors.status.dropped,
  },
});
