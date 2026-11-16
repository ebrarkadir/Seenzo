import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import MoviePeopleSections from '../people/MoviePeopleSections';
import PosterThumb from '../ui/PosterThumb';
import RateChip from '../ui/RateChip';
import RatingSheet from '../ui/RatingSheet';
import { mediaSynopsis, mediaTitle } from '../../data/labels';
import { resolveMovie, useMediaRevision } from '../../data/mediaLibrary';
import { parseTraktMovieKey } from '../../services/trakt/normalize';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

export default function MovieDetailSheet({
  visible,
  movieId,
  onClose,
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const revision = useMediaRevision();
  const { movies, setMovieRating } = useTracking();
  const [ratingOpen, setRatingOpen] = useState(false);
  const [draft, setDraft] = useState(null);

  const closeSheet = () => {
    setRatingOpen(false);
    setDraft(null);
    onClose();
  };

  const movie = movieId && revision >= 0 ? resolveMovie(movieId) : null;
  const entry = movieId ? movies[movieId] : null;
  const watched = Boolean(entry?.watched);
  const movieRating = entry?.rating ?? null;
  const traktId = movie ? (parseTraktMovieKey(movie.id) || movie.traktId || null) : null;
  const genreLine = movie?.genreKey
    ? `${movie.year || t('trakt.unavailable')} · ${t(movie.genreKey)}`
    : [movie?.year, movie?.genres?.join(', ')].filter(Boolean).join(' · ') || t('trakt.unavailable');

  if (!movieId) {
    return null;
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={closeSheet}>
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('movies.closeMovie')}
            style={styles.dismiss}
            onPress={closeSheet}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderSpacer} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('movies.closeMovie')}
                onPress={closeSheet}
                hitSlop={8}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              {movie ? (
                <>
                  <View style={styles.header}>
                    <PosterThumb
                      uri={movie.poster}
                      posterPath={movie.posterPath}
                      width={84}
                      height={126}
                      status={watched ? 'completed' : entry?.saved ? 'plan' : null}
                    />
                    <View style={styles.headerCopy}>
                      <Text style={styles.title}>{mediaTitle(t, movie)}</Text>
                      <Text style={styles.meta}>{genreLine}</Text>
                      <Text style={styles.meta}>
                        {watched ? t('movies.watched') : entry?.saved ? t('movies.toWatch') : t('movies.notSaved')}
                      </Text>
                      <View style={styles.rateRow}>
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
                        {movieRating == null ? (
                          <Text style={styles.meta}>{t('rating.none')}</Text>
                        ) : null}
                      </View>
                      {!watched ? (
                        <Text style={styles.meta}>{t('rating.watchToRateMovie')}</Text>
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.section}>{t('trakt.overview')}</Text>
                  <Text style={styles.body}>{mediaSynopsis(t, movie) || t('trakt.unavailable')}</Text>
                  <MoviePeopleSections traktMovieId={traktId} watched={watched} compact />
                </>
              ) : (
                <Text style={styles.body}>{t('movies.notFound')}</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <RatingSheet
        visible={ratingOpen && watched && Boolean(movie)}
        title={t('rating.movie')}
        mediaTitle={movie?.title}
        value={draft}
        savedValue={movieRating}
        onChange={setDraft}
        onClose={() => setRatingOpen(false)}
        onSave={() => {
          if (!movie || !watched || draft == null) {
            return;
          }
          setMovieRating(movie.id, draft);
          setRatingOpen(false);
        }}
        onRemove={() => {
          if (!movie || !watched) {
            return;
          }
          setMovieRating(movie.id, null);
          setRatingOpen(false);
        }}
      />
    </>
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
