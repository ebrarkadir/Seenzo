import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import WatchedMoviesGrid from '../../components/media/WatchedMoviesGrid';
import { colors } from '../../theme';

export default function MovieArchiveScreen() {
  const { t } = useTranslation();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <WatchedMoviesGrid emptyTitle={t('archive.emptyMovies')} emptyBody={t('archive.emptyMoviesBody')} />
    </View>
  );
}
