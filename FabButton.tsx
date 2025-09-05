// FabButton.tsx
import React, { useEffect, useRef } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated, Easing, ViewStyle } from 'react-native';

type FabButtonProps = {
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
  style?: ViewStyle;
};

const FabButton: React.FC<FabButtonProps> = ({ listening, onStart, onStop, style }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (listening) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      scaleAnim.setValue(1);
    }
  }, [listening, scaleAnim]);

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <TouchableOpacity
        style={[styles.fab, listening ? styles.stop : styles.start]}
        onPress={listening ? onStop : onStart}
      >
        <Text style={styles.fabText}>{listening ? 'Stop' : 'Start'}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fab: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 30,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  start: {
    backgroundColor: '#007AFF',
  },
  stop: {
    backgroundColor: '#FF3B30',
  },
  fabText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default FabButton;
