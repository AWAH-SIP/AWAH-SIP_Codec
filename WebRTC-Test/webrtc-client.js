(() => {
  const els = {
    wsStatus: document.getElementById('wsStatus'),
    wsUrl: document.getElementById('wsUrl'),
    btnConnect: document.getElementById('btnConnect'),
    btnDisconnect: document.getElementById('btnDisconnect'),

    channelId: document.getElementById('channelId'),
    channelDesc: document.getElementById('channelDesc'),
    btnCreateCh: document.getElementById('btnCreateCh'),
    btnRemoveCh: document.getElementById('btnRemoveCh'),
    btnListCh: document.getElementById('btnListCh'),
    channelsOut: document.getElementById('channelsOut'),
    statusChannelSelect: document.getElementById('statusChannelSelect'),

    channelSelect: document.getElementById('channelSelect'),
    btnModifyCh: document.getElementById('btnModifyCh'),
    chkSendOnly: document.getElementById('chkSendOnly'),
    maxCalls: document.getElementById('maxCalls'),
    stunServer: document.getElementById('stunServer'),
    turnServer: document.getElementById('turnServer'),
    turnUser: document.getElementById('turnUser'),
    turnPass: document.getElementById('turnPass'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    rtcState: document.getElementById('rtcState'),
    remoteAudio: document.getElementById('remoteAudio'),
    chkLoopbackBrowser: document.getElementById('chkLoopbackBrowser'),

    sSignaling: document.getElementById('sSignaling'),
    sIce: document.getElementById('sIce'),
    sDtls: document.getElementById('sDtls'),
    sConn: document.getElementById('sConn'),
    topSignaling: document.getElementById('topSignaling'),
    topIce: document.getElementById('topIce'),
    topDtls: document.getElementById('topDtls'),
    topConn: document.getElementById('topConn'),
    sPair: document.getElementById('sPair'),
    sLocalCand: document.getElementById('sLocalCand'),
    sRemoteCand: document.getElementById('sRemoteCand'),
    sBytes: document.getElementById('sBytes'),

    btnGetStatus: document.getElementById('btnGetStatus'),
    srvStatusOut: document.getElementById('srvStatusOut'),
    srvStatusView: document.getElementById('srvStatusView'),

    localSdp: document.getElementById('localSdp'),
    remoteSdp: document.getElementById('remoteSdp'),

    logOut: document.getElementById('logOut')
  };

  let ws = null;
  let pc = null;
  let localStream = null;
  let loopbackCtx = null;
  let loopbackDest = null;
  let loopbackSource = null;
  let loopbackTrackSender = null;
  let sessionId = null;
  let reqId = 1;
  let bytesTx = 0, bytesRx = 0;
  let channelsCache = [];
  const localCands = [];
  const remoteCands = [];
  const pendingLocalCands = [];
  let statsTimer = null;
  let pendingRefreshResolve = null;

  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    els.logOut.textContent += `[${ts}] ${msg}\n`;
    els.logOut.scrollTop = els.logOut.scrollHeight;
  }

  function setWsStatus(connected) {
    els.wsStatus.textContent = `WS: ${connected ? 'connected' : 'disconnected'}`;
  }

  function setRtcState(text, muted = false) {
    els.rtcState.textContent = text;
    els.rtcState.classList.toggle('muted', muted);
  }

  function send(command, data = {}, id = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = { command, data, cmdID: id || `${command}-${reqId++}` };
    ws.send(JSON.stringify(msg));
  }

  function populateChannelSelect(list = []) {
    els.channelSelect.innerHTML = '';
    if (els.statusChannelSelect) els.statusChannelSelect.innerHTML = '';
    list.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = `${ch.description} (${ch.id}) [${ch.sendOnly ? 'send-only' : 'sendrecv'}]`;
      if (ch.sendOnly) opt.dataset.sendonly = 'true';
      els.channelSelect.appendChild(opt);
      if (els.statusChannelSelect) {
        const opt2 = opt.cloneNode(true);
        els.statusChannelSelect.appendChild(opt2);
      }
    });
  }

  async function updateStatsOnce() {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      let pair = null; bytesTx = 0; bytesRx = 0; let dtls = els.sDtls.textContent || '-';
      stats.forEach(r => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded') pair = r;
        if (r.type === 'outbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) bytesTx += r.bytesSent || 0;
        if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) bytesRx += r.bytesReceived || 0;
        if (r.type === 'transport' && r.dtlsState) dtls = r.dtlsState;
      });
      els.sPair.textContent = pair ? `${pair.localCandidateId} ⇄ ${pair.remoteCandidateId}` : '-';
      els.sBytes.textContent = `${bytesTx} / ${bytesRx}`;
      els.sDtls.textContent = dtls;
      if (els.topDtls) els.topDtls.textContent = `DTLS: ${dtls}`;
    } catch {}
  }

  function startStatsLoop() {
    stopStatsLoop();
    statsTimer = setInterval(updateStatsOnce, 1000);
  }
  function stopStatsLoop() {
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
  }

  function resetPc() {
    stopStatsLoop();
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    sessionId = null;
    setRtcState('not started', true);
    els.sSignaling.textContent = '-';
    els.sIce.textContent = '-';
    els.sConn.textContent = '-';
    els.sPair.textContent = '-';
    els.sLocalCand.textContent = '0';
    els.sRemoteCand.textContent = '0';
    els.sDtls.textContent = '-';
    if (els.topSignaling) els.topSignaling.textContent = 'Signaling: -';
    if (els.topIce) els.topIce.textContent = 'ICE: -';
    if (els.topDtls) els.topDtls.textContent = 'DTLS: -';
    if (els.topConn) els.topConn.textContent = 'PC: -';
    els.sBytes.textContent = '0 / 0';
    els.localSdp.textContent = '';
    els.remoteSdp.textContent = '';
    localCands.length = 0; remoteCands.length = 0; pendingLocalCands.length = 0;
  }

  function bindPcEvents() {
    pc.onsignalingstatechange = () => {
      els.sSignaling.textContent = pc.signalingState;
      if (els.topSignaling) els.topSignaling.textContent = `Signaling: ${pc.signalingState}`;
    };
    pc.oniceconnectionstatechange = () => {
      els.sIce.textContent = pc.iceConnectionState;
      if (els.topIce) els.topIce.textContent = `ICE: ${pc.iceConnectionState}`;
    };
    pc.onconnectionstatechange = () => {
      els.sConn.textContent = pc.connectionState;
      if (els.topConn) els.topConn.textContent = `PC: ${pc.connectionState}`;
      if (pc.connectionState === 'connected') {
        setRtcState('active');
        startStatsLoop();
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setRtcState('stopped', true);
      }
    };
    pc.onicegatheringstatechange = async () => {
      if (pc.iceGatheringState === 'complete' && sessionId) {
        send('webrtc_ice_candidate', { sessionId, candidate: 'end-of-candidates', sdpMLineIndex: 0, sdpMid: '0' });
      }
      updateStatsOnce();
    };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const cand = ev.candidate.candidate;
      localCands.push(cand);
      els.sLocalCand.textContent = `${localCands.length}`;
      if (sessionId) {
        send('webrtc_ice_candidate', { sessionId, candidate: cand, sdpMLineIndex: ev.candidate.sdpMLineIndex, sdpMid: ev.candidate.sdpMid });
      } else {
        pendingLocalCands.push({ candidate: cand, sdpMLineIndex: ev.candidate.sdpMLineIndex || 0, sdpMid: ev.candidate.sdpMid || '0' });
      }
    };
    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        els.remoteAudio.srcObject = ev.streams[0];
        if (els.chkLoopbackBrowser && els.chkLoopbackBrowser.checked) {
          try {
            if (!loopbackCtx) loopbackCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (!loopbackDest) loopbackDest = loopbackCtx.createMediaStreamDestination();
            if (loopbackSource) { try { loopbackSource.disconnect(); } catch {}
              loopbackSource = null; }
            loopbackSource = loopbackCtx.createMediaStreamSource(ev.streams[0]);
            loopbackSource.connect(loopbackDest);
            const ms = loopbackDest.stream;
            const tr = ms.getAudioTracks()[0];
            if (tr) {
              if (loopbackTrackSender) { try { pc.removeTrack(loopbackTrackSender); } catch {} loopbackTrackSender = null; }
              loopbackTrackSender = pc.addTrack(tr, ms);
            }
          } catch (e) { log('loopback init failed: ' + e); }
        }
      }
    };
  }

  function mungeOpusStereo(sdp, targetBitrate = 128000) {
    if (!sdp) return sdp;
    const lines = sdp.split(/\r?\n/);
    // find opus PT from rtpmap
    let opusPt = null;
    for (const l of lines) {
      const m = l.match(/^a=rtpmap:(\d+)\s+opus\/48000(?:\/\d+)?/i);
      if (m) { opusPt = m[1]; break; }
    }
    if (!opusPt) return sdp;
    // ensure 2 channels in rtpmap (opus/48000/2)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(new RegExp(`^a=rtpmap:${opusPt}\\s+opus/48000(?:/\n)?`, 'i'))) {
        lines[i] = `a=rtpmap:${opusPt} opus/48000/2`;
      }
    }
    // update/append fmtp for opus
    let fmtpIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().startsWith(`a=fmtp:${opusPt} `)) { fmtpIdx = i; break; }
    }
    const addParams = [`stereo=1`, `sprop-stereo=1`, `maxaveragebitrate=${targetBitrate}`];
    if (fmtpIdx >= 0) {
      const parts = lines[fmtpIdx].split(/\s+/);
      let params = parts.slice(1).join(' ');
      for (const p of addParams) {
        if (!new RegExp(`(?:^|;)${p.split('=')[0]}=`).test(params)) params += `;${p}`;
      }
      lines[fmtpIdx] = `a=fmtp:${opusPt} ${params}`;
        } else {
      // insert after rtpmap line
      let insertAt = lines.findIndex(l => l.toLowerCase().startsWith(`a=rtpmap:${opusPt} `));
      if (insertAt === -1) insertAt = lines.findIndex(l => l.startsWith('m=audio')) + 1;
      lines.splice(insertAt + 1, 0, `a=fmtp:${opusPt} ${addParams.join(';')}`);
    }
    return lines.join('\r\n');
  }

  // WebSocket wiring
  els.btnConnect.onclick = () => {
    if (ws) try { ws.close(); } catch {}
    ws = new WebSocket(els.wsUrl.value);
    ws.onopen = () => {
      setWsStatus(true); log('ws: open');
      els.btnConnect.disabled = true;
      els.btnDisconnect.disabled = false;
      // refresh channels on connect
      send('getWebRTCChannels', {}, 'list_channels');
    };
    ws.onclose = () => {
      setWsStatus(false); log('ws: close'); resetPc();
      els.btnConnect.disabled = false;
      els.btnDisconnect.disabled = true;
    };
    ws.onerror = () => { log('ws error'); };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.command === 'createWebRTCChannel') { 
          const newId = m.data && m.data.id ? m.data.id : '';
          log(`channel: created${newId ? ` (id: ${newId})` : ''}`);
          if (newId) { els.channelId.value = newId; }
          send('getWebRTCChannels', {}, 'list_channels'); 
          return; 
        }
        if (m.command === 'modifyWebRTCChannel') { log('channel: modified'); send('getWebRTCChannels', {}, 'list_channels'); return; }
        if (m.command === 'removeWebRTCChannel') { log('channel: removed'); send('getWebRTCChannels', {}, 'list_channels'); return; }
        if (m.command === 'getWebRTCChannels') {
          const list = Array.isArray(m.data) ? m.data : [];
          channelsCache = list;
          els.channelsOut.textContent = JSON.stringify(list, null, 2);
          populateChannelSelect(list);
          if (pendingRefreshResolve) { try { pendingRefreshResolve(); } finally { pendingRefreshResolve = null; } }
          return;
        }
        if (m.command === 'webrtc_status') {
          renderServerStatus(m.data);
          els.srvStatusOut.textContent = JSON.stringify(m, null, 2);
        return;
    }
        if (m.command === 'webrtc_ice_candidate' && m.data && m.data.candidate && pc) {
          remoteCands.push(m.data.candidate);
          els.sRemoteCand.textContent = `${remoteCands.length}`;
          const ice = new RTCIceCandidate({ candidate: m.data.candidate, sdpMLineIndex: m.data.sdpMLineIndex || 0, sdpMid: m.data.sdpMid || '0' });
          pc.addIceCandidate(ice).catch(()=>{});
            return;
        }
        if (m.command === 'webrtc_offer' && m.data) {
          if (m.data.sessionId) sessionId = m.data.sessionId;
          if (m.data.sdp) {
            els.remoteSdp.textContent = m.data.sdp;
            pc.setRemoteDescription({ type: 'answer', sdp: m.data.sdp }).then(() => {
              setRtcState('connecting');
              if (pendingLocalCands.length) {
                pendingLocalCands.splice(0).forEach(c => send('webrtc_ice_candidate', { sessionId, candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex, sdpMid: c.sdpMid }));
              }
              updateStatsOnce();
            }).catch(err => log('setRemoteDescription error: ' + err));
          }
        return;
    }
      } catch {}
    };
  };
  els.btnDisconnect.onclick = () => { if (ws) ws.close(); };

  // Create channel: server generates UID; client-provided id is ignored
  els.btnCreateCh.onclick = () => {
    const description = els.channelDesc.value.trim();
    if (!description) { log('channel: description required'); return; }
    send('createWebRTCChannel', { description, enabled: true, sendOnly: !!els.chkSendOnly?.checked, maxConcurrentStreams: parseInt(els.maxCalls?.value||'5',10), stunServer: els.stunServer?.value, turnServer: els.turnServer?.value, turnUsername: els.turnUser?.value, turnCredential: els.turnPass?.value }, 'create_channel');
  };
  if (els.btnModifyCh) {
    els.btnModifyCh.onclick = () => {
      const id = els.channelSelect.value || els.channelId.value.trim();
      if (!id) { log('modify: select a channel'); return; }
      send('modifyWebRTCChannel', { id, description: els.channelDesc.value, enabled: true, sendOnly: !!els.chkSendOnly?.checked, maxConcurrentStreams: parseInt(els.maxCalls?.value||'5',10), stunServer: els.stunServer?.value, turnServer: els.turnServer?.value, turnUsername: els.turnUser?.value, turnCredential: els.turnPass?.value }, 'modify_channel');
    };
  }
  els.btnRemoveCh.onclick = () => {
    const id = els.channelSelect.value || els.channelId.value.trim();
    if (!id) { log('remove: select a channel'); return; }
    send('removeWebRTCChannel', { id }, 'remove_channel');
  };
  els.btnListCh.onclick = () => {
    send('getWebRTCChannels', {}, 'list_channels');
  };

  // Fill form fields when selecting a channel
  els.channelSelect.onchange = () => {
    const sel = els.channelSelect.value;
    const ch = channelsCache.find(c => c.id === sel);
    if (!ch) return;
    els.channelId.value = ch.id;
    els.channelDesc.value = ch.description || '';
    if (els.chkSendOnly) els.chkSendOnly.checked = !!ch.sendOnly;
    if (els.maxCalls) els.maxCalls.value = ch.maxConcurrentStreams ?? 5;
    if (els.stunServer) els.stunServer.value = ch.stunServer || '';
    if (els.turnServer) els.turnServer.value = ch.turnServer || '';
    if (els.turnUser) els.turnUser.value = ch.turnUsername || '';
    if (els.turnPass) els.turnPass.value = ch.turnCredential || '';
  };

  // Session start/stop
  els.btnStart.onclick = async () => {
    resetPc();
    const selected = els.channelSelect.value || els.channelId.value.trim();
    if (!selected) { log('no channel selected'); return; }
    // Ensure we use latest channel settings before creating offer
    await new Promise((resolve) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; resolve(); } }, 1000);
      pendingRefreshResolve = () => { if (!done) { done = true; clearTimeout(to); resolve(); } };
      send('getWebRTCChannels', {}, 'list_channels');
    });
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceCandidatePoolSize: 10 });
    bindPcEvents();
    // Decide direction based on up-to-date channel mode (cache preferred)
    const ch = channelsCache.find(c => c.id === selected);
    const selectedOpt = Array.from(els.channelSelect.options).find(o => o.value === selected);
    const sendOnly = ch ? !!ch.sendOnly : (selectedOpt && selectedOpt.dataset.sendonly === 'true');
    if (sendOnly) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    } else {
      try {
        // Request mic only when channel is bidirectional
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 48000 },
            sampleSize: { ideal: 16 },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          },
            video: false
        });
        localStream = stream;
        const track = stream.getAudioTracks()[0];
        if (track) pc.addTrack(track, stream);
      } catch (e) {
        log('mic permission failed: ' + e);
      }
    }
    // If loopback requested before tracks arrive, pre-allocate a dummy dest and add track when ontrack fires
    if (els.chkLoopbackBrowser && els.chkLoopbackBrowser.checked) {
      try {
        if (!loopbackCtx) loopbackCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (!loopbackDest) loopbackDest = loopbackCtx.createMediaStreamDestination();
      } catch {}
    }
    const offer = await pc.createOffer();
    let sdp = offer.sdp || '';
    sdp = mungeOpusStereo(sdp, 128000);
    els.localSdp.textContent = sdp;
    await pc.setLocalDescription({ type: 'offer', sdp });
    send('webrtc_offer', { channelId: selected, sdp }, 'webrtc_offer');
    setRtcState('starting');
    els.btnStart.disabled = true;
    els.btnStop.disabled = false;
  };

  els.btnStop.onclick = () => {
    if (sessionId) send('webrtc_disconnect', { sessionId }, 'webrtc_disconnect');
    resetPc();
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
  };

  if (els.chkLoopbackBrowser) {
    els.chkLoopbackBrowser.onchange = () => {
      if (!pc) return;
      try {
        if (els.chkLoopbackBrowser.checked) {
          // enable: if remote is already set, wire now
          const s = els.remoteAudio && els.remoteAudio.srcObject;
          if (s) {
            if (!loopbackCtx) loopbackCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (!loopbackDest) loopbackDest = loopbackCtx.createMediaStreamDestination();
            if (loopbackSource) { try { loopbackSource.disconnect(); } catch {} loopbackSource = null; }
            loopbackSource = loopbackCtx.createMediaStreamSource(s);
            loopbackSource.connect(loopbackDest);
            const ms = loopbackDest.stream; const tr = ms.getAudioTracks()[0];
            if (tr) { if (loopbackTrackSender) { try { pc.removeTrack(loopbackTrackSender); } catch {} }
              loopbackTrackSender = pc.addTrack(tr, ms);
            }
          }
        } else {
          // disable
          if (loopbackTrackSender) { try { pc.removeTrack(loopbackTrackSender); } catch {} loopbackTrackSender = null; }
          if (loopbackSource) { try { loopbackSource.disconnect(); } catch {} loopbackSource = null; }
          if (loopbackDest) { /* keep context/dest around */ }
        }
      } catch (e) { log('loopback toggle error: ' + e); }
    };
  }

  els.btnGetStatus.onclick = () => {
    const selected = (els.statusChannelSelect && els.statusChannelSelect.value) || els.channelSelect.value || els.channelId.value.trim();
    if (!selected) { els.srvStatusOut.textContent = 'No channel selected'; return; }
    send('webrtc_status', { channelId: selected }, 'webrtc_status');
  };

  function renderKV(container, entries) {
    const ul = document.createElement('ul'); ul.className = 'kv';
    entries.forEach(([k, v]) => {
      const li = document.createElement('li');
      const b = document.createElement('strong'); b.textContent = k;
      const span = document.createElement('span'); span.textContent = v;
      li.appendChild(b); li.appendChild(span); ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  function renderServerStatus(data) {
    const root = els.srvStatusView; if (!root) return;
    root.innerHTML = '';
    if (!data || typeof data !== 'object') { root.textContent = 'No data'; return; }

    // Channel section
    if (data.channel) {
      const sec = document.createElement('div'); sec.className = 'section';
      const h = document.createElement('h3'); h.textContent = 'Channel'; sec.appendChild(h);
      renderKV(sec, [
        ['ID', data.channel.id],
        ['Description', data.channel.description],
        ['Enabled', String(data.channel.enabled)]
      ]);
      root.appendChild(sec);
    }

    // Streams section
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const secS = document.createElement('div'); secS.className = 'section';
    const h2 = document.createElement('h3'); h2.textContent = `Streams (${streams.length})`; secS.appendChild(h2);
    const grid = document.createElement('div'); grid.className = 'streams';
    streams.forEach(s => {
      const card = document.createElement('div'); card.className = 'section';
      const title = document.createElement('h3'); title.textContent = `Session ${s.sessionId}`; card.appendChild(title);
      renderKV(card, [
        ['Active', String(s.isActive)],
        ['ICE ready', String(s.iceReady)],
        ['SRTP ready', String(s.srtpReady)],
        ['Pending ICE', String(s.pendingIceCandidatesCount)]
      ]);
      if (s.media && s.media.codec) {
        const md = s.media;
        const secM = document.createElement('div'); secM.className = 'section';
        const h3 = document.createElement('h3'); h3.textContent = 'Media'; secM.appendChild(h3);
        renderKV(secM, [
          ['Codec', md.codec.name || ''],
          ['Clock', String(md.codec.clockRate || 0)],
          ['Channels', String(md.codec.channels || 0)],
          ['PT (tx/rx)', `${md.codec.tx_pt ?? '-'} / ${md.codec.rx_pt ?? '-'}`],
          ['Direction', String(md.direction ?? '')],
          ['RTCP-Mux', String(md.rtcpMux ?? '')]
        ]);
        // RTCP
        if (md.rtcpStat) {
          const r = md.rtcpStat;
          const tx = r.tx || {}; const rx = r.rx || {}; const rtt = r.rttUsec || {};
          const secR = document.createElement('div'); secR.className = 'section';
          const h4 = document.createElement('h3'); h4.textContent = 'RTCP'; secR.appendChild(h4);
          renderKV(secR, [
            ['TX bytes/pkt', `${tx.bytes ?? 0} / ${tx.pkt ?? 0}`],
            ['RX bytes/pkt', `${rx.bytes ?? 0} / ${rx.pkt ?? 0}`],
            ['RX loss/discard/dup', `${rx.loss ?? 0} / ${rx.discard ?? 0} / ${rx.dup ?? 0}`],
            ['RX reorder', String(rx.reorder ?? 0)],
            ['RX jitter (min/mean/max us)', `${rx.jitterUsec?.min ?? 0}/${rx.jitterUsec?.mean ?? 0}/${rx.jitterUsec?.max ?? 0}`],
            ['RTT (min/mean/max us)', `${rtt.min ?? 0}/${rtt.mean ?? 0}/${rtt.max ?? 0}`]
          ]);
          secM.appendChild(secR);
        }
        // Jitter buffer
        if (md.jitterBuffer) {
          const j = md.jitterBuffer;
          const secJ = document.createElement('div'); secJ.className = 'section';
          const h5 = document.createElement('h3'); h5.textContent = 'Jitter Buffer'; secJ.appendChild(h5);
          renderKV(secJ, [
            ['Frame size (bytes)', String(j.frame_size)],
            ['Prefetch (min/max)', `${j.prefetch} (${j.min_prefetch}/${j.max_prefetch})`],
            ['Size (frames)', String(j.size)],
            ['Delay avg/min/max (ms)', `${j.avg_delay_ms}/${j.min_delay_ms}/${j.max_delay_ms}`],
            ['Lost/Discard/Empty', `${j.lost_frames}/${j.discard_frames}/${j.empty_events}`]
          ]);
          secM.appendChild(secJ);
        }
        card.appendChild(secM);
      }
      grid.appendChild(card);
    });
    secS.appendChild(grid);
    root.appendChild(secS);
  }
})(); 
