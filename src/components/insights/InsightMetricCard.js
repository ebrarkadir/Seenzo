import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../theme';

export default function InsightMetricCard({
  label,
  value,
  footnote,
  accessibilityLabel,
}) {
  return (
    <View
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel || `${label}: ${value}`}
    >
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      {footnote ? <Text style={styles.footnote} numberOfLines={2}>{footnote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '46%',
    minHeight: 88,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  value: {
    ...typography.subtitle,
    color: colors.text,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
});
