import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { collectMovieActors, fetchMoviePeople } from '../../services/trakt/people';
import { colors, spacing, typography } from '../../theme';
import PrimaryButton from '../ui/PrimaryButton';
import PerformanceVoteSection from './PerformanceVoteSection';

export default function MoviePerformanceBlock({
  traktMovieId,
  watched = false,
  candidates = null,
}) {
  return (
    <MoviePerformanceBody
      key={`${traktMovieId}-${candidates ? 'shared' : 'fetch'}`}
      traktMovieId={traktMovieId}
      watched={watched}
      candidates={candidates}
    />
  );
}

function MoviePerformanceBody({ traktMovieId, watched, candidates: candidatesProp }) {
  const { t } = useTranslation();
  const hasCandidates = Array.isArray(candidatesProp);
  const [attempt, setAttempt] = useState(0);
  const [fetchedActors, setFetchedActors] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (hasCandidates) {
      return undefined;
    }
    let active = true;
    fetchMoviePeople(traktMovieId)
      .then((people) => {
        if (!active) {
          return;
        }
        setFetchedActors(collectMovieActors(people));
        setError(null);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }
        setFetchedActors(null);
        setError(requestError);
      });
    return () => {
      active = false;
    };
  }, [attempt, hasCandidates, traktMovieId]);

  const actors = hasCandidates ? candidatesProp : fetchedActors;

  if (actors == null && !error) {
    return <Text style={styles.meta}>{t('people.votesLoading')}</Text>;
  }

  if (!hasCandidates && error) {
    return (
      <View style={styles.block}>
        <Text style={styles.meta}>{t('people.votesError')}</Text>
        <PrimaryButton
          label={t('people.retry')}
          variant="secondary"
          onPress={() => setAttempt((value) => value + 1)}
        />
      </View>
    );
  }

  return (
    <PerformanceVoteSection
      mode="movie"
      traktMovieId={traktMovieId}
      candidates={actors || []}
      watched={watched}
    />
  );
}

const styles = {
  block: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
};
