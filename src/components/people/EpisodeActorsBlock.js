import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { collectEpisodeActors, fetchEpisodePeople } from '../../services/trakt/people';
import { colors, spacing, typography } from '../../theme';
import PrimaryButton from '../ui/PrimaryButton';
import PerformanceVoteSection from './PerformanceVoteSection';
import PersonAvatar from './PersonAvatar';

export default function EpisodeActorsBlock({
  traktShowId,
  seasonNumber,
  episodeNumber,
  watched = false,
}) {
  return (
    <EpisodeActorsBody
      key={`${traktShowId}-${seasonNumber}-${episodeNumber}`}
      traktShowId={traktShowId}
      seasonNumber={seasonNumber}
      episodeNumber={episodeNumber}
      watched={watched}
    />
  );
}

function EpisodeActorsBody({ traktShowId, seasonNumber, episodeNumber, watched }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [actors, setActors] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetchEpisodePeople(traktShowId, seasonNumber, episodeNumber)
      .then((people) => {
        if (!active) {
          return;
        }
        setActors(collectEpisodeActors(people));
        setError(null);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }
        setActors(null);
        setError(requestError);
      });
    return () => {
      active = false;
    };
  }, [attempt, episodeNumber, seasonNumber, traktShowId]);

  if (actors == null && !error) {
    return <Text style={styles.meta}>{t('people.loadingEpisodeCast')}</Text>;
  }

  if (error) {
    return (
      <View style={styles.block}>
        <Text style={styles.heading}>{t('people.episodeCast')}</Text>
        <Text style={styles.meta}>{t('people.episodeCastError')}</Text>
        <PrimaryButton
          label={t('people.retry')}
          variant="secondary"
          onPress={() => setAttempt((value) => value + 1)}
        />
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>{t('people.episodeCast')}</Text>
      {!actors.length ? (
        <Text style={styles.meta}>{t('people.episodeCastUnavailable')}</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {actors.map((person) => (
            <View key={`episode-actor-${person.personId}`} style={styles.card}>
              <PersonAvatar headshotPath={person.headshotPath} size={56} />
              <Text style={styles.name} numberOfLines={2}>{person.name}</Text>
              <Text style={styles.role} numberOfLines={2}>
                {person.characters.join(', ') || t('people.unknownRole')}
              </Text>
              {person.isGuest ? (
                <Text style={styles.guest}>{t('people.guestBadge')}</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}

      <PerformanceVoteSection
        traktShowId={traktShowId}
        seasonNumber={seasonNumber}
        episodeNumber={episodeNumber}
        candidates={actors}
        watched={watched}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
  },
  heading: {
    ...typography.subtitle,
    color: colors.text,
  },
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  card: {
    width: 88,
    gap: 4,
  },
  name: {
    ...typography.label,
    color: colors.text,
  },
  role: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  guest: {
    ...typography.caption,
    color: colors.primary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
