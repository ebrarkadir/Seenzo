import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { episodeTitle, mediaSynopsis } from '../../data/labels';
import { parseTraktShowKey } from '../../services/trakt/normalize';
import { colors, radii, spacing, typography } from '../../theme';
import { episodeCode, isReleased } from '../../tracking/status';
import EpisodeActorsBlock from '../people/EpisodeActorsBlock';
import PosterThumb from '../ui/PosterThumb';
import PrimaryButton from '../ui/PrimaryButton';
import RateChip from '../ui/RateChip';

export default function EpisodeDetailSheet({
  visible,
  show,
  episode,
  watched,
  rating,
  onClose,
  onToggleWatched,
  onRate,
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const traktShowId = parseTraktShowKey(show?.id) || show?.traktId || null;

  if (!episode) {
    return null;
  }

  const released = isReleased(episode);
  const code = t('common.episodeCode', episodeCode(episode));
  const title = episodeTitle(t, episode) || t('trakt.unavailable');
  const synopsis = mediaSynopsis(t, episode);
  const posterPath = episode.posterPath || show?.posterPath;
  const posterUri = episode.poster || show?.poster;
  const canRate = released && watched;
  const rateLabel = rating != null ? t('common.ratingValue', { rating }) : t('rating.rate');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tv.closeEpisode')}
          style={styles.dismiss}
          onPress={onClose}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderSpacer} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('tv.closeEpisode')}
              onPress={onClose}
              hitSlop={8}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <PosterThumb uri={posterUri} posterPath={posterPath} width={84} height={126} />
              <View style={styles.headerCopy}>
                <Text style={styles.code}>{code}</Text>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.meta}>
                  {[
                    episode.airDate ? t('tv.airedOn', { date: formatAirDate(episode.airDate) }) : null,
                    typeof episode.runtime === 'number' ? t('common.minutes', { count: episode.runtime }) : null,
                  ].filter(Boolean).join(' · ') || t('trakt.unavailable')}
                </Text>
                <View style={styles.rateRow}>
                  <RateChip
                    label={rateLabel}
                    accessibilityLabel={t('rating.episode')}
                    disabled={!canRate}
                    onPress={canRate ? onRate : () => {}}
                  />
                  {rating == null ? (
                    <Text style={styles.meta}>{t('rating.none')}</Text>
                  ) : null}
                </View>
                {!canRate && released ? (
                  <Text style={styles.meta}>{t('rating.watchToRate')}</Text>
                ) : null}
              </View>
            </View>
            <Text style={styles.section}>{t('trakt.overview')}</Text>
            <Text style={styles.body}>{synopsis || t('trakt.unavailable')}</Text>
            {released ? (
              <PrimaryButton
                label={t(watched ? 'tv.markUnwatched' : 'tv.markWatched')}
                onPress={onToggleWatched}
              />
            ) : (
              <Text style={styles.meta}>
                {episode.airDate
                  ? t('tv.upcoming', { date: formatAirDate(episode.airDate) })
                  : t('upcoming.tba')}
              </Text>
            )}
            {traktShowId ? (
              <EpisodeActorsBlock
                traktShowId={traktShowId}
                seasonNumber={episode.season}
                episodeNumber={episode.number}
                watched={watched}
              />
            ) : (
              <Text style={styles.meta}>{t('people.unavailableForDemo')}</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function formatAirDate(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
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
    maxHeight: '90%',
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  sheetHeaderSpacer: {
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  code: {
    ...typography.label,
    color: colors.primary,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
  },
  rateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  section: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
