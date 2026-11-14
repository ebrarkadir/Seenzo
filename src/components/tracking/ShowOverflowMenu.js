import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

export default function ShowOverflowMenu({ visible, options, onClose }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          style={styles.dismiss}
          onPress={onClose}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {options.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                option.onPress();
              }}
              style={styles.item}
            >
              <Text style={[styles.label, option.destructive && styles.destructive]}>{option.label}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.item}>
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
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
    paddingTop: spacing.sm,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  item: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  label: {
    ...typography.body,
    color: colors.text,
  },
  destructive: {
    color: colors.status.dropped,
  },
  cancel: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
