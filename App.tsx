import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DashboardScreen from './src/DashboardScreen';
import TransactionsScreen from './src/TransactionsScreen';
import RulesScreen from './src/RulesScreen';
import ProfileScreen from './src/ProfileScreen';
import ErrorBoundary from './src/ErrorBoundary';
import { useBackgroundMaintenance } from './src/backgroundSync';

const Tab = createBottomTabNavigator();

type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IoniconName; inactive: IoniconName }> = {
  Dashboard: { active: 'home', inactive: 'home-outline' },
  Transactions: { active: 'receipt', inactive: 'receipt-outline' },
  Rules: { active: 'pricetags', inactive: 'pricetags-outline' },
  Profile: { active: 'person-circle', inactive: 'person-circle-outline' },
};

// Tab.Screen's `component` prop needs a component, not a pre-built element,
// so each tab is wrapped in its own named component here rather than inline
// in the navigator — that also gives the boundary's fallback UI a real name.
function DashboardTab() {
  return (
    <ErrorBoundary screenName="Dashboard">
      <DashboardScreen />
    </ErrorBoundary>
  );
}
function TransactionsTab() {
  return (
    <ErrorBoundary screenName="Transactions">
      <TransactionsScreen />
    </ErrorBoundary>
  );
}
function RulesTab() {
  return (
    <ErrorBoundary screenName="Rules">
      <RulesScreen />
    </ErrorBoundary>
  );
}
function ProfileTab() {
  return (
    <ErrorBoundary screenName="Profile">
      <ProfileScreen />
    </ErrorBoundary>
  );
}

export default function App() {
  // Always mounted regardless of which tab is active — unlike the per-screen
  // effects this replaced, which silently stopped whenever a different tab
  // was open (bottom-tabs lazy-mounts screens).
  useBackgroundMaintenance();

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarIcon: ({ color, size, focused }) => {
              const icons = TAB_ICONS[route.name];
              return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
            },
            tabBarActiveTintColor: '#1E1B18',
            tabBarInactiveTintColor: '#8C7F73',
            tabBarStyle: { backgroundColor: '#FFFDF9', borderTopColor: '#E3D8CA' },
          })}
        >
          <Tab.Screen name="Dashboard" component={DashboardTab} />
          <Tab.Screen name="Transactions" component={TransactionsTab} />
          <Tab.Screen name="Rules" component={RulesTab} />
          <Tab.Screen name="Profile" component={ProfileTab} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
