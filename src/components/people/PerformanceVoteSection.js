import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import { useAuth } from '../../auth/AuthContext';
import {
  castPerformanceVote,
  clearPerformanceVote,
  emptyVoteStats,
  fetchPerformanceVoteStats,
  isVotesSetupUnavailable,
  rankPerformanceVotes,
} from '../../services/supabase/performanceVotes';
import { colors, radii, spacing, typography } from '../../theme';
import PrimaryButton from '../ui/PrimaryButton';
import PersonAvatar from './PersonAvatar';

export default function PerformanceVoteSection(props) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PerformanceVoteBody
      key={`${props.traktShowId}-${props.seasonNumber}-${props.episodeNumber}-${attempt}`}
      {...props}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function PerformanceVoteBody({
  traktShowId,
  seasonNumber,
  episodeNumber,
  candidates,
  watched = false,
  onRetry,
}) {
  const { t } = useTranslation();
  const { session, ready } = useAuth();
  const [stats, setStats] = useState(emptyVoteStats());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [setupUnavailable, setSetupUnavailable] = useState(false);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    let active = true;
    fetchPerformanceVoteStats(traktShowId, seasonNumber, episodeNumber)
      .then((next) => {
        if (!active) {
          return;
        }
        setStats(next);
        setError(null);
        setSetupUnavailable(false);
        setLoading(false);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }
        const unavailable = isVotesSetupUnavailable(requestError);
        setSetupUnavailable(unavailable);
        setError(unavailable ? null : requestError);
        setStats(emptyVoteStats());
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [episodeNumber, ready, seasonNumber, traktShowId]);

  const ranked = useMemo(
    () => rankPerformanceVotes(candidates, setupUnavailable ? emptyVoteStats() : stats),
    [candidates, setupUnavailable, stats]
  );

  const vote = async (personId) => {
    if (setupUnavailable) {
      return;
    }
    if (!session?.user?.id) {
      router.push('/sign-in');
      return;
    }
    if (!watched) {
      return;
    }
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const selected = stats.myPersonId === personId;
      const next = selected
        ? await clearPerformanceVote({
          showTraktId: traktShowId,
          seasonNumber,
          episodeNumber,
        })
        : await castPerformanceVote({
          showTraktId: traktShowId,
          seasonNumber,
          episodeNumber,
          personTraktId: personId,
        });
      setStats(next);
      setSetupUnavailable(false);
    } catch (requestError) {
      if (isVotesSetupUnavailable(requestError)) {
        setSetupUnavailable(true);
        setError(null);
      } else if (requestError?.code === 'episode_not_watched') {
        setError(requestError);
      } else {
        setError(requestError);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>{t('people.performanceTitle')}</Text>
      <Text style={styles.meta}>{t('people.performancePrompt')}</Text>

      {setupUnavailable ? (
        <Text style={styles.banner}>{t('people.votesUnavailable')}</Text>
      ) : null}

      {!session ? (
        <PrimaryButton
          label={t('people.signInToVote')}
          variant="secondary"
          onPress={() => router.push('/sign-in')}
        />
      ) : null}

      {session && !watched ? (
        <Text style={styles.banner}>{t('people.watchToVote')}</Text>
      ) : null}

      {loading ? <Text style={styles.meta}>{t('people.votesLoading')}</Text> : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.meta}>
            {error.code === 'episode_not_watched'
              ? t('people.watchToVote')
              : error.code === 'actor_not_in_episode'
                ? t('people.actorNotEligible')
                : t('people.votesError')}
          </Text>
          {error.code === 'episode_not_watched' || error.code === 'actor_not_in_episode' ? null : (
            <PrimaryButton label={t('people.retry')} variant="secondary" onPress={onRetry} />
          )}
        </View>
      ) : null}

      {!loading && !error && !setupUnavailable && stats.totalVotes === 0 && candidates.length ? (
        <Text style={styles.meta}>{t('people.beFirstToVote')}</Text>
      ) : null}

      {!candidates.length ? (
        <Text style={styles.meta}>{t('people.performanceNoCandidates')}</Text>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cards}
          >
            {ranked.map((person) => {
              const canInteract = Boolean(session) && watched && !setupUnavailable && !saving;
              return (
                <Pressable
                  key={`vote-card-${person.personId}`}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: person.selected,
                    disabled: !canInteract && !session,
                  }}
                  disabled={saving || setupUnavailable || (!!session && !watched)}
                  onPress={() => vote(person.personId)}
                  style={[styles.card, person.selected && styles.cardSelected]}
                >
                  <PersonAvatar headshotPath={person.headshotPath} size={64} />
                  <Text style={styles.name} numberOfLines={2}>{person.name}</Text>
                  <Text style={styles.role} numberOfLines={2}>
                    {person.characters.join(', ') || t('people.unknownRole')}
                  </Text>
                  {person.isGuest ? (
                    <Text style={styles.guest}>{t('people.guestBadge')}</Text>
                  ) : null}
                  {!setupUnavailable && stats.totalVotes > 0 ? (
                    <Text style={styles.meta}>
                      {t('people.voteStats', { percent: person.percent, count: person.voteCount })}
                    </Text>
                  ) : null}
                  {person.selected ? (
                    <Text style={styles.selectedLabel}>{t('people.yourVote')}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {!setupUnavailable && stats.totalVotes > 0 ? (
            <View style={styles.rankList}>
              {ranked.map((person) => (
                <View key={`rank-${person.personId}`} style={styles.rankRow}>
                  <View style={styles.rankCopy}>
                    <Text style={styles.name} numberOfLines={1}>{person.name}</Text>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${person.percent}%` }]} />
                    </View>
                  </View>
                  <Text style={styles.meta}>
                    {t('people.voteStats', { percent: person.percent, count: person.voteCount })}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {session && watched && stats.myPersonId && !setupUnavailable ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => vote(stats.myPersonId)}
            >
              <Text style={styles.link}>{t('people.removeVote')}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  heading: {
    ...typography.subtitle,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  banner: {
    ...typography.caption,
    color: colors.primary,
  },
  errorBox: {
    gap: spacing.sm,
  },
  cards: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  card: {
    width: 96,
    gap: 4,
    padding: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  cardSelected: {
    borderColor: colors.primary,
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
  selectedLabel: {
    ...typography.caption,
    color: colors.primary,
  },
  rankList: {
    gap: spacing.xs,
  },
  rankRow: {
    gap: 4,
  },
  rankCopy: {
    gap: 4,
  },
  track: {
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  link: {
    ...typography.label,
    color: colors.primary,
  },
});
