import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

export default function ProfileActivitySection({
  showsCount = 0,
  episodesWatched = 0,
  moviesWatched = 0,
  moviesToWatch = 0,
  ratingsCount = 0,
  onPressShows,
  onPressMovies,
  onPressRatings,
  onPressInsights,
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>{t('profile.myActivity')}</Text>
        {onPressInsights ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('insights.openFromProfile')}
            onPress={onPressInsights}
            hitSlop={8}
            style={({ pressed }) => [styles.insightsLink, pressed && styles.pressed]}
          >
            <Text style={styles.insightsLinkText}>{t('insights.seeInsights')}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.row}>
        <ActivityCard
          icon="tv-outline"
          value={showsCount}
          title={t('profile.activityShows')}
          secondary={t('profile.activityShowsSecondary', { count: episodesWatched })}
          accessibilityLabel={t('profile.activityShowsA11y', {
            shows: showsCount,
            episodes: episodesWatched,
          })}
          onPress={onPressShows}
        />
        <ActivityCard
          icon="film-outline"
          value={moviesWatched}
          title={t('profile.activityMovies')}
          secondary={t('profile.activityMoviesSecondary', { count: moviesToWatch })}
          accessibilityLabel={t('profile.activityMoviesA11y', {
            watched: moviesWatched,
            toWatch: moviesToWatch,
          })}
          onPress={onPressMovies}
        />
        <ActivityCard
          icon="star"
          value={ratingsCount}
          title={t('profile.activityRatings')}
          secondary={t('profile.activityRatingsSecondary')}
          accessibilityLabel={t('profile.activityRatingsA11y', { count: ratingsCount })}
          onPress={onPressRatings}
        />
      </View>
    </View>
  );
}

function ActivityCard({
  icon,
  value,
  title,
  secondary,
  accessibilityLabel,
  onPress,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <View style={styles.iconBadge}>
          <Ionicons name={icon} size={16} color={colors.primary} />
        </View>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </View>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <Text style={styles.secondary} numberOfLines={2}>{secondary}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heading: {
    ...typography.subtitle,
    color: colors.text,
    flexShrink: 1,
  },
  insightsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  insightsLinkText: {
    ...typography.label,
    color: colors.primary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 118,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
    justifyContent: 'flex-start',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  iconBadge: {
    width: 30,
    height: 30,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  value: {
    ...typography.subtitle,
    color: colors.text,
  },
  title: {
    ...typography.label,
    color: colors.text,
    fontWeight: '700',
  },
  secondary: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  pressed: {
    opacity: 0.88,
  },
});
