import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SOCIAL_FEED_FILTERS } from '../../services/supabase/socialActivity';
import { colors, radii, spacing, typography } from '../../theme';

/**
 * Compact horizontal feed filters. Selection only — fetching stays in the parent.
 */
export default function ActivityFeedFilterRow({
  value = 'all',
  onChange,
  disabled = false,
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {SOCIAL_FEED_FILTERS.map((filter) => {
          const active = value === filter;
          return (
            <Pressable
              key={filter}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => {
                if (!disabled && filter !== value) onChange?.(filter);
              }}
              style={({ pressed }) => [
                styles.chip,
                active && styles.chipActive,
                pressed && !disabled && styles.pressed,
                disabled && styles.disabled,
              ]}
            >
              <Text style={[styles.label, active && styles.labelActive]}>
                {t(`social.feedFilters.${filter}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.sm,
  },
  row: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: 'rgba(121, 196, 255, 0.55)',
    backgroundColor: 'rgba(121, 196, 255, 0.14)',
  },
  pressed: {
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  labelActive: {
    color: colors.primary,
  },
});
