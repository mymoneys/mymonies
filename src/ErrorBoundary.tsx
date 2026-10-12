import { Component, ReactNode } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

type Props = {
  children: ReactNode;
  /** Shown in the fallback UI so it's obvious which screen crashed. */
  screenName: string;
};

type State = {
  error: Error | null;
};

/**
 * Wraps a single tab's screen. Without this, a render-time error anywhere
 * unmounts the whole React tree (including react-navigation's own state),
 * so every tab becomes unreachable until the app is force-reloaded — not
 * just the screen that actually broke. Scoping one boundary per tab means a
 * crash in, say, Dashboard leaves Transactions/Rules/Profile still usable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(`[ErrorBoundary:${this.props.screenName}]`, error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={styles.screen}>
          <View style={styles.card}>
            <Text style={styles.title}>{this.props.screenName} crashed</Text>
            <Text style={styles.message}>{this.state.error.message}</Text>
            <Pressable style={styles.button} onPress={this.reset}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F1EA',
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#FFFDF9',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E3D8CA',
  },
  title: {
    color: '#A3453C',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  message: {
    color: '#4E463E',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#1E1B18',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFDF9',
    fontWeight: '700',
  },
});
