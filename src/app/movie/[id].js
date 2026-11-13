import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../../components/ui/PosterThumb';
import PrimaryButton from '../../components/ui/PrimaryButton';
import RatingPicker from '../../components/ui/RatingPicker';
import { getMovie } from '../../data/catalog';
import { colors, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams();
  const movieId = Array.isArray(id) ? id[0] : id;
  const movie = getMovie(movieId);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { movies, saveMovie, removeMovie, setMovieRating } = useTracking();
  const entry = movies[movieId];

  useEffect(() => {
    navigation.setOptions({ title: movie ? t(movie.titleKey) : t('movies.notFound') });
  }, [movie, navigation, t]);

  if (!movie) {
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
        <PosterThumb uri={movie.poster} width={96} height={144} status={watched ? 'completed' : saved ? 'plan' : null} />
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{t(movie.titleKey)}</Text>
          <Text style={styles.meta}>{movie.year} · {t(movie.genreKey)}</Text>
          <Text style={styles.meta}>{watched ? t('movies.watched') : saved ? t('movies.toWatch') : t('movies.notSaved')}</Text>
        </View>
      </View>
      <Text style={styles.body}>{t(movie.synopsisKey)}</Text>
      {saved ? <RatingPicker value={entry.rating} onChange={(rating) => setMovieRating(movie.id, rating)} /> : null}
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
          <PrimaryButton label={t('movies.removeFromList')} variant="secondary" onPress={() => removeMovie(movie.id)} />
        ) : null}
        {!saved ? (
          <PrimaryButton
            label={t('discover.addMovie')}
            variant="secondary"
            onPress={() => saveMovie(movie.id, { saved: true, watched: false })}
          />
        ) : null}
      </View>
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
});
