import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ActivityFeedCard from './ActivityFeedCard';
import ReportSheet from './ReportSheet';
import { useAuth } from '../../auth/AuthContext';
import {
  describeActivityAction,
  formatActivityRating,
} from '../../services/supabase/activityFeedPresentation';
import {
  hydrateActivityMedia,
  resolveActivityMediaSync,
} from '../../services/supabase/activityFeedMedia';
import {
  REPORT_TARGET,
  reportSocialContent,
} from '../../services/supabase/socialInteractions';
import { useTracking } from '../../tracking/TrackingContext';

function openProfile(actor) {
  const username = actor?.username;
  if (username) {
    router.push(`/user/${encodeURIComponent(username)}`);
  }
}

/**
 * One friends-activity row with non-blocking Trakt artwork/title hydration.
 */
export default function ActivityFeedItem({ item, onInteractionChange }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { demoMode } = useTracking();
  const local = resolveActivityMediaSync(item);
  const hydrateKey = local.hydrateTarget
    ? `${local.hydrateTarget.kind}:${local.hydrateTarget.traktId}`
    : null;
  const [remoteByKey, setRemoteByKey] = useState({});
  const [reportOpen, setReportOpen] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const remote = hydrateKey ? remoteByKey[hydrateKey] || null : null;
  const viewerId = session?.user?.id || null;
  const canReport = Boolean(
    item?.interactionsEnabled
    && item?.id
    && item?.actor?.userId
    && viewerId
    && item.actor.userId !== viewerId
  );

  useEffect(() => {
    if (!local.hydrateTarget || !hydrateKey) {
      return undefined;
    }
    let active = true;
    hydrateActivityMedia(local.hydrateTarget).then((next) => {
      if (!active || !next) {
        return;
      }
      setRemoteByKey((current) => (
        current[hydrateKey] === next ? current : { ...current, [hydrateKey]: next }
      ));
    });
    return () => {
      active = false;
    };
  }, [hydrateKey, local.hydrateTarget]);

  const localTitleIsId = local.title === item?.mediaId || local.title === item?.showMediaId;
  const media = {
    title: (!localTitleIsId && local.title) ? local.title : (remote?.title || local.title),
    meta: local.meta || remote?.meta || null,
    posterPath: local.posterPath || remote?.posterPath || null,
    posterUri: local.posterUri || remote?.posterUri || null,
    route: local.route || remote?.route || null,
  };

  const submitReport = async (reason) => {
    if (!item?.id || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await reportSocialContent({
        targetType: REPORT_TARGET.SOCIAL_ACTIVITY,
        targetId: item.id,
        reason,
      });
      setReportOpen(false);
      Alert.alert(t('social.report.thanksTitle'), t('social.report.thanksBody'));
    } catch (requestError) {
      Alert.alert(
        t('social.report.errorTitle'),
        t(`social.errors.${requestError?.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setReportSubmitting(false);
    }
  };

  return (
    <>
      <ActivityFeedCard
        id={item.id}
        avatarUrl={item.actor?.avatarUrl}
        username={item.actor?.username}
        displayName={item.actor?.displayName}
        actionLabel={describeActivityAction(t, item)}
        relativeTime={item.relativeTime}
        posterUrl={media.posterUri}
        posterPath={media.posterPath}
        mediaTitle={media.title}
        mediaMeta={media.meta}
        ratingLabel={formatActivityRating(item.rating)}
        reviewText={item.reviewText || null}
        reviewContainsSpoilers={Boolean(item.reviewContainsSpoilers)}
        interactionsEnabled={Boolean(item.interactionsEnabled)}
        likedByViewer={Boolean(item.likedByViewer)}
        likeCount={item.likeCount || 0}
        commentCount={item.commentCount || 0}
        demoMode={Boolean(demoMode)}
        canReport={canReport}
        onReport={() => setReportOpen(true)}
        onPressUser={() => openProfile(item.actor)}
        onPressMedia={() => {
          if (media.route) {
            router.push(media.route);
          }
        }}
        onOpenDiscussion={() => {
          if (item?.id) {
            router.push(`/social/discussion?activityId=${encodeURIComponent(item.id)}`);
          }
        }}
        onInteractionChange={(next) => onInteractionChange?.(item.id, next)}
      />
      <ReportSheet
        visible={reportOpen}
        targetKind="review"
        submitting={reportSubmitting}
        onClose={() => {
          if (!reportSubmitting) setReportOpen(false);
        }}
        onSubmit={submitReport}
      />
    </>
  );
}
