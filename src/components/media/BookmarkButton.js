import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../theme';

export default function BookmarkButton({ active, label, onPress, style }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={8}
      onPress={onPress}
      style={[styles.button, style]}
    >
      <Ionicons name={active ? 'bookmark' : 'bookmark-outline'} size={18} color={active ? colors.primary : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 16, 21, 0.78)',
  },
});
