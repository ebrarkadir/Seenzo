import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

export default function UndoBar({ bottom = 12 }) {
  const { t } = useTranslation();
  const { undo, undoLast, dismissUndo } = useTracking();

  if (!undo) {
    return null;
  }

  return (
    <View style={[styles.bar, { bottom }]}>
      <Text style={styles.message} numberOfLines={2}>
        {undo.kind === 'season'
          ? t(undo.removed?.length && !undo.added?.length ? 'tv.undoSeasonUnwatched' : 'tv.undoSeasonWatched', {
            label: undo.seasonNumber === 0 ? t('tv.seasonSpecials') : t('tv.season', { number: undo.seasonNumber }),
          })
          : t('tv.undoMessage', { title: undo.episodeTitle || (undo.episodeTitleKey ? t(undo.episodeTitleKey) : '') })}
      </Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={undoLast} hitSlop={8}>
          <Text style={styles.undo}>{t('tv.undo')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={dismissUndo} hitSlop={8}>
          <Text style={styles.dismiss}>{t('common.dismiss')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  message: {
    ...typography.caption,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  undo: {
    ...typography.label,
    color: colors.primary,
  },
  dismiss: {
    ...typography.label,
    color: colors.textSecondary,
  },
});
