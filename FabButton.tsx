// FabButton.tsx
import React, { useEffect, useRef } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated, Easing, ViewStyle } from 'react-native';
import { Mic, Square } from "lucide-react-native"; 

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
            toValue: 0.9,
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
        {listening ? <Square color="#fff" size={28} /> : <Mic color="#fff" size={28} />}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fab: {
    paddingHorizontal: 15,
    paddingVertical: 15,
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
    backgroundColor: '#E1372E',
  },
  fabText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default FabButton;
