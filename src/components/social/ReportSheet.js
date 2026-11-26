import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import PrimaryButton from '../ui/PrimaryButton';
import { REPORT_REASON_KEYS } from '../../services/supabase/socialInteractions';
import { colors, radii, spacing, typography } from '../../theme';

/**
 * Shared report sheet for profiles, review activities, and comments.
 * Parent owns the submit RPC and demo guard; this sheet collects a reason.
 */
export default function ReportSheet({
  visible,
  targetKind = 'content',
  submitting = false,
  onClose,
  onSubmit,
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={styles.dismiss}
          onPress={submitting ? undefined : onClose}
        />
        {visible ? (
          <ReportSheetBody
            key={`report:${targetKind}`}
            targetKind={targetKind}
            submitting={submitting}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function ReportSheetBody({ targetKind, submitting, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState(null);

  const title = t(`social.report.titles.${targetKind}`, {
    defaultValue: t('social.report.titles.content'),
  });
  const body = t(`social.report.bodies.${targetKind}`, {
    defaultValue: t('social.report.bodies.content'),
  });

  return (
    <View style={styles.sheet}>
      <View style={styles.handleRow}>
        <View style={styles.handle} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>

      <View style={styles.reasons}>
        {REPORT_REASON_KEYS.map((key) => {
          const selected = reason === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={submitting}
              onPress={() => setReason(key)}
              style={({ pressed }) => [
                styles.reasonChip,
                selected && styles.reasonChipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                {t(`social.report.reasons.${key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={submitting ? t('common.loading') : t('social.report.submit')}
          onPress={() => {
            if (!reason || submitting) return;
            onSubmit?.(reason);
          }}
          disabled={!reason || submitting}
        />
        {submitting ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <PrimaryButton
            label={t('common.cancel')}
            variant="secondary"
            onPress={onClose}
            disabled={submitting}
          />
        )}
      </View>
    </View>
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    minHeight: 28,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  reasons: {
    gap: spacing.sm,
  },
  reasonChip: {
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  reasonChipSelected: {
    borderColor: colors.primary,
  },
  reasonText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  reasonTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.88,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  loader: {
    marginVertical: spacing.sm,
  },
});
