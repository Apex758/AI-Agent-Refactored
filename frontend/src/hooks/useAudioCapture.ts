import { useState, useRef, useCallback, useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';

interface UseAudioCaptureOptions {
  onAudioData?: (audioData: ArrayBuffer) => void;
  visualizer?: boolean;
}

export function useAudioCapture(options: UseAudioCaptureOptions = {}) {
  const { onAudioData, visualizer = true } = options;
  
  const { voiceState, setVoiceState } = useChatStore();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const [permissionDenied, setPermissionDenied] = useState(false);
  
  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current || !visualizer) {
      return;
    }
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const normalizedLevel = Math.min(100, (average / 128) * 100);
    
    setVoiceState({ audioLevel: normalizedLevel });
    
    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, [setVoiceState, visualizer]);
  
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      
      streamRef.current = stream;
      
      // Set up audio context for visualization
      if (visualizer) {
        audioContextRef.current = new AudioContext();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        
        const source = audioContextRef.current.createMediaStreamSource(stream);
        source.connect(analyserRef.current);
        
        updateAudioLevel();
      }
      
      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && onAudioData) {
          const arrayBuffer = await event.data.arrayBuffer();
          onAudioData(arrayBuffer);
        }
      };
      
      mediaRecorder.start(100); // Collect data every 100ms
      mediaRecorderRef.current = mediaRecorder;
      
      setVoiceState({
        isRecording: true,
        localStream: stream,
      });
      
      setPermissionDenied(false);
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setPermissionDenied(true);
      }
    }
  }, [onAudioData, setVoiceState, updateAudioLevel, visualizer]);
  
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    
    setVoiceState({
      isRecording: false,
      audioLevel: 0,
      localStream: null,
    });
  }, [setVoiceState]);
  
  const toggleRecording = useCallback(() => {
    if (voiceState.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [voiceState.isRecording, startRecording, stopRecording]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);
  
  return {
    isRecording: voiceState.isRecording,
    audioLevel: voiceState.audioLevel,
    permissionDenied,
    startRecording,
    stopRecording,
    toggleRecording,
    stream: streamRef.current,
  };
}

// Audio playback hook
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  useEffect(() => {
    audioRef.current = new Audio();
    
    audioRef.current.ontimeupdate = () => {
      setCurrentTime(audioRef.current?.currentTime || 0);
    };
    
    audioRef.current.ondurationchange = () => {
      setDuration(audioRef.current?.duration || 0);
    };
    
    audioRef.current.onended = () => {
      setIsPlaying(false);
    };
    
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);
  
  const play = useCallback((src: string | ArrayBuffer) => {
    if (!audioRef.current) return;
    
    if (typeof src === 'string') {
      audioRef.current.src = src;
    } else {
      const blob = new Blob([src], { type: 'audio/webm' });
      audioRef.current.src = URL.createObjectURL(blob);
    }
    
    audioRef.current.play();
    setIsPlaying(true);
  }, []);
  
  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);
  
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);
  
  return {
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    stop,
  };
}