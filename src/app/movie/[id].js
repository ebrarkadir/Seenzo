import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import MoviePeopleSections from '../../components/people/MoviePeopleSections';
import ShowOverflowMenu from '../../components/tracking/ShowOverflowMenu';
import PosterThumb from '../../components/ui/PosterThumb';
import RateChip from '../../components/ui/RateChip';
import RatingSheet from '../../components/ui/RatingSheet';
import { mediaSynopsis, mediaTitle } from '../../data/labels';
import { rememberMovie, resolveMovie, useMediaRevision } from '../../data/mediaLibrary';
import { hydrateMovie } from '../../services/trakt/catalog';
import { parseTraktMovieKey } from '../../services/trakt/normalize';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

function formatCommunityRating(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(1));
}

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
  const { movies, saveMovie, toggleMovieWatchlist, setMovieRating, removeMovie } = useTracking();
  const entry = movies[movieId];
  const movieRating = entry?.rating ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
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
  const posterStatus = watched ? 'completed' : saved ? 'plan' : null;
  const communityRating = formatCommunityRating(movie.communityRating);
  const genreLine = movie.genreKey
    ? `${movie.year || t('trakt.unavailable')} · ${t(movie.genreKey)}`
    : [movie.year, movie.genres?.join(', ')].filter(Boolean).join(' · ') || t('trakt.unavailable');

  const overflowOptions = [];
  if (!saved && !watched) {
    overflowOptions.push({
      key: 'watchlist-add',
      label: t('movies.addToWatchlist'),
      onPress: () => toggleMovieWatchlist(movie.id),
    });
  }
  if (saved && !watched) {
    overflowOptions.push({
      key: 'watchlist-remove',
      label: t('movies.removeFromWatchlist'),
      onPress: () => toggleMovieWatchlist(movie.id),
    });
  }
  if (watched) {
    overflowOptions.push({
      key: 'unwatched',
      label: t('movies.markUnwatched'),
      onPress: () => saveMovie(movie.id, { watched: false, saved: true }),
    });
  }
  if (entry) {
    overflowOptions.push({
      key: 'remove',
      label: t('movies.removeFromList'),
      destructive: true,
      onPress: () => {
        Alert.alert(t('movies.removeTitle'), t('movies.removeMessage'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.remove'), style: 'destructive', onPress: () => removeMovie(movie.id) },
        ]);
      },
    });
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <PosterThumb
            uri={movie.poster}
            posterPath={movie.posterPath}
            width={96}
            height={144}
            status={posterStatus}
          />
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{mediaTitle(t, movie)}</Text>
            <Text style={styles.meta}>{genreLine}</Text>
            {movie.runtime ? (
              <Text style={styles.meta}>{t('common.minutes', { count: movie.runtime })}</Text>
            ) : null}
            <Text style={styles.meta}>
              {communityRating == null
                ? t('trakt.unavailable')
                : t('trakt.communityRating', { rating: communityRating })}
            </Text>
            <Text style={styles.meta}>
              {watched ? t('movies.watched') : saved ? t('movies.toWatch') : t('movies.notSaved')}
            </Text>
            <View style={styles.headerActions}>
              {watched ? (
                <View style={[styles.markChip, styles.markChipDone]}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.onPrimary} />
                  <Text style={[styles.markText, styles.markTextDone]}>{t('movies.watched')}</Text>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('movies.markWatched')}
                  onPress={() => saveMovie(movie.id, { watched: true, saved: true })}
                  hitSlop={6}
                  style={styles.markChip}
                >
                  <Ionicons name="checkmark" size={16} color={colors.primary} />
                  <Text style={styles.markText}>{t('movies.markWatched')}</Text>
                </Pressable>
              )}
              <RateChip
                label={movieRating != null ? t('common.ratingValue', { rating: movieRating }) : t('rating.rate')}
                accessibilityLabel={t('rating.movie')}
                disabled={!watched}
                onPress={() => {
                  if (!watched) {
                    return;
                  }
                  setDraft(movieRating);
                  setRatingOpen(true);
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('movies.moreActions')}
                onPress={() => setMenuOpen(true)}
                hitSlop={8}
                style={styles.moreButton}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
              </Pressable>
            </View>
            {!watched ? (
              <Text style={styles.meta}>{t('rating.watchToRateMovie')}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.body}>{mediaSynopsis(t, movie) || t('trakt.unavailable')}</Text>
        {remoteLoading ? <Text style={styles.meta}>{t('trakt.loading')}</Text> : null}

        <MoviePeopleSections traktMovieId={traktId} watched={watched} />
      </ScrollView>

      <ShowOverflowMenu
        visible={menuOpen}
        options={overflowOptions}
        onClose={() => setMenuOpen(false)}
      />
      <RatingSheet
        visible={ratingOpen && watched}
        title={t('rating.movie')}
        mediaTitle={movie?.title}
        mediaType="movie"
        mediaId={movie?.id}
        posterPath={movie?.posterPath || null}
        posterUri={movie?.poster || null}
        value={draft}
        savedValue={movieRating}
        onChange={setDraft}
        onClose={() => setRatingOpen(false)}
        onSave={() => {
          if (!watched || draft == null) {
            return;
          }
          setMovieRating(movie.id, draft);
          setRatingOpen(false);
        }}
        onRemove={() => {
          if (!watched) {
            return;
          }
          setMovieRating(movie.id, null);
          setRatingOpen(false);
        }}
      />
    </View>
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
    minWidth: 0,
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  markChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  markChipDone: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  markText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  markTextDone: {
    color: colors.onPrimary,
  },
  moreButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
