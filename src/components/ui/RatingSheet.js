import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';
import PrimaryButton from './PrimaryButton';

export default function RatingSheet({
  visible,
  title,
  value,
  savedValue,
  onChange,
  onClose,
  onSave,
  onRemove,
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('rating.close')} style={styles.dismiss} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.score}>{value ? t('common.ratingValue', { rating: value }) : t('rating.none')}</Text>
          <View style={styles.grid}>
            {[0, 1].map((row) => (
              <View key={row} style={styles.gridRow}>
                {[1, 2, 3, 4, 5].map((column) => {
                  const rating = row * 5 + column;
                  const selected = value === rating;
                  return (
                    <Pressable
                      key={rating}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.ratingValue', { rating })}
                      accessibilityState={{ selected }}
                      onPress={() => onChange(rating)}
                      style={[styles.cell, selected && styles.cellSelected]}
                    >
                      <Text style={[styles.cellText, selected && styles.cellTextSelected]}>{rating}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
          <PrimaryButton label={t('rating.save')} onPress={onSave} disabled={value == null} />
          {savedValue != null ? (
            <PrimaryButton label={t('rating.remove')} variant="secondary" onPress={onRemove} />
          ) : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>{t('rating.close')}</Text>
          </Pressable>
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
    gap: spacing.sm,
    padding: spacing.md,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
  },
  score: {
    ...typography.hero,
    color: colors.primary,
  },
  grid: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  gridRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cell: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cellSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  cellText: {
    ...typography.subtitle,
    color: colors.text,
  },
  cellTextSelected: {
    color: colors.onPrimary,
  },
  close: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
