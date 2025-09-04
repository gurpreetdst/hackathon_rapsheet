// DynamicFormScreen.tsx
import { JSX, useCallback, useEffect, useMemo, useState, useRef } from 'react';
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
  ListRenderItemInfo, Dimensions
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

  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  useEffect(() => {
    const handleSpeechResults = (e: any) => {
      setTranscript((e.value ?? []).join(' ').trim());
      setPartialTranscript('');
    };

    const handleSpeechPartialResults = (e: any) => {
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
      setTranscript('');
      setPartialTranscript('');
      await Voice.start('en-US');
      setListening(true);
    } catch (e) {
      console.warn('startListening', e);
      Alert.alert('Microphone error', 'Could not start speech recognition');
    }
  }, []);

  const stopListening = useCallback(async () => {
    try {
      setLoading(true);
      await Voice.stop();
    } catch (e) { console.warn(e); }
    setListening(false);

    const finalTranscript = transcript || partialTranscript;
    if (!finalTranscript) return;

    remoteParserRef.current(schemaRef.current, finalTranscript).then(updates => {
      if (!updates || updates.length === 0) return;

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

      const newErrors: Record<string, string | null> = {};
      let talkBackSpeech = "";
      for (const u of updates) {
        const field = schemaRef.current.find((f) => f.id === u.fieldId);
        if (u?.fieldId === 'talkback_text') {
          talkBackSpeech = u.value;
        }
        if (field) {
          newErrors[u.fieldId] = validateField(field, u.value);
        }
      }
      setErrors((prev) => ({ ...(prev ?? {}), ...newErrors }));

      Tts.speak(talkBackSpeech);

      setAppliedTranscript(finalTranscript);
      setTranscript('');
    }).catch(err => {
      console.warn('Parser error', err);
      Alert.alert('Parsing Error', 'Could not process your speech. Try again.');
    }).finally(() => {
      setLoading(false);
    });

    setPartialTranscript('');
    setTranscript('');
  }, [transcript, partialTranscript]);

  const renderField = useCallback((item: ListRenderItemInfo<Field>) => {
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
        {errors[field.id] && (
          <Text style={styles.errorText}>{errors[field.id]}</Text>
        )}
      </View>
    );
  }, [state, errors, schema]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Voice-Enabled Site Inspection Form</Text>

      <View style={styles.formContainer}>
        <FlatList
          contentContainerStyle={styles.listContent}
          data={schema}
          keyExtractor={(field) => field.id}
          renderItem={renderField}
        />
      </View>
      <FabButton
        listening={listening}
        onStart={startListening}
        onStop={stopListening}
        style={{
          position: 'absolute',
          right: 20,
          top: screenHeight / 2 - 30,
          zIndex: 100,
        }}
      />

      <View style={styles.bottomContainer}>
        <ScrollView
          contentContainerStyle={styles.transcriptScrollContent}
          showsVerticalScrollIndicator={true}
        >
          <Text style={styles.transcriptText}>
            Transcript: {listening ? (partialTranscript || '—') : (appliedTranscript || '—')}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8F1F2',
  },
  bottomContainer: {
    height: screenHeight * 0.2,
    minHeight: 60,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    borderColor: 'black',
    borderWidth: 0.7,
    elevation: 10,
    padding: 10,
  },
  transcriptScrollContent: {
    padding: 10,
  },
  title: {
    fontWeight: '800',
    fontSize: 20,
    margin: 16,
    color: '#0D47A1',
    textAlign: 'center',
  },
  formContainer: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
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
  fieldLabel: {
    marginBottom: 8,
    fontWeight: '600',
    fontSize: 16, // Reduced font size
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10, // Reduced padding
    fontSize: 14, // Reduced font size
    borderRadius: 8,
    backgroundColor: '#F9F9F9',
    color: '#333',
  },
  inputError: {
    borderColor: '#EF5350',
    borderWidth: 2,
  },
  optionRow: {
    paddingVertical: 8, // Reduced padding
    paddingHorizontal: 14, // Reduced padding
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#B0BEC5',
    marginRight: 8,
    marginBottom: 8,
  },
  optionRowSelected: {
    backgroundColor: '#42A5F5',
    borderColor: '#42A5F5',
  },
  groupError: {
    borderWidth: 2,
    borderColor: '#EF5350',
    borderRadius: 12,
    padding: 4,
  },
  errorText: {
    color: '#EF5350',
    marginTop: 6,
    fontSize: 12,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  micContainer: {
    marginBottom: 20,
  },
  micBtn: {
    backgroundColor: '#1E88E5',
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderRadius: 10,
    shadowColor: '#1E88E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  micActive: {
    backgroundColor: '#EF5350',
    shadowColor: '#EF5350',
  },
  micBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  transcriptText: {
    marginTop: 12,
    color: '#555',
    fontSize: 14,
    fontStyle: 'italic',
  },
  previewContainer: {
    marginTop: 10,
  },
  previewTitle: {
    fontWeight: '700',
    fontSize: 18,
    color: '#333',
    marginBottom: 10,
  },
  noPreviewText: {
    color: '#888',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 10,
  },
  diffRow: {
    backgroundColor: '#F9F9F9', // Subtle background color
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  diffLabel: {
    fontWeight: 'bold',
    color: '#1E88E5',
  },
  diffValue: {
    color: '#666',
    marginTop: 2,
  },
  diffConfidence: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 16,
    justifyContent: 'flex-start',
  },
  applyBtn: {
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    flex: 1,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  applyBtnDisabled: {
    backgroundColor: '#BDBDBD',
    shadowColor: 'transparent',
    elevation: 0,
  },
  applyBtnText: {
    color: 'white',
    fontWeight: 'bold',
  },
  applyBtnTextDisabled: {
    color: '#666',
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: '#E0E0E0', // Changed button color
    marginLeft: 10,
  },
  cancelBtnText: {
    color: '#555',
    fontWeight: '600',
  },
});