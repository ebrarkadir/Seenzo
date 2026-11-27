import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../ui/PosterThumb';
import { mediaTitle } from '../../data/labels';
import { colors, radii, spacing, typography } from '../../theme';

export default function WatchlistOrderRow({
  item,
  media,
  position,
  showPosition = true,
  editablePosition = false,
  dragEnabled = false,
  drag,
  isActive = false,
  onPress,
  onMoveToPosition,
  trailing = null,
  genreLine = null,
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const title = mediaTitle(t, media);

  const commitPosition = () => {
    setEditing(false);
    if (!editablePosition || !onMoveToPosition) {
      setDraft('');
      setError(false);
      return;
    }
    const raw = String(draft).trim();
    if (!/^\d+$/.test(raw)) {
      setDraft('');
      setError(true);
      return;
    }
    const next = Number(raw);
    const result = onMoveToPosition(item, next);
    setDraft('');
    if (!result?.ok) {
      setError(true);
      return;
    }
    setError(false);
  };

  return (
    <View style={[styles.row, isActive && styles.rowActive]}>
      {showPosition ? (
        <View style={styles.positionWrap}>
          {editablePosition ? (
            <TextInput
              value={editing ? draft : String(position || '')}
              onFocus={() => {
                setEditing(true);
                setDraft(String(position || ''));
                setError(false);
              }}
              onChangeText={(value) => {
                setDraft(value.replace(/[^\d]/g, ''));
                setError(false);
              }}
              onBlur={commitPosition}
              onSubmitEditing={commitPosition}
              keyboardType="number-pad"
              returnKeyType="done"
              selectTextOnFocus
              accessibilityLabel={t('watchlist.positionA11y', { title, position })}
              style={[styles.positionInput, error && styles.positionInputError]}
            />
          ) : (
            <Text style={styles.positionText}>{position}</Text>
          )}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={styles.main}
      >
        <PosterThumb
          uri={media?.poster}
          posterPath={media?.posterPath}
          width={48}
          height={72}
        />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {media?.year ? (
            <Text style={styles.meta}>{media.year}</Text>
          ) : null}
          {genreLine ? (
            <Text style={styles.genres} numberOfLines={1}>{genreLine}</Text>
          ) : null}
          {error ? (
            <Text style={styles.error}>{t('watchlist.invalidPosition')}</Text>
          ) : null}
        </View>
      </Pressable>

      {trailing}
      {dragEnabled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('watchlist.dragHandleA11y', { title })}
          onLongPress={drag}
          delayLongPress={120}
          hitSlop={8}
          style={styles.handle}
        >
          <Ionicons name="menu" size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowActive: {
    borderColor: colors.primary,
  },
  positionWrap: {
    width: 44,
    alignItems: 'center',
  },
  positionText: {
    ...typography.subtitle,
    color: colors.textSecondary,
  },
  positionInput: {
    width: 44,
    minHeight: 36,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    textAlign: 'center',
    ...typography.label,
    paddingHorizontal: 2,
    paddingVertical: 6,
  },
  positionInputError: {
    borderColor: colors.status.dropped,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  copy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
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
  genres: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '500',
  },
  error: {
    ...typography.caption,
    color: colors.status.dropped,
  },
  handle: {
    padding: spacing.xs,
  },
});
