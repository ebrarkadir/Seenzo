import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthContext';
import { authErrorMessage, isEmailAddressInvalid, validateEmail, validatePassword } from '../auth/messages';
import AuthField from '../components/auth/AuthField';
import PrimaryButton from '../components/ui/PrimaryButton';
import { colors, spacing, typography } from '../theme';

export default function SignUpScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { config, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

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
    if (password !== confirm) {
      nextErrors.confirm = t('auth.passwordMismatch');
    }
    setFieldError(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length || !config.ready) {
      return;
    }
    setLoading(true);
    try {
      const result = await signUp(trimmedEmail, password);
      if (result.error) {
        const message = authErrorMessage(t, result.error);
        if (isEmailAddressInvalid(result.error)) {
          setFieldError({ email: message });
          return;
        }
        setFormError(message);
        return;
      }
      if (result.existingAccount) {
        setFormError(t('auth.errors.exists'));
        return;
      }
      if (result.confirmationRequired || !result.session) {
        setConfirmation(true);
        return;
      }
      finish();
    } catch (error) {
      setFormError(authErrorMessage(t, error));
    } finally {
      setLoading(false);
    }
  };

  if (confirmation) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.title}>{t('auth.confirmTitle')}</Text>
        <Text style={styles.body}>{t('auth.confirmBody')}</Text>
        <PrimaryButton label={t('auth.backToSignIn')} onPress={() => router.replace('/sign-in')} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('auth.signUpTitle')}</Text>
        <Text style={styles.body}>{t('auth.signUpBody')}</Text>
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
          autoComplete="new-password"
          textContentType="newPassword"
          error={fieldError.password}
        />
        <AuthField
          label={t('auth.confirmPassword')}
          value={confirm}
          onChangeText={setConfirm}
          placeholder={t('auth.passwordPlaceholder')}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          error={fieldError.confirm}
        />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <View style={styles.actions}>
          <PrimaryButton label={loading ? t('auth.working') : t('auth.createAccount')} onPress={submit} disabled={loading || !config.ready} />
          <PrimaryButton label={t('auth.haveAccount')} variant="secondary" onPress={() => router.replace('/sign-in')} disabled={loading} />
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
