import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

export default function RatingPicker({ value, onChange }) {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>{t('common.yourRating')}</Text>
      <View style={styles.row}>
        {Array.from({ length: 10 }, (_, index) => {
          const rating = index + 1;
          const selected = value === rating;
          return (
            <Pressable
              key={rating}
              accessibilityRole="button"
              accessibilityLabel={t('common.ratingValue', { rating })}
              accessibilityState={{ selected }}
              onPress={() => onChange(selected ? null : rating)}
              style={[styles.cell, selected && styles.cellSelected]}
            >
              <Text style={[styles.cellText, selected && styles.cellTextSelected]}>{rating}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  caption: {
    ...typography.label,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
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
    ...typography.label,
    color: colors.text,
  },
  cellTextSelected: {
    color: colors.onPrimary,
  },
});
