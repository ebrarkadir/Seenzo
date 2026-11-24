import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useProfile } from '../../profile/ProfileContext';
import { useReviews } from '../../reviews/ReviewsContext';
import {
  REVIEW_MAX_LENGTH,
  clampReviewText,
  trimmedReviewText,
} from '../../reviews/reviewRules';
import Artwork from '../../services/artwork/Artwork';
import { colors, radii, spacing, typography } from '../../theme';
import PrimaryButton from './PrimaryButton';
import SpoilerToggle from './SpoilerToggle';
import {
  ratingDescriptorKey,
  starFillAt,
  starsFromRating,
  toggleStarRating,
} from './ratingPresentation';

const STAR_SIZE = 36;
const STAR_HIT = 48;
const POSTER = 56;

function StarGlyph({ fill }) {
  return (
    <View style={styles.starGlyph}>
      <Ionicons
        name="star"
        size={STAR_SIZE}
        color={colors.border}
        style={styles.starBase}
      />
      {fill >= 1 ? (
        <Ionicons name="star" size={STAR_SIZE} color={colors.primary} />
      ) : null}
      {fill === 0.5 ? (
        <View style={styles.starHalfClip}>
          <Ionicons name="star" size={STAR_SIZE} color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

function InteractiveStars({ rating, disabled, onSelectStar, accessibilityHint }) {
  const { t } = useTranslation();

  return (
    <View style={styles.stars} accessibilityRole="adjustable">
      {[1, 2, 3, 4, 5].map((starNumber) => {
        const fill = starFillAt(rating, starNumber);
        const fullScore = starNumber * 2;
        const halfScore = fullScore - 1;
        const selectedFull = rating === fullScore;
        const selectedHalf = rating === halfScore;
        let label = t('rating.starSetFull', {
          stars: starNumber,
          rating: fullScore,
        });
        if (selectedFull) {
          label = t('rating.starToggleHalf', {
            stars: starNumber - 0.5,
            rating: halfScore,
          });
        } else if (selectedHalf) {
          label = t('rating.starToggleFull', {
            stars: starNumber,
            rating: fullScore,
          });
        }
        return (
          <Pressable
            key={starNumber}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={accessibilityHint}
            accessibilityState={{ selected: fill > 0, disabled }}
            disabled={disabled}
            hitSlop={6}
            onPress={() => {
              if (typeof __DEV__ !== 'undefined' && __DEV__) {
                console.log('[rating] star_pressed', { starNumber });
              }
              onSelectStar(starNumber);
            }}
            style={({ pressed }) => [styles.starHit, pressed && !disabled && styles.starPressed]}
          >
            <StarGlyph fill={fill} />
          </Pressable>
        );
      })}
    </View>
  );
}

function RatingSheetBody({
  title,
  mediaTitle,
  mediaType,
  mediaId,
  showMediaId,
  seasonNumber,
  episodeNumber,
  posterPath,
  posterUri,
  value,
  savedValue,
  saving,
  onChange,
  onClose,
  onSave,
  onRemove,
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { profile } = useProfile();
  const { getReview, saveReview, removeReview, unavailable: reviewsUnavailable } = useReviews();
  const initialReview = mediaId ? getReview(mediaId) : null;
  const [submitting, setSubmitting] = useState(false);
  const [reviewDraft, setReviewDraft] = useState(initialReview?.reviewText || '');
  const [spoilers, setSpoilers] = useState(Boolean(initialReview?.containsSpoilers));
  const [reviewFocused, setReviewFocused] = useState(false);
  const [savedReview, setSavedReview] = useState(initialReview);

  const descriptorKey = ratingDescriptorKey(value);
  const busy = Boolean(saving) || submitting;
  const starCount = starsFromRating(value);
  const starLabel = value == null
    ? t('rating.none')
    : t('rating.starsOutOf', { stars: starCount });
  const hasReviewText = Boolean(trimmedReviewText(reviewDraft));
  const shareOn = Boolean(profile?.shareActivityWithFollowers);
  const hasArtwork = Boolean(posterPath || posterUri);

  const runOnce = async (action) => {
    if (busy || typeof action !== 'function') {
      return;
    }
    setSubmitting(true);
    try {
      await action();
    } finally {
      setSubmitting(false);
    }
  };

  const persistReview = async () => {
    if (!mediaType || !mediaId) {
      return;
    }
    const saved = await saveReview({
      mediaType,
      mediaId,
      showMediaId,
      seasonNumber,
      episodeNumber,
      reviewText: reviewDraft,
      containsSpoilers: hasReviewText ? spoilers : false,
    });
    setSavedReview(saved);
  };

  const handleSave = () => runOnce(async () => {
    if (value == null || typeof onSave !== 'function') {
      return;
    }
    await onSave();
    try {
      await persistReview();
    } catch (_error) {
      Alert.alert(t('rating.reviewSaveFailedTitle'), t('rating.reviewSaveFailedBody'));
    }
  });

  const handleRemoveRating = () => runOnce(async () => {
    if (typeof onRemove !== 'function') {
      return;
    }
    await onRemove();
  });

  const handleRemoveReview = () => runOnce(async () => {
    if (!mediaId) {
      return;
    }
    const previousText = reviewDraft;
    const previousSpoilers = spoilers;
    const previousSaved = savedReview;
    setReviewDraft('');
    setSpoilers(false);
    try {
      await removeReview(mediaId);
      setSavedReview(null);
    } catch (_error) {
      setReviewDraft(previousText);
      setSpoilers(previousSpoilers);
      setSavedReview(previousSaved);
      Alert.alert(t('rating.reviewSaveFailedTitle'), t('rating.reviewSaveFailedBody'));
    }
  });

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={styles.handleRow}>
        <View style={styles.handle} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('rating.close')}
          hitSlop={10}
          disabled={busy}
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}
        >
          <Ionicons name="close" size={18} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.mediaHeader}>
          {hasArtwork ? (
            <Artwork
              uri={posterUri}
              posterPath={posterPath}
              width={POSTER}
              height={Math.round(POSTER * 1.5)}
              radius={radii.sm}
            />
          ) : (
            <View style={[styles.posterFallback, { width: POSTER, height: Math.round(POSTER * 1.5) }]}>
              <Ionicons name="film-outline" size={22} color={colors.textMuted} />
            </View>
          )}
          <View style={styles.mediaCopy}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
            {mediaTitle ? (
              <Text style={styles.mediaTitle} numberOfLines={2}>{mediaTitle}</Text>
            ) : null}
          </View>
        </View>

        <View
          style={styles.scoreBlock}
          accessibilityLiveRegion="polite"
          accessibilityLabel={
            value == null
              ? t('rating.none')
              : `${starLabel}. ${t('common.ratingValue', { rating: value })}`
          }
        >
          <Text style={styles.score}>
            {value == null ? '—' : value}
            <Text style={styles.scoreSuffix}> / 10</Text>
          </Text>
          <Text style={styles.descriptor}>
            {t(`rating.descriptors.${descriptorKey}`, { defaultValue: t('rating.none') })}
          </Text>
        </View>

        <InteractiveStars
          rating={value}
          disabled={busy}
          accessibilityHint={t('rating.starHint')}
          onSelectStar={(starNumber) => {
            if (typeof onChange !== 'function') {
              return;
            }
            onChange(toggleStarRating(value, starNumber));
          }}
        />

        <View style={styles.reviewBlock}>
          <View style={styles.reviewLabelRow}>
            <Text style={styles.reviewLabel}>{t('rating.review.label')}</Text>
            <Text style={styles.optional}>{t('rating.review.optional')}</Text>
          </View>
          <TextInput
            value={reviewDraft}
            onChangeText={(text) => {
              const next = clampReviewText(text);
              setReviewDraft(next);
              if (!trimmedReviewText(next)) {
                setSpoilers(false);
              }
            }}
            placeholder={t('rating.review.placeholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={REVIEW_MAX_LENGTH}
            editable={!busy}
            onFocus={() => setReviewFocused(true)}
            onBlur={() => setReviewFocused(false)}
            textAlignVertical="top"
            style={[styles.reviewInput, reviewFocused && styles.reviewInputFocused]}
          />
          <Text style={styles.counter}>
            {t('rating.review.counter', {
              count: reviewDraft.length,
              max: REVIEW_MAX_LENGTH,
            })}
          </Text>
        </View>

        {hasReviewText ? (
          <SpoilerToggle
            value={spoilers}
            disabled={busy}
            onChange={setSpoilers}
          />
        ) : null}

        <Text style={styles.privacyHint}>
          {shareOn ? t('rating.privacy.sharingOn') : t('rating.privacy.sharingOff')}
        </Text>
        {reviewsUnavailable ? (
          <Text style={styles.privacyHint}>{t('rating.review.unavailable')}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={busy ? t('rating.saving') : t('rating.saveReview')}
          onPress={handleSave}
          disabled={busy || value == null}
        />
        {savedReview?.reviewText ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('rating.review.remove')}
            disabled={busy}
            onPress={handleRemoveReview}
            style={({ pressed }) => [styles.secondaryAction, pressed && !busy && styles.removePressed]}
          >
            <Text style={styles.secondaryText}>{t('rating.review.remove')}</Text>
          </Pressable>
        ) : null}
        {savedValue != null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('rating.remove')}
            disabled={busy}
            onPress={handleRemoveRating}
            style={({ pressed }) => [styles.secondaryAction, pressed && !busy && styles.removePressed]}
          >
            <Text style={styles.removeText}>{t('rating.remove')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function RatingSheet({
  visible,
  title,
  mediaTitle,
  mediaType = null,
  mediaId = null,
  showMediaId = null,
  seasonNumber = null,
  episodeNumber = null,
  posterPath = null,
  posterUri = null,
  value,
  savedValue,
  saving = false,
  onChange,
  onClose,
  onSave,
  onRemove,
}) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('rating.close')}
          style={styles.dismiss}
          onPress={onClose}
        />
        {visible ? (
          <RatingSheetBody
            key={`${mediaType || 'media'}:${mediaId || 'none'}`}
            title={title}
            mediaTitle={mediaTitle}
            mediaType={mediaType}
            mediaId={mediaId}
            showMediaId={showMediaId}
            seasonNumber={seasonNumber}
            episodeNumber={episodeNumber}
            posterPath={posterPath}
            posterUri={posterUri}
            value={value}
            savedValue={savedValue}
            saving={saving}
            onChange={onChange}
            onClose={onClose}
            onSave={onSave}
            onRemove={onRemove}
          />
        ) : null}
      </KeyboardAvoidingView>
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
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handleRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 36,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  closeButton: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.xs,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closePressed: {
    opacity: 0.8,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  mediaHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  posterFallback: {
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  sheetTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  mediaTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  scoreBlock: {
    alignItems: 'center',
    gap: 2,
  },
  score: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '700',
    color: colors.primary,
  },
  scoreSuffix: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  descriptor: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  stars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: spacing.xs,
  },
  starHit: {
    width: STAR_HIT,
    height: STAR_HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starPressed: {
    opacity: 0.88,
  },
  starGlyph: {
    width: STAR_SIZE,
    height: STAR_SIZE,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  starBase: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  starHalfClip: {
    width: STAR_SIZE / 2,
    height: STAR_SIZE,
    overflow: 'hidden',
  },
  reviewBlock: {
    gap: spacing.xs,
  },
  reviewLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewLabel: {
    ...typography.label,
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  optional: {
    ...typography.caption,
    color: colors.textMuted,
  },
  reviewInput: {
    minHeight: 96,
    maxHeight: 140,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
  },
  reviewInputFocused: {
    borderColor: colors.primary,
  },
  counter: {
    ...typography.label,
    color: colors.textMuted,
    alignSelf: 'flex-end',
  },
  privacyHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  footer: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  secondaryAction: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  removePressed: {
    opacity: 0.75,
  },
  removeText: {
    ...typography.label,
    color: colors.status.dropped,
  },
});
