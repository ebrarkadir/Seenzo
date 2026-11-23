import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import GenreBars from '../components/insights/GenreBars';
import InsightMetricCard from '../components/insights/InsightMetricCard';
import MostWatchedShows from '../components/insights/MostWatchedShows';
import RatingDistributionChart from '../components/insights/RatingDistributionChart';
import ViewingActivitySection from '../components/insights/ViewingActivitySection';
import { useAuth } from '../auth/AuthContext';
import { resolveMovie, resolveShow, useMediaRevision } from '../data/mediaLibrary';
import { buildInsightsDashboard } from '../insights/calculateInsights';
import { colors, radii, spacing, typography } from '../theme';
import { useTracking } from '../tracking/TrackingContext';

export default function InsightsScreen() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user?.id || null;
  const {
    ready,
    movies,
    shows,
    showRatings,
    episodeRatings,
    episodeMeta,
    keptEpisodes,
    activityEvents,
    demoMode,
  } = useTracking();
  const mediaRevision = useMediaRevision();
  const [ratingFilter, setRatingFilter] = useState('all');
  const [selectedScore, setSelectedScore] = useState(null);
  const [activityFilter, setActivityFilter] = useState('all');
  const [activityYear, setActivityYear] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);

  const trackingState = useMemo(() => ({
    movies,
    shows,
    showRatings,
    episodeRatings,
    episodeMeta,
    keptEpisodes,
    activityEvents,
  }), [activityEvents, episodeMeta, episodeRatings, keptEpisodes, movies, showRatings, shows]);

  const hideDemo = Boolean(userId && demoMode);

  const dashboard = useMemo(() => {
    void mediaRevision;
    return buildInsightsDashboard(trackingState, {
      resolveMovie,
      resolveShow,
      ratingFilter,
      activityFilter,
      activityYear,
      hideDemo,
      genreLimit: 5,
      showLimit: 5,
    });
  }, [activityFilter, activityYear, hideDemo, mediaRevision, ratingFilter, trackingState]);

  const watchLabel = useMemo(() => {
    const { hours, minutes } = dashboard.overview.watchTime.display;
    if (hours <= 0 && minutes <= 0) {
      return t('insights.watchTimeZero');
    }
    if (hours <= 0) {
      return t('insights.watchTimeMinutesOnly', { minutes });
    }
    if (minutes <= 0) {
      return t('insights.watchTimeHoursOnly', { hours });
    }
    return t('insights.watchTimeHoursMinutes', { hours, minutes });
  }, [dashboard.overview.watchTime.display, t]);

  const averageLabel = dashboard.overview.averageRating.average == null
    ? t('insights.averageEmpty')
    : t('insights.averageValue', { value: dashboard.overview.averageRating.average });

  if (!ready) {
    return <View style={styles.screen} />;
  }

  const hasActivity = dashboard.overview.moviesWatched > 0
    || dashboard.overview.episodesWatched > 0
    || dashboard.overview.averageRating.count > 0
    || dashboard.viewingActivity.hasLoggingEvents;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>{t('insights.subtitle')}</Text>

      {!hasActivity ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t('insights.emptyTitle')}</Text>
          <Text style={styles.emptyBody}>{t('insights.emptyBody')}</Text>
        </View>
      ) : null}

      <View style={styles.metrics}>
        <InsightMetricCard
          label={t('insights.watchTime')}
          value={watchLabel}
          footnote={
            dashboard.overview.watchTime.estimated
              ? t('insights.watchTimeEstimated')
              : t('insights.watchTimeExact')
          }
        />
        <InsightMetricCard
          label={t('insights.averageRating')}
          value={averageLabel}
          footnote={
            dashboard.overview.averageRating.count > 0
              ? t('insights.averageFootnote', { count: dashboard.overview.averageRating.count })
              : t('insights.averageEmptyFootnote')
          }
        />
        <InsightMetricCard
          label={t('insights.moviesWatched')}
          value={String(dashboard.overview.moviesWatched)}
          footnote={t('insights.moviesWatchedFootnote')}
        />
        <InsightMetricCard
          label={t('insights.episodesWatched')}
          value={String(dashboard.overview.episodesWatched)}
          footnote={t('insights.episodesWatchedFootnote')}
        />
      </View>

      {dashboard.overview.watchTime.coverage.missingUnits > 0 ? (
        <Text style={styles.note}>
          {t('insights.watchTimeCoverageNote', {
            missing: dashboard.overview.watchTime.coverage.missingUnits,
          })}
        </Text>
      ) : null}

      <ViewingActivitySection
        activity={dashboard.viewingActivity}
        filter={activityFilter}
        onChangeFilter={(next) => {
          setActivityFilter(next);
          setSelectedMonth(null);
        }}
        selectedMonth={selectedMonth}
        onSelectMonth={setSelectedMonth}
        onChangeYear={(year) => {
          setActivityYear(year);
          setSelectedMonth(null);
        }}
      />

      <RatingDistributionChart
        data={dashboard.ratingDistribution}
        filter={ratingFilter}
        onChangeFilter={(next) => {
          setRatingFilter(next);
          setSelectedScore(null);
        }}
        selectedScore={selectedScore}
        onSelectScore={setSelectedScore}
      />

      <GenreBars
        items={dashboard.genres.items}
        mediaMissingGenres={dashboard.genres.mediaMissingGenres}
      />

      <MostWatchedShows
        items={dashboard.mostWatchedShows}
        onPressShow={(showId) => router.push(`/show/${showId}`)}
      />
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
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
  },
  emptyCard: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  emptyBody: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
