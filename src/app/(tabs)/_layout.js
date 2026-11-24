import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../../theme';

function TabBarIcon({ outlineName, filledName, color, size, focused }) {
  return <Ionicons name={focused ? filledName : outlineName} size={size} color={color} />;
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          height: 56 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
        },
        tabBarItemStyle: {
          paddingHorizontal: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: 2,
        },
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.tv'),
          tabBarLabel: t('tabs.tvShort'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon outlineName="tv-outline" filledName="tv" color={color} size={size} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          title: t('tabs.movies'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon outlineName="film-outline" filledName="film" color={color} size={size} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: t('tabs.discover'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon
              outlineName="compass-outline"
              filledName="compass"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="social"
        options={{
          title: t('tabs.social'),
          headerShown: false,
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon
              outlineName="people-outline"
              filledName="people"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon
              outlineName="person-outline"
              filledName="person"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
