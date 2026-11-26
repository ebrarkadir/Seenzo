import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';
import { episodeCode } from '../../tracking/status';

/** Shared Obsidian Blue capsule surface for S## · E## markers. */
export const episodeIdBadgeSurface = {
  backgroundColor: 'rgba(121, 196, 255, 0.12)',
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: 'rgba(121, 196, 255, 0.38)',
  borderRadius: radii.md,
};

/**
 * Season/episode marker from episode metadata (not list index).
 * size: "compact" (plain text) | "pill" / "sheet" (shared capsule)
 */
export default function EpisodeIdentifier({ episode, size = 'compact', style }) {
  const { t } = useTranslation();
  if (typeof episode?.season !== 'number' || typeof episode?.number !== 'number') {
    return null;
  }

  const parts = episodeCode(episode);
  const label = t('common.episodeId', parts);

  if (size === 'pill' || size === 'sheet') {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={label}
        style={[styles.pill, style]}
      >
        <Text style={styles.pillText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  }

  return (
    <Text
      style={[styles.compact, style]}
      numberOfLines={1}
      ellipsizeMode="clip"
      accessibilityLabel={label}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  compact: {
    ...typography.label,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: colors.primary,
  },
  pill: {
    ...episodeIdBadgeSurface,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  pillText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: colors.primary,
  },
});
