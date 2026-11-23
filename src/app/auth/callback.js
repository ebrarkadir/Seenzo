import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../auth/AuthContext';
import { completeAuthCallbackFromUrl } from '../../auth/authCallback';
import { getAuthEmailRedirectTo, isAuthCallbackUrl } from '../../auth/authRedirect';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { colors, spacing, typography } from '../../theme';

const RESOLVE_TIMEOUT_MS = 12000;

export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const linkingUrl = Linking.useURL();
  const { session } = useAuth();
  const [errorCode, setErrorCode] = useState(null);
  const [status, setStatus] = useState('working');
  const handledKey = useRef(null);
  const finishedRef = useRef(false);
  const paramsRef = useRef(params);
  const sessionRef = useRef(session);
  const paramSignature = useMemo(() => serializeParams(params), [params]);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const finishSuccess = () => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    setStatus('done');
    router.replace('/');
  };

  const finishError = (code) => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    setStatus('error');
    setErrorCode(code || 'link_invalid');
  };

  // If AuthContext already has a session (exchange completed / restored), leave the spinner.
  useEffect(() => {
    if (session?.user?.id && status === 'working') {
      finishSuccess();
    }
  }, [session, status]);

  // Never leave "Confirming…" forever when the deep link payload never arrives.
  useEffect(() => {
    if (status !== 'working') {
      return undefined;
    }
    const timer = setTimeout(() => {
      finishError('link_timeout');
    }, RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const url = await resolveCallbackUrl(linkingUrl, paramsRef.current);
      if (cancelled || finishedRef.current) {
        return;
      }
      // URL may arrive on a later linking event — keep waiting until the timeout.
      if (!url) {
        return;
      }
      if (handledKey.current === url) {
        return;
      }
      handledKey.current = url;

      try {
        const result = await completeAuthCallbackFromUrl(url);
        // Success must navigate even if this effect was cleaned up (param identity races).
        if (result.session) {
          finishSuccess();
          return;
        }
        if (result.status === 'duplicate') {
          if (sessionRef.current?.user?.id) {
            finishSuccess();
            return;
          }
          finishError('link_used');
          return;
        }
        finishError('link_invalid');
      } catch (error) {
        finishError(error?.code || 'link_invalid');
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [linkingUrl, paramSignature]);

  if (status === 'error') {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{t('auth.callbackErrorTitle')}</Text>
        <Text style={styles.body}>
          {t(`auth.errors.${errorCode}`, { defaultValue: t('auth.errors.link_invalid') })}
        </Text>
        <PrimaryButton label={t('auth.backToSignIn')} onPress={() => router.replace('/sign-in')} />
        <PrimaryButton
          label={t('auth.openSignUp')}
          variant="secondary"
          onPress={() => router.replace('/sign-up')}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.body}>{t('auth.callbackWorking')}</Text>
    </View>
  );
}

function serializeParams(params) {
  return Object.keys(params || {})
    .sort()
    .map((key) => {
      const value = params[key];
      const text = Array.isArray(value) ? value[0] : value;
      return `${key}=${text == null ? '' : String(text)}`;
    })
    .join('&');
}

async function resolveCallbackUrl(linkingUrl, params) {
  if (linkingUrl && (isAuthCallbackUrl(linkingUrl) || linkingUrl.includes('code=') || linkingUrl.includes('access_token') || linkingUrl.includes('token_hash'))) {
    return linkingUrl;
  }
  const initial = await Linking.getInitialURL();
  if (initial && (isAuthCallbackUrl(initial) || initial.includes('code=') || initial.includes('access_token') || initial.includes('token_hash'))) {
    return initial;
  }
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null) {
      return;
    }
    const text = Array.isArray(value) ? value[0] : value;
    if (text != null && String(text).length) {
      search.set(key, String(text));
    }
  });
  const query = search.toString();
  if (!query) {
    return null;
  }
  return `${getAuthEmailRedirectTo()}?${query}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
