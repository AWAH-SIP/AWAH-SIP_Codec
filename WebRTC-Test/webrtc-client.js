/**
 * AWAH-SIP WebRTC Test Client
 * Eine einfache Test-Anwendung, um die WebRTC-Funktionalität von AWAH-SIP_Codec zu testen
 */

// Globale Variablen
let websocket = null;
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallId = null;
let audioContext = null;
let meterInterval = null;

// DOM-Elemente
const connectBtn = document.getElementById('connect-btn');
const websocketUrlInput = document.getElementById('websocket-url');
const stunServerInput = document.getElementById('stun-server');
const accountIdSelect = document.getElementById('account-id');
const remoteUriInput = document.getElementById('remote-uri');
const createSessionBtn = document.getElementById('create-session-btn');
const endSessionBtn = document.getElementById('end-session-btn');
const callStatusElement = document.getElementById('call-status');
const callIdElement = document.getElementById('call-id');
const iceStatusElement = document.getElementById('ice-status');
const audioSourceSelect = document.getElementById('audio-source');
const muteBtn = document.getElementById('mute-btn');
const volumeSlider = document.getElementById('volume-slider');
const meterValueElement = document.getElementById('meter-value');
const logEntriesElement = document.getElementById('log-entries');
const clearLogBtn = document.getElementById('clear-log-btn');

// Event-Listener
document.addEventListener('DOMContentLoaded', () => {
    connectBtn.addEventListener('click', connectWebSocket);
    createSessionBtn.addEventListener('click', createWebRTCSession);
    endSessionBtn.addEventListener('click', endWebRTCSession);
    muteBtn.addEventListener('click', toggleMute);
    volumeSlider.addEventListener('input', updateVolume);
    clearLogBtn.addEventListener('click', clearLog);
    document.getElementById('create-webrtc-account-btn').addEventListener('click', createWebRTCAccount);
    
    // Zugriff auf Mikrofonzugriff vorbereiten
    setupAudioContext();
});

// Audio-Kontext erstellen
function setupAudioContext() {
    try {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        logMessage('Audio-Kontext initialisiert', 'info');
    } catch (e) {
        logMessage('Fehler beim Initialisieren des Audio-Kontexts: ' + e, 'error');
    }
}

// Verbindung zum Websocket-Server herstellen
function connectWebSocket() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
    }
    
    const wsUrl = websocketUrlInput.value;
    logMessage(`Verbinde mit Websocket: ${wsUrl}`, 'info');
    
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
        logMessage('Websocket-Verbindung hergestellt', 'success');
        document.querySelector('.session-settings').style.display = 'block';
        
        // WebRTC initialisieren
        initWebRTC();
        
        // Accounts abrufen
        fetchAccounts();
    };
    
    websocket.onclose = () => {
        logMessage('Websocket-Verbindung geschlossen', 'info');
        document.querySelector('.session-settings').style.display = 'none';
        document.querySelector('.call-info').style.display = 'none';
        document.querySelector('.audio-controls').style.display = 'none';
    };
    
    websocket.onerror = (error) => {
        logMessage('Websocket-Fehler: ' + error, 'error');
    };
    
    websocket.onmessage = handleWebSocketMessage;
}

// Verarbeitet eingehende Websocket-Nachrichten
function handleWebSocketMessage(event) {
    try {
        const message = JSON.parse(event.data);
        
        // Ereignis-Nachrichten (Events vom Server)
        if (message.type) {
            handleServerEvent(message);
            return;
        }
        
        // Antworten auf API-Anfragen
        if (message.id && message.result) {
            const result = message.result;
            logMessage(`API-Antwort erhalten: ${message.id}`, 'info');
            
            // Verarbeite die Antworten auf verschiedene API-Aufrufe
            if (message.id === 'accounts') {
                handleAccountsResponse(result);
            } else if (message.id === 'webrtc_init') {
                handleWebRTCInitResponse(result);
            } else if (message.id === 'create_session') {
                handleCreateSessionResponse(result);
            } else if (message.id === 'end_session') {
                handleEndSessionResponse(result);
            }
        }
    } catch (e) {
        logMessage('Fehler beim Verarbeiten der Websocket-Nachricht: ' + e, 'error');
    }
}

// Verarbeitet Server-Ereignisse
function handleServerEvent(message) {
    if (message.type === 'webrtc') {
        handleWebRTCEvent(message);
    }
    // Andere Ereignistypen könnten hier verarbeitet werden
}

// Verarbeitet WebRTC-spezifische Ereignisse
function handleWebRTCEvent(message) {
    const event = message.event;
    const data = message.data;
    
    switch (event) {
        case 'icecandidate':
            handleRemoteIceCandidate(data);
            break;
        case 'sdp':
            handleRemoteSDP(data);
            break;
        case 'terminated':
            handleSessionTerminated(data);
            break;
    }
}

// Verarbeitet ein Remote-SDP (Angebot oder Antwort)
async function handleRemoteSDP(data) {
    if (!peerConnection) {
        logMessage('PeerConnection nicht initialisiert', 'error');
        return;
    }
    
    try {
        const sdp = data.sdp;
        const type = data.type; // 'offer' oder 'answer'
        const callId = data.callId;
        
        logMessage(`Remote SDP erhalten (${type}) für Call ID ${callId}`, 'info');
        
        // SDP-Beschreibung erstellen
        const remoteDesc = new RTCSessionDescription({
            type: type,
            sdp: sdp
        });
        
        // Remote-Beschreibung setzen
        await peerConnection.setRemoteDescription(remoteDesc);
        logMessage('Remote Description gesetzt', 'success');
        
        // Falls es ein Angebot ist, müssen wir mit einer Antwort reagieren
        if (type === 'offer') {
            logMessage('Erstelle Antwort...', 'info');
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            // Antwort an den Server senden
            sendToServer('webrtc.handleAnswer', {
                callId: callId,
                sdp: answer.sdp
            });
        }
        
        // Call-ID speichern, wenn sie noch nicht gesetzt ist
        if (!currentCallId) {
            currentCallId = callId;
            callIdElement.textContent = callId;
            endSessionBtn.disabled = false;
            callStatusElement.textContent = 'Verbindung wird aufgebaut...';
            document.querySelector('.call-info').style.display = 'block';
            document.querySelector('.audio-controls').style.display = 'block';
        }
    } catch (error) {
        logMessage('Fehler beim Verarbeiten des Remote SDP: ' + error, 'error');
    }
}

// Verarbeitet einen Remote-ICE-Kandidaten
async function handleRemoteIceCandidate(data) {
    if (!peerConnection) {
        logMessage('PeerConnection nicht initialisiert', 'error');
        return;
    }
    
    try {
        const callId = data.callId;
        const candidate = data.candidate;
        const sdpMLineIndex = data.sdpMLineIndex;
        const sdpMid = data.sdpMid;
        
        logMessage(`Remote ICE-Kandidat erhalten für Call ID ${callId}`, 'info');
        
        // ICE-Kandidaten hinzufügen
        await peerConnection.addIceCandidate(new RTCIceCandidate({
            candidate: candidate,
            sdpMLineIndex: sdpMLineIndex,
            sdpMid: sdpMid
        }));
        
        logMessage('ICE-Kandidat hinzugefügt', 'success');
    } catch (error) {
        logMessage('Fehler beim Hinzufügen des ICE-Kandidaten: ' + error, 'error');
    }
}

// Verarbeitet die Beendigung einer Session
function handleSessionTerminated(data) {
    const callId = data.callId;
    const reason = data.reason;
    
    logMessage(`WebRTC-Session beendet für Call ID ${callId}. Grund: ${reason}`, 'info');
    
    // Aufräumen
    if (currentCallId === callId) {
        resetSession();
    }
}

// Abrufen der verfügbaren Accounts
function fetchAccounts() {
    sendToServer('accounts.getAccounts', {}, 'accounts');
}

// Verarbeiten der Accounts-Antwort
function handleAccountsResponse(result) {
    if (result.error && result.error.code !== 0) {
        logMessage('Fehler beim Abrufen der Accounts: ' + result.error.message, 'error');
        return;
    }
    
    const accounts = result.data;
    accountIdSelect.innerHTML = '';
    
    accounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account.id;
        option.textContent = `${account.name} (${account.user}@${account.serverURI})`;
        accountIdSelect.appendChild(option);
    });
    
    logMessage(`${accounts.length} Accounts geladen`, 'success');
}

// WebRTC initialisieren
function initWebRTC() {
    const stunServer = stunServerInput.value;
    const parts = stunServer.split(':');
    const server = parts[0];
    const port = parts.length > 1 ? parseInt(parts[1]) : 19302;
    
    sendToServer('webrtc.init', {
        stunServer: server,
        stunPort: port
    }, 'webrtc_init');
}

// Verarbeiten der WebRTC-Initialisierungsantwort
function handleWebRTCInitResponse(result) {
    if (result.error && result.error.code !== 0) {
        logMessage('Fehler bei der WebRTC-Initialisierung: ' + result.error.message, 'error');
        return;
    }
    
    logMessage('WebRTC erfolgreich initialisiert', 'success');
    
    // Erstellen der PeerConnection
    setupPeerConnection();
}

// PeerConnection einrichten
function setupPeerConnection() {
    const stunServer = stunServerInput.value;
    
    const config = {
        iceServers: [{
            urls: `stun:${stunServer}`
        }]
    };
    
    peerConnection = new RTCPeerConnection(config);
    
    // Event-Handler für ICE-Kandidaten
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            // ICE-Kandidaten an den Server senden, wenn ein Call aktiv ist
            if (currentCallId) {
                sendToServer('webrtc.addIceCandidate', {
                    callId: currentCallId,
                    candidate: event.candidate.candidate,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                    sdpMid: event.candidate.sdpMid
                });
            }
        }
    };
    
    // Event-Handler für ICE-Verbindungsstatus
    peerConnection.oniceconnectionstatechange = () => {
        iceStatusElement.textContent = peerConnection.iceConnectionState;
        logMessage('ICE-Status geändert: ' + peerConnection.iceConnectionState, 'info');
        
        if (peerConnection.iceConnectionState === 'connected' || 
            peerConnection.iceConnectionState === 'completed') {
            callStatusElement.textContent = 'Verbunden';
        } else if (peerConnection.iceConnectionState === 'failed' || 
                   peerConnection.iceConnectionState === 'disconnected' || 
                   peerConnection.iceConnectionState === 'closed') {
            callStatusElement.textContent = 'Getrennt';
        }
    };
    
    // Event-Handler für das Hinzufügen von Tracks
    peerConnection.ontrack = event => {
        logMessage('Remote-Track empfangen', 'success');
        
        // Remote-Stream einstellen
        remoteStream = event.streams[0];
        
        // Audio-Element erstellen und abspielen
        const audioElement = new Audio();
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;
        audioElement.volume = volumeSlider.value / 100;
        
        // Audio-Element dem Dokument hinzufügen
        document.body.appendChild(audioElement);
    };
    
    logMessage('PeerConnection eingerichtet', 'success');
    
    // Mikrofonzugriff anfordern
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
            localStream = stream;
            logMessage('Mikrofon-Zugriff erhalten', 'success');
            
            // Verfügbare Audioquellen auflisten
            updateAudioSources();
            
            // Lokale Tracks zur PeerConnection hinzufügen
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            
            // Audio-Meter einrichten
            setupAudioMeter();
        })
        .catch(error => {
            logMessage('Fehler beim Zugriff auf das Mikrofon: ' + error, 'error');
        });
}

// Verfügbare Audioquellen auflisten
function updateAudioSources() {
    navigator.mediaDevices.enumerateDevices()
        .then(devices => {
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            
            audioSourceSelect.innerHTML = '';
            audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Mikrofon ${audioSourceSelect.options.length + 1}`;
                audioSourceSelect.appendChild(option);
            });
            
            // Event-Listener für Änderungen der Audio-Quelle
            audioSourceSelect.addEventListener('change', changeAudioSource);
        })
        .catch(error => {
            logMessage('Fehler beim Auflisten der Audioquellen: ' + error, 'error');
        });
}

// Audioquelle wechseln
async function changeAudioSource() {
    const deviceId = audioSourceSelect.value;
    
    try {
        // Alte Tracks entfernen
        if (localStream) {
            localStream.getTracks().forEach(track => {
                track.stop();
                peerConnection.getSenders().forEach(sender => {
                    if (sender.track === track) {
                        peerConnection.removeTrack(sender);
                    }
                });
            });
        }
        
        // Neue Audioquelle anfordern
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: deviceId } },
            video: false
        });
        
        localStream = newStream;
        
        // Neue Tracks zur PeerConnection hinzufügen
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Audio-Meter aktualisieren
        setupAudioMeter();
        
        logMessage('Audioquelle gewechselt', 'success');
    } catch (error) {
        logMessage('Fehler beim Wechseln der Audioquelle: ' + error, 'error');
    }
}

// Audio-Meter einrichten
function setupAudioMeter() {
    if (!audioContext || !localStream) return;
    
    // Altes Intervall löschen
    if (meterInterval) {
        clearInterval(meterInterval);
    }
    
    // Audio-Quelle mit dem Audio-Kontext verbinden
    const source = audioContext.createMediaStreamSource(localStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Regelmäßig den Audiopegel messen
    meterInterval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        
        // Durchschnittlichen Pegel berechnen
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        // Pegelanzeige aktualisieren
        const level = Math.min(100, Math.round(average * 100 / 255));
        meterValueElement.style.width = `${level}%`;
        
        // Farbe basierend auf Pegel ändern
        if (level < 30) {
            meterValueElement.style.backgroundColor = '#4CAF50';
        } else if (level < 70) {
            meterValueElement.style.backgroundColor = '#FFC107';
        } else {
            meterValueElement.style.backgroundColor = '#F44336';
        }
    }, 100);
}

// WebRTC-Sitzung erstellen
function createWebRTCSession() {
    const accountId = accountIdSelect.value;
    const remoteUri = remoteUriInput.value;
    
    if (!accountId || !remoteUri) {
        logMessage('Bitte Account und Remote URI angeben', 'error');
        return;
    }
    
    // Anruf erstellen
    sendToServer('webrtc.createSession', {
        accountId: parseInt(accountId),
        remoteUri: remoteUri
    }, 'create_session');
}

// Verarbeiten der Antwort auf die Sitzungserstellung
function handleCreateSessionResponse(result) {
    if (result.error && result.error.code !== 0) {
        logMessage('Fehler beim Erstellen der WebRTC-Sitzung: ' + result.error.message, 'error');
        return;
    }
    
    logMessage('WebRTC-Sitzung wird erstellt...', 'success');
    callStatusElement.textContent = 'Warte auf Verbindung...';
    document.querySelector('.call-info').style.display = 'block';
}

// WebRTC-Sitzung beenden
function endWebRTCSession() {
    if (!currentCallId) {
        logMessage('Keine aktive Sitzung', 'error');
        return;
    }
    
    sendToServer('webrtc.terminateSession', {
        callId: currentCallId
    }, 'end_session');
}

// Verarbeiten der Antwort auf die Sitzungsbeendigung
function handleEndSessionResponse(result) {
    if (result.error && result.error.code !== 0) {
        logMessage('Fehler beim Beenden der WebRTC-Sitzung: ' + result.error.message, 'error');
        return;
    }
    
    logMessage('WebRTC-Sitzung beendet', 'success');
    resetSession();
}

// Sitzungsstatus zurücksetzen
function resetSession() {
    // Aufräumen
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (meterInterval) {
        clearInterval(meterInterval);
        meterInterval = null;
    }
    
    // Remote-Audio-Elemente entfernen
    document.querySelectorAll('audio').forEach(el => el.remove());
    
    // UI zurücksetzen
    currentCallId = null;
    callIdElement.textContent = '-';
    callStatusElement.textContent = 'Nicht verbunden';
    iceStatusElement.textContent = '-';
    endSessionBtn.disabled = true;
    meterValueElement.style.width = '0%';
    muteBtn.classList.remove('muted');
    muteBtn.textContent = 'Stumm';
    
    document.querySelector('.call-info').style.display = 'none';
    document.querySelector('.audio-controls').style.display = 'none';
    
    // PeerConnection neu einrichten, für den nächsten Anruf
    setupPeerConnection();
}

// Stummschaltung umschalten
function toggleMute() {
    if (!localStream) return;
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;
    
    const enabled = !audioTracks[0].enabled;
    audioTracks[0].enabled = enabled;
    
    muteBtn.classList.toggle('muted', !enabled);
    muteBtn.textContent = enabled ? 'Stumm' : 'Unmute';
    
    logMessage(`Mikrofon ${enabled ? 'aktiviert' : 'deaktiviert'}`, 'info');
}

// Lautstärke aktualisieren
function updateVolume() {
    const volume = volumeSlider.value / 100;
    
    document.querySelectorAll('audio').forEach(el => {
        el.volume = volume;
    });
    
    logMessage(`Lautstärke auf ${volumeSlider.value}% gesetzt`, 'info');
}

// Log-Nachrichten hinzufügen
function logMessage(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${timestamp}] ${message}`;
    
    logEntriesElement.appendChild(entry);
    logEntriesElement.scrollTop = logEntriesElement.scrollHeight;
}

// Log löschen
function clearLog() {
    logEntriesElement.innerHTML = '';
}

// Hilfsfunktion zum Senden von Nachrichten an den Server
function sendToServer(method, params = {}, id = null) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        logMessage('Keine Websocket-Verbindung', 'error');
        return;
    }
    
    const request = {
        jsonrpc: '2.0',
        method: method,
        params: params
    };
    
    if (id) {
        request.id = id;
    }
    
    websocket.send(JSON.stringify(request));
    logMessage(`Anfrage gesendet: ${method}`, 'info');
}

// WebRTC-Account erstellen
function createWebRTCAccount() {
    // Statt webrtc.createAccount verwenden wir die reguläre createAccount-Methode
    sendToServer('createAccount', {
        accountName: "WebRTC Test Account",
        server: "local",
        user: "webrtc",
        password: "",
        filePlayPath: "",
        fileRecPath: "",
        fileRecordRXonly: true,
        fixedJitterBuffer: false,
        fixedJitterBufferValue: 80,
        autoconnectToBuddyUID: "",
        autoconnectEnable: false,
        hasDTMFGPIO: false,
        type: 3  // WEBRTC type (3)
    }, 'create_webrtc_account');
    
    // Account-Liste nach der Erstellung aktualisieren
    setTimeout(fetchAccounts, 1000);
}