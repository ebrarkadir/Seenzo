import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { mediaTitle } from '../../data/labels';
import { rememberMovie, rememberShow, resolveMovie, resolveShow, useMediaRevision } from '../../data/mediaLibrary';
import { searchMoviesPage, searchShowsPage } from '../../services/trakt/catalog';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import PosterThumb from '../ui/PosterThumb';
import PrimaryButton from '../ui/PrimaryButton';

export default function FavoritePickerModal({
  visible,
  mediaType = 'show',
  selectedIds = [],
  onClose,
  onSelect,
}) {
  if (!visible) {
    return null;
  }
  return (
    <FavoritePickerBody
      key={`${mediaType}-open`}
      mediaType={mediaType}
      selectedIds={selectedIds}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
}

function FavoritePickerBody({ mediaType, selectedIds, onClose, onSelect }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const revision = useMediaRevision();
  const { shows, movies } = useTracking();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const library = useMemo(() => {
    if (revision < 0) {
      return [];
    }
    if (mediaType === 'movie') {
      return Object.entries(movies)
        .map(([id, entry]) => ({ media: resolveMovie(id), entry }))
        .filter((item) => item.media && (item.entry.watched || item.entry.saved))
        .sort((a, b) => mediaTitle(t, a.media).localeCompare(mediaTitle(t, b.media)));
    }
    return Object.entries(shows)
      .map(([id]) => ({ media: resolveShow(id) }))
      .filter((item) => item.media)
      .sort((a, b) => mediaTitle(t, a.media).localeCompare(mediaTitle(t, b.media)));
  }, [mediaType, movies, revision, shows, t]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return undefined;
    }
    let active = true;
    const timer = setTimeout(() => {
      if (!active) {
        return;
      }
      setSearching(true);
      const search = mediaType === 'movie' ? searchMoviesPage : searchShowsPage;
      search(trimmed, 1)
        .then((page) => {
          if (!active) {
            return;
          }
          const items = (page.items || []).filter(Boolean);
          items.forEach((item) => {
            if (mediaType === 'movie') {
              rememberMovie(item);
            } else {
              rememberShow(item);
            }
          });
          setResults(items);
          setError(null);
        })
        .catch((requestError) => {
          if (!active) {
            return;
          }
          setResults([]);
          setError(requestError);
        })
        .finally(() => {
          if (active) {
            setSearching(false);
          }
        });
    }, 320);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mediaType, query]);

  const selected = new Set(selectedIds);
  const source = query.trim().length >= 2
    ? results.map((media) => ({ media }))
    : library;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Text style={styles.title}>
            {t(mediaType === 'movie' ? 'profile.pickFavoriteMovie' : 'profile.pickFavoriteShow')}
          </Text>
          <TextInput
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              if (value.trim().length < 2) {
                setResults([]);
                setError(null);
                setSearching(false);
              }
            }}
            placeholder={t('profile.searchCatalog')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          {searching ? <ActivityIndicator color={colors.primary} /> : null}
          {error ? <Text style={styles.meta}>{t('profile.searchFailed')}</Text> : null}
          {!source.length && !searching ? (
            <Text style={styles.meta}>
              {t(query.trim().length >= 2 ? 'profile.noSearchResults' : 'profile.noLibraryFavorites')}
            </Text>
          ) : null}
          <FlatList
            data={source}
            keyExtractor={(item) => item.media.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const disabled = selected.has(item.media.id);
              return (
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => onSelect?.(item.media)}
                  style={[styles.row, disabled && styles.rowDisabled]}
                >
                  <PosterThumb
                    uri={item.media.poster}
                    posterPath={item.media.posterPath}
                    width={44}
                    height={66}
                  />
                  <View style={styles.copy}>
                    <Text style={styles.name} numberOfLines={2}>{mediaTitle(t, item.media)}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.media.year || t('trakt.unavailable')}
                      {disabled ? ` · ${t('profile.alreadyFavorite')}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
          <PrimaryButton label={t('common.cancel')} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(12, 16, 21, 0.72)',
  },
  dismiss: {
    flex: 1,
  },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
  },
  input: {
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    color: colors.text,
    paddingHorizontal: spacing.md,
  },
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.body,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
