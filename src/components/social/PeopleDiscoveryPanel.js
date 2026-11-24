import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import SearchField from '../ui/SearchField';
import PrimaryButton from '../ui/PrimaryButton';
import UserSearchResult from './UserSearchResult';
import { useAuth } from '../../auth/AuthContext';
import { useTracking } from '../../tracking/TrackingContext';
import { searchPublicProfiles } from '../../services/supabase/social';
import { SOCIAL_SEARCH_DEBOUNCE_MS } from '../../services/supabase/socialRules';
import { colors, spacing, typography } from '../../theme';

/**
 * Shared public-profile discovery UI used by Social → People and /users/search.
 * Reuses Social V1 searchPublicProfiles — does not rewrite Supabase queries.
 */
export default function PeopleDiscoveryPanel({
  autoFocus = false,
  contentContainerStyle,
  ListHeaderComponent,
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { demoMode } = useTracking();
  const signedIn = Boolean(session?.user?.id);
  const demoBlocked = () => {
    if (!demoMode) return false;
    Alert.alert(t('social.demoBlockedTitle'), t('social.demoBlockedBody'));
    return true;
  };
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const requestSeq = useRef(0);
  const debounceTimer = useRef(null);

  useEffect(() => {
    if (!signedIn || !debounced) {
      return undefined;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    let active = true;
    searchPublicProfiles({ query: debounced, offset: 0 })
      .then((result) => {
        if (!active || requestSeq.current !== seq) {
          return;
        }
        setItems(result.items);
        setOffset(result.items.length);
        setHasMore(result.hasMore);
        setError(null);
      })
      .catch((requestError) => {
        if (!active || requestSeq.current !== seq) {
          return;
        }
        setItems([]);
        setHasMore(false);
        setError(requestError);
      })
      .finally(() => {
        if (active && requestSeq.current === seq) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [debounced, signedIn]);

  const onChangeQuery = (text) => {
    setQuery(text);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    const trimmed = text.trim();
    if (!trimmed) {
      requestSeq.current += 1;
      setDebounced('');
      setItems([]);
      setError(null);
      setHasMore(false);
      setOffset(0);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setLoading(true);
    debounceTimer.current = setTimeout(() => {
      setDebounced(trimmed);
    }, SOCIAL_SEARCH_DEBOUNCE_MS);
  };

  const retry = () => {
    if (!debounced) {
      return;
    }
    setLoading(true);
    setError(null);
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    searchPublicProfiles({ query: debounced, offset: 0 })
      .then((result) => {
        if (requestSeq.current !== seq) {
          return;
        }
        setItems(result.items);
        setOffset(result.items.length);
        setHasMore(result.hasMore);
        setError(null);
      })
      .catch((requestError) => {
        if (requestSeq.current !== seq) {
          return;
        }
        setItems([]);
        setHasMore(false);
        setError(requestError);
      })
      .finally(() => {
        if (requestSeq.current === seq) {
          setLoading(false);
        }
      });
  };

  const loadMore = () => {
    if (!hasMore || loading || loadingMore || !debounced || !signedIn) {
      return;
    }
    const seq = requestSeq.current;
    setLoadingMore(true);
    searchPublicProfiles({ query: debounced, offset })
      .then((result) => {
        if (requestSeq.current !== seq) {
          return;
        }
        setItems((current) => [...current, ...result.items]);
        setOffset((current) => current + result.items.length);
        setHasMore(result.hasMore);
      })
      .catch(() => {})
      .finally(() => {
        if (requestSeq.current === seq) {
          setLoadingMore(false);
        }
      });
  };

  if (!signedIn) {
    return (
      <View style={styles.gate}>
        {ListHeaderComponent}
        <Text style={styles.gateTitle}>{t('social.peopleSignInTitle')}</Text>
        <Text style={styles.gateBody}>{t('social.peopleSignInBody')}</Text>
        <PrimaryButton label={t('profile.signIn')} onPress={() => router.push('/sign-in')} />
        <PrimaryButton
          label={t('profile.createAccount')}
          variant="secondary"
          onPress={() => router.push('/sign-up')}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.userId}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      contentContainerStyle={[styles.list, contentContainerStyle]}
      ListHeaderComponent={(
        <View>
          {ListHeaderComponent}
          <SearchField
            value={query}
            onChangeText={onChangeQuery}
            placeholder={t('social.searchPlaceholder')}
            autoFocus={autoFocus}
          />
          <Text style={styles.hint}>{t('social.searchHint')}</Text>
          {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
          {error ? (
            <View style={styles.errorBlock}>
              <Text style={styles.error}>
                {t(`social.errors.${error.code}`, { defaultValue: t('social.errors.generic') })}
              </Text>
              <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}>
                <Text style={styles.retryLabel}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : null}
          {!loading && !error && debounced && !items.length ? (
            <Text style={styles.empty}>{t('social.searchEmpty')}</Text>
          ) : null}
          {!debounced && !loading ? (
            <Text style={styles.empty}>{t('social.searchIdle')}</Text>
          ) : null}
        </View>
      )}
      renderItem={({ item }) => (
        <UserSearchResult
          profile={item}
          showFollow
          demoBlocked={demoBlocked}
          onPress={(profile) => router.push(`/user/${encodeURIComponent(profile.username)}`)}
        />
      )}
      ListFooterComponent={(
        <View style={styles.footer}>
          {loadingMore ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
          <Text style={styles.footerNote}>{t('social.privateExcluded')}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  loader: {
    marginVertical: spacing.md,
  },
  empty: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorBlock: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  error: {
    ...typography.caption,
    color: colors.status.dropped,
  },
  retry: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  retryLabel: {
    ...typography.label,
    color: colors.primary,
  },
  footer: {
    paddingBottom: spacing.md,
  },
  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  gate: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  gateTitle: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
  },
  gateBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
