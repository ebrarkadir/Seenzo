import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { mediaTitle } from '../../data/labels';
import { colors, radii, spacing } from '../../theme';
import { deriveShowStatus } from '../../tracking/status';
import { useTracking } from '../../tracking/TrackingContext';
import { isMovieWatchlisted, isShowWatchlisted, movieBookmarkVisible, showBookmarkVisible } from '../../tracking/watchlist';
import PosterTile from './PosterTile';

export function ShowPoster({ show, entry, width, height, onPress, onRemove }) {
  const { t } = useTranslation();
  const { toggleShowWatchlist } = useTracking();
  const status = entry ? deriveShowStatus(show, entry) : null;
  const bookmark = showBookmarkVisible(entry);
  const watchlisted = isShowWatchlisted(entry);
  const title = mediaTitle(t, show);

  return (
    <View style={{ width }}>
      <PosterTile
        uri={show.poster}
        posterPath={show.posterPath}
        title={title}
        meta={status ? t(`tv.status.${status}`) : null}
        width={width}
        height={height}
        status={status}
        watchlisted={watchlisted}
        bookmarkLabel={t(watchlisted ? 'watchlist.remove' : 'watchlist.add', { title })}
        onBookmark={bookmark ? () => toggleShowWatchlist(show.id) : null}
        onPress={onPress}
        accessibilityLabel={t('tv.openShow', {
          title,
          status: status ? t(`tv.status.${status}`) : t('tv.notTracking'),
        })}
      />
      {onRemove ? (
        <View style={styles.actions}>
          <IconButton name="close-outline" label={t('common.remove')} onPress={onRemove} />
        </View>
      ) : null}
    </View>
  );
}

export function MoviePoster({ movie, watched, rating, width, height, onPress, onMarkWatched, tracked }) {
  const { t } = useTranslation();
  const { movies, toggleMovieWatchlist } = useTracking();
  const entry = movies[movie.id];
  const bookmark = movieBookmarkVisible(entry);
  const watchlisted = isMovieWatchlisted(entry);
  const title = mediaTitle(t, movie);
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
      posterPath={movie.posterPath}
      title={title}
      meta={meta}
      width={width}
      height={height}
      watchlisted={watchlisted}
      bookmarkLabel={t(watchlisted ? 'watchlist.remove' : 'watchlist.add', { title })}
      onBookmark={bookmark ? () => toggleMovieWatchlist(movie.id) : null}
      badge={tracked && !watched ? t('discover.inLibrary') : null}
      onPress={onPress}
      accessibilityLabel={t('movies.openMovie', { title })}
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
