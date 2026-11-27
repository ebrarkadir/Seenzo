import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../ui/PosterThumb';
import PrimaryButton from '../ui/PrimaryButton';
import StatusBadge from '../ui/StatusBadge';
import { episodeTitle, mediaGenreLine, mediaTitle } from '../../data/labels';
import { colors, radii, spacing, typography } from '../../theme';
import {
  deriveShowStatus,
  episodeCode,
  getNextEpisode,
  getProgress,
  isReleased,
  lastWatchedEpisode,
} from '../../tracking/status';
import EpisodeIdentifier from './EpisodeIdentifier';

function codeLabel(t, episode) {
  return t('common.episodeCode', episodeCode(episode));
}

function formatAirDate(iso) {
  if (!iso) {
    return null;
  }
  const [year, month, day] = String(iso).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

export default function ShowCard({
  show,
  entry,
  onPress,
  onOpenEpisode,
  onMarkEpisodeWatched,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}) {
  const { t } = useTranslation();
  const title = mediaTitle(t, show);
  const genreLine = mediaGenreLine(t, show);
  const status = deriveShowStatus(show, entry);
  const next = getNextEpisode(show, entry);
  const progress = getProgress(show, entry);
  const last = lastWatchedEpisode(show, entry);
  const color = colors.status[status] || colors.textMuted;
  const nextReleased = Boolean(next && isReleased(next));
  // Active Up Next actions only for watching — never treat dropped as active continue.
  const useEpisodeActions = Boolean(
    status === 'watching' && onOpenEpisode && next && nextReleased
  );

  let fallbackMeta = t(`tv.status.${status}`);
  if (status === 'dropped' && last) {
    fallbackMeta = t('tv.stoppedAt', { code: codeLabel(t, last) });
  } else if (status === 'plan') {
    fallbackMeta = t('tv.notStarted');
  } else if (progress.total > 0) {
    fallbackMeta = t('tv.progress', progress);
  }

  const progressLine = progress.total > 0
    ? `${t(`tv.status.${status}`)} · ${t('tv.progress', progress)}`
    : t(`tv.status.${status}`);

  const ratio = progress.total > 0 ? progress.watched / progress.total : 0;
  const episodeMeta = next
    ? [
      next.airDate ? formatAirDate(next.airDate) : null,
      typeof next.runtime === 'number' ? t('common.minutes', { count: next.runtime }) : null,
    ].filter(Boolean).join(' · ')
    : '';

  const openNextEpisode = () => {
    if (next && onOpenEpisode) {
      onOpenEpisode(show, next);
    }
  };

  const markNext = () => {
    if (!next || !nextReleased || !onMarkEpisodeWatched) {
      return;
    }
    onMarkEpisodeWatched(show, next);
  };

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tv.openShow', { title, status: t(`tv.status.${status}`) })}
        onPress={onPress}
        style={styles.row}
      >
        <PosterThumb uri={show.poster} posterPath={show.posterPath} status={status} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {genreLine ? (
            <Text style={styles.genres} numberOfLines={1}>{genreLine}</Text>
          ) : null}
          {useEpisodeActions ? (
            <Text style={styles.meta} numberOfLines={1}>{progressLine}</Text>
          ) : (
            <>
              <StatusBadge status={status} />
              <Text style={styles.meta} numberOfLines={2}>{fallbackMeta}</Text>
            </>
          )}
          {progress.total > 0 && status !== 'plan' ? (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: color }]} />
            </View>
          ) : null}
        </View>
      </Pressable>

      {useEpisodeActions ? (
        <View style={styles.nextBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tv.openEpisode', {
              code: codeLabel(t, next),
              title: episodeTitle(t, next) || t('trakt.unavailable'),
            })}
            onPress={openNextEpisode}
            style={styles.nextInfo}
          >
            <View style={styles.nextLabelRow}>
              <Text style={styles.nextHeading}>{t('tv.nextEpisodeHeading')}</Text>
              <EpisodeIdentifier episode={next} size="pill" />
            </View>
            <Text style={styles.nextTitle} numberOfLines={2}>
              {episodeTitle(t, next) || t('trakt.unavailable')}
            </Text>
            {episodeMeta ? (
              <Text style={styles.meta} numberOfLines={1}>{episodeMeta}</Text>
            ) : null}
          </Pressable>
          <PrimaryButton
            label={t('tv.markWatched')}
            onPress={markNext}
            accessibilityLabel={t('tv.markWatchedAndOpen', {
              code: codeLabel(t, next),
              title: episodeTitle(t, next) || t('trakt.unavailable'),
            })}
            style={styles.markButton}
          />
        </View>
      ) : null}

      {!useEpisodeActions && (primaryLabel || secondaryLabel) ? (
        <View style={styles.actions}>
          {primaryLabel ? (
            <PrimaryButton
              label={primaryLabel}
              onPress={onPrimary}
              accessibilityLabel={t('tv.actionA11y', { title, action: primaryLabel })}
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
    minWidth: 0,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  genres: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '500',
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
  nextBlock: {
    gap: 6,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  nextInfo: {
    gap: 3,
    minWidth: 0,
  },
  nextLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    minWidth: 0,
  },
  nextHeading: {
    ...typography.label,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  nextTitle: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.text,
  },
  markButton: {
    alignSelf: 'stretch',
    minHeight: 40,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
