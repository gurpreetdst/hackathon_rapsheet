import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Animated, Easing, Text, TouchableOpacity } from 'react-native';

const ListeningOverlay = ({ isListening, onStopListening }) => {
    const animatedValue = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isListening) {
            Animated.loop(
                Animated.timing(animatedValue, {
                    toValue: 1,
                    duration: 1000,
                    easing: Easing.linear,
                    useNativeDriver: true,
                })
            ).start();
        } else {
            animatedValue.stopAnimation();
            animatedValue.setValue(0);
        }
    }, [isListening]);

    const scale = animatedValue.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 1.2, 1],
    });

    const opacity = animatedValue.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.7, 0.3, 0.7],
    });

    if (!isListening) {
        return null;
    }

    return (
        <View style={styles.container}>
            <Animated.View style={[styles.pulse, { transform: [{ scale }], opacity }]} />
            <View style={styles.microphoneIcon} />
            <Text style={styles.listeningText}>Listening...</Text>
            <TouchableOpacity style={styles.stopButton} onPress={onStopListening}>
                <Text style={styles.stopButtonText}>Stop Listening</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute', // Position it on top
        bottom: 50, // Adjust this as needed
        left: '50%',
        transform: [{ translateX: -75 }], // Center it horizontally
        width: 150,
        height: 150,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 75,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        zIndex: 10, // Ensure it's on top
    },
    pulse: {
        position: 'absolute',
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: 'white',
    },
    microphoneIcon: {
        width: 60,
        height: 60,
        backgroundColor: 'white',
        borderRadius: 30,
    },
    listeningText: {
        color: 'white',
        marginTop: 10,
        fontSize: 16,
        fontWeight: 'bold',
    },
    stopButton: {
        marginTop: 10,
        backgroundColor: '#f66',
        paddingVertical: 5,
        paddingHorizontal: 15,
        borderRadius: 20,
    },
    stopButtonText: {
        color: 'white',
        fontWeight: 'bold',
    }
});

export default ListeningOverlay;