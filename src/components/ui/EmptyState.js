import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';
import PrimaryButton from './PrimaryButton';

export default function EmptyState({ title, body, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {primaryLabel ? <PrimaryButton label={primaryLabel} onPress={onPrimary} style={styles.button} /> : null}
      {secondaryLabel ? (
        <PrimaryButton label={secondaryLabel} onPress={onSecondary} variant="secondary" style={styles.button} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  button: {
    alignSelf: 'stretch',
  },
});
