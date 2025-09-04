/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import RapSheet from './RapSheet';
import { Field } from './parser';
import { use, useEffect, useMemo, useState } from 'react';
import { generateFormFromAI } from './remoteParser';

const exampleSchema: Field[] = [
  { id: 'name', label: 'Full Name', type: 'text' },
  { id: 'dob', label: 'Date of Birth', type: 'date' },
  { id: 'gender', label: 'Gender', type: 'radio', options: [{ id: 'male', label: 'Male' }, { id: 'female', label: 'Female' }] },
  { id: 'city', label: 'City', type: 'select', options: [{ id: 'delhi', label: 'Delhi' }, { id: 'bang', label: 'Bangalore' }, { id: 'mum', label: 'Mumbai' }] },
  { id: 'email', label: 'Email Address', type: 'email' },
  { id: 'notify', label: 'Notify by email', type: 'switch' },
  { id: 'quantity', label: 'Quantity', type: 'number' }
];

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const [form, setForm] = useState<Field[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    generateFormFromAI("job application").then((fields) => {
      setForm(fields);
      setLoading(false);
    });
  }, []);
  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      {
        loading && form.length <= 0 ? <Text style={{ padding: 16 }}>Loading form...</Text> : <RapSheet schema={form} />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
