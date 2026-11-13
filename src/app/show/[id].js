import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useUndoTimer } from '../../tracking/useUndoTimer';
import PosterThumb from '../../components/ui/PosterThumb';
import PrimaryButton from '../../components/ui/PrimaryButton';
import RatingPicker from '../../components/ui/RatingPicker';
import StatusBadge from '../../components/ui/StatusBadge';
import UndoBar from '../../components/tracking/UndoBar';
import { getShow } from '../../data/catalog';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import {
  deriveShowStatus,
  episodeCode,
  getProgress,
  isReleased,
} from '../../tracking/status';

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams();
  const showId = Array.isArray(id) ? id[0] : id;
  const show = getShow(showId);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const {
    shows,
    undo,
    toggleEpisode,
    setShowIntent,
    removeShow,
    setShowRating,
  } = useTracking();
  useUndoTimer();
  const entry = shows[showId];
  const [season, setSeason] = useState(show?.seasons[0]?.season || 1);

  useEffect(() => {
    navigation.setOptions({ title: show ? t(show.titleKey) : t('tv.notFound') });
  }, [navigation, show, t]);

  if (!show) {
    return (
      <View style={styles.missing}>
        <Text style={styles.body}>{t('tv.notFound')}</Text>
      </View>
    );
  }

  const status = entry ? deriveShowStatus(show, entry) : null;
  const progress = getProgress(show, entry);
  const seasonBlock = show.seasons.find((item) => item.season === season) || show.seasons[0];
  const watched = new Set(entry?.watchedEpisodeIds || []);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: undo ? 120 : spacing.xl, gap: spacing.md }}>
        <View style={styles.header}>
          <PosterThumb uri={show.poster} width={96} height={144} status={status} />
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{t(show.titleKey)}</Text>
            <Text style={styles.meta}>{t(`tv.release.${show.releaseStatus}`)}</Text>
            {status ? <StatusBadge status={status} /> : <Text style={styles.meta}>{t('tv.notTracking')}</Text>}
            <Text style={styles.meta}>
              {progress.total
                ? t('tv.progress', progress)
                : t('tv.noReleased')}
            </Text>
          </View>
        </View>
        <Text style={styles.body}>{t(show.synopsisKey)}</Text>
        {entry ? (
          <RatingPicker value={entry.rating} onChange={(rating) => setShowRating(show.id, rating)} />
        ) : null}
        <View style={styles.actions}>
          <PrimaryButton
            label={t('tv.status.plan')}
            variant={entry?.intent === 'plan' ? 'primary' : 'secondary'}
            onPress={() => setShowIntent(show.id, 'plan')}
            style={styles.action}
          />
          <PrimaryButton
            label={t('tv.status.watching')}
            variant={entry?.intent === 'watching' ? 'primary' : 'secondary'}
            onPress={() => setShowIntent(show.id, 'watching')}
            style={styles.action}
          />
          <PrimaryButton
            label={t('tv.status.dropped')}
            variant={entry?.intent === 'dropped' ? 'primary' : 'secondary'}
            onPress={() => setShowIntent(show.id, 'dropped')}
            style={styles.action}
          />
        </View>
        {entry ? (
          <PrimaryButton label={t('tv.removeShow')} variant="secondary" onPress={() => removeShow(show.id)} />
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasons}>
          {show.seasons.map((item) => {
            const selected = item.season === seasonBlock.season;
            return (
              <Pressable
                key={item.season}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSeason(item.season)}
                style={[styles.season, selected && styles.seasonSelected]}
              >
                <Text style={[styles.seasonText, selected && styles.seasonTextSelected]}>
                  {t('tv.season', { number: item.season })}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {seasonBlock.episodes.map((episode) => {
          const released = isReleased(episode);
          const isWatched = watched.has(episode.id);
          const code = t('common.episodeCode', episodeCode(episode));
          return (
            <Pressable
              key={episode.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isWatched, disabled: !released }}
              disabled={!released}
              onPress={() => toggleEpisode(show.id, episode.id)}
              style={styles.episode}
            >
              <Ionicons
                name={released ? (isWatched ? 'checkmark-circle' : 'ellipse-outline') : 'lock-closed-outline'}
                size={22}
                color={released ? (isWatched ? colors.primary : colors.textMuted) : colors.textMuted}
              />
              <View style={styles.episodeCopy}>
                <Text style={styles.episodeTitle}>
                  {code} · {t(episode.titleKey)}
                </Text>
                <Text style={styles.meta}>
                  {released
                    ? t('common.minutes', { count: episode.runtime })
                    : t('tv.upcoming', { date: formatAirDate(episode.airDate) })}
                </Text>
              </View>
            </Pressable>
          );
        })}
        <Text style={styles.note}>{t('tv.unreleasedNote')}</Text>
      </ScrollView>
      <UndoBar bottom={16} />
    </View>
  );
}

function formatAirDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
  seasons: {
    gap: spacing.sm,
  },
  season: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  seasonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  seasonText: {
    ...typography.label,
    color: colors.text,
  },
  seasonTextSelected: {
    color: colors.onPrimary,
  },
  episode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  episodeCopy: {
    flex: 1,
    gap: 2,
  },
  episodeTitle: {
    ...typography.body,
    color: colors.text,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
