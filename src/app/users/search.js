import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useEffect } from 'react';

import PeopleDiscoveryPanel from '../../components/social/PeopleDiscoveryPanel';
import { useAuth } from '../../auth/AuthContext';
import { colors } from '../../theme';

/**
 * Deep-link / stack route for Find People.
 * Prefer Social → People for in-app discovery; this route stays for bookmarks and older links.
 */
export default function UserSearchScreen() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace('/sign-in');
    }
  }, [session?.user?.id]);

  return (
    <View style={styles.screen}>
      <PeopleDiscoveryPanel autoFocus />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
