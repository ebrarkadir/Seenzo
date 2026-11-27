import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import PosterTile from '../media/PosterTile';
import { colors, spacing, typography } from '../../theme';

const CARD_WIDTH = 112;
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.5);

export default function DiscoverRecommendRail({
  title,
  subtitle = null,
  loading = false,
  coldStartMessage = null,
  items = [],
  emptyMessage = null,
  showSeeAll = false,
  onSeeAll,
  getWatchState,
  onOpen,
  onBookmark,
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {showSeeAll ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('discover.seeAll')}
            onPress={onSeeAll}
            hitSlop={8}
            style={styles.seeAll}
          >
            <Text style={styles.seeAllLabel}>{t('discover.seeAll')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : null}
      {!loading && coldStartMessage ? (
        <Text style={styles.hint}>{coldStartMessage}</Text>
      ) : null}
      {!loading && !coldStartMessage && !items.length && emptyMessage ? (
        <Text style={styles.hint}>{emptyMessage}</Text>
      ) : null}
      {!loading && items.length ? (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(row) => row.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          renderItem={({ item: row }) => {
            const watch = typeof getWatchState === 'function' ? getWatchState(row) : {};
            const metaParts = [row.media?.year, row.genreLine].filter(Boolean);
            return (
              <View style={styles.card}>
                <PosterTile
                  posterPath={row.media?.posterPath}
                  uri={row.media?.poster}
                  title={row.media?.title || ''}
                  meta={metaParts.length ? metaParts.join(' · ') : null}
                  detail={row.reason || null}
                  width={CARD_WIDTH}
                  height={CARD_HEIGHT}
                  badge={watch.tracked ? t('discover.inLibrary') : null}
                  watchlisted={Boolean(watch.watchlisted)}
                  bookmarkLabel={t(
                    watch.watchlisted ? 'watchlist.remove' : 'watchlist.add',
                    { title: row.media?.title || '' }
                  )}
                  onBookmark={watch.bookmark ? () => onBookmark?.(row) : null}
                  onPress={() => onOpen?.(row)}
                />
              </View>
            );
          }}
        />
      ) : null}
    </View>
  );
}

export function DiscoverSectionDivider() {
  return <View style={styles.divider} />;
}

export function DiscoverBrowseHeading({ label }) {
  return (
    <View style={styles.browseWrap}>
      <Text style={styles.browseTitle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  seeAllLabel: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '700',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.md,
    marginTop: 2,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  loader: {
    marginVertical: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  card: {
    marginRight: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  browseWrap: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  browseTitle: {
    ...typography.label,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
