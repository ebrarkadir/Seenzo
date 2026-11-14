import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

export default function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
  autoComplete,
  keyboardType = 'default',
  textContentType,
  error,
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const hidden = secure && !visible;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.wrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={hidden}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          textContentType={textContentType}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(visible ? 'auth.hidePassword' : 'auth.showPassword')}
            onPress={() => setVisible((current) => !current)}
            hitSlop={8}
          >
            <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  error: {
    ...typography.caption,
    color: colors.status.dropped,
  },
});
