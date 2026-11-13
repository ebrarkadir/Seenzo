import { Image, StyleSheet, View } from 'react-native';

import { colors, radii } from '../../theme';

export default function PosterThumb({ uri, width = 64, height = 96, status }) {
  return (
    <View style={{ width }}>
      <Image
        source={{ uri }}
        resizeMode="cover"
        style={[
          styles.image,
          { width, height },
          status ? styles.imageCropped : styles.imageRounded,
        ]}
      />
      {status ? (
        <View style={[styles.indicator, { backgroundColor: colors.status[status] || colors.textMuted }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surfaceElevated,
  },
  imageCropped: {
    borderTopLeftRadius: radii.md,
    borderTopRightRadius: radii.md,
  },
  imageRounded: {
    borderRadius: radii.md,
  },
  indicator: {
    height: 4,
    borderBottomLeftRadius: radii.md,
    borderBottomRightRadius: radii.md,
  },
});
