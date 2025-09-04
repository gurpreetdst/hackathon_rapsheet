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
  ListRenderItemInfo,
} from 'react-native';
import Voice from '@react-native-voice/voice';
import { Field, FieldUpdate } from './parser';
import { remoteParser } from './remoteParser';
import { coerceValue, validateField } from './utils';
// const hardCodeSpeech = "My name is Gurpreet Singh dhalla, email gurpreet@example.com, phone +91 98765 43210, I live in Bangalore and I'm 29 years old male born on 4th june 1996. Subscribe: yes"
// Simple UI primitives for select/radio/checkbox
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
  const [preview, setPreview] = useState<FieldUpdate[]>([]);
  const [partialTranscript, setPartialTranscript] = useState(''); // New state for partial results
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [appliedTranscript, setAppliedTranscript] = useState(''); // applied text

  // Use a ref to store a stable reference to the schema and remoteParser function
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

    // Partial results just update partialTranscript
    const handleSpeechPartialResults = (e: any) => {
      setPartialTranscript((e.value ?? []).join(' '));
    };

    const handleSpeechError = (err: any) => {
      console.warn('Voice error', err);
      setListening(false);
      setPartialTranscript('');
      setTranscript(''); // Clear transcript on error
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
      setPreview([]);
      await Voice.start('en-US');
      setListening(true);
    } catch (e) {
      console.warn('startListening', e);
      Alert.alert('Microphone error', 'Could not start speech recognition');
    }
  }, []);

  const stopListening = useCallback(async () => {
    try {
      await Voice.stop();
    } catch (e) { console.warn(e); }
    setListening(false);

    const finalTranscript = transcript || partialTranscript;
    if (!finalTranscript) return;

    remoteParserRef.current(schemaRef.current, finalTranscript).then(updates => {
      setPreview(updates);
      setAppliedTranscript(finalTranscript); // store applied version separately
    });

    setPartialTranscript('');
    setTranscript('');
  }, [transcript, partialTranscript]);


  const applyPreview = useCallback(() => {
    if (!preview || preview.length === 0) {
      return;
    }

    // 1. Apply all preview values to state
    setState((prev) => {
      const next = { ...prev };
      for (const u of preview) {
        const field = schema.find((f) => f.id === u.fieldId);
        if (field) {
          next[u.fieldId] = coerceValue(field, u.value);
        }
      }
      return next;
    });

    // 2. Validate applied values → update errors
    const newErrors: Record<string, string | null> = {};
    for (const u of preview) {
      const field = schema.find((f) => f.id === u.fieldId);
      if (field) {
        newErrors[u.fieldId] = validateField(field, u.value);
      }
    }
    setErrors((prev) => ({ ...(prev ?? {}), ...newErrors }));

    // 3. Clear preview and store applied transcript
    setPreview([]);
    setAppliedTranscript(''); // preserve applied text
    setTranscript(''); // clear live speech transcript for next session
  }, [preview, schema]);

  const computeDiffLines = useMemo(() => {
    return preview.map((u) => {
      const field = schema.find((s) => s.id === u.fieldId);
      const before = state[u.fieldId];
      const isInvalid = field ? !!validateField(field, u.value) : false;

      return {
        fieldId: u.fieldId,
        label: field?.label ?? u.fieldId,
        before,
        after: u.value,
        confidence: isInvalid ? 0 : u.confidence, // 0% confidence for invalid values
      };
    });
  }, [preview, state, schema]);

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
                      // update errors based on the new array
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
      <Text style={styles.title}>Voice-Enabled Form</Text>
      <View style={styles.formContainer}>
        <FlatList contentContainerStyle={styles.listContent}
          data={schema}
          keyExtractor={(field) => field.id}
          renderItem={renderField}
        />
      </View>
      <View style={styles.bottomContainer}>
        <ScrollView contentContainerStyle={styles.scrollContent} overScrollMode='never' scrollToOverflowEnabled={false}>
          <View style={styles.micContainer}>
            <TouchableOpacity
              style={[styles.micBtn, listening ? styles.micActive : null]}
              onPress={listening ? stopListening : startListening}
            >
              <Text style={styles.micBtnText}>{listening ? 'Stop Listening' : '🎤 Autofill with Voice'}</Text>
            </TouchableOpacity>
            <Text style={styles.transcriptText}>
              Transcript: {listening ? (partialTranscript || '—') : (appliedTranscript || '—')}
            </Text>
          </View>

          <View style={styles.previewContainer}>
            <Text style={styles.previewTitle}>Preview Changes</Text>
            {computeDiffLines.length > 0 ? computeDiffLines.map((d) => (
              <View key={d.fieldId} style={styles.diffRow}>
                <Text style={styles.diffLabel}>{d.label}</Text>
                <Text style={styles.diffValue}>Before: {String(d.before ?? '—')}</Text>
                <Text style={styles.diffValue}>After: {String(d.after)}</Text>
                <Text style={styles.diffConfidence}>
                  Confidence: {(d.confidence * 100).toFixed(0)}%
                </Text>
              </View>
            )) : <Text style={styles.noPreviewText}>No changes detected.</Text>}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                onPress={applyPreview}
                style={[
                  styles.applyBtn,
                  computeDiffLines.length === 0 && styles.applyBtnDisabled,
                  { marginRight: 8 }
                ]}
                disabled={computeDiffLines.length === 0}
              >
                <Text style={computeDiffLines.length === 0 ? styles.applyBtnTextDisabled : styles.applyBtnText}>
                  Apply
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setPreview([]);
                }}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
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
  title: {
    fontWeight: '800',
    fontSize: 24,
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
  bottomContainer: {
    flex: 0.5,
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
    marginTop: 10,
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