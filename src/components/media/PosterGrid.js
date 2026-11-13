import { FlatList, useWindowDimensions, View } from 'react-native';

import { spacing } from '../../theme';
import { posterSize } from './PosterTile';

export default function PosterGrid({
  data,
  keyExtractor,
  renderItem,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  contentBottom = spacing.lg,
  onEndReached,
}) {
  const { width } = useWindowDimensions();
  const size = posterSize(width);

  return (
    <FlatList
      data={data}
      keyExtractor={keyExtractor}
      numColumns={2}
      columnWrapperStyle={data.length ? { gap: size.gap, paddingHorizontal: spacing.md, marginBottom: size.gap } : undefined}
      contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: contentBottom, flexGrow: 1 }}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={ListFooterComponent}
      ListEmptyComponent={ListEmptyComponent}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      renderItem={({ item }) => <View style={{ width: size.width }}>{renderItem(item, size)}</View>}
    />
  );
}
