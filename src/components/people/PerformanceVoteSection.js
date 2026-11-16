import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import { useAuth } from '../../auth/AuthContext';
import {
  castMoviePerformanceVote,
  clearMoviePerformanceVote,
  emptyVoteStats as emptyMovieVoteStats,
  fetchMoviePerformanceVoteStats,
  isMovieVotesSetupUnavailable,
  rankPerformanceVotes as rankMovieVotes,
} from '../../services/supabase/moviePerformanceVotes';
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
import {
  PERFORMANCE_CARD_GAP,
  PERFORMANCE_CARD_WIDTH,
  findPerformanceActorIndex,
  performanceCardLayout,
  shouldScrollToVotedActor,
} from './performanceVoteCarousel';

export default function PerformanceVoteSection(props) {
  const mode = props.mode === 'movie' ? 'movie' : 'episode';
  const [attempt, setAttempt] = useState(0);
  const scopeKey = mode === 'movie'
    ? `movie-${props.traktMovieId}`
    : `${props.traktShowId}-${props.seasonNumber}-${props.episodeNumber}`;
  return (
    <PerformanceVoteBody
      key={`${scopeKey}-${attempt}`}
      {...props}
      mode={mode}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function PerformanceVoteBody({
  mode = 'episode',
  traktShowId,
  seasonNumber,
  episodeNumber,
  traktMovieId,
  candidates,
  watched = false,
  onRetry,
}) {
  const { t } = useTranslation();
  const { session, ready } = useAuth();
  const isMovie = mode === 'movie';
  const [stats, setStats] = useState(isMovie ? emptyMovieVoteStats() : emptyVoteStats());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingPersonId, setPendingPersonId] = useState(null);
  const [error, setError] = useState(null);
  const [setupUnavailable, setSetupUnavailable] = useState(false);
  const requestSeq = useRef(0);
  const loadSeq = useRef(0);
  const listRef = useRef(null);
  const pendingScrollPersonId = useRef(null);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    const load = isMovie
      ? fetchMoviePerformanceVoteStats(traktMovieId)
      : fetchPerformanceVoteStats(traktShowId, seasonNumber, episodeNumber);
    load
      .then((next) => {
        if (loadSeq.current !== seq) {
          return;
        }
        setStats(next);
        setError(null);
        setSetupUnavailable(false);
        setLoading(false);
      })
      .catch((requestError) => {
        if (loadSeq.current !== seq) {
          return;
        }
        const unavailable = isMovie
          ? isMovieVotesSetupUnavailable(requestError)
          : isVotesSetupUnavailable(requestError);
        setSetupUnavailable(unavailable);
        setError(unavailable ? null : requestError);
        setStats(isMovie ? emptyMovieVoteStats() : emptyVoteStats());
        setLoading(false);
      });
    return undefined;
  }, [episodeNumber, isMovie, ready, seasonNumber, traktMovieId, traktShowId]);

  const confirmedRanked = useMemo(() => {
    const ranking = isMovie ? rankMovieVotes : rankPerformanceVotes;
    const fallback = isMovie ? emptyMovieVoteStats() : emptyVoteStats();
    return ranking(candidates, setupUnavailable ? fallback : stats);
  }, [candidates, isMovie, setupUnavailable, stats]);

  const ranked = useMemo(
    () => confirmedRanked.map((person) => ({
      ...person,
      pendingSelected: pendingPersonId != null && pendingPersonId === person.personId,
      confirmedSelected: person.selected,
      selected: pendingPersonId != null
        ? pendingPersonId === person.personId
        : person.selected,
    })),
    [confirmedRanked, pendingPersonId]
  );

  useLayoutEffect(() => {
    const targetId = pendingScrollPersonId.current;
    if (targetId == null || saving || loading) {
      return undefined;
    }
    const index = findPerformanceActorIndex(ranked, targetId);
    if (index < 0) {
      pendingScrollPersonId.current = null;
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      if (pendingScrollPersonId.current !== targetId || !listRef.current) {
        return;
      }
      pendingScrollPersonId.current = null;
      try {
        listRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0,
        });
      } catch {
        listRef.current.scrollToOffset({
          offset: performanceCardLayout(index).offset,
          animated: true,
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, ranked, saving, stats]);

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

    const clearing = stats.myPersonId === personId;
    const nextPending = clearing ? null : personId;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const previousStats = stats;

    pendingScrollPersonId.current = null;
    setPendingPersonId(nextPending);
    setSaving(true);
    setError(null);

    try {
      const next = clearing
        ? (isMovie
          ? await clearMoviePerformanceVote({ movieTraktId: traktMovieId })
          : await clearPerformanceVote({
            showTraktId: traktShowId,
            seasonNumber,
            episodeNumber,
          }))
        : (isMovie
          ? await castMoviePerformanceVote({
            movieTraktId: traktMovieId,
            personTraktId: personId,
          })
          : await castPerformanceVote({
            showTraktId: traktShowId,
            seasonNumber,
            episodeNumber,
            personTraktId: personId,
          }));
      if (requestSeq.current !== seq) {
        return;
      }
      if (shouldScrollToVotedActor({
        clearing,
        personId,
        requestCurrent: requestSeq.current,
        requestSeq: seq,
      })) {
        pendingScrollPersonId.current = personId;
      }
      setStats(next);
      setPendingPersonId(null);
      setSetupUnavailable(false);
    } catch (requestError) {
      if (requestSeq.current !== seq) {
        return;
      }
      pendingScrollPersonId.current = null;
      setPendingPersonId(null);
      setStats(previousStats);
      const unavailable = isMovie
        ? isMovieVotesSetupUnavailable(requestError)
        : isVotesSetupUnavailable(requestError);
      if (unavailable) {
        setSetupUnavailable(true);
        setError(null);
      } else {
        setError(requestError);
      }
    } finally {
      if (requestSeq.current === seq) {
        setSaving(false);
      }
    }
  };

  const promptKey = isMovie ? 'people.performancePromptMovie' : 'people.performancePrompt';
  const watchToVoteKey = isMovie ? 'people.watchToVoteMovie' : 'people.watchToVote';
  const unavailableKey = isMovie ? 'people.votesUnavailableMovie' : 'people.votesUnavailable';
  const noCandidatesKey = isMovie ? 'people.performanceNoCandidatesMovie' : 'people.performanceNoCandidates';
  const actorErrorKey = isMovie ? 'people.actorNotEligibleMovie' : 'people.actorNotEligible';
  const notWatchedCode = isMovie ? 'movie_not_watched' : 'episode_not_watched';
  const actorCode = isMovie ? 'actor_not_in_movie' : 'actor_not_in_episode';

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>{t('people.performanceTitle')}</Text>
      <Text style={styles.meta}>{t(promptKey)}</Text>

      {setupUnavailable ? (
        <Text style={styles.banner}>{t(unavailableKey)}</Text>
      ) : null}

      {!session ? (
        <PrimaryButton
          label={t('people.signInToVote')}
          variant="secondary"
          onPress={() => router.push('/sign-in')}
        />
      ) : null}

      {session && !watched ? (
        <Text style={styles.banner}>{t(watchToVoteKey)}</Text>
      ) : null}

      {loading ? <Text style={styles.meta}>{t('people.votesLoading')}</Text> : null}
      {saving ? <Text style={styles.banner}>{t('people.voteSaving')}</Text> : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.meta}>
            {error.code === notWatchedCode
              ? t(watchToVoteKey)
              : error.code === actorCode
                ? t(actorErrorKey)
                : t('people.votesError')}
          </Text>
          {error.code === notWatchedCode || error.code === actorCode ? null : (
            <PrimaryButton label={t('people.retry')} variant="secondary" onPress={onRetry} />
          )}
        </View>
      ) : null}

      {!loading && !error && !setupUnavailable && !saving && stats.totalVotes === 0 && candidates.length ? (
        <Text style={styles.meta}>{t('people.beFirstToVote')}</Text>
      ) : null}

      {!candidates.length ? (
        <Text style={styles.meta}>{t(noCandidatesKey)}</Text>
      ) : (
        <>
          <FlatList
            ref={listRef}
            horizontal
            data={ranked}
            keyExtractor={(person) => `vote-card-${person.personId}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cards}
            ItemSeparatorComponent={CardGap}
            getItemLayout={(_, index) => performanceCardLayout(index)}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: performanceCardLayout(info.index).offset,
                animated: true,
              });
            }}
            renderItem={({ item: person }) => {
              const canInteract = Boolean(session) && watched && !setupUnavailable && !saving;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: person.selected,
                    disabled: !canInteract && !session,
                  }}
                  disabled={saving || setupUnavailable || (!!session && !watched)}
                  onPress={() => vote(person.personId)}
                  style={[
                    styles.card,
                    person.selected && styles.cardSelected,
                    person.pendingSelected && styles.cardPending,
                  ]}
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
                  {person.confirmedSelected && !saving ? (
                    <Text style={styles.selectedLabel}>{t('people.yourVote')}</Text>
                  ) : null}
                  {person.pendingSelected ? (
                    <Text style={styles.selectedLabel}>{t('people.voteSaving')}</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />

          {session && watched && (pendingPersonId != null || stats.myPersonId) && !setupUnavailable ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => vote(pendingPersonId != null ? pendingPersonId : stats.myPersonId)}
            >
              <Text style={styles.link}>{t('people.removeVote')}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

function CardGap() {
  return <View style={styles.cardGap} />;
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
    paddingVertical: spacing.xs,
  },
  cardGap: {
    width: PERFORMANCE_CARD_GAP,
  },
  card: {
    width: PERFORMANCE_CARD_WIDTH,
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
  cardPending: {
    opacity: 0.85,
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
  link: {
    ...typography.label,
    color: colors.primary,
  },
});
