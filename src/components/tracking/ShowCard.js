import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../ui/PosterThumb';
import PrimaryButton from '../ui/PrimaryButton';
import StatusBadge from '../ui/StatusBadge';
import { colors, radii, spacing, typography } from '../../theme';
import {
  deriveShowStatus,
  episodeCode,
  getNextEpisode,
  getProgress,
  lastWatchedEpisode,
} from '../../tracking/status';

function codeLabel(t, episode) {
  return t('common.episodeCode', episodeCode(episode));
}

export default function ShowCard({
  show,
  entry,
  onPress,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}) {
  const { t } = useTranslation();
  const status = deriveShowStatus(show, entry);
  const next = getNextEpisode(show, entry);
  const progress = getProgress(show, entry);
  const last = lastWatchedEpisode(show, entry);
  const color = colors.status[status] || colors.textMuted;

  let meta = t(`tv.status.${status}`);
  if (status === 'watching' && next) {
    meta = t('tv.next', { code: codeLabel(t, next), title: t(next.titleKey) });
  } else if (status === 'dropped' && last) {
    meta = t('tv.stoppedAt', { code: codeLabel(t, last) });
  } else if (status === 'plan') {
    meta = t('tv.notStarted');
  } else if (progress.total > 0) {
    meta = t('tv.progress', progress);
  }

  const ratio = progress.total > 0 ? progress.watched / progress.total : 0;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tv.openShow', { title: t(show.titleKey), status: t(`tv.status.${status}`) })}
        onPress={onPress}
        style={styles.row}
      >
        <PosterThumb uri={show.poster} status={status} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {t(show.titleKey)}
          </Text>
          <StatusBadge status={status} />
          <Text style={styles.meta} numberOfLines={2}>
            {meta}
          </Text>
          {progress.total > 0 && status !== 'plan' ? (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: color }]} />
            </View>
          ) : null}
        </View>
      </Pressable>
      {primaryLabel || secondaryLabel ? (
        <View style={styles.actions}>
          {primaryLabel ? (
            <PrimaryButton
              label={primaryLabel}
              onPress={onPrimary}
              accessibilityLabel={t('tv.actionA11y', { title: t(show.titleKey), action: primaryLabel })}
              style={styles.action}
            />
          ) : null}
          {secondaryLabel ? (
            <PrimaryButton label={secondaryLabel} onPress={onSecondary} variant="secondary" style={styles.action} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm + 2,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
  },
  body: {
    flex: 1,
    gap: 6,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  track: {
    height: 3,
    borderRadius: radii.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
