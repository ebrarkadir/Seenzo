import { useTranslation } from 'react-i18next';

import PlaceholderScreen from '../../components/PlaceholderScreen';

export default function ProfileScreen() {
  const { t } = useTranslation();

  return (
    <PlaceholderScreen
      title={t('profile.title')}
      description={t('profile.placeholder')}
    />
  );
}
