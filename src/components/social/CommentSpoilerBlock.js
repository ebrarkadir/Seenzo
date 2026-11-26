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

function Gate({ text, containsSpoilers }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  if (!containsSpoilers || revealed) {
    return (
      <View style={styles.revealed}>
        <Text style={styles.body}>{text}</Text>
        {containsSpoilers ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.discussion.spoilers.hide')}
            onPress={() => setRevealed(false)}
            hitSlop={8}
          >
            <Text style={styles.hide}>{t('social.discussion.spoilers.hide')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('social.discussion.spoilers.revealA11y')}
      onPress={() => setRevealed(true)}
      style={({ pressed }) => [styles.hidden, pressed && styles.pressed]}
    >
      <Ionicons name="eye-off" size={16} color={colors.textMuted} />
      <Text style={styles.hiddenTitle}>{t('social.discussion.spoilers.title')}</Text>
      <Text style={styles.hiddenHint}>{t('social.discussion.spoilers.tap')}</Text>
    </Pressable>
  );
}

/**
 * Presentation-only spoiler gate for comments.
 * Remount via resetKey so reveal state stays local.
 */
export default function CommentSpoilerBlock({
  text,
  containsSpoilers = false,
  resetKey = null,
}) {
  if (!text) return null;

  return (
    <Gate
      key={`${resetKey || 'comment'}:${containsSpoilers}:${text}`}
      text={text}
      containsSpoilers={Boolean(containsSpoilers)}
    />
  );
}

const styles = StyleSheet.create({
  hidden: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'flex-start',
    gap: 2,
  },
  pressed: {
    opacity: 0.9,
  },
  hiddenTitle: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  hiddenHint: {
    ...typography.label,
    color: colors.primary,
  },
  revealed: {
    gap: 4,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  hide: {
    ...typography.label,
    color: colors.textMuted,
  },
});
