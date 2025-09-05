// DynamicFormScreen.tsx
import { JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Switch,
  Alert,
  ScrollView,
  ListRenderItemInfo,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import Voice from '@react-native-voice/voice';
import Tts from 'react-native-tts';
import { Field } from './parser';
import { remoteParser } from './remoteParser';
import { coerceValue, validateField } from './utils';
import FabButton from './FabButton';

const { height: screenHeight } = Dimensions.get('window');

function OptionRow({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.optionRow, selected && styles.optionRowSelected]}>
      <Text style={{ color: selected ? '#fff' : '#000' }}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DynamicFormScreen({
  schema,
  initial = {},
  onSubmit,
}: {
  schema: Field[];
  initial?: Record<string, any>;
  onSubmit?: (state: Record<string, any>) => void;
}) {
  const [state, setState] = useState<Record<string, any>>(initial);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [appliedTranscript, setAppliedTranscript] = useState('');
  const [loading, setLoading] = useState(false);

  const schemaRef = useRef(schema);
  const remoteParserRef = useRef(remoteParser);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ref used to ignore any speech result callbacks after user pressed Stop.
  const ignoreResultsRef = useRef(false);

  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);



  useEffect(() => {
    // handlers use ignoreResultsRef.current to decide whether to apply results
    const handleSpeechResults = (e: any) => {
      if (ignoreResultsRef.current) return;
      const t = (e.value ?? []).join(' ').trim();
      setTranscript(t);
      setPartialTranscript('');
    };

    const handleSpeechPartialResults = (e: any) => {
      if (ignoreResultsRef.current) return;
      setPartialTranscript((e.value ?? []).join(' '));
    };

    const handleSpeechError = (err: any) => {
      console.warn('Voice error', err);
      setListening(false);
      setPartialTranscript('');
      setTranscript('');
    };

    Voice.onSpeechResults = handleSpeechResults;
    Voice.onSpeechPartialResults = handleSpeechPartialResults;
    Voice.onSpeechError = handleSpeechError;

    return () => {
      Voice.destroy().catch(() => { });
      Voice.removeAllListeners();
    };
  }, []);

  const startListening = useCallback(async () => {
    try {
      // Clear any previous timeout if it exists
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // allow results again
      ignoreResultsRef.current = false;
      setTranscript('');
      setPartialTranscript('');
      setAppliedTranscript(''); // optional: clear previous applied transcript when starting new listen
      await Voice.start('en-US');
      setListening(true);
    } catch (e) {
      console.warn('startListening', e);
      Alert.alert('Microphone error', 'Could not start speech recognition');
    }
  }, []);

  const stopListening = useCallback(async () => {
    // set flag to ignore any onSpeechResults that may arrive after we stop
    ignoreResultsRef.current = true;

    try {
      setLoading(true);
      await Voice.stop();
    } catch (e) {
      console.warn('Voice.stop error', e);
    }

    // flip listening state immediately so UI shows stopped
    setListening(false);

    // capture final transcript BEFORE we clear anything
    const finalTranscript = transcript || partialTranscript;

    // Immediately clear displayed transcripts for the UI (user requested this)
    setTranscript('');
    setPartialTranscript('');
    setAppliedTranscript(''); // clear the "applied" display immediately

    if (!finalTranscript) {
      setLoading(false);
      // allow results again for next session
      ignoreResultsRef.current = false;
      return;
    }

    // Send final transcript for parsing (async)
    remoteParserRef.current(schemaRef.current, finalTranscript)
      .then((updates) => {
        if (!updates || updates.length === 0) return;

        // Apply field updates to form state
        setState((prev) => {
          const next = { ...prev };
          for (const u of updates) {
            const field = schemaRef.current.find((f) => f.id === u.fieldId);
            if (field) {
              next[u.fieldId] = coerceValue(field, u.value);
            }
          }
          return next;
        });

        // Validate and collect talkback_text if present
        const newErrors: Record<string, string | null> = {};
        let talkBackSpeech = '';
        for (const u of updates) {
          const field = schemaRef.current.find((f) => f.id === u.fieldId);
          if (u?.fieldId === 'talkback_text') talkBackSpeech = u.value;
          if (field) newErrors[u.fieldId] = validateField(field, u.value);
        }
        setErrors((prev) => ({ ...(prev ?? {}), ...newErrors }));

        // Speak back if available
        if (talkBackSpeech) {
          Tts.speak(talkBackSpeech);
        }

        // NOTE: we intentionally DO NOT setAppliedTranscript(finalTranscript) here
        // because requirement is to clear transcript immediately on Stop.
      })
      .catch((err) => {
        console.warn('Parser error', err);
        Alert.alert('Parsing Error', 'Could not process your speech. Try again.');
      })
      .finally(() => {
        setLoading(false);
        // allow results again for future sessions
        ignoreResultsRef.current = false;
      });
  }, [transcript, partialTranscript]);

  // Effect to handle the auto-stop timer when there's a pause in speech
  useEffect(() => {
    // Only run this logic if we're currently listening
    if (!listening) {
      // If not listening, make sure no timer is active
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // Clear any existing timer to prevent it from triggering
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set a new timer. If it fires, it means there was a 5-second pause.
    timeoutRef.current = setTimeout(() => {
      console.log('5-second pause detected. Automatically stopping.');
      // Call the stop function. The useCallback hook ensures this is stable.
      stopListening();
    }, 4000);

    // Cleanup function for the effect
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [partialTranscript, listening, stopListening]);

  const renderField = useCallback(
    (item: ListRenderItemInfo<Field>) => {
      const field = item.item;
      const value = state[field.id];
      const hasError = !!errors[field.id];
      let fieldComponent: JSX.Element | null = null;

      switch (field.type) {
        case 'text':
        case 'email':
        case 'phone':
        case 'number':
        case 'date':
        case 'datetime':
        case 'time': {
          const inputValue = typeof value === 'number' ? String(value) : value ?? '';
          fieldComponent = (
            <TextInput
              style={[styles.input, hasError && styles.inputError]}
              value={inputValue}
              onChangeText={(t) => {
                setState((p) => ({ ...p, [field.id]: t }));
                setErrors((prev) => ({ ...prev, [field.id]: validateField(field, t) }));
              }}
              placeholder={field.label}
              keyboardType={field.type === 'number' ? 'numeric' : 'default'}
            />
          );
          break;
        }

        case 'switch':
          fieldComponent = (
            <Switch
              value={!!value}
              onValueChange={(v) => {
                setState((p) => ({ ...p, [field.id]: v }));
                setErrors((prev) => ({ ...prev, [field.id]: validateField(field, v) }));
              }}
              trackColor={{ false: '#767577', true: '#6DD5ED' }}
              thumbColor={value ? '#2196F3' : '#f4f3f4'}
            />
          );
          break;

        case 'radio':
        case 'select':
          fieldComponent = (
            <View style={[{ flexDirection: 'row', flexWrap: 'wrap' }, hasError && styles.groupError]}>
              {field.options?.map((opt) => (
                <OptionRow
                  key={opt.id}
                  label={opt.label}
                  selected={value === opt.id}
                  onPress={() => {
                    setState((p) => ({ ...p, [field.id]: opt.id }));
                    setErrors((prev) => ({ ...prev, [field.id]: validateField(field, opt.id) }));
                  }}
                />
              ))}
            </View>
          );
          break;

        case 'checkbox':
          fieldComponent = (
            <View style={[{ flexDirection: 'row', flexWrap: 'wrap' }, hasError && styles.groupError]}>
              {field.options?.map((opt) => {
                const arr: string[] = Array.isArray(value) ? value : [];
                const selected = arr.includes(opt.id);
                return (
                  <OptionRow
                    key={opt.id}
                    label={opt.label}
                    selected={selected}
                    onPress={() => {
                      setState((p) => {
                        const cur = Array.isArray(p[field.id]) ? [...p[field.id]] : [];
                        const nextArr = cur.includes(opt.id) ? cur.filter((x) => x !== opt.id) : [...cur, opt.id];
                        setErrors((prev) => ({ ...prev, [field.id]: validateField(field, nextArr) }));
                        return { ...p, [field.id]: nextArr };
                      });
                    }}
                  />
                );
              })}
            </View>
          );
          break;

        default:
          fieldComponent = <Text>Unsupported type: {field.type}</Text>;
      }

      return (
        <View key={field.id} style={styles.fieldContainer}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          {fieldComponent}
          {hasError && <Text style={styles.errorText}>{errors[field.id]}</Text>}
        </View>
      );
    },
    [state, errors]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Voice-Enabled Site Inspection Form</Text>

      <View style={styles.formContainer}>
        <FlatList contentContainerStyle={styles.listContent} data={schema} keyExtractor={(field) => field.id} renderItem={renderField} />
      </View>

      {/* Bottom container shows transcript only (cleared immediately on Stop) */}
      <View style={styles.bottomContainer}>
        <ScrollView contentContainerStyle={styles.transcriptScrollContent} showsVerticalScrollIndicator={true}>
          <Text style={styles.transcriptText}>Transcript: {listening ? (partialTranscript || '—') : (appliedTranscript || '—')}</Text>

          {loading && (
            <View style={{ marginTop: 8 }}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={{ color: '#666', marginTop: 6 }}>Analyzing speech…</Text>
            </View>
          )}
        </ScrollView>

        {/* Place FAB centered horizontally at bottom of bottom container */}
        <FabButton
          listening={listening}
          onStart={startListening}
          onStop={stopListening}
          style={{
            position: 'absolute',
            alignSelf: 'center',
            bottom: 10,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E8F1F2' },
  title: { fontWeight: '800', fontSize: 20, margin: 16, color: '#0D47A1', textAlign: 'center' },
  formContainer: { flex: 1 },
  listContent: { padding: 16 },
  fieldContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  fieldLabel: { marginBottom: 8, fontWeight: '600', fontSize: 16, color: '#333' },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, fontSize: 14, borderRadius: 8, backgroundColor: '#F9F9F9', color: '#333' },
  inputError: { borderColor: '#EF5350', borderWidth: 2 },
  optionRow: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#B0BEC5', marginRight: 8, marginBottom: 8 },
  optionRowSelected: { backgroundColor: '#42A5F5', borderColor: '#42A5F5' },
  groupError: { borderWidth: 2, borderColor: '#EF5350', borderRadius: 12, padding: 4 },
  errorText: { color: '#EF5350', marginTop: 6, fontSize: 12 },
  bottomContainer: {
    height: screenHeight * 0.22,
    minHeight: 70,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    borderColor: 'black',
    borderWidth: 0.6,
    elevation: 10,
    padding: 12,
  },
  transcriptScrollContent: { paddingBottom: 40 },
  transcriptText: { marginTop: 6, color: '#555', fontSize: 14, fontStyle: 'italic' },
});
