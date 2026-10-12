import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import DashboardScreen from './src/DashboardScreen';
import TransactionsScreen from './src/TransactionsScreen';
import RulesScreen from './src/RulesScreen';

const Tab = createBottomTabNavigator();

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
          <Tab.Screen name="Dashboard" component={DashboardScreen} />
          <Tab.Screen name="Transactions" component={TransactionsScreen} />
          <Tab.Screen name="Rules" component={RulesScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
