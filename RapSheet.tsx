// DynamicFormScreen.tsx
import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import Voice from '@react-native-voice/voice';
import { Field, FieldUpdate, parseTranscript } from './parser';
import { remoteParser } from './remoteParser';
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

    useEffect(() => {
        Voice.onSpeechResults = (e: any) => {
            const t = (e.value ?? []).join(' ').trim();
            setTranscript(t);
        };
        Voice.onSpeechPartialResults = (e: any) => {
            setTranscript((e.value ?? []).join(' '));
        };
        Voice.onSpeechError = (err: any) => {
            console.warn('Voice error', err);
            // Alert.alert('Speech error', String(err?.error?.message ?? err));
            setListening(false);
        };
        return () => {
            Voice.destroy().catch(() => { });
            Voice.removeAllListeners();
        };
    }, []);

    const startListening = async () => {
        try {
            setTranscript('');
            setPreview([]);
            await Voice.start('en-US');
            setListening(true);
        } catch (e) {
            console.warn('startListening', e);
            Alert.alert('Microphone error', 'Could not start speech recognition');
        }
    };
    const stopListening = async () => {
        try {
            await Voice.stop();
        } catch (e) {
            console.warn('stopListening', e);
        } finally {
            setListening(false);
            handleTranscriptFinal(transcript);
        }
    };

    const handleTranscriptFinal = (text: string) => {
        // if (!text) return;
        remoteParser(schema, text).then(updates => {
            console.log('Transcript parsed, updates:', updates);
            setPreview(updates);
        })
    };

    const applyPreview = () => {
        const next = { ...state };
        for (const u of preview) {
            next[u.fieldId] = u.value;
        }
        setState(next);
        setPreview([]);
        setTranscript('');
    };

    const computeDiffLines = () => {
        return preview.map((u) => {
            const before = state[u.fieldId];
            return { fieldId: u.fieldId, label: schema.find((s) => s.id === u.fieldId)?.label ?? u.fieldId, before, after: u.value, confidence: u.confidence };
        });
    };

    // Renderers per field type
    const renderField = (field: Field) => {
        const value = state[field.id];
        switch (field.type) {
            case 'text':
            case 'email':
            case 'phone':
            case 'number':
            case 'date':
            case 'datetime':
            case 'time':
                return (
                    <TextInput
                        style={styles.input}
                        value={value ?? ''}
                        onChangeText={(t) => setState((p) => ({ ...p, [field.id]: t }))}
                        placeholder={field.label}
                        keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                    />
                );
            case 'switch':
                return <Switch value={!!value} onValueChange={(v) => setState((p) => ({ ...p, [field.id]: v }))} />;
            case 'radio':
            case 'select':
                return (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {field.options?.map((opt) => (
                            <OptionRow
                                key={opt.id}
                                label={opt.label}
                                selected={value === opt.id}
                                onPress={() => setState((p) => ({ ...p, [field.id]: opt.id }))}
                            />
                        ))}
                    </View>
                );
            case 'checkbox':
                return (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {field.options?.map((opt) => {
                            const arr: string[] = Array.isArray(value) ? value : [];
                            const selected = arr.includes(opt.id);
                            return (
                                <OptionRow
                                    key={opt.id}
                                    label={opt.label}
                                    selected={selected}
                                    onPress={() =>
                                        setState((p) => {
                                            const cur = Array.isArray(p[field.id]) ? [...p[field.id]] : [];
                                            if (cur.includes(opt.id)) {
                                                return { ...p, [field.id]: cur.filter((x) => x !== opt.id) };
                                            } else {
                                                cur.push(opt.id);
                                                return { ...p, [field.id]: cur };
                                            }
                                        })
                                    }
                                />
                            );
                        })}
                    </View>
                );
            default:
                return <Text>Unsupported type: {field.type}</Text>;
        }
    };

    return (
        <ScrollView style={{ padding: 16 }}>
            <Text style={{ fontWeight: '700', fontSize: 18, marginBottom: 12 }}>Dynamic Form</Text>

            {schema.map((field) => (
                <View key={field.id} style={{ marginBottom: 12 }}>
                    <Text style={{ marginBottom: 6, fontWeight: '600' }}>{field.label}</Text>
                    {renderField(field)}
                </View>
            ))}

            <View style={{ marginVertical: 12 }}>
                <TouchableOpacity
                    style={[styles.micBtn, listening ? styles.micActive : null]}
                    onPress={listening ? stopListening : startListening}
                >
                    <Text style={{ color: '#fff' }}>{listening ? 'Stop Listening' : '🎤 Autofill with Voice'}</Text>
                </TouchableOpacity>
                <Text style={{ marginTop: 6, color: '#444' }}>Transcript: {transcript || '—'}</Text>
            </View>

            <View style={{ marginVertical: 12 }}>
                <Text style={{ fontWeight: '700' }}>Preview changes (auto-detected)</Text>
                {computeDiffLines().length === 0 ? (
                    <Text style={{ color: '#666' }}>No auto-detected changes</Text>
                ) : (
                    computeDiffLines().map((d) => (
                        <View key={d.fieldId} style={styles.diffRow}>
                            <Text style={{ fontWeight: '600' }}>{d.label}</Text>
                            <Text>Before: {String(d.before ?? '—')}</Text>
                            <Text>After: {String(d.after)}</Text>
                            <Text style={{ color: '#666' }}>Confidence: {(d.confidence * 100).toFixed(0)}%</Text>
                        </View>
                    ))
                )}
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                    <TouchableOpacity onPress={applyPreview} style={[styles.applyBtn, { marginRight: 8 }]} disabled={computeDiffLines().length === 0}>
                        <Text style={{ color: '#fff' }}>Apply</Text>
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

            <View style={{ height: 64 }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    input: { borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 },
    optionRow: { padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#ddd', marginRight: 8, marginBottom: 8 },
    optionRowSelected: { backgroundColor: '#0a84ff', borderColor: '#0a84ff' },
    micBtn: { backgroundColor: '#0a84ff', padding: 12, alignItems: 'center', borderRadius: 8 },
    micActive: { backgroundColor: '#f66' },
    diffRow: { padding: 8, borderWidth: 1, borderColor: '#eee', marginTop: 8, borderRadius: 6 },
    applyBtn: { backgroundColor: '#0a84ff', padding: 10, borderRadius: 6 },
    cancelBtn: { padding: 10, borderRadius: 6, justifyContent: 'center' },
});
