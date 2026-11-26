import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../../components/media/PosterGrid';
import { ShowPoster } from '../../components/media/LibraryTiles';
import EmptyState from '../../components/ui/EmptyState';
import RatingSheet from '../../components/ui/RatingSheet';
import SegmentedControl from '../../components/ui/SegmentedControl';
import EpisodeDetailSheet from '../../components/tracking/EpisodeDetailSheet';
import ShowCard from '../../components/tracking/ShowCard';
import UpcomingRow from '../../components/tracking/UpcomingRow';
import UndoBar from '../../components/tracking/UndoBar';
import { episodeTitle, mediaTitle } from '../../data/labels';
import { resolveShow, useMediaRevision } from '../../data/mediaLibrary';
import { colors, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import { useUndoTimer } from '../../tracking/useUndoTimer';
import {
  deriveShowStatus,
  episodeCode,
  getReleasedSuccessor,
  listEpisodes,
  upcomingForShows,
} from '../../tracking/status';

export default function TvShowsScreen() {
  const { t } = useTranslation();
  const {
    shows,
    undo,
    markNextWatched,
    toggleEpisode,
    removeShow,
    setEpisodeRating,
    episodeRatings,
  } = useTracking();
  const revision = useMediaRevision();
  const [segment, setSegment] = useState('watching');
  const [selected, setSelected] = useState(null);
  const [ratingTarget, setRatingTarget] = useState(null);
  const [draft, setDraft] = useState(null);
  useUndoTimer();

  const tracked = useMemo(() => {
    if (revision < 0) {
      return [];
    }
    return Object.entries(shows)
      .map(([id, entry]) => ({ show: resolveShow(id), entry }))
      .filter((item) => item.show);
  }, [revision, shows]);

  const watching = useMemo(() => {
    return tracked
      .filter((item) => deriveShowStatus(item.show, item.entry) === 'watching')
      .sort((a, b) => mediaTitle(t, a.show).localeCompare(mediaTitle(t, b.show)));
  }, [t, tracked]);

  const planned = useMemo(() => {
    return tracked
      .filter((item) => deriveShowStatus(item.show, item.entry) === 'plan')
      .sort((a, b) => mediaTitle(t, a.show).localeCompare(mediaTitle(t, b.show)));
  }, [t, tracked]);

  const upcomingAll = useMemo(() => upcomingForShows(tracked), [tracked]);
  const upcoming = upcomingAll.slice(0, 3);

  const selectedShow = selected ? resolveShow(selected.showId) : null;
  const selectedEntry = selected ? shows[selected.showId] : null;
  const selectedEpisode = selectedShow && selected?.episodeId
    ? listEpisodes(selectedShow).find((episode) => episode.id === selected.episodeId) || null
    : null;
  const selectedWatched = Boolean(
    selectedEpisode && selectedEntry?.watchedEpisodeIds?.includes(selectedEpisode.id)
  );

  const openEpisode = (show, episode) => {
    if (!show?.id || !episode?.id) {
      return;
    }
    setSelected({ showId: show.id, episodeId: episode.id });
  };

  const markAndOpenEpisode = (show, episode) => {
    if (!show?.id || !episode?.id) {
      return;
    }
    // Capture the episode before progress advances to the following next episode.
    const showId = show.id;
    const episodeId = episode.id;
    markNextWatched(showId);
    setSelected({ showId, episodeId });
  };

  const segmentControl = (
    <SegmentedControl
      value={segment}
      onChange={setSegment}
      options={[
        { value: 'watching', label: t('tv.segment.watching') },
        { value: 'watchlist', label: t('tv.segment.watchlist') },
      ]}
    />
  );

  if (segment === 'watchlist') {
    return (
      <View style={styles.screen}>
        <PosterGrid
          data={planned}
          keyExtractor={(item) => item.show.id}
          ListHeaderComponent={segmentControl}
          contentBottom={spacing.lg}
          ListEmptyComponent={
            <EmptyState
              title={t('watchlist.emptyShowsTitle')}
              body={t('watchlist.emptyShowsBody')}
              primaryLabel={t('tv.discoverShows')}
              onPrimary={() => router.push({ pathname: '/(tabs)/discover', params: { type: 'tv' } })}
            />
          }
          renderItem={(item, size) => (
            <ShowPoster
              show={item.show}
              entry={item.entry}
              width={size.width}
              height={size.height}
              onPress={() => router.push(`/show/${item.show.id}`)}
              onRemove={() => removeShow(item.show.id)}
            />
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: undo ? 96 : spacing.lg }}>
        {segmentControl}
        {watching.length === 0 ? (
          <EmptyState
            title={t('tv.emptyTitle')}
            body={t('tv.emptyBody')}
            primaryLabel={t('tv.addFirstShow')}
            onPrimary={() => router.push({ pathname: '/(tabs)/discover', params: { type: 'tv' } })}
          />
        ) : (
          watching.map(({ show, entry }) => (
            <ShowCard
              key={show.id}
              show={show}
              entry={entry}
              onPress={() => router.push(`/show/${show.id}`)}
              onOpenEpisode={openEpisode}
              onMarkEpisodeWatched={markAndOpenEpisode}
            />
          ))
        )}
        {upcomingAll.length ? (
          <View style={styles.upcoming}>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>{t('tv.upcomingSection')}</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push('/upcoming')} hitSlop={8}>
                <Text style={styles.seeAll}>{t('tv.seeAll')}</Text>
              </Pressable>
            </View>
            {upcoming.map((item) => (
              <UpcomingRow key={item.id} item={item} onPress={() => router.push(`/show/${item.show.id}`)} />
            ))}
          </View>
        ) : null}
      </ScrollView>
      <UndoBar />
      <EpisodeDetailSheet
        key={selected ? `${selected.showId}-${selected.episodeId}` : 'closed'}
        visible={Boolean(selectedEpisode) && !ratingTarget}
        show={selectedShow}
        episode={selectedEpisode}
        watched={selectedWatched}
        rating={selectedEpisode ? episodeRatings?.[selectedEpisode.id] ?? null : null}
        onClose={() => {
          setSelected(null);
          setRatingTarget(null);
          setDraft(null);
        }}
        onToggleWatched={() => {
          if (selectedShow && selectedEpisode) {
            toggleEpisode(selectedShow.id, selectedEpisode.id);
          }
        }}
        onRate={() => {
          if (!selectedEpisode || !selectedWatched) {
            return;
          }
          setDraft(episodeRatings?.[selectedEpisode.id] ?? null);
          // Hide episode Modal before opening RatingSheet (Android nested-Modal tap bug).
          setRatingTarget({
            id: selectedEpisode.id,
            title: `${t('common.episodeCode', episodeCode(selectedEpisode))} · ${episodeTitle(t, selectedEpisode)}`,
            season: selectedEpisode.season,
            number: selectedEpisode.number,
          });
        }}
        onNextEpisode={() => {
          if (!selectedShow || !selectedEpisode) {
            return;
          }
          if (ratingTarget) {
            // Keep existing rating/review sheet UX — do not discard an open draft.
            return;
          }
          const next = getReleasedSuccessor(selectedShow, selectedEpisode.id);
          if (!next?.id) {
            return;
          }
          setSelected({ showId: selectedShow.id, episodeId: next.id });
        }}
      />
      <RatingSheet
        visible={Boolean(ratingTarget)}
        title={t('rating.episode')}
        mediaTitle={ratingTarget?.title}
        mediaType="episode"
        mediaId={ratingTarget?.id}
        showMediaId={selectedShow?.id || null}
        seasonNumber={ratingTarget?.season ?? selectedEpisode?.season ?? null}
        episodeNumber={ratingTarget?.number ?? selectedEpisode?.number ?? null}
        posterPath={selectedShow?.posterPath || null}
        posterUri={selectedShow?.poster || null}
        value={draft}
        savedValue={ratingTarget ? episodeRatings?.[ratingTarget.id] ?? null : null}
        onChange={setDraft}
        onClose={() => {
          setRatingTarget(null);
          setDraft(null);
        }}
        onSave={() => {
          if (draft == null || !ratingTarget) {
            return;
          }
          if (!selectedEntry?.watchedEpisodeIds?.includes(ratingTarget.id)) {
            return;
          }
          setEpisodeRating(ratingTarget.id, draft);
          setRatingTarget(null);
          setDraft(null);
        }}
        onRemove={() => {
          if (!ratingTarget) {
            return;
          }
          if (!selectedEntry?.watchedEpisodeIds?.includes(ratingTarget.id)) {
            return;
          }
          setEpisodeRating(ratingTarget.id, null);
          setRatingTarget(null);
          setDraft(null);
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
  upcoming: {
    marginTop: spacing.sm,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  section: {
    ...typography.subtitle,
    color: colors.text,
  },
  seeAll: {
    ...typography.label,
    color: colors.primary,
  },
});
