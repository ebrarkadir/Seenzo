import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ActivityFeedCard from './ActivityFeedCard';
import {
  describeActivityAction,
  formatActivityRating,
} from '../../services/supabase/activityFeedPresentation';
import {
  hydrateActivityMedia,
  resolveActivityMediaSync,
} from '../../services/supabase/activityFeedMedia';

function openProfile(actor) {
  const username = actor?.username;
  if (username) {
    router.push(`/user/${encodeURIComponent(username)}`);
  }
}

/**
 * One friends-activity row with non-blocking Trakt artwork/title hydration.
 */
export default function ActivityFeedItem({ item }) {
  const { t } = useTranslation();
  const local = resolveActivityMediaSync(item);
  const hydrateKey = local.hydrateTarget
    ? `${local.hydrateTarget.kind}:${local.hydrateTarget.traktId}`
    : null;
  const [remoteByKey, setRemoteByKey] = useState({});
  const remote = hydrateKey ? remoteByKey[hydrateKey] || null : null;

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

  return (
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
      onPressUser={() => openProfile(item.actor)}
      onPressMedia={() => {
        if (media.route) {
          router.push(media.route);
        }
      }}
    />
  );
}
