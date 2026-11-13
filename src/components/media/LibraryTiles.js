import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing } from '../../theme';
import { deriveShowStatus } from '../../tracking/status';
import { useTracking } from '../../tracking/TrackingContext';
import PosterTile from './PosterTile';

export function ShowPoster({ show, entry, width, height, onPress, onStart, onRemove }) {
  const { t } = useTranslation();
  const { favorites, toggleFavorite } = useTracking();
  const status = entry ? deriveShowStatus(show, entry) : null;
  const favorite = Boolean(favorites?.shows?.[show.id]);
  const title = t(show.titleKey);

  return (
    <View style={{ width }}>
      <PosterTile
        uri={show.poster}
        title={title}
        meta={status ? t(`tv.status.${status}`) : null}
        width={width}
        height={height}
        status={status}
        favorite={favorite}
        favoriteLabel={t(favorite ? 'favorites.remove' : 'favorites.add', { title })}
        onFavorite={() => toggleFavorite('show', show.id)}
        onPress={onPress}
        accessibilityLabel={t('tv.openShow', {
          title: t(show.titleKey),
          status: status ? t(`tv.status.${status}`) : t('tv.notTracking'),
        })}
      />
      {onStart || onRemove ? (
        <View style={styles.actions}>
          {onStart ? (
            <IconButton name="play-outline" label={t('tv.startWatching')} onPress={onStart} />
          ) : null}
          {onRemove ? <IconButton name="close-outline" label={t('common.remove')} onPress={onRemove} /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function MoviePoster({ movie, watched, rating, width, height, onPress, onMarkWatched, tracked }) {
  const { t } = useTranslation();
  const { favorites, toggleFavorite } = useTracking();
  const favorite = Boolean(favorites?.movies?.[movie.id]);
  const title = t(movie.titleKey);
  let meta = String(movie.year);
  if (watched && rating) {
    meta = t('common.ratingValue', { rating });
  } else if (watched) {
    meta = t('movies.watched');
  } else if (rating) {
    meta = `${movie.year} · ${t('common.ratingValue', { rating })}`;
  }

  return (
    <PosterTile
      uri={movie.poster}
      title={title}
      meta={meta}
      width={width}
      height={height}
      favorite={favorite}
      favoriteLabel={t(favorite ? 'favorites.remove' : 'favorites.add', { title })}
      onFavorite={() => toggleFavorite('movie', movie.id)}
      badge={tracked && !watched ? t('discover.inLibrary') : null}
      onPress={onPress}
      accessibilityLabel={t('movies.openMovie', { title: t(movie.titleKey) })}
      quickLabel={onMarkWatched ? t('movies.markWatched') : null}
      onQuick={onMarkWatched}
    />
  );
}

function IconButton({ name, label, onPress }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.icon}>
      <Ionicons name={name} size={16} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
