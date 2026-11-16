import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { episodeTitle } from '../../data/labels';
import { patchEpisodeOverview } from '../../data/mediaLibrary';
import {
  fetchEpisodeOverview,
  readCachedEpisodeOverview,
  rememberCachedEpisodeOverview,
} from '../../services/trakt/episodes';
import { normalizeEpisodeOverview, parseTraktShowKey } from '../../services/trakt/normalize';
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
  if (!episode) {
    return null;
  }

  return (
    <EpisodeDetailSheetBody
      key={`${show?.id || 'show'}-${episode.id}-${visible ? 'open' : 'closed'}`}
      visible={visible}
      show={show}
      episode={episode}
      watched={watched}
      rating={rating}
      onClose={onClose}
      onToggleWatched={onToggleWatched}
      onRate={onRate}
    />
  );
}

function EpisodeDetailSheetBody({
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
  const seasonNumber = typeof episode.season === 'number' ? episode.season : null;
  const episodeNumber = typeof episode.number === 'number' ? episode.number : null;
  const localOverview = normalizeEpisodeOverview(episode.overview);
  const cachedOverview = traktShowId != null && seasonNumber != null && episodeNumber != null
    ? readCachedEpisodeOverview(traktShowId, seasonNumber, episodeNumber) || ''
    : '';
  const seedOverview = localOverview || cachedOverview;
  const canFetch = Boolean(traktShowId && seasonNumber != null && episodeNumber != null);
  const [overview, setOverview] = useState(seedOverview);
  const [loadingOverview, setLoadingOverview] = useState(!seedOverview && canFetch && visible);

  useEffect(() => {
    if (!visible || seedOverview || !canFetch) {
      return undefined;
    }
    let active = true;
    fetchEpisodeOverview(traktShowId, seasonNumber, episodeNumber)
      .then((text) => {
        if (!active) {
          return;
        }
        const next = normalizeEpisodeOverview(text);
        setOverview(next);
        if (next) {
          rememberCachedEpisodeOverview(traktShowId, seasonNumber, episodeNumber, next);
          if (show?.id) {
            patchEpisodeOverview(show.id, seasonNumber, episodeNumber, next);
          }
        }
      })
      .finally(() => {
        if (active) {
          setLoadingOverview(false);
        }
      });
    return () => {
      active = false;
    };
  }, [canFetch, episodeNumber, seasonNumber, seedOverview, show?.id, traktShowId, visible]);

  const released = isReleased(episode);
  const code = t('common.episodeCode', episodeCode(episode));
  const title = episodeTitle(t, episode) || t('trakt.unavailable');
  const posterPath = episode.posterPath || show?.posterPath;
  const posterUri = episode.poster || show?.poster;
  const canRate = released && watched;
  const rateLabel = rating != null ? t('common.ratingValue', { rating }) : t('rating.rate');
  const synopsis = normalizeEpisodeOverview(overview);
  const synopsisText = loadingOverview
    ? t('trakt.loading')
    : synopsis || t('tv.noEpisodeOverview');

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
            <Text style={styles.body}>{synopsisText}</Text>
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
