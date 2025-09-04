// DynamicFormScreen.tsx
import { JSX, useCallback, useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    // Only update the final transcript on the 'onSpeechResults' event
    Voice.onSpeechResults = (e: any) => {
      const t = (e.value ?? []).join(' ').trim();
      setTranscript(t); // Set final transcript
      setPartialTranscript(''); // Clear partial transcript
    };

    // Use onSpeechPartialResults for real-time preview only
    Voice.onSpeechPartialResults = (e: any) => {
      setPartialTranscript((e.value ?? []).join(' '));
    };

    Voice.onSpeechError = (err: any) => {
      console.warn('Voice error', err);
      setListening(false);
      setPartialTranscript('');
      setTranscript(''); // Clear transcript on error
    };

    return () => {
      Voice.destroy().catch(() => { });
      Voice.removeAllListeners();
    };
  }, []);

  const handleTranscriptFinal = useCallback((text: string) => {
    if (!text) return;
    remoteParser(schema, text).then(updates => {
      console.log('Transcript parsed, updates:', updates);
      setPreview(updates);
    });
  }, [schema]);

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
    } catch (e) {
      console.warn('stopListening', e);
    } finally {
      setListening(false);
      // Pass the final transcript to the parser
      handleTranscriptFinal(transcript);
    }
  }, [transcript, handleTranscriptFinal]);

  const applyPreview = useCallback(() => {
    if (!preview || preview.length === 0) {
      setTranscript('');
      return;
    }

    // 1. Apply all preview values as-is
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

    // 2. Validate after applying → update errors
    const newErrors: Record<string, string | null> = {};
    for (const u of preview) {
      const field = schema.find((f) => f.id === u.fieldId);
      if (field) {
        newErrors[u.fieldId] = validateField(field, u.value);
      }
    }
    setErrors((prev) => ({ ...(prev ?? {}), ...newErrors }));

    // 3. Clear preview and reset transcript (fresh speech next time)
    setPreview([]);
    setTranscript('');
  }, [preview, schema]);



  // const computeDiffLines = useMemo(() => {
  //   return preview.map((u) => {
  //     const before = state[u.fieldId];
  //     return { fieldId: u.fieldId, label: schema.find((s) => s.id === u.fieldId)?.label ?? u.fieldId, before, after: u.value, confidence: u.confidence };
  //   });
  // }, [preview, state, schema]);

  const computeDiffLines = useMemo(() => {
    return preview.map((u) => {
      const field = schema.find((s) => s.id === u.fieldId);
      const before = state[u.fieldId];

      // Do not show error at all in preview
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
      <View key={field.id} style={{ marginBottom: 12 }}>
        <Text style={{ marginBottom: 6, fontWeight: '600' }}>{field.label}</Text>
        {fieldComponent}
        {errors[field.id] && (
          <Text style={{ color: 'red', marginTop: 4 }}>{errors[field.id]}</Text>
        )}
      </View>
    );
  }, [state, errors, schema]);



  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontWeight: '700', fontSize: 18, margin: 12 }}>Dynamic Form</Text>
      <View style={{ flex: 0.5, flexGrow: 1 }} >
        <FlatList contentContainerStyle={{ padding: 16 }}
          data={schema}
          keyExtractor={(field) => field.id}
          renderItem={renderField}
        />
      </View>
      <View style={{ flex: 0.5, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' }}>
        <ScrollView contentContainerStyle={{ padding: 16, marginBottom: 24 }} overScrollMode='never' scrollToOverflowEnabled={false}>
          <View style={{ marginVertical: 12 }}>
            <TouchableOpacity
              style={[styles.micBtn, listening ? styles.micActive : null]}
              onPress={listening ? stopListening : startListening}
            >
              <Text style={{ color: '#fff' }}>{listening ? 'Stop Listening' : '🎤 Autofill with Voice'}</Text>
            </TouchableOpacity>
            <Text style={{ marginTop: 6, color: '#444' }}>Transcript: {transcript || partialTranscript || '—'}</Text>
          </View>

          <View style={{ marginVertical: 12 }}>
            <Text style={{ fontWeight: '700' }}>Preview changes (auto-detected)</Text>
            {computeDiffLines.map((d) => (
              <View key={d.fieldId} style={styles.diffRow}>
                <Text style={{ fontWeight: '600' }}>{d.label}</Text>
                <Text>Before: {String(d.before ?? '—')}</Text>
                <Text>After: {String(d.after)}</Text>
                <Text style={{ color: '#666' }}>
                  Confidence: {(d.confidence * 100).toFixed(0)}%
                </Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
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
                  setTranscript('');
                }}
                style={styles.cancelBtn}
              >
                <Text>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 },
  optionRow: { padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#ddd', marginRight: 8, marginBottom: 8 },
  optionRowSelected: { backgroundColor: '#0a84ff', borderColor: '#0a84ff' },
  micBtn: { backgroundColor: '#0a84ff', padding: 12, alignItems: 'center', borderRadius: 8 },
  micActive: { backgroundColor: '#f66' },
  diffRow: { padding: 8, borderWidth: 1, borderColor: '#eee', marginTop: 8, borderRadius: 6 },
  cancelBtn: { padding: 10, borderRadius: 6, justifyContent: 'center' },
  inputError: { borderColor: '#ff3b30' },
  groupError: { borderWidth: 1, borderColor: '#ff3b30', borderRadius: 6, padding: 4 },
  errorText: { color: '#ff3b30', marginTop: 4 },
  applyBtn: {
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#0a84ff'
  },
  applyBtnDisabled: {
    backgroundColor: '#ccc', // grey
  },
  applyBtnText: {
    color: 'white',
  },
  applyBtnTextDisabled: {
    color: '#888', // dimmed text when disabled
  },
});