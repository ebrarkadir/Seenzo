import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

function SpoilerGate({ reviewText, containsSpoilers }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  if (!containsSpoilers || revealed) {
    return (
      <View style={styles.revealed}>
        <Text style={styles.reviewText}>{reviewText}</Text>
        {containsSpoilers ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.activity.spoilers.hide')}
            onPress={() => setRevealed(false)}
            hitSlop={8}
            style={styles.hideAction}
          >
            <Text style={styles.hideText}>{t('social.activity.spoilers.hide')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('social.activity.spoilers.revealA11y')}
      onPress={() => setRevealed(true)}
      style={({ pressed }) => [styles.hidden, pressed && styles.pressed]}
    >
      <Ionicons name="eye-off" size={18} color={colors.textMuted} />
      <Text style={styles.hiddenTitle}>{t('social.activity.spoilers.title')}</Text>
      <Text style={styles.hiddenHint}>{t('social.activity.spoilers.tap')}</Text>
    </Pressable>
  );
}

/**
 * Presentation-only spoiler gate for social feed reviews.
 * Remount via resetKey so reveal state stays local to the card instance.
 */
export default function SpoilerReviewBlock({
  reviewText,
  containsSpoilers = false,
  resetKey = null,
}) {
  if (!reviewText) {
    return null;
  }

  return (
    <SpoilerGate
      key={`${resetKey || 'review'}:${containsSpoilers}:${reviewText}`}
      reviewText={reviewText}
      containsSpoilers={containsSpoilers}
    />
  );
}

const styles = StyleSheet.create({
  hidden: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.9,
  },
  hiddenTitle: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  hiddenHint: {
    ...typography.label,
    color: colors.primary,
    textAlign: 'center',
  },
  revealed: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  reviewText: {
    ...typography.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  hideAction: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  hideText: {
    ...typography.label,
    color: colors.textMuted,
  },
});
