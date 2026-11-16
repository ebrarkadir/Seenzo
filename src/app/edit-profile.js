import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ProfileHeader from '../components/profile/ProfileHeader';
import PrimaryButton from '../components/ui/PrimaryButton';
import { useAuth } from '../auth/AuthContext';
import { useProfile } from '../profile/ProfileContext';
import {
  PROFILE_BIO_MAX,
  isValidBio,
  isValidDisplayName,
  isValidUsername,
  normalizeBio,
  normalizeDisplayName,
  normalizeUsername,
} from '../services/supabase/profileRules';
import { pickProfileImage } from '../services/supabase/profileMedia';
import { colors, radii, spacing, typography } from '../theme';

export default function EditProfileScreen() {
  const { userId } = useProfile();

  useEffect(() => {
    if (!userId) {
      router.replace('/(tabs)/profile');
    }
  }, [userId]);

  if (!userId) {
    return null;
  }

  return <EditProfileForm key={userId} />;
}

function EditProfileForm() {
  const { t } = useTranslation();
  const { email } = useAuth();
  const {
    profile,
    loading,
    saving,
    uploadProgress,
    saveProfile,
    uploadAndSaveImage,
    removeImage,
  } = useProfile();
  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [username, setUsername] = useState(profile.username || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [preview, setPreview] = useState({ avatarUrl: null, bannerUrl: null });
  const [pendingKind, setPendingKind] = useState(null);
  const [seedKey, setSeedKey] = useState(profile.updatedAt || 'empty');

  // Seed fields once profile finishes loading, without clobbering in-progress edits.
  if (!loading && !dirty && !saving && (profile.updatedAt || 'empty') !== seedKey) {
    setSeedKey(profile.updatedAt || 'empty');
    setDisplayName(profile.displayName || '');
    setUsername(profile.username || '');
    setBio(profile.bio || '');
    setLocalError(null);
    setStatusMessage(null);
  }

  const draftFields = useMemo(() => ({
    displayName: normalizeDisplayName(displayName),
    username: normalizeUsername(username),
    bio: normalizeBio(bio),
  }), [bio, displayName, username]);

  const headerProfile = useMemo(() => ({
    ...profile,
    displayName: draftFields.displayName || profile.displayName,
    username: draftFields.username || profile.username,
    bio: draftFields.bio,
    avatarUrl: preview.avatarUrl || profile.avatarUrl,
    bannerUrl: preview.bannerUrl || profile.bannerUrl,
  }), [draftFields, preview.avatarUrl, preview.bannerUrl, profile]);

  const markDirty = (setter) => (value) => {
    setDirty(true);
    setLocalError(null);
    setStatusMessage(null);
    setter(value);
  };

  const confirmDiscard = (onDiscard) => {
    if (!dirty && !saving && !preview.avatarUrl && !preview.bannerUrl) {
      onDiscard();
      return;
    }
    Alert.alert(t('profile.discardTitle'), t('profile.discardMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.discard'), style: 'destructive', onPress: onDiscard },
    ]);
  };

  const onSave = async () => {
    if (saving) {
      return;
    }
    if (!isValidDisplayName(draftFields.displayName)) {
      setLocalError('invalid_display_name');
      return;
    }
    if (!isValidUsername(draftFields.username)) {
      setLocalError('invalid_username');
      return;
    }
    if (!isValidBio(draftFields.bio)) {
      setLocalError('invalid_bio');
      return;
    }
    setLocalError(null);
    setStatusMessage(null);
    try {
      await saveProfile(draftFields);
      setDirty(false);
      Alert.alert(t('profile.saveSuccessTitle'), t('profile.saveSuccessBody'));
      router.back();
    } catch (error) {
      setLocalError(error.code || 'profile_save_failed');
    }
  };

  const pickAndUpload = async (kind) => {
    if (saving) {
      return;
    }
    setLocalError(null);
    setStatusMessage(null);
    try {
      const asset = await pickProfileImage(kind);
      if (!asset) {
        return;
      }
      setPreview((current) => ({
        ...current,
        [kind === 'avatar' ? 'avatarUrl' : 'bannerUrl']: asset.uri,
      }));
      setPendingKind(kind);
      setStatusMessage('uploadingPhoto');
      await uploadAndSaveImage(kind, asset);
      setPreview((current) => ({
        ...current,
        [kind === 'avatar' ? 'avatarUrl' : 'bannerUrl']: null,
      }));
      setPendingKind(null);
      setStatusMessage(null);
      Alert.alert(
        t('profile.photoSaveSuccessTitle'),
        t(kind === 'avatar' ? 'profile.avatarSaveSuccessBody' : 'profile.bannerSaveSuccessBody')
      );
    } catch (error) {
      setPendingKind(null);
      setStatusMessage(null);
      setLocalError(error.code || 'upload_failed');
    }
  };

  const onRemoveImage = async (kind) => {
    if (saving) {
      return;
    }
    const previewKey = kind === 'avatar' ? 'avatarUrl' : 'bannerUrl';
    const savedPath = kind === 'avatar' ? profile.avatarPath : profile.bannerPath;
    setLocalError(null);
    setStatusMessage(null);
    if (!savedPath && preview[previewKey]) {
      setPreview((current) => ({ ...current, [previewKey]: null }));
      return;
    }
    try {
      setPendingKind(kind);
      await removeImage(kind);
      setPreview((current) => ({ ...current, [previewKey]: null }));
      setPendingKind(null);
      setStatusMessage(null);
      Alert.alert(
        t('profile.photoRemovedTitle'),
        t(kind === 'avatar' ? 'profile.avatarRemovedBody' : 'profile.bannerRemovedBody')
      );
    } catch (error) {
      setPendingKind(null);
      setLocalError(error.code || 'profile_save_failed');
    }
  };

  const hasPreview = Boolean(preview.avatarUrl || preview.bannerUrl);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ProfileHeader
          profile={headerProfile}
          onPressAvatar={() => {
            Alert.alert(t('profile.avatarActions'), undefined, [
              { text: t('profile.choosePhoto'), onPress: () => pickAndUpload('avatar') },
              profile.avatarPath || preview.avatarUrl
                ? { text: t('profile.removePhoto'), style: 'destructive', onPress: () => onRemoveImage('avatar') }
                : null,
              { text: t('common.cancel'), style: 'cancel' },
            ].filter(Boolean));
          }}
          onPressBanner={() => {
            Alert.alert(t('profile.bannerActions'), undefined, [
              { text: t('profile.choosePhoto'), onPress: () => pickAndUpload('banner') },
              profile.bannerPath || preview.bannerUrl
                ? { text: t('profile.removePhoto'), style: 'destructive', onPress: () => onRemoveImage('banner') }
                : null,
              { text: t('common.cancel'), style: 'cancel' },
            ].filter(Boolean));
          }}
          onImageError={(kind) => {
            setLocalError(kind === 'banner' ? 'banner_load_failed' : 'avatar_load_failed');
          }}
        />

        <View style={styles.form}>
          {(dirty || hasPreview) && !saving ? (
            <Text style={styles.notice}>{t('profile.unsavedChanges')}</Text>
          ) : null}
          <Text style={styles.meta}>{t('profile.photoUploadsOnSelect')}</Text>
          <Field
            label={t('profile.displayName')}
            value={displayName}
            onChangeText={markDirty(setDisplayName)}
            maxLength={80}
            autoCapitalize="words"
          />
          <Field
            label={t('profile.username')}
            value={username}
            onChangeText={markDirty(setUsername)}
            maxLength={24}
            autoCapitalize="none"
            autoCorrect={false}
            prefix="@"
          />
          <Field
            label={t('profile.bio')}
            value={bio}
            onChangeText={markDirty(setBio)}
            maxLength={PROFILE_BIO_MAX}
            multiline
            helper={t('profile.bioCount', { count: normalizeBio(bio).length, max: PROFILE_BIO_MAX })}
          />
          <Text style={styles.meta}>{t('profile.emailReadOnly', { email })}</Text>
          {uploadProgress != null || pendingKind ? (
            <Text style={styles.meta}>
              {t('profile.uploadProgress', {
                percent: Math.round((uploadProgress == null ? 0.1 : uploadProgress) * 100),
              })}
            </Text>
          ) : null}
          {statusMessage ? <Text style={styles.meta}>{t(`profile.${statusMessage}`)}</Text> : null}
          {localError ? (
            <Text style={styles.error}>
              {t(`profile.errors.${localError}`, { defaultValue: t('profile.errors.generic') })}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label={saving ? t('profile.saving') : t('profile.save')}
            onPress={onSave}
            disabled={saving}
          />
          <PrimaryButton
            label={t('common.cancel')}
            variant="secondary"
            disabled={saving}
            onPress={() => confirmDiscard(() => router.back())}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  helper,
  prefix,
  multiline = false,
  ...rest
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, multiline && styles.inputMultiline]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, multiline && styles.inputArea]}
          multiline={multiline}
          {...rest}
        />
      </View>
      {helper ? <Text style={styles.meta}>{helper}</Text> : null}
    </View>
  );
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
  form: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  actions: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  inputWrap: {
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputMultiline: {
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  prefix: {
    ...typography.body,
    color: colors.textMuted,
    marginRight: 2,
  },
  input: {
    flex: 1,
    color: colors.text,
    ...typography.body,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },
  inputArea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  notice: {
    ...typography.caption,
    color: colors.primary,
  },
  error: {
    ...typography.caption,
    color: colors.status.dropped,
  },
});
