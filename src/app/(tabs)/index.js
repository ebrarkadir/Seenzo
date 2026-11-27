import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import EmptyState from '../../components/ui/EmptyState';
import RatingSheet from '../../components/ui/RatingSheet';
import SegmentedControl from '../../components/ui/SegmentedControl';
import EpisodeDetailSheet from '../../components/tracking/EpisodeDetailSheet';
import ShowCard from '../../components/tracking/ShowCard';
import UpcomingRow from '../../components/tracking/UpcomingRow';
import UndoBar from '../../components/tracking/UndoBar';
import WatchlistModeToggle from '../../components/tracking/WatchlistModeToggle';
import WatchlistOrderRow from '../../components/tracking/WatchlistOrderRow';
import WatchlistSortSelect from '../../components/tracking/WatchlistSortSelect';
import { episodeTitle, mediaGenreLine, mediaTitle } from '../../data/labels';
import { resolveShow, useMediaRevision } from '../../data/mediaLibrary';
import { useProfile } from '../../profile/ProfileContext';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import { useUndoTimer } from '../../tracking/useUndoTimer';
import {
  PREFERENCE_CONFIDENCE_HISTORY,
  WATCHLIST_SORT_FOR_YOU,
  buildPreferenceProfile,
  rankCandidates,
} from '../../tracking/preferenceProfile';
import {
  deriveShowStatus,
  episodeCode,
  getReleasedSuccessor,
  listEpisodes,
  upcomingForShows,
} from '../../tracking/status';
import {
  MY_LIST_SORT_MY_ORDER,
  sortWatchlistItems,
} from '../../tracking/watchlistSort';
import { sortItemsByWatchlistOrder } from '../../tracking/watchlistOrder';

const MAIN_MY_LIST = 'myList';
const MAIN_FOR_YOU = 'forYou';

export default function TvShowsScreen() {
  const { t } = useTranslation();
  const {
    shows,
    showRatings,
    showWatchlistOrder,
    undo,
    markNextWatched,
    toggleEpisode,
    setShowIntent,
    setEpisodeRating,
    episodeRatings,
    moveShowWatchlistOrder,
    reorderShowWatchlist,
  } = useTracking();
  const { favorites } = useProfile();
  const revision = useMediaRevision();
  const [segment, setSegment] = useState('watching');
  const [mainMode, setMainMode] = useState(MAIN_MY_LIST);
  const [listSort, setListSort] = useState(MY_LIST_SORT_MY_ORDER);
  const [query, setQuery] = useState('');
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
    return tracked.filter((item) => item.entry?.intent === 'plan');
  }, [tracked]);

  const favoriteShowIds = useMemo(
    () => (favorites?.shows || []).map((item) => item.mediaId).filter(Boolean),
    [favorites]
  );

  const positionById = useMemo(() => {
    const map = new Map();
    (showWatchlistOrder || []).forEach((id, index) => {
      map.set(id, index + 1);
    });
    return map;
  }, [showWatchlistOrder]);

  const showPreferenceProfile = useMemo(() => {
    if (revision < 0 || mainMode !== MAIN_FOR_YOU || segment !== 'watchlist') {
      return null;
    }
    return buildPreferenceProfile(
      { shows, showRatings },
      {
        mediaKind: 'show',
        resolveShow,
        favoriteShowIds,
      }
    );
  }, [favoriteShowIds, mainMode, revision, segment, showRatings, shows]);

  const orderedPlan = useMemo(() => sortWatchlistItems(planned, {
    mode: listSort,
    order: showWatchlistOrder,
    getId: (item) => item.show.id,
    getTitle: (item) => mediaTitle(t, item.show),
    getMedia: (item) => item.show,
    getAddedAt: (item) => item.entry?.watchlistAddedAt,
  }), [listSort, planned, showWatchlistOrder, t]);

  const forYouPlan = useMemo(() => {
    if (!showPreferenceProfile?.ready) {
      return sortItemsByWatchlistOrder(planned, showWatchlistOrder, (item) => item.show.id);
    }
    return rankCandidates(planned, {
      profile: showPreferenceProfile,
      mode: WATCHLIST_SORT_FOR_YOU,
      getId: (item) => item.show.id,
      getTitle: (item) => mediaTitle(t, item.show),
      getMedia: (item) => item.show,
    });
  }, [planned, showPreferenceProfile, showWatchlistOrder, t]);

  const visiblePlan = useMemo(() => {
    const source = mainMode === MAIN_FOR_YOU ? forYouPlan : orderedPlan;
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return source;
    }
    return source.filter((item) => mediaTitle(t, item.show).toLowerCase().includes(needle));
  }, [forYouPlan, mainMode, orderedPlan, query, t]);

  const myOrderMode = mainMode === MAIN_MY_LIST && listSort === MY_LIST_SORT_MY_ORDER;
  const dragEnabled = segment === 'watchlist' && myOrderMode && !query.trim();
  const showForYouHint = segment === 'watchlist'
    && mainMode === MAIN_FOR_YOU
    && showPreferenceProfile
    && !showPreferenceProfile.ready
    && planned.length > 0;
  const showForYouHistoryNote = segment === 'watchlist'
    && mainMode === MAIN_FOR_YOU
    && showPreferenceProfile?.ready
    && showPreferenceProfile.confidence === PREFERENCE_CONFIDENCE_HISTORY
    && planned.length > 0;
  const forYouHintText = showPreferenceProfile?.reason === 'insufficient_history'
    ? t('watchlist.forYouNeedHistory')
    : t('watchlist.forYouNeedRatings');

  const dropped = useMemo(() => {
    return tracked
      .filter((item) => item.entry?.intent === 'dropped')
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
    const watchlistHeader = (
      <View>
        {segmentControl}
        <View style={styles.controls}>
          <WatchlistModeToggle
            value={mainMode}
            onChange={setMainMode}
            options={[
              { value: MAIN_MY_LIST, label: t('watchlist.main.myList') },
              { value: MAIN_FOR_YOU, label: t('watchlist.main.forYou') },
            ]}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('watchlist.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          {mainMode === MAIN_MY_LIST ? (
            <WatchlistSortSelect value={listSort} onChange={setListSort} />
          ) : null}
          {showForYouHint ? (
            <Text style={styles.note}>{forYouHintText}</Text>
          ) : null}
          {showForYouHistoryNote ? (
            <Text style={styles.note}>{t('watchlist.forYouBasedOnHistory')}</Text>
          ) : null}
        </View>
      </View>
    );

    const renderPlanRow = ({ item, drag, isActive }) => {
      const position = positionById.get(item.show.id) || 0;
      return (
        <WatchlistOrderRow
          item={item}
          media={item.show}
          position={position}
          showPosition={myOrderMode || Boolean(query.trim())}
          editablePosition={myOrderMode}
          dragEnabled={dragEnabled}
          drag={drag}
          isActive={isActive}
          onPress={() => router.push(`/show/${item.show.id}`)}
          onMoveToPosition={(row, nextPosition) => moveShowWatchlistOrder(row.show.id, nextPosition)}
          genreLine={mediaGenreLine(t, item.show)}
        />
      );
    };

    return (
      <GestureHandlerRootView style={styles.screen}>
        <DraggableFlatList
          data={visiblePlan}
          keyExtractor={(item) => item.show.id}
          ListHeaderComponent={watchlistHeader}
          contentContainerStyle={styles.listContent}
          activationDistance={dragEnabled ? undefined : Number.MAX_SAFE_INTEGER}
          ListEmptyComponent={(
            <EmptyState
              title={query.trim() ? t('watchlist.searchEmpty') : t('watchlist.emptyShowsTitle')}
              body={query.trim() ? t('watchlist.searchEmptyBody') : t('watchlist.emptyShowsBody')}
              primaryLabel={query.trim() ? null : t('tv.discoverShows')}
              onPrimary={query.trim() ? undefined : () => router.push({ pathname: '/(tabs)/discover', params: { type: 'tv' } })}
            />
          )}
          onDragEnd={dragEnabled ? ({ data }) => {
            reorderShowWatchlist(data.map((item) => item.show.id));
          } : undefined}
          renderItem={(params) => renderPlanRow({
            ...params,
            drag: dragEnabled ? params.drag : undefined,
          })}
        />
      </GestureHandlerRootView>
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
        {dropped.length ? (
          <View style={styles.droppedSection}>
            <Text style={styles.droppedHeading}>{t('tv.droppedSection')}</Text>
            {dropped.map(({ show, entry }) => (
              <ShowCard
                key={`dropped-${show.id}`}
                show={show}
                entry={entry}
                onPress={() => router.push(`/show/${show.id}`)}
                primaryLabel={t('tv.resumeWatching')}
                onPrimary={() => setShowIntent(show.id, 'watching')}
              />
            ))}
          </View>
        ) : null}
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
  droppedSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
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
  droppedHeading: {
    ...typography.subtitle,
    color: colors.text,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  seeAll: {
    ...typography.label,
    color: colors.primary,
  },
  controls: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  search: {
    marginHorizontal: spacing.md,
    minHeight: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.md,
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
});
