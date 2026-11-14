import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthContext';
import { authErrorMessage, validateEmail, validatePassword } from '../auth/messages';
import AuthField from '../components/auth/AuthField';
import PrimaryButton from '../components/ui/PrimaryButton';
import { colors, spacing, typography } from '../theme';

export default function SignInScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { config, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  const finish = () => {
    router.replace('/(tabs)/profile');
  };

  const submit = async () => {
    const trimmedEmail = email.trim();
    if (trimmedEmail !== email) {
      setEmail(trimmedEmail);
    }
    const nextErrors = {};
    if (!validateEmail(trimmedEmail)) {
      nextErrors.email = t('auth.emailInvalid');
    }
    if (!validatePassword(password)) {
      nextErrors.password = t('auth.passwordShort');
    }
    setFieldError(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length || !config.ready) {
      return;
    }
    setLoading(true);
    try {
      const result = await signIn(trimmedEmail, password);
      if (result.error) {
        setFormError(authErrorMessage(t, result.error));
        return;
      }
      finish();
    } catch (error) {
      setFormError(authErrorMessage(t, error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('auth.signInTitle')}</Text>
        <Text style={styles.body}>{t('auth.signInBody')}</Text>
        {config.ready ? null : <Text style={styles.error}>{t(`auth.errors.${config.reason}`)}</Text>}
        <AuthField
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.emailPlaceholder')}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          error={fieldError.email}
        />
        <AuthField
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          placeholder={t('auth.passwordPlaceholder')}
          secure
          autoComplete="password"
          textContentType="password"
          error={fieldError.password}
        />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <View style={styles.actions}>
          <PrimaryButton label={loading ? t('auth.working') : t('auth.signIn')} onPress={submit} disabled={loading || !config.ready} />
          <PrimaryButton label={t('auth.createAccount')} variant="secondary" onPress={() => router.push('/sign-up')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  error: {
    ...typography.caption,
    color: colors.status.dropped,
  },
  actions: {
    gap: spacing.sm,
  },
});
