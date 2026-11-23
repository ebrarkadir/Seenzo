import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PrimaryButton from '../ui/PrimaryButton';
import { colors, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

/**
 * Signed-out first launch gateway.
 * Sign In / Create Account / Try Demo — not Welcome / Get Started.
 */
export default function AuthGateway() {
  const { t } = useTranslation();
  const { loadDemo } = useTracking();

  const startDemo = () => {
    loadDemo();
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.brand}>{t('common.appName')}</Text>
        <Text style={styles.title}>{t('authGateway.title')}</Text>
        <Text style={styles.body}>{t('authGateway.body')}</Text>
        <View style={styles.actions}>
          <PrimaryButton label={t('auth.signIn')} onPress={() => router.push('/sign-in')} />
          <PrimaryButton
            label={t('auth.createAccount')}
            variant="secondary"
            onPress={() => router.push('/sign-up')}
          />
          <PrimaryButton
            label={t('onboarding.tryDemo')}
            variant="secondary"
            onPress={startDemo}
          />
        </View>
        <Text style={styles.hint}>{t('onboarding.tryDemoHint')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  brand: {
    ...typography.label,
    color: colors.primary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    ...typography.hero,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
