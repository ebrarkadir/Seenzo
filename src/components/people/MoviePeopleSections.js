import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { collectMovieActors, fetchMoviePeople } from '../../services/trakt/people';
import { colors, spacing, typography } from '../../theme';
import PrimaryButton from '../ui/PrimaryButton';
import CastCrewSection from './CastCrewSection';
import MoviePerformanceBlock from './MoviePerformanceBlock';

/** Shared movie people stack: Cast → Best Performance → Crew (one Trakt fetch). */
export default function MoviePeopleSections({ traktMovieId, watched = false, compact = false }) {
  const { t } = useTranslation();

  if (!traktMovieId) {
    return <Text style={styles.meta}>{t('people.unavailableForDemo')}</Text>;
  }

  return (
    <MoviePeopleSectionsBody
      key={String(traktMovieId)}
      traktMovieId={traktMovieId}
      watched={watched}
      compact={compact}
    />
  );
}

function MoviePeopleSectionsBody({ traktMovieId, watched, compact }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetchMoviePeople(traktMovieId)
      .then((data) => {
        if (!active) {
          return;
        }
        setPeople(data);
        setError(null);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }
        setPeople(null);
        setError(requestError);
      });
    return () => {
      active = false;
    };
  }, [attempt, traktMovieId]);

  if (people == null && !error) {
    return <Text style={styles.meta}>{t('people.loading')}</Text>;
  }

  if (error) {
    return (
      <View style={styles.block}>
        <Text style={styles.meta}>{t('people.error')}</Text>
        <PrimaryButton
          label={t('people.retry')}
          variant="secondary"
          onPress={() => setAttempt((value) => value + 1)}
        />
      </View>
    );
  }

  const candidates = collectMovieActors(people);

  return (
    <View style={styles.block}>
      <CastCrewSection
        mode="movie"
        traktMovieId={traktMovieId}
        people={people}
        source="movie"
        parts="cast"
        compact={compact}
      />
      <MoviePerformanceBlock
        traktMovieId={traktMovieId}
        watched={watched}
        candidates={candidates}
      />
      <CastCrewSection
        mode="movie"
        traktMovieId={traktMovieId}
        people={people}
        source="movie"
        parts="crew"
        compact={compact}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.md,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
