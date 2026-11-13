import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import PrimaryButton from '../components/ui/PrimaryButton';
import SearchField from '../components/ui/SearchField';
import SegmentedControl from '../components/ui/SegmentedControl';
import { colors, radii, spacing, typography } from '../theme';
import { getTraktConfigStatus } from '../services/trakt/config';
import {
  movieDetails,
  searchMovies,
  searchShows,
  seasonEpisodes,
  showDetails,
  showSeasons,
  trendingMovies,
  trendingShows,
} from '../services/trakt/client';

export default function TraktTestScreen() {
  const { t } = useTranslation();
  const config = getTraktConfigStatus();
  const [kind, setKind] = useState('movie');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [results, setResults] = useState(null);
  const [detail, setDetail] = useState(null);
  const [seasons, setSeasons] = useState(null);
  const [episodes, setEpisodes] = useState(null);
  const [seasonNumber, setSeasonNumber] = useState(null);

  const run = async (task) => {
    if (!config.ready) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  };

  const search = () => {
    const text = query.trim();
    if (!text) {
      setNotice(t('trakt.emptyQuery'));
      setResults([]);
      return;
    }
    run(async () => {
      const items = kind === 'movie' ? await searchMovies(text) : await searchShows(text);
      setDetail(null);
      setSeasons(null);
      setEpisodes(null);
      setResults(items);
    });
  };

  const openItem = (item) => {
    run(async () => {
      const next = kind === 'movie' ? await movieDetails(item.id) : await showDetails(item.id);
      setDetail({ ...next, type: kind });
      setSeasons(null);
      setEpisodes(null);
      setSeasonNumber(null);
    });
  };

  const loadSeasons = () => {
    if (!detail || detail.type !== 'show') {
      return;
    }
    run(async () => {
      setSeasons(await showSeasons(detail.id));
      setEpisodes(null);
      setSeasonNumber(null);
    });
  };

  const loadEpisodes = (number) => {
    if (!detail) {
      return;
    }
    run(async () => {
      setSeasonNumber(number);
      setEpisodes(await seasonEpisodes(detail.id, number));
    });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.banner, config.ready ? styles.bannerReady : styles.bannerBlocked]}>
        <Text style={styles.bannerTitle}>
          {config.ready ? t('trakt.configured') : t('trakt.notConfigured')}
        </Text>
        {config.ready ? null : <Text style={styles.bannerBody}>{t(`trakt.errors.${config.reason}`)}</Text>}
      </View>
      <SearchField value={query} onChangeText={setQuery} placeholder={t('trakt.searchPlaceholder')} />
      <SegmentedControl
        value={kind}
        onChange={(value) => {
          setKind(value);
          setResults(null);
          setDetail(null);
          setSeasons(null);
          setEpisodes(null);
        }}
        options={[
          { value: 'movie', label: t('trakt.movies') },
          { value: 'show', label: t('trakt.shows') },
        ]}
      />
      <PrimaryButton label={t('trakt.search')} onPress={search} disabled={!config.ready || loading} />
      <View style={styles.row}>
        <PrimaryButton
          label={t('trakt.trendingMovies')}
          variant="secondary"
          style={styles.flex}
          disabled={!config.ready || loading}
          onPress={() => {
            setKind('movie');
            run(async () => {
              setDetail(null);
              setSeasons(null);
              setEpisodes(null);
              setResults(await trendingMovies());
            });
          }}
        />
        <PrimaryButton
          label={t('trakt.trendingShows')}
          variant="secondary"
          style={styles.flex}
          disabled={!config.ready || loading}
          onPress={() => {
            setKind('show');
            run(async () => {
              setDetail(null);
              setSeasons(null);
              setEpisodes(null);
              setResults(await trendingShows());
            });
          }}
        />
      </View>
      {loading ? <Text style={styles.note}>{t('trakt.loading')}</Text> : null}
      {notice ? <Text style={styles.note}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{errorText(t, error)}</Text> : null}
      {detail ? (
        <DetailCard
          item={detail}
          onBack={() => setDetail(null)}
          onSeasons={loadSeasons}
          seasons={seasons}
          episodes={episodes}
          seasonNumber={seasonNumber}
          onEpisodes={loadEpisodes}
        />
      ) : null}
      {results && results.length === 0 ? <Text style={styles.note}>{t('trakt.emptyResults')}</Text> : null}
      {results?.map((item) => (
        <Pressable key={String(item.id)} accessibilityRole="button" onPress={() => openItem(item)} style={styles.card}>
          <Text style={styles.cardTitle}>{item.title || t('trakt.unavailable')}</Text>
          <Text style={styles.meta}>{item.year ?? t('trakt.unavailable')}</Text>
          {item.watchers != null ? <Text style={styles.meta}>{t('trakt.watchers', { count: item.watchers })}</Text> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function DetailCard({ item, onBack, onSeasons, seasons, episodes, seasonNumber, onEpisodes }) {
  const { t } = useTranslation();
  return (
    <View style={styles.detail}>
      <Text style={styles.section}>{t('trakt.details')}</Text>
      <Field label={t('trakt.year')} value={item.year ?? t('trakt.unavailable')} />
      <Field label={t('trakt.status')} value={item.status || t('trakt.unavailable')} />
      <Field label={t('trakt.released')} value={item.released || t('trakt.unavailable')} />
      <Field
        label={t('trakt.rating')}
        value={
          item.rating == null
            ? t('trakt.unavailable')
            : item.votes == null
              ? t('trakt.ratingOnly', { rating: item.rating })
              : t('trakt.ratingValue', { rating: item.rating, votes: item.votes })
        }
      />
      <Field
        label={t('trakt.runtime')}
        value={item.runtime == null ? t('trakt.unavailable') : t('trakt.runtimeValue', { count: item.runtime })}
      />
      <Field label={t('trakt.network')} value={item.network || t('trakt.unavailable')} />
      <Field label={t('trakt.genres')} value={item.genres.length ? item.genres.join(', ') : t('trakt.unavailable')} />
      <Text style={styles.label}>{t('trakt.overview')}</Text>
      <Text style={styles.body}>{item.overview || t('trakt.unavailable')}</Text>
      <Text style={styles.label}>{t('trakt.ids')}</Text>
      <Text style={styles.body}>{formatIds(item.ids) || t('trakt.unavailable')}</Text>
      <Text style={styles.label}>{t('trakt.images')}</Text>
      <Text style={styles.body}>{formatImages(t, item.images)}</Text>
      <Text style={styles.note}>{t('trakt.imagesHidden')}</Text>
      {item.type === 'show' ? (
        <PrimaryButton label={t('trakt.loadSeasons')} variant="secondary" onPress={onSeasons} />
      ) : null}
      {seasons?.map((season) => (
        <Pressable
          key={season.number}
          accessibilityRole="button"
          onPress={() => onEpisodes(season.number)}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>
            {season.number === 0 ? t('trakt.specials') : t('trakt.seasonNumber', { number: season.number })}
          </Text>
          <Text style={styles.meta}>
            {season.episodeCount == null ? t('trakt.unavailable') : t('trakt.episodeCount', { count: season.episodeCount })}
          </Text>
          <Text style={styles.meta}>{season.firstAired || t('trakt.unavailable')}</Text>
        </Pressable>
      ))}
      {seasonNumber != null ? (
        <Text style={styles.section}>
          {t('trakt.episodes')} · {t('trakt.seasonNumber', { number: seasonNumber })}
        </Text>
      ) : null}
      {episodes?.length === 0 ? <Text style={styles.note}>{t('trakt.emptyResults')}</Text> : null}
      {episodes?.map((episode) => (
        <View key={`${episode.season}-${episode.number}`} style={styles.card}>
          <Text style={styles.cardTitle}>
            {t('trakt.episodeCode', {
              season: String(episode.season ?? seasonNumber).padStart(2, '0'),
              episode: String(episode.number).padStart(2, '0'),
            })}
            {' · '}
            {episode.title || t('trakt.unavailable')}
          </Text>
          <Text style={styles.meta}>{episode.firstAired || t('trakt.unavailable')}</Text>
          <Text style={styles.body}>{episode.overview || t('trakt.unavailable')}</Text>
        </View>
      ))}
      <PrimaryButton label={t('trakt.backToResults')} variant="secondary" onPress={onBack} />
    </View>
  );
}

function Field({ label, value }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{String(value)}</Text>
    </View>
  );
}

function formatIds(ids) {
  if (!ids) {
    return '';
  }
  return ['trakt', 'slug', 'imdb', 'tmdb', 'tvdb']
    .filter((key) => ids[key] != null)
    .map((key) => `${key} ${ids[key]}`)
    .join('\n');
}

function formatImages(t, images) {
  if (!images || Object.keys(images).length === 0) {
    return t('trakt.unavailable');
  }
  return Object.entries(images)
    .map(([type, count]) => t('trakt.imageCount', { type, count }))
    .join('\n');
}

function errorText(t, error) {
  if (error?.code === 'rateLimit' && error.retryAfter != null) {
    return t('trakt.errors.rateLimitWait', { seconds: error.retryAfter });
  }
  const known = [
    'missing',
    'placeholder',
    'unauthorized',
    'forbidden',
    'notFound',
    'rateLimit',
    'timeout',
    'network',
    'invalid',
  ];
  if (known.includes(error?.code)) {
    return t(`trakt.errors.${error.code}`);
  }
  if (error?.code === 'http') {
    return t('trakt.errors.http', { status: error.status ?? '' });
  }
  return t('trakt.errors.unknown');
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  banner: {
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.xs,
  },
  bannerReady: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  bannerBlocked: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.favorite,
  },
  bannerTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  bannerBody: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  error: {
    ...typography.body,
    color: colors.favorite,
  },
  card: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  cardTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  detail: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  section: {
    ...typography.subtitle,
    color: colors.text,
  },
  field: {
    gap: 2,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
});
