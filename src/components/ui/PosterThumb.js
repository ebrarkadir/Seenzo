import { StyleSheet, View } from 'react-native';

import Artwork from '../../services/artwork/Artwork';
import { colors, radii } from '../../theme';

export default function PosterThumb({ uri, posterPath, width = 64, height = 96, status }) {
  return (
    <View style={{ width }}>
      <Artwork
        uri={uri}
        posterPath={posterPath}
        width={width}
        height={height}
        radius={radii.md}
      />
      {status ? (
        <View style={[styles.indicator, { backgroundColor: colors.status[status] || colors.textMuted }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    height: 4,
    borderBottomLeftRadius: radii.md,
    borderBottomRightRadius: radii.md,
  },
});
