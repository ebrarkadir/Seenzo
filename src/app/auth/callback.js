import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { completeAuthCallbackFromUrl } from '../../auth/authCallback';
import { getAuthEmailRedirectTo, isAuthCallbackUrl } from '../../auth/authRedirect';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { colors, spacing, typography } from '../../theme';

export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const linkingUrl = Linking.useURL();
  const [errorCode, setErrorCode] = useState(null);
  const [status, setStatus] = useState('working');
  const handledKey = useRef(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      const url = await resolveCallbackUrl(linkingUrl, params);
      if (!url) {
        return;
      }
      if (handledKey.current === url) {
        return;
      }
      handledKey.current = url;
      try {
        const result = await completeAuthCallbackFromUrl(url);
        if (!active) {
          return;
        }
        if (result.status === 'duplicate') {
          setStatus('done');
          router.replace('/');
          return;
        }
        if (!result.session) {
          setStatus('error');
          setErrorCode('link_invalid');
          return;
        }
        setStatus('done');
        router.replace('/');
      } catch (error) {
        if (!active) {
          return;
        }
        setStatus('error');
        setErrorCode(error?.code || 'link_invalid');
      }
    };

    run();
    return () => {
      active = false;
    };
  }, [linkingUrl, params]);

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
