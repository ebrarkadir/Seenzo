import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ProfileReviewsSection from '../../components/social/ProfileReviewsSection';
import PublicProfileView from '../../components/social/PublicProfileView';
import ReportSheet from '../../components/social/ReportSheet';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { useAuth } from '../../auth/AuthContext';
import { useTracking } from '../../tracking/TrackingContext';
import { rememberMovie, rememberShow, resolveMovie, resolveShow } from '../../data/mediaLibrary';
import { hydrateMovie, hydrateShow } from '../../services/trakt/catalog';
import { parseTraktMovieKey, parseTraktShowKey } from '../../services/trakt/normalize';
import {
  fetchPublicProfileByUsername,
  followUser,
  unfollowUser,
} from '../../services/supabase/social';
import { blockUser } from '../../services/supabase/socialBlocks';
import { cancelFollowRequest } from '../../services/supabase/socialGraph';
import {
  REPORT_TARGET,
  reportSocialContent,
} from '../../services/supabase/socialInteractions';
import { RELATIONSHIP, resolveRelationshipAction } from '../../services/supabase/socialRules';
import { colors, spacing, typography } from '../../theme';

export default function PublicUserProfileScreen() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { demoMode } = useTracking();
  const params = useLocalSearchParams();
  const username = String(params.username || '');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [followLoading, setFollowLoading] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [activeUsername, setActiveUsername] = useState(username);

  if (username !== activeUsername) {
    setActiveUsername(username);
    setPayload(null);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace('/sign-in');
    }
  }, [session?.user?.id]);

  useEffect(() => {
    let active = true;
    fetchPublicProfileByUsername(username)
      .then(async (next) => {
        if (!next.limited) {
          await hydrateFavorites(next.favorites);
        }
        if (!active) {
          return;
        }
        setPayload(next);
        setError(null);
        setLoading(false);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }
        setPayload(null);
        setError(requestError);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, username]);

  const onRetry = () => {
    setLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  };

  const openConnections = (direction) => {
    if (!payload?.profile?.userId) return;
    router.push({
      pathname: '/users/connections',
      params: {
        userId: payload.profile.userId,
        direction,
        title: direction === 'following' ? 'following' : 'followers',
      },
    });
  };

  const onToggleFollow = useCallback(async () => {
    if (!payload?.profile?.userId || payload.isSelf || followLoading) {
      return;
    }
    if (demoMode) {
      Alert.alert(t('social.demoBlockedTitle'), t('social.demoBlockedBody'));
      return;
    }
    setFollowLoading(true);
    try {
      const action = payload.relationshipAction;
      if (action === RELATIONSHIP.FOLLOWING) {
        await unfollowUser(payload.profile.userId);
        setPayload((current) => {
          if (!current) return current;
          const relationship = {
            ...current.relationship,
            isFollowing: false,
            outgoingRequestId: null,
          };
          return {
            ...current,
            isFollowing: false,
            relationship,
            relationshipAction: resolveRelationshipAction(relationship),
            followCounts: {
              ...current.followCounts,
              followers: Math.max(0, (current.followCounts?.followers || 0) - 1),
            },
          };
        });
      } else if (action === RELATIONSHIP.REQUESTED) {
        await cancelFollowRequest(payload.profile.userId);
        setPayload((current) => {
          if (!current) return current;
          const relationship = {
            ...current.relationship,
            outgoingRequestId: null,
          };
          return {
            ...current,
            relationship,
            relationshipAction: resolveRelationshipAction(relationship),
          };
        });
      } else {
        const result = await followUser(payload.profile.userId);
        setPayload((current) => {
          if (!current) return current;
          const relationship = {
            ...current.relationship,
            isFollowing: Boolean(result.isFollowing),
            outgoingRequestId: result.requestId || null,
          };
          return {
            ...current,
            isFollowing: Boolean(result.isFollowing),
            relationship,
            relationshipAction: resolveRelationshipAction(relationship),
            followCounts: {
              ...current.followCounts,
              followers: result.isFollowing
                ? (current.followCounts?.followers || 0) + 1
                : current.followCounts?.followers || 0,
            },
          };
        });
      }
    } catch (requestError) {
      Alert.alert(
        t('social.followErrorTitle'),
        t(`social.errors.${requestError.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setFollowLoading(false);
    }
  }, [demoMode, followLoading, payload, t]);

  const onBlockUser = useCallback(() => {
    if (!payload?.profile?.userId || payload.isSelf || blockLoading) {
      return;
    }
    if (demoMode) {
      Alert.alert(t('social.demoBlockedTitle'), t('social.block.demoBlockedBody'));
      return;
    }
    Alert.alert(t('social.block.confirmTitle'), t('social.block.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('social.block.blockAction'),
        style: 'destructive',
        onPress: async () => {
          setBlockLoading(true);
          try {
            await blockUser(payload.profile.userId);
            Alert.alert(t('social.block.successTitle'), t('social.block.successBody'));
            router.back();
          } catch (requestError) {
            Alert.alert(
              t('social.block.errorTitle'),
              t(`social.errors.${requestError.code}`, {
                defaultValue: t('social.errors.generic'),
              })
            );
          } finally {
            setBlockLoading(false);
          }
        },
      },
    ]);
  }, [blockLoading, demoMode, payload, t]);

  const onReportUser = useCallback(() => {
    if (!payload?.profile?.userId || payload.isSelf) return;
    if (demoMode) {
      Alert.alert(t('social.demoBlockedTitle'), t('social.report.demoBlockedBody'));
      return;
    }
    setReportOpen(true);
  }, [demoMode, payload, t]);

  const submitProfileReport = useCallback(async (reason) => {
    if (!payload?.profile?.userId || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await reportSocialContent({
        targetType: REPORT_TARGET.PROFILE,
        targetId: payload.profile.userId,
        reason,
      });
      setReportOpen(false);
      Alert.alert(t('social.report.thanksTitle'), t('social.report.thanksBody'));
    } catch (requestError) {
      Alert.alert(
        t('social.report.errorTitle'),
        t(`social.errors.${requestError.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setReportSubmitting(false);
    }
  }, [payload, reportSubmitting, t]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !payload) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>
          {t(`social.errors.${error?.code || 'profile_not_found'}`, {
            defaultValue: t('social.errors.generic'),
          })}
        </Text>
        <PrimaryButton label={t('common.retry')} onPress={onRetry} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <PublicProfileView
        profile={payload.profile}
        favorites={payload.favorites}
        stats={payload.stats}
        followCounts={payload.followCounts}
        isSelf={payload.isSelf}
        limited={payload.limited}
        relationshipAction={payload.relationshipAction}
        followLoading={followLoading}
        onToggleFollow={onToggleFollow}
        blockLoading={blockLoading}
        onBlockUser={payload.isSelf ? undefined : onBlockUser}
        onReportUser={payload.isSelf ? undefined : onReportUser}
        onPressFollowers={() => openConnections('followers')}
        onPressFollowing={() => openConnections('following')}
        onPressFavorite={(item) => {
          if (!item?.mediaId) {
            return;
          }
          if (item.mediaType === 'movie') {
            router.push(`/movie/${item.mediaId}`);
            return;
          }
          router.push(`/show/${item.mediaId}`);
        }}
      />
      {!demoMode && payload.profile?.username && !payload.limited ? (
        <ProfileReviewsSection
          key={`reviews:${session?.user?.id}:${payload.profile.username}`}
          username={payload.profile.username}
          isOwner={Boolean(payload.isSelf)}
          enabled
        />
      ) : null}
      <ReportSheet
        visible={reportOpen}
        targetKind="profile"
        submitting={reportSubmitting}
        onClose={() => {
          if (!reportSubmitting) setReportOpen(false);
        }}
        onSubmit={submitProfileReport}
      />
    </ScrollView>
  );
}

async function hydrateFavorites(favorites) {
  const tasks = [];
  (favorites?.shows || []).forEach((item) => {
    if (resolveShow(item.mediaId)) {
      return;
    }
    const traktId = parseTraktShowKey(item.mediaId);
    if (!traktId) {
      return;
    }
    tasks.push(
      hydrateShow(traktId).then((show) => {
        if (show) {
          rememberShow(show);
        }
      }).catch(() => {})
    );
  });
  (favorites?.movies || []).forEach((item) => {
    if (resolveMovie(item.mediaId)) {
      return;
    }
    const traktId = parseTraktMovieKey(item.mediaId);
    if (!traktId) {
      return;
    }
    tasks.push(
      hydrateMovie(traktId).then((movie) => {
        if (movie) {
          rememberMovie(movie);
        }
      }).catch(() => {})
    );
  });
  await Promise.all(tasks);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  error: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
