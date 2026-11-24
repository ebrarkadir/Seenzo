import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PersonalRatingRow from '../components/profile/PersonalRatingRow';
import PrimaryButton from '../components/ui/PrimaryButton';
import RatingSheet from '../components/ui/RatingSheet';
import { useAuth } from '../auth/AuthContext';
import { rememberMovie, rememberShow, resolveMovie, resolveShow, useMediaRevision } from '../data/mediaLibrary';
import { hydrateMovie, hydrateShow } from '../services/trakt/catalog';
import { parseTraktMovieKey, parseTraktShowKey } from '../services/trakt/normalize';
import { colors, radii, spacing, typography } from '../theme';
import {
  PERSONAL_RATING_FILTERS,
  PERSONAL_RATING_SORTS,
  buildPersonalRatingsView,
  countPersonalRatingsByKind,
  enrichPersonalRatingItems,
  collectPersonalRatings,
} from '../tracking/personalRatings';
import { listEpisodes } from '../tracking/status';
import { useTracking } from '../tracking/TrackingContext';

function FilterChip({ label, active, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export default function PersonalRatingsScreen() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user?.id || null;
  const {
    movies,
    shows,
    showRatings,
    episodeRatings,
    episodeMeta,
    keptEpisodes,
    demoMode,
    setMovieRating,
    setShowRating,
    setEpisodeRating,
    ready,
  } = useTracking();
  const mediaRevision = useMediaRevision();
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('highest');
  const [query, setQuery] = useState('');
  const [ratingTarget, setRatingTarget] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const hydrateStarted = useRef(new Set());

  const trackingState = useMemo(() => ({
    movies,
    shows,
    showRatings,
    episodeRatings,
    episodeMeta,
    keptEpisodes,
  }), [episodeMeta, episodeRatings, keptEpisodes, movies, showRatings, shows]);

  const hideDemo = Boolean(userId && demoMode);

  const catalogHelpers = useMemo(() => ({
    resolveMovie,
    resolveShow,
    listEpisodes,
  }), []);

  const allItems = useMemo(() => {
    void mediaRevision;
    if (hideDemo) {
      return [];
    }
    return enrichPersonalRatingItems(collectPersonalRatings(trackingState), catalogHelpers);
  }, [catalogHelpers, hideDemo, mediaRevision, trackingState]);

  const counts = useMemo(() => countPersonalRatingsByKind(allItems), [allItems]);

  const items = useMemo(() => {
    void mediaRevision;
    if (hideDemo) {
      return [];
    }
    return buildPersonalRatingsView(trackingState, {
      filter,
      query,
      sort,
      ...catalogHelpers,
    });
  }, [catalogHelpers, filter, hideDemo, mediaRevision, query, sort, trackingState]);

  useEffect(() => {
    if (!ready || hideDemo) {
      return undefined;
    }
    let cancelled = false;
    const missingShows = new Set();
    const missingMovies = new Set();
    allItems.forEach((item) => {
      if (item.kind === 'movie' && !resolveMovie(item.id)) {
        const traktId = parseTraktMovieKey(item.id);
        if (traktId) missingMovies.add(traktId);
      }
      if (item.kind === 'show' && !resolveShow(item.id)) {
        const traktId = parseTraktShowKey(item.id);
        if (traktId) missingShows.add(traktId);
      }
      if (item.kind === 'episode' && item.showId && !resolveShow(item.showId)) {
        const traktId = parseTraktShowKey(item.showId);
        if (traktId) missingShows.add(traktId);
      }
    });

    [...missingMovies].slice(0, 12).forEach((traktId) => {
      const key = `movie:${traktId}`;
      if (hydrateStarted.current.has(key)) {
        return;
      }
      hydrateStarted.current.add(key);
      hydrateMovie(traktId)
        .then((movie) => {
          if (!cancelled && movie) {
            rememberMovie(movie);
          }
        })
        .catch(() => {});
    });
    [...missingShows].slice(0, 12).forEach((traktId) => {
      const key = `show:${traktId}`;
      if (hydrateStarted.current.has(key)) {
        return;
      }
      hydrateStarted.current.add(key);
      hydrateShow(traktId)
        .then((show) => {
          if (!cancelled && show) {
            rememberShow(show);
          }
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, [allItems, hideDemo, ready, mediaRevision]);

  const openEditor = useCallback((item) => {
    if (!item) {
      return;
    }
    if (!item.editable) {
      Alert.alert(
        t('personalRatings.lockedTitle'),
        item.kind === 'movie' ? t('rating.watchToRateMovie') : t('rating.watchToRate')
      );
      return;
    }
    setRatingTarget(item);
    setDraft(item.rating);
  }, [t]);

  const closeEditor = useCallback(() => {
    if (busy) {
      return;
    }
    setRatingTarget(null);
    setDraft(null);
  }, [busy]);

  const ensureCatalog = useCallback(async (item) => {
    if (item.kind === 'movie') {
      if (resolveMovie(item.id)) {
        return true;
      }
      const traktId = parseTraktMovieKey(item.id);
      if (!traktId) {
        return false;
      }
      const movie = await hydrateMovie(traktId);
      if (movie) {
        rememberMovie(movie);
      }
      return Boolean(resolveMovie(item.id));
    }
    if (item.kind === 'show' || item.kind === 'episode') {
      const showId = item.kind === 'show' ? item.id : item.showId;
      if (!showId) {
        return item.kind === 'episode';
      }
      if (resolveShow(showId)) {
        return true;
      }
      const traktId = parseTraktShowKey(showId);
      if (!traktId) {
        return false;
      }
      const show = await hydrateShow(traktId);
      if (show) {
        rememberShow(show);
      }
      return Boolean(resolveShow(showId));
    }
    return false;
  }, []);

  const persistRating = useCallback(async (nextRating) => {
    if (!ratingTarget || busy) {
      return;
    }
    setBusy(true);
    try {
      const readyCatalog = await ensureCatalog(ratingTarget);
      if (!readyCatalog && ratingTarget.kind !== 'episode') {
        throw new Error('catalog_missing');
      }
      if (ratingTarget.kind === 'movie') {
        setMovieRating(ratingTarget.id, nextRating);
      } else if (ratingTarget.kind === 'show') {
        setShowRating(ratingTarget.id, nextRating);
      } else {
        setEpisodeRating(ratingTarget.id, nextRating);
      }
      setRatingTarget(null);
      setDraft(null);
    } catch (_error) {
      Alert.alert(
        t('personalRatings.saveFailedTitle'),
        t('personalRatings.saveFailedBody')
      );
    } finally {
      setBusy(false);
    }
  }, [busy, ensureCatalog, ratingTarget, setEpisodeRating, setMovieRating, setShowRating, t]);

  const emptyCopy = useMemo(() => {
    if (query.trim()) {
      return {
        title: t('personalRatings.emptySearchTitle'),
        body: t('personalRatings.emptySearchBody'),
      };
    }
    if (filter === 'movie') {
      return { title: t('personalRatings.emptyMoviesTitle'), body: t('personalRatings.emptyMoviesBody') };
    }
    if (filter === 'show') {
      return { title: t('personalRatings.emptyShowsTitle'), body: t('personalRatings.emptyShowsBody') };
    }
    if (filter === 'episode') {
      return { title: t('personalRatings.emptyEpisodesTitle'), body: t('personalRatings.emptyEpisodesBody') };
    }
    return { title: t('personalRatings.emptyTitle'), body: t('personalRatings.emptyBody') };
  }, [filter, query, t]);

  const sheetTitle = ratingTarget
    ? (ratingTarget.kind === 'movie'
      ? t('rating.movie')
      : ratingTarget.kind === 'show'
        ? t('rating.show')
        : t('rating.episode'))
    : '';

  return (
    <View style={styles.screen}>
      <View style={styles.headerBlock}>
        <Text style={styles.subtitle}>{t('personalRatings.subtitle')}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('personalRatings.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        <View style={styles.chipRow}>
          {PERSONAL_RATING_FILTERS.map((key) => (
            <FilterChip
              key={key}
              active={filter === key}
              onPress={() => setFilter(key)}
              label={t(`personalRatings.filters.${key}`, { count: counts[key] || 0 })}
            />
          ))}
        </View>
        <View style={styles.chipRow}>
          {PERSONAL_RATING_SORTS.map((key) => (
            <FilterChip
              key={key}
              active={sort === key}
              onPress={() => setSort(key)}
              label={t(`personalRatings.sorts.${key}`)}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('personalRatings.sortNote')}</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <PersonalRatingRow
            item={item}
            onPress={() => openEditor(item)}
            onEdit={() => openEditor(item)}
          />
        )}
        contentContainerStyle={items.length ? styles.listContent : styles.emptyContent}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
            <Text style={styles.emptyBody}>{emptyCopy.body}</Text>
            {!query.trim() && filter === 'all' ? (
              <View style={styles.emptyActions}>
                <PrimaryButton
                  label={t('personalRatings.browseShows')}
                  onPress={() => router.push('/(tabs)')}
                />
                <PrimaryButton
                  label={t('personalRatings.browseMovies')}
                  variant="secondary"
                  onPress={() => router.push('/(tabs)/movies')}
                />
              </View>
            ) : null}
          </View>
        )}
        initialNumToRender={16}
        windowSize={9}
        removeClippedSubviews
      />

      <RatingSheet
        visible={Boolean(ratingTarget)}
        title={sheetTitle}
        mediaTitle={ratingTarget?.title}
        mediaType={ratingTarget?.kind || null}
        mediaId={ratingTarget?.id || null}
        showMediaId={ratingTarget?.kind === 'episode' ? ratingTarget?.showId : null}
        seasonNumber={ratingTarget?.kind === 'episode' ? ratingTarget?.season ?? null : null}
        episodeNumber={ratingTarget?.kind === 'episode' ? ratingTarget?.number ?? null : null}
        posterPath={ratingTarget?.posterPath || null}
        posterUri={ratingTarget?.poster || null}
        value={draft}
        savedValue={ratingTarget?.rating ?? null}
        saving={busy}
        onChange={setDraft}
        onClose={closeEditor}
        onSave={() => persistRating(draft)}
        onRemove={() => persistRating(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBlock: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  search: {
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.onPrimary,
  },
  note: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '500',
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  empty: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  emptyTitle: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyActions: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
