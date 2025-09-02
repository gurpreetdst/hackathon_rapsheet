import React, { useEffect, useRef } from 'react'
import { View, Button, Text } from 'react-native'
import RNFS from 'react-native-fs'

// Whisper RN
import { initWhisper, initWhisperVad } from 'whisper.rn'
import { RealtimeTranscriber } from 'whisper.rn'
import { AudioPcmStreamAdapter } from '@fugood/react-native-audio-pcm-stream'

// Demo Component
export default function WhisperRealtimeScreen() {
  const transcriberRef = useRef<RealtimeTranscriber | null>(null)
  const [status, setStatus] = React.useState('IDLE')
  const [lastTranscript, setLastTranscript] = React.useState<string>('')

  useEffect(() => {
    let mounted = true

    async function setup() {
      try {
        const whisperContext = await initWhisper({
          filePath: RNFS.DocumentDirectoryPath + '/whisper-model.bin', // update path as needed
        })
        const vadContext = await initWhisperVad({
          filePath: RNFS.DocumentDirectoryPath + '/vad-model.bin', // update path as needed
        })
        const audioStream = new AudioPcmStreamAdapter() // requires @fugood/react-native-audio-pcm-stream

        if (!mounted) return

        const transcriber = new RealtimeTranscriber(
          { whisperContext, vadContext, audioStream, fs: RNFS },
          {
            audioSliceSec: 30,
            vadPreset: 'default',
            autoSliceOnSpeechEnd: true,
            transcribeOptions: { language: 'en' },
          },
          {
            onTranscribe: (event) => {
              const result = event.data?.result ?? ''
              console.log('Transcription:', result)
              setLastTranscript(result)
            },
            onVad: (event) => {
              console.log('VAD:', event.type, event.confidence)
            },
            onStatusChange: (isActive) => {
              console.log('Status:', isActive ? 'ACTIVE' : 'INACTIVE')
              setStatus(isActive ? 'ACTIVE' : 'INACTIVE')
            },
            onError: (error) => {
              console.error('Error:', error)
              setStatus('ERROR')
            },
          },
        )

        transcriberRef.current = transcriber
      } catch (err) {
        console.error('Setup error:', err)
      }
    }

    setup()

    return () => {
      mounted = false
      if (transcriberRef.current) {
        transcriberRef.current.stop().catch(console.error)
      }
    }
  }, [])

  const handleStart = async () => {
    if (transcriberRef.current) {
      await transcriberRef.current.start()
      setStatus('STARTED')
    }
  }

  const handleStop = async () => {
    if (transcriberRef.current) {
      await transcriberRef.current.stop()
      setStatus('STOPPED')
    }
  }

  return (
    <View style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
      <Text style={{ fontSize: 18, marginBottom: 10 }}>Status: {status}</Text>
      <Text style={{ marginBottom: 20 }}>Transcript: {lastTranscript}</Text>
      <Button title="Start Transcription" onPress={handleStart} />
      <View style={{ height: 10 }} />
      <Button title="Stop Transcription" onPress={handleStop} />
    </View>
  )
}
