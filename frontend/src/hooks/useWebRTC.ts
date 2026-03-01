import { useRef, useCallback, useState, useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';

interface UseWebRTCOptions {
  serverUrl?: string;
}

interface PeerConnection {
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
}

export function useWebRTC(options: UseWebRTCOptions = {}) {
  const { serverUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000' } = options;
  
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const peerRef = useRef<PeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  const { setVoiceState } = useChatStore();
  
  // ICE servers configuration
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  
  // Initialize media stream
  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
        video: false,
      });
      
      setLocalStream(stream);
      setVoiceState({ localStream: stream });
      return stream;
    } catch (error) {
      console.error('Failed to get media devices:', error);
      throw error;
    }
  }, [setVoiceState]);
  
  // Create peer connection
  const createPeerConnection = useCallback(async (stream: MediaStream) => {
    const connection = new RTCPeerConnection({ iceServers });
    
    // Add local audio tracks
    stream.getTracks().forEach((track) => {
      connection.addTrack(track, stream);
    });
    
    // Handle incoming audio
    connection.ontrack = (event) => {
      const [remoteAudioStream] = event.streams;
      setRemoteStream(remoteAudioStream);
      setVoiceState({ isPlaying: true });
    };
    
    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice_candidate',
          candidate: event.candidate,
        }));
      }
    };
    
    // Handle connection state changes
    connection.onconnectionstatechange = () => {
      console.log('Connection state:', connection.connectionState);
      setIsConnected(connection.connectionState === 'connected');
    };
    
    // Create data channel for signaling
    const dataChannel = connection.createDataChannel('signaling');
    
    dataChannel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handleSignalingMessage(message, connection);
    };
    
    peerRef.current = { connection, dataChannel };
    return connection;
  }, [setVoiceState]);
  
  // Handle signaling messages
  const handleSignalingMessage = async (message: RTCSessionDescriptionInit | RTCIceCandidateInit, connection: RTCPeerConnection) => {
    switch (message.type) {
      case 'offer':
        await connection.setRemoteDescription(new RTCSessionDescription(message));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: answer }));
        break;
        
      case 'answer':
        await connection.setRemoteDescription(new RTCSessionDescription(message));
        break;
        
      case 'ice_candidate':
        if (message.candidate) {
          await connection.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
        break;
    }
  };
  
  // Connect to WebRTC server
  const connect = useCallback(async () => {
    if (isConnecting || isConnected) return;
    
    setIsConnecting(true);
    
    try {
      // Get media stream
      const stream = await initializeMedia();
      
      // Create peer connection
      const connection = await createPeerConnection(stream);
      
      // Create offer
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      
      // Connect to signaling server
      const ws = new WebSocket(`${serverUrl}/webrtc`);
      wsRef.current = ws;
      
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'offer', sdp: offer }));
      };
      
      ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'answer':
            await connection.setRemoteDescription(new RTCSessionDescription(message.sdp));
            break;
            
          case 'ice_candidate':
            if (message.candidate) {
              await connection.addIceCandidate(new RTCIceCandidate(message.candidate));
            }
            break;
        }
      };
      
      ws.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnecting(false);
      };
      
    } catch (error) {
      console.error('Failed to connect:', error);
      setIsConnecting(false);
      throw error;
    }
  }, [isConnecting, isConnected, serverUrl, initializeMedia, createPeerConnection]);
  
  // Disconnect
  const disconnect = useCallback(() => {
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    
    // Close peer connection
    if (peerRef.current) {
      peerRef.current.connection.close();
      peerRef.current = null;
    }
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setRemoteStream(null);
    setIsConnected(false);
    setIsConnecting(false);
    setVoiceState({ isRecording: false, isPlaying: false, localStream: null });
  }, [localStream, setVoiceState]);
  
  // Send audio data through data channel
  const sendAudioData = useCallback((data: ArrayBuffer) => {
    if (peerRef.current?.dataChannel?.readyState === 'open') {
      peerRef.current.dataChannel.send(data);
    }
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);
  
  return {
    isConnected,
    isConnecting,
    localStream,
    remoteStream,
    connect,
    disconnect,
    sendAudioData,
  };
}