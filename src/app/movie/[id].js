import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../../components/ui/PosterThumb';
import PrimaryButton from '../../components/ui/PrimaryButton';
import RatingSheet from '../../components/ui/RatingSheet';
import { mediaSynopsis, mediaTitle } from '../../data/labels';
import { rememberMovie, resolveMovie, useMediaRevision } from '../../data/mediaLibrary';
import { hydrateMovie } from '../../services/trakt/catalog';
import { parseTraktMovieKey } from '../../services/trakt/normalize';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams();
  const movieId = Array.isArray(id) ? id[0] : id;
  const revision = useMediaRevision();
  const movie = resolveMovie(movieId);
  const traktId = parseTraktMovieKey(movieId);
  const [remoteLoading, setRemoteLoading] = useState(Boolean(traktId) && !movie);
  const [remoteError, setRemoteError] = useState(null);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { movies, saveMovie, toggleMovieWatchlist, setMovieRating } = useTracking();
  const entry = movies[movieId];
  const movieRating = entry?.rating ?? null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    navigation.setOptions({ title: movie ? mediaTitle(t, movie) : t('movies.notFound') });
  }, [movie, navigation, revision, t]);

  useEffect(() => {
    if (!traktId || resolveMovie(movieId)) {
      return undefined;
    }
    let active = true;
    hydrateMovie(traktId)
      .then((record) => {
        if (!active) {
          return;
        }
        if (record) {
          rememberMovie(record);
        } else {
          setRemoteError({ code: 'invalid' });
        }
      })
      .catch((requestError) => {
        if (active) {
          setRemoteError(requestError);
        }
      })
      .finally(() => {
        if (active) {
          setRemoteLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [movieId, traktId]);

  if (!movie) {
    if (remoteLoading) {
      return (
        <View style={styles.missing}>
          <Text style={styles.body}>{t('trakt.loading')}</Text>
        </View>
      );
    }
    if (remoteError) {
      return (
        <View style={styles.missing}>
          <Text style={styles.body}>{t(`trakt.errors.${remoteError.code || 'unknown'}`, { status: remoteError.status ?? '' })}</Text>
        </View>
      );
    }
    return (
      <View style={styles.missing}>
        <Text style={styles.body}>{t('movies.notFound')}</Text>
      </View>
    );
  }

  const saved = Boolean(entry?.saved);
  const watched = Boolean(entry?.watched);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <PosterThumb uri={movie.poster} posterPath={movie.posterPath} width={96} height={144} status={watched ? 'completed' : saved ? 'plan' : null} />
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{mediaTitle(t, movie)}</Text>
          <Text style={styles.meta}>
            {movie.genreKey
              ? `${movie.year} · ${t(movie.genreKey)}`
              : [movie.year, movie.genres?.join(', ')].filter(Boolean).join(' · ') || t('trakt.unavailable')}
          </Text>
          {movie.runtime ? <Text style={styles.meta}>{t('common.minutes', { count: movie.runtime })}</Text> : null}
          {movie.communityRating == null ? null : (
            <Text style={styles.meta}>{t('trakt.communityRating', { rating: movie.communityRating })}</Text>
          )}
          <Text style={styles.meta}>{watched ? t('movies.watched') : saved ? t('movies.toWatch') : t('movies.notSaved')}</Text>
        </View>
      </View>
      <Text style={styles.body}>{mediaSynopsis(t, movie) || t('trakt.unavailable')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setDraft(movieRating);
          setOpen(true);
        }}
        style={styles.rateRow}
      >
        <Text style={styles.rateLabel}>{t('rating.movie')}</Text>
        <Text style={styles.rateValue}>
          {movieRating ? t('common.ratingValue', { rating: movieRating }) : t('rating.none')}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        {watched ? (
          <PrimaryButton
            label={t('movies.markUnwatched')}
            onPress={() => saveMovie(movie.id, { watched: false, saved: true })}
          />
        ) : (
          <PrimaryButton
            label={t('movies.markWatched')}
            onPress={() => saveMovie(movie.id, { watched: true, saved: true })}
          />
        )}
        {saved && !watched ? (
          <PrimaryButton label={t('movies.removeFromWatchlist')} variant="secondary" onPress={() => toggleMovieWatchlist(movie.id)} />
        ) : null}
        {!saved && !watched ? (
          <PrimaryButton
            label={t('movies.addToWatchlist')}
            variant="secondary"
            onPress={() => toggleMovieWatchlist(movie.id)}
          />
        ) : null}
      </View>
      <RatingSheet
        visible={open}
        title={t('rating.movie')}
        value={draft}
        savedValue={movieRating}
        onChange={setDraft}
        onClose={() => setOpen(false)}
        onSave={() => {
          if (draft == null) {
            return;
          }
          setMovieRating(movie.id, draft);
          setOpen(false);
        }}
        onRemove={() => {
          setMovieRating(movie.id, null);
          setOpen(false);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
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
    gap: spacing.sm,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rateLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  rateValue: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
});
