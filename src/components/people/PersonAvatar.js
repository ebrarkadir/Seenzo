import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Artwork from '../../services/artwork/Artwork';
import { colors } from '../../theme';

export default function PersonAvatar({ headshotPath, size = 64 }) {
  if (headshotPath) {
    return (
      <Artwork
        posterPath={headshotPath}
        width={size}
        height={size}
        radius={size / 2}
      />
    );
  }
  return (
    <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="person" size={Math.round(size * 0.42)} color={colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
