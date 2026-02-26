'use strict';

/**
 * VoiceChat Manager
 * Handles WebRTC peer connections, audio streaming, and voice activity detection
 */

class VoiceChat {
    constructor(socket) {
        this.socket = socket;
        this.peers = {};              // peerId -> SimplePeer instance
        this.audioElements = {};      // userId -> HTMLAudioElement
        this.localStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.isMicEnabled = false;
        this.isSpeaking = false;
        this.currentUserId = null;
        this.micStream = null;
        this.vadThreshold = 30;       // Voice activity detection threshold
        this.vadSmoothingFactor = 0.3;
        this.smoothedLevel = 0;
        this.vadCheckInterval = null;
        this.dataChannels = {};       // peerId -> DataChannel for metadata
        
        this.setupSocketListeners();
        this.setupAudioContext();
    }

    /**
     * Setup Audio Context for voice activity detection
     */
    setupAudioContext() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        try {
            this.audioContext = new AudioCtx();
        } catch (e) {
            console.error('Web Audio API not supported:', e);
        }
    }

    /**
     * Setup Socket.io listeners for WebRTC signaling
     */
    setupSocketListeners() {
        this.socket.on('voice-offer', (data) => {
            this.handleOffer(data);
        });

        this.socket.on('voice-answer', (data) => {
            this.handleAnswer(data);
        });

        this.socket.on('voice-ice-candidate', (data) => {
            this.handleIceCandidate(data);
        });

        this.socket.on('voice-user-left', (data) => {
            this.closePeer(data.userId);
        });
    }

    /**
     * Request microphone access and enable voice chat
     */
    async enableMicrophone() {
        try {
            if (this.isMicEnabled) return;

            // Request microphone permission
            this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false,  // We'll handle gain manually for VAD
                }
            });

            if (!this.audioContext) {
                this.setupAudioContext();
            }

            // Resume audio context if suspended
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.isMicEnabled = true;
            this.setupVoiceActivityDetection();
            this.notifyMicStatusChanged();

            // Send offer to all existing peers
            this.broadcastOffer();

            return true;
        } catch (error) {
            console.error('Microphone access denied:', error);
            alert('Microphone access denied. Voice chat will not work.');
            return false;
        }
    }

    /**
     * Disable microphone and close all peer connections
     */
    async disableMicrophone() {
        try {
            if (!this.isMicEnabled) return;

            // Stop all local tracks
            if (this.micStream) {
                this.micStream.getTracks().forEach(track => track.stop());
                this.micStream = null;
            }

            // Stop VAD checking
            if (this.vadCheckInterval) {
                clearInterval(this.vadCheckInterval);
                this.vadCheckInterval = null;
            }

            // Close all peer connections
            Object.keys(this.peers).forEach(peerId => {
                this.closePeer(peerId);
            });

            this.isMicEnabled = false;
            this.isSpeaking = false;
            this.notifyMicStatusChanged();

        } catch (error) {
            console.error('Error disabling microphone:', error);
        }
    }

    /**
     * Setup Voice Activity Detection (VAD)
     */
    setupVoiceActivityDetection() {
        if (!this.audioContext || !this.micStream) return;

        // Create analyser for frequency analysis
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;

        const source = this.audioContext.createMediaStreamSource(this.micStream);
        source.connect(this.analyser);

        // Start checking voice activity
        if (this.vadCheckInterval) clearInterval(this.vadCheckInterval);
        this.vadCheckInterval = setInterval(() => {
            this.updateVoiceActivity();
        }, 50); // Check every 50ms
    }

    /**
     * Analyze audio and detect voice activity
     */
    updateVoiceActivity() {
        if (!this.analyser) return;

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);

        // Calculate RMS (Root Mean Square) energy
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);

        // Smooth the level for stability
        this.smoothedLevel = this.smoothedLevel * (1 - this.vadSmoothingFactor) +
            rms * this.vadSmoothingFactor;

        const wasSpeaking = this.isSpeaking;
        this.isSpeaking = this.smoothedLevel > this.vadThreshold;

        // Notify when speaking state changes
        if (this.isSpeaking !== wasSpeaking) {
            this.notifyMicStatusChanged();
        }
    }

    /**
     * Broadcast offer to all connected users (full mesh topology)
     */
    async broadcastOffer() {
        if (!this.isMicEnabled || !this.micStream) return;

        // Get list of all users except self
        this.socket.emit('voice-get-peers', (userIds) => {
            userIds.forEach(userId => {
                if (!this.peers[userId]) {
                    this.createPeerConnection(userId, true);
                }
            });
        });
    }

    /**
     * Create a WebRTC peer connection
     */
    async createPeerConnection(userId, initiator = false) {
        try {
            if (this.peers[userId]) return; // Already connected

            // Simple Peer configuration
            const peerConfig = {
                initiator: initiator,
                trickleIce: true,
                stream: this.micStream || undefined,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' },
                    ]
                }
            };

            // Check if SimplePeer is available
            if (typeof SimplePeer === 'undefined') {
                console.error('SimplePeer library not loaded');
                return;
            }

            const peer = new SimplePeer(peerConfig);

            peer.on('signal', (data) => {
                // Send SDP offer/answer or ICE candidate to other user
                if (data.type === 'offer') {
                    this.socket.emit('voice-offer', { to: userId, data: data });
                } else if (data.type === 'answer') {
                    this.socket.emit('voice-answer', { to: userId, data: data });
                } else if (data.candidate) {
                    this.socket.emit('voice-ice-candidate', { to: userId, data: data });
                }
            });

            peer.on('connect', () => {
                console.log(`Voice connection established with ${userId}`);
                // Open data channel for metadata
                if (peer.send && typeof peer.send === 'function') {
                    peer.send(JSON.stringify({ type: 'peer-connected', userId: this.currentUserId }));
                }
            });

            peer.on('stream', (stream) => {
                console.log(`Received audio stream from ${userId}`);
                this.handleRemoteStream(userId, stream);
            });

            peer.on('data', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'peer-connected') {
                        console.log(`${msg.userId} connected`);
                    }
                } catch (e) {
                    // Data might be binary or invalid JSON
                }
            });

            peer.on('error', (err) => {
                console.error(`Peer error with ${userId}:`, err);
            });

            peer.on('close', () => {
                console.log(`Connection closed with ${userId}`);
                delete this.peers[userId];
                this.removeAudioElement(userId);
            });

            this.peers[userId] = peer;

        } catch (error) {
            console.error(`Error creating peer connection with ${userId}:`, error);
        }
    }

    /**
     * Handle incoming offer
     */
    handleOffer(data) {
        const { from, data: offerData } = data;
        if (this.peers[from]) {
            this.peers[from].signal(offerData);
        } else {
            // Create peer connection to respond to offer
            this.createPeerConnection(from, false).then(() => {
                if (this.peers[from]) {
                    this.peers[from].signal(offerData);
                }
            });
        }
    }

    /**
     * Handle incoming answer
     */
    handleAnswer(data) {
        const { from, data: answerData } = data;
        if (this.peers[from]) {
            this.peers[from].signal(answerData);
        }
    }

    /**
     * Handle incoming ICE candidate
     */
    handleIceCandidate(data) {
        const { from, data: candidateData } = data;
        if (this.peers[from]) {
            this.peers[from].signal(candidateData);
        }
    }

    /**
     * Handle remote audio stream
     */
    handleRemoteStream(userId, stream) {
        try {
            // Create audio element for remote stream
            let audioEl = this.audioElements[userId];
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                audioEl.playsinline = true;
                audioEl.style.display = 'none';
                document.body.appendChild(audioEl);
                this.audioElements[userId] = audioEl;
            }

            // Set stream and ensure playback
            audioEl.srcObject = stream;
            audioEl.play().catch(err => {
                console.warn(`Audio playback error for ${userId}:`, err);
            });

        } catch (error) {
            console.error(`Error handling remote stream for ${userId}:`, error);
        }
    }

    /**
     * Close peer connection
     */
    closePeer(userId) {
        try {
            if (this.peers[userId]) {
                this.peers[userId].destroy();
                delete this.peers[userId];
            }
            this.removeAudioElement(userId);
        } catch (error) {
            console.error(`Error closing peer ${userId}:`, error);
        }
    }

    /**
     * Remove audio element for user
     */
    removeAudioElement(userId) {
        const audioEl = this.audioElements[userId];
        if (audioEl) {
            audioEl.srcObject = null;
            audioEl.remove();
            delete this.audioElements[userId];
        }
    }

    /**
     * Notify server and UI of microphone status change
     */
    notifyMicStatusChanged() {
        // Emit to server for broadcasting to others
        this.socket.emit('voice-status-change', {
            isMicOn: this.isMicEnabled,
            isSpeaking: this.isSpeaking
        });

        // Dispatch custom event for UI update
        window.dispatchEvent(new CustomEvent('voice-status-changed', {
            detail: {
                isMicOn: this.isMicEnabled,
                isSpeaking: this.isSpeaking
            }
        }));
    }

    /**
     * Get list of connected voice peers
     */
    getConnectedPeers() {
        return Object.keys(this.peers).length;
    }

    /**
     * Check if microphone is enabled
     */
    isMicrophoneEnabled() {
        return this.isMicEnabled;
    }

    /**
     * Check if currently speaking
     */
    isUserSpeaking() {
        return this.isSpeaking;
    }

    /**
     * Set VAD threshold (0-255)
     */
    setVadThreshold(threshold) {
        this.vadThreshold = Math.max(0, Math.min(255, threshold));
    }

    /**
     * Cleanup on disconnect
     */
    async cleanup() {
        await this.disableMicrophone();
        Object.keys(this.audioElements).forEach(userId => {
            this.removeAudioElement(userId);
        });
    }
}

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VoiceChat;
}
