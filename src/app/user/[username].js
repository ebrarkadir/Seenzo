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

import PublicProfileView from '../../components/social/PublicProfileView';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { useAuth } from '../../auth/AuthContext';
import { rememberMovie, rememberShow, resolveMovie, resolveShow } from '../../data/mediaLibrary';
import { hydrateMovie, hydrateShow } from '../../services/trakt/catalog';
import { parseTraktMovieKey, parseTraktShowKey } from '../../services/trakt/normalize';
import {
  fetchPublicProfileByUsername,
  followUser,
  unfollowUser,
} from '../../services/supabase/social';
import { colors, spacing, typography } from '../../theme';

export default function PublicUserProfileScreen() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const params = useLocalSearchParams();
  const username = String(params.username || '');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [followLoading, setFollowLoading] = useState(false);
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
        await hydrateFavorites(next.favorites);
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

  const onToggleFollow = useCallback(async () => {
    if (!payload?.profile?.userId || payload.isSelf || followLoading) {
      return;
    }
    setFollowLoading(true);
    try {
      if (payload.isFollowing) {
        await unfollowUser(payload.profile.userId);
        setPayload((current) => (
          current
            ? {
              ...current,
              isFollowing: false,
              followCounts: {
                ...current.followCounts,
                followers: Math.max(0, (current.followCounts?.followers || 0) - 1),
              },
            }
            : current
        ));
      } else {
        await followUser(payload.profile.userId);
        setPayload((current) => (
          current
            ? {
              ...current,
              isFollowing: true,
              followCounts: {
                ...current.followCounts,
                followers: (current.followCounts?.followers || 0) + 1,
              },
            }
            : current
        ));
      }
    } catch (requestError) {
      Alert.alert(
        t('social.followErrorTitle'),
        t(`social.errors.${requestError.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setFollowLoading(false);
    }
  }, [followLoading, payload, t]);

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
        isFollowing={payload.isFollowing}
        followLoading={followLoading}
        onToggleFollow={onToggleFollow}
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
