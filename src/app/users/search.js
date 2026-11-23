import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import UserSearchResult from '../../components/social/UserSearchResult';
import { useAuth } from '../../auth/AuthContext';
import { searchPublicProfiles } from '../../services/supabase/social';
import { SOCIAL_SEARCH_DEBOUNCE_MS } from '../../services/supabase/socialRules';
import { colors, radii, spacing, typography } from '../../theme';

export default function UserSearchScreen() {
  const { t } = useTranslation();
  const { session } = useAuth();
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
    if (!session?.user?.id) {
      router.replace('/sign-in');
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (!debounced) {
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
  }, [debounced]);

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

  const loadMore = () => {
    if (!hasMore || loading || loadingMore || !debounced) {
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

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={onChangeQuery}
          placeholder={t('social.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      <Text style={styles.hint}>{t('social.searchHint')}</Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : null}

      {error ? (
        <Text style={styles.error}>
          {t(`social.errors.${error.code}`, { defaultValue: t('social.errors.generic') })}
        </Text>
      ) : null}

      {!loading && !error && debounced && !items.length ? (
        <Text style={styles.empty}>{t('social.searchEmpty')}</Text>
      ) : null}

      {!debounced ? (
        <Text style={styles.empty}>{t('social.searchIdle')}</Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.userId}
        renderItem={({ item }) => (
          <UserSearchResult
            profile={item}
            onPress={(profile) => router.push(`/user/${encodeURIComponent(profile.username)}`)}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
      />
      <Text style={styles.footerNote}>{t('social.privateExcluded')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchWrap: {
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  list: {
    paddingBottom: spacing.xl,
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
  error: {
    ...typography.caption,
    color: colors.status.dropped,
    paddingHorizontal: spacing.md,
  },
  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    padding: spacing.md,
  },
});
