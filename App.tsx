import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import DashboardScreen from './src/DashboardScreen';
import TransactionsScreen from './src/TransactionsScreen';
import RulesScreen from './src/RulesScreen';
import ProfileScreen from './src/ProfileScreen';
import ErrorBoundary from './src/ErrorBoundary';

const Tab = createBottomTabNavigator();

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
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            // No icon set is wired up, so explicitly render none — otherwise
            // bottom-tabs falls back to a missing-glyph placeholder box.
            tabBarIcon: () => null,
            tabBarActiveTintColor: '#1E1B18',
            tabBarInactiveTintColor: '#8C7F73',
            tabBarStyle: { backgroundColor: '#FFFDF9', borderTopColor: '#E3D8CA' },
          }}
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
