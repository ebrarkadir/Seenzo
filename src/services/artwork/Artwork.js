import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { colors, radii } from '../../theme';
import { cachedArtworkUri } from './cache';

function directPoster(uri) {
  if (!uri || typeof uri !== 'string' || uri.includes('trakt.tv')) {
    return null;
  }
  return uri;
}

export default function Artwork({ uri, posterPath, width, height, radius = radii.md }) {
  const safeUri = directPoster(uri);
  const [localUri, setLocalUri] = useState(safeUri);

  useEffect(() => {
    if (safeUri || !posterPath) {
      return undefined;
    }
    let active = true;
    cachedArtworkUri(posterPath).then((next) => {
      if (active) {
        setLocalUri(next);
      }
    });
    return () => {
      active = false;
    };
  }, [posterPath, safeUri]);

  if (!localUri) {
    return <View style={{ width, height, borderRadius: radius, backgroundColor: colors.surfaceElevated }} />;
  }

  return (
    <Image
      source={{ uri: localUri }}
      resizeMode="cover"
      style={{ width, height, borderRadius: radius, backgroundColor: colors.surfaceElevated }}
    />
  );
}
