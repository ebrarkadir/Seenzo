import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../ui/PosterThumb';
import { mediaTitle } from '../../data/labels';
import { colors, radii, spacing, typography } from '../../theme';
import { episodeCode } from '../../tracking/status';

export function formatAirDate(iso) {
  if (!iso) {
    return null;
  }
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

export default function UpcomingRow({ item, onPress }) {
  const { t } = useTranslation();
  const code = t('common.episodeCode', episodeCode(item.episode));
  const when = item.airDate ? formatAirDate(item.airDate) : t('upcoming.tba');
  const kind = item.kind === 'season' ? t('upcoming.newSeason') : t('upcoming.newEpisode');

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <PosterThumb uri={item.show.poster} posterPath={item.show.posterPath} width={52} height={78} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {mediaTitle(t, item.show)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {kind} · {code}
        </Text>
        <Text style={styles.date}>{when}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copy: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  date: {
    ...typography.label,
    color: colors.primary,
  },
});
