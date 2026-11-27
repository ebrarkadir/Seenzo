import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';
import { MY_LIST_SORT_OPTIONS } from '../../tracking/watchlistSort';
import ShowOverflowMenu from './ShowOverflowMenu';

export default function WatchlistSortSelect({ value, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const label = t(`watchlist.sorts.${value}`);
  const options = useMemo(
    () => MY_LIST_SORT_OPTIONS.map((optionValue) => ({
      key: optionValue,
      label: t(`watchlist.sorts.${optionValue}`),
      onPress: () => onChange?.(optionValue),
    })),
    [onChange, t]
  );

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('watchlist.sortA11y', { sort: label })}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={styles.trigger}
      >
        <Ionicons name="swap-vertical" size={18} color={colors.textSecondary} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      <ShowOverflowMenu
        visible={open}
        options={options}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.md,
  },
  trigger: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
});
