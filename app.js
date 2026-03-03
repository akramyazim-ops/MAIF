/* =============================================================
   M.A.I.F — My AI Framework  |  app.js
   Voice recognition → AI brain → TTS response → Zapier hooks
   ============================================================= */

// ── Config & State ──────────────────────────────────────────
const CFG_KEY = 'maif_config';
let config = {
  apiKey: 'sk-c2a2198d7dfe4b2e925fa6875e50a8cd',
  apiProvider: 'deepseek', // 'openai' | 'gemini' | 'deepseek'
  zapierUrl: '',
  voiceName: '',
  voiceRate: 1,
  voicePitch: 1,
  continuousMode: false
};

const state = {
  recording: false,
  speaking: false,
  sessionStart: Date.now(),
  cmdCount: 0,
  zapCount: 0,
  conversation: [],
  lastTranscript: '' // Buffer for PTT capture
};

// ── Load persisted config ───────────────────────────────────
function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    Object.assign(config, saved);
  } catch (_) { }
}
function saveConfig() {
  localStorage.setItem(CFG_KEY, JSON.stringify(config));
}

// ── DOM refs ────────────────────────────────────────────────
const orbCore = document.getElementById('orbCore');
const orbIcon = document.getElementById('orbIcon');
const micBtn = document.getElementById('micBtn');
const aiText = document.getElementById('aiText');
const dotEl = document.getElementById('statusDot');
const dotLabel = document.getElementById('dotLabel');
const interimEl = document.getElementById('interim');
const transcriptEl = document.getElementById('transcriptScroll');
const toggleEl = document.getElementById('continuousToggle');
const waveCanvas = document.getElementById('waveform');
const waveCtx = waveCanvas ? waveCanvas.getContext('2d') : null;

// Settings modal
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const modalClose = document.getElementById('modalClose');
const modalCancel = document.getElementById('modalCancel');
const modalSave = document.getElementById('modalSave');
const inputApiKey = document.getElementById('inputApiKey');
const inputApiProv = document.getElementById('inputApiProv');
const inputZapier = document.getElementById('inputZapier');
const inputVoiceSel = document.getElementById('inputVoice');
const inputRate = document.getElementById('inputRate');
const inputPitch = document.getElementById('inputPitch');
const rateVal = document.getElementById('rateVal');
const pitchVal = document.getElementById('pitchVal');

// Stats
const statCmds = document.getElementById('statCmds');
const statZaps = document.getElementById('statZaps');
const statSession = document.getElementById('statSession');

// ── Toast ───────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── State helpers ───────────────────────────────────────────
function setStatus(mode, label) {
  dotEl.className = `dot ${mode}`;
  dotLabel.textContent = label;
}
function setOrbMode(mode) {
  orbCore.className = 'orb-core ' + mode;
  if (mode === 'listening') { orbIcon.textContent = '🎙️'; aiText.textContent = 'Listening…'; aiText.className = 'ai-text active'; }
  else if (mode === 'speaking') { orbIcon.textContent = '🔊'; aiText.textContent = 'Speaking…'; aiText.className = 'ai-text active'; }
  else { orbIcon.textContent = '🤖'; aiText.textContent = 'Ready for your command'; aiText.className = 'ai-text'; }
}
function updateStats() {
  if (statCmds) statCmds.textContent = state.cmdCount;
  if (statZaps) statZaps.textContent = state.zapCount;
  if (statSession) {
    const mins = Math.floor((Date.now() - state.sessionStart) / 60000);
    statSession.textContent = mins < 1 ? 'just now' : `${mins}m`;
  }
}

// ── Waveform animation ──────────────────────────────────────
let waveAnim = null;
let wavePhase = 0;
function drawWave(active) {
  if (!waveCtx || !waveCanvas) return;
  const W = waveCanvas.offsetWidth || 460;
  const H = waveCanvas.offsetHeight || 56;
  waveCanvas.width = W;
  waveCanvas.height = H;
  waveCtx.clearRect(0, 0, W, H);

  if (!active) {
    waveCtx.strokeStyle = 'rgba(124,58,237,0.15)';
    waveCtx.lineWidth = 1.5;
    waveCtx.beginPath();
    waveCtx.moveTo(0, H / 2);
    waveCtx.lineTo(W, H / 2);
    waveCtx.stroke();
    return;
  }

  wavePhase += 0.05;
  const bars = 42;
  const amp = H * 0.38;
  const grad = waveCtx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(124,58,237,0.9)');
  grad.addColorStop(0.5, 'rgba(6,182,212,0.9)');
  grad.addColorStop(1, 'rgba(16,185,129,0.9)');

  for (let i = 0; i < bars; i++) {
    const x = (i / bars) * W;
    const t = (i / bars) * Math.PI * 6;
    const h = Math.abs(Math.sin(t + wavePhase) * (amp * (0.5 + 0.5 * Math.random())));
    const barW = (W / bars) * 0.6;
    const r = barW / 2;
    const y = H / 2 - h / 2;
    waveCtx.fillStyle = grad;
    waveCtx.beginPath();
    waveCtx.roundRect(x, y, barW, h, r);
    waveCtx.fill();
  }
}
function startWave() {
  cancelAnimationFrame(waveAnim);
  function loop() { drawWave(true); waveAnim = requestAnimationFrame(loop); }
  loop();
}
function stopWave() {
  cancelAnimationFrame(waveAnim);
  drawWave(false);
}

// ── Malaysian Time Helper ───────────────────────────────────
function getMYTime() {
  return new Intl.DateTimeFormat('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(new Date());
}
function getMYDate() {
  return new Intl.DateTimeFormat('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());
}

// ── Chat transcript ─────────────────────────────────────────
function addMessage(role, text, zapierPayload = null) {
  const now = getMYTime();
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const avatarEmoji = role === 'ai' ? '🤖' : '👤';
  let extra = '';
  if (zapierPayload) {
    extra = `<div class="zap-action" onclick="sendToZapier(${JSON.stringify(JSON.stringify(zapierPayload))})">
      <span>⚡</span>
      <span class="zap-text">Send to Zapier: <strong>${zapierPayload.action}</strong></span>
      <span>→</span>
    </div>`;
  }
  div.innerHTML = `
    <div class="msg-avatar">${avatarEmoji}</div>
    <div class="msg-body">
      <div class="msg-bubble">${text}</div>
      ${extra}
      <div class="msg-meta">${now}</div>
    </div>`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  state.conversation.push({ role: role === 'ai' ? 'assistant' : 'user', content: text });
  if (state.conversation.length > 40) state.conversation.splice(0, 2);
}

function clearTranscript() {
  transcriptEl.innerHTML = '';
  state.conversation = [];
  addWelcome();
}

function addWelcome() {
  addMessage('ai', `Hai! Saya <strong>M.A.I.F</strong> — pembantu AI peribadi anda. Saya boleh membantu anda dengan:<br>
    📅 Penjadualan &amp; peringatan &nbsp;|&nbsp; 📧 Tugasan emel melalui Zapier &nbsp;|&nbsp; 🔍 Penyelidikan &amp; ringkasan<br>
    Klik atau tahan <strong>butang mikrofon 🎙️</strong> untuk bermula!`);
}

// ── Zapier integration ──────────────────────────────────────
async function sendToZapier(payloadString) {
  if (!config.zapierUrl) {
    toast('⚡ Add your Zapier webhook URL in Settings first!', 'error');
    openSettings();
    return;
  }
  let payload;
  try { payload = typeof payloadString === 'string' ? JSON.parse(payloadString) : payloadString; }
  catch (_) { payload = { action: 'generic', data: payloadString }; }

  try {
    toast('⚡ Sending to Zapier…');
    await fetch(config.zapierUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'MAIF', timestamp: new Date().toISOString(), ...payload })
    });
    state.zapCount++;
    updateStats();
    toast('✅ Zapier triggered successfully!', 'success');
  } catch (err) {
    toast('❌ Zapier error: ' + err.message, 'error');
  }
}

// ── AI API calls ────────────────────────────────────────────
const SYSTEM_PROMPT = `Anda adalah M.A.I.F (My AI Framework), seorang pembantu peribadi yang cekap dan profesional.
Tugas utama anda adalah untuk memberikan maklum balas yang sangat tepat dan terus kepada maksud berdasarkan apa yang dikatakan oleh pengguna.
Pastikan maklum balas adalah ringkas, padat, dan "manusiawi," tetapi elakkan daripada memberikan maklumat yang tidak berkaitan.
DILARANG MENGGUNAKAN EMOJI DALAM SEBARANG MAKLUM BALAS.
Waktu tempatan sekarang di Kuala Lumpur: ${getMYTime()}.
SELESAIKAN SEMUA MAKLUM BALAS DALAM BAHASA MELAYU.
Jika ada permintaan tindakan (emel, peringatan, dll.), sertakan JSON ini di hujung:
ZAPIER_ACTION:{"action":"<action_name>","data":{<relevant_fields>}}`;

async function callOpenAI(userText) {
  const dynamicPrompt = `${SYSTEM_PROMPT} Current Local Time in Malaysia (Kuala Lumpur): ${getMYTime()}.`;
  const messages = [
    { role: 'system', content: dynamicPrompt },
    ...state.conversation.slice(-10),
    { role: 'user', content: userText }
  ];
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.7, max_tokens: 250 })
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.json()).error?.message || res.statusText}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function callGemini(userText) {
  const dynamicPrompt = `${SYSTEM_PROMPT} Current Local Time in Malaysia (Kuala Lumpur): ${getMYTime()}.`;
  const history = state.conversation.slice(-10).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: dynamicPrompt }] },
        contents: [...history, { role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: 250, temperature: 0.7 }
      })
    }
  );
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.json()).error?.message || res.statusText}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

async function callDeepSeek(userText) {
  const dynamicPrompt = `${SYSTEM_PROMPT} Current Local Time in Malaysia (Kuala Lumpur): ${getMYTime()}.`;
  const messages = [
    { role: 'system', content: dynamicPrompt },
    ...state.conversation.slice(-10),
    { role: 'user', content: userText }
  ];
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 250 })
  });
  if (!res.ok) throw new Error(`DeepSeek error ${res.status}: ${(await res.json()).error?.message || res.statusText}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// Smart local fallback (no API key required)
function localFallback(text) {
  const t = text.toLowerCase();
  if (t.includes('hello') || t.includes('hai') || t.includes('apa khabar')) return "Hai. Saya M.A.I.F, pembantu AI anda. Sila beritahu saya apa yang boleh saya bantu hari ini.";
  if (t.includes('pukul berapa') || t.includes('waktu') || t.includes('masa')) return `Sekarang adalah pukul ${getMYTime()} di Malaysia.`;
  if (t.includes('tarikh') || t.includes('hari ini')) return `Hari ini adalah ${getMYDate()}.`;
  if (t.includes('ingatkan') || t.includes('jadual') || t.includes('mesyuarat'))
    return `Saya akan membantu anda menetapkan peringatan tersebut melalui Zapier. Sila pastikan webhook anda telah dikonfigurasikan.\nZAPIER_ACTION:{"action":"create_reminder","data":{"text":"${text}"}}`;
  if (t.includes('emel') || t.includes('hantar'))
    return `Saya akan memproses penghantaran emel ini melalui Zapier. Adakah terdapat perkara lain yang anda perlukan?\nZAPIER_ACTION:{"action":"send_email","data":{"message":"${text}"}}`;
  if (t.includes('cuaca')) return "Saya memerlukan kunci API untuk menyemak maklumat cuaca secara langsung. Anda boleh menyediakannya dalam bahagian Tetapan.";
  if (t.includes('terima kasih')) return "Sama-sama. Saya sedia membantu anda.";
  if (t.includes('lawak') || t.includes('cerita lucu')) return "Kenapa komputer masuk hospital? Sebab dia ada virus. Saya harap itu dapat membantu menceriakan suasana.";
  return `Saya menerima input anda: "${text}". Untuk fungsi yang lebih mendalam, sila masukkan kunci API anda dalam bahagian Tetapan.`;
}

async function getAIResponse(userText) {
  try {
    if (config.apiKey) {
      if (config.apiProvider === 'gemini') return await callGemini(userText);
      if (config.apiProvider === 'deepseek') return await callDeepSeek(userText);
      return await callOpenAI(userText);
    }
    return localFallback(userText);
  } catch (err) {
    console.error('AI error:', err);
    return `Sorry, I hit an error: ${err.message}. Check your API key in Settings.`;
  }
}

// ── Parse Zapier action from AI response ────────────────────
function parseZapierAction(aiText) {
  const match = aiText.match(/ZAPIER_ACTION:(\{.*\})/s);
  if (!match) return { clean: aiText, payload: null };
  try {
    const payload = JSON.parse(match[1]);
    const clean = aiText.replace(/ZAPIER_ACTION:\{.*\}/s, '').trim();
    return { clean, payload };
  } catch (_) {
    return { clean: aiText.replace(/ZAPIER_ACTION:.*$/s, '').trim(), payload: null };
  }
}

// ── Text-to-Speech ──────────────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const cleanText = text.replace(/<[^>]+>/g, '').replace(/ZAPIER_ACTION:.*$/s, '');
  const utt = new SpeechSynthesisUtterance(cleanText);
  utt.rate = config.voiceRate || 1;
  utt.pitch = config.voicePitch || 1;

  const voices = speechSynthesis.getVoices();
  if (config.voiceName) {
    const match = voices.find(v => v.name === config.voiceName);
    if (match) utt.voice = match;
  } else {
    // Priority 1: High quality Malay voice
    const malayPremium = voices.find(v => v.lang.startsWith('ms') && (v.name.includes('Google') || v.name.includes('Natural')));
    // Priority 2: Any Malay voice
    const malayAny = voices.find(v => v.lang.startsWith('ms'));
    // Priority 3: Premium English voice
    const englishPremium = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural')));

    if (malayPremium) utt.voice = malayPremium;
    else if (malayAny) utt.voice = malayAny;
    else if (englishPremium) utt.voice = englishPremium;
  }

  utt.onstart = () => {
    state.speaking = true;
    setOrbMode('speaking');
    setStatus('speak', 'Speaking');
    startWave();
  };
  utt.onend = utt.onerror = () => {
    state.speaking = false;
    setOrbMode('');
    setStatus('ready', 'Ready');
    stopWave();
    if (config.continuousMode && !state.recording) {
      startRecognition();
    }
  };
  speechSynthesis.speak(utt);
}

/**
 * Mobile security fix: 'Unlock' speech synthesis inside a user gesture
 * Browsers like Safari/Chrome on mobile block speech unless it's triggered by a gesture.
 */
function unlockSpeech() {
  if (!window.speechSynthesis) return;
  const silent = new SpeechSynthesisUtterance(' ');
  silent.volume = 0;
  speechSynthesis.speak(silent);
}

// ── Speech Recognition ──────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function initRecognition() {
  if (!SpeechRecognition) return;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'ms-MY';

  recognition.onstart = () => {
    state.recording = true;
    micBtn.classList.add('recording');
    micBtn.textContent = '⏹️';
    setOrbMode('listening');
    setStatus('listen', 'Mendengar');
    startWave();
    interimEl.style.display = 'block';
    interimEl.textContent = 'Mendengar…';
  };

  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    state.lastTranscript = final || interim;
    if (interim) interimEl.textContent = '🎙️ ' + interim;
    if (final) handleUserInput(final.trim());
  };

  recognition.onerror = (e) => {
    console.warn('Speech error:', e.error);
    if (e.error === 'not-allowed') toast('🎙️ Microphone access denied. Allow mic in browser settings.', 'error');
    else if (e.error !== 'no-speech') toast('Voice error: ' + e.error, 'error');
    stopRecognition();
  };

  recognition.onend = () => {
    stopRecognition();
  };
}

function startRecognition() {
  if (!recognition) {
    if (!SpeechRecognition) { toast('❌ Voice recognition not supported. Use Chrome or Edge.', 'error'); return; }
    initRecognition();
  }
  try { recognition.start(); } catch (_) { }
}

function handlePttFallback() {
  interimEl.style.display = 'none';
  // PTT Fallback: If we stopped but have text that wasn't "final", process it now
  if (state.recording && state.lastTranscript.trim()) {
    const text = state.lastTranscript.trim();
    state.lastTranscript = '';
    handleUserInput(text);
  }
}

function stopRecognition() {
  if (!state.recording) return; // Prevent duplicate triggers
  state.recording = false;
  micBtn.classList.remove('recording');
  micBtn.textContent = '🎙️';
  if (!state.speaking) {
    setOrbMode('');
    setStatus('ready', 'Ready');
    stopWave();
  }
  handlePttFallback();
  try { recognition && recognition.stop(); } catch (_) { }
}

async function handleUserInput(text) {
  if (!text) return;
  state.lastTranscript = ''; // Clear buffer since we are processing
  stopRecognition();
  interimEl.style.display = 'none';
  state.cmdCount++;
  updateStats();

  addMessage('user', text);

  setOrbMode('');
  setStatus('ready', 'Berfikir…');
  aiText.textContent = 'Berfikir…';
  aiText.className = 'ai-text active';

  const raw = await getAIResponse(text);
  const { clean, payload } = parseZapierAction(raw);

  addMessage('ai', clean || raw, payload);
  speak(clean || raw);

  // Auto-send to Zapier if URL configured and action detected
  if (payload && config.zapierUrl) {
    setTimeout(() => sendToZapier(payload), 500);
  }
}

// ── Quick command buttons ────────────────────────────────────
function sendQuickCmd(text) {
  if (state.speaking) speechSynthesis.cancel();
  handleUserInput(text);
}

// ── Voice selector ───────────────────────────────────────────
function populateVoices() {
  const voices = speechSynthesis.getVoices();
  if (!inputVoiceSel) return;
  inputVoiceSel.innerHTML = '<option value="">Default voice</option>';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v.name === config.voiceName) opt.selected = true;
    inputVoiceSel.appendChild(opt);
  });
}

// ── Settings modal ───────────────────────────────────────────
function openSettings() {
  if (inputApiKey) inputApiKey.value = config.apiKey;
  if (inputApiProv) inputApiProv.value = config.apiProvider;
  if (inputZapier) inputZapier.value = config.zapierUrl;
  if (inputRate) { inputRate.value = config.voiceRate; if (rateVal) rateVal.textContent = config.voiceRate; }
  if (inputPitch) { inputPitch.value = config.voicePitch; if (pitchVal) pitchVal.textContent = config.voicePitch; }
  populateVoices();
  settingsModal.classList.add('open');
}
function closeSettings() { settingsModal.classList.remove('open'); }

function saveSettings() {
  config.apiKey = inputApiKey?.value.trim() || '';
  config.apiProvider = inputApiProv?.value || 'openai';
  config.zapierUrl = inputZapier?.value.trim() || '';
  config.voiceName = inputVoiceSel?.value || '';
  config.voiceRate = parseFloat(inputRate?.value) || 1;
  config.voicePitch = parseFloat(inputPitch?.value) || 1;
  saveConfig();
  closeSettings();
  toast('✅ Settings saved!', 'success');
}

// ── Event listeners ──────────────────────────────────────────
const startEvents = ['mousedown', 'touchstart'];
const stopEvents = ['mouseup', 'mouseleave', 'touchend'];

startEvents.forEach(evt => {
  micBtn?.addEventListener(evt, (e) => {
    e.preventDefault();
    unlockSpeech(); // UNLOCK for mobile
    if (state.speaking) speechSynthesis.cancel();
    startRecognition();
  });
});

stopEvents.forEach(evt => {
  micBtn?.addEventListener(evt, (e) => {
    unlockSpeech(); // Double check unlock on release
    if (state.recording) stopRecognition();
  });
});

toggleEl?.addEventListener('click', () => {
  config.continuousMode = !config.continuousMode;
  toggleEl.classList.toggle('on', config.continuousMode);
  toast(config.continuousMode ? '🔄 Continuous mode on' : '🔴 Continuous mode off');
});

settingsBtn?.addEventListener('click', openSettings);
modalClose?.addEventListener('click', closeSettings);
modalCancel?.addEventListener('click', closeSettings);
modalSave?.addEventListener('click', saveSettings);
settingsModal?.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

inputRate?.addEventListener('input', () => { if (rateVal) rateVal.textContent = inputRate.value; });
inputPitch?.addEventListener('input', () => { if (pitchVal) pitchVal.textContent = inputPitch.value; });

// Keyboard: hold spacebar to talk
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    if (!e.repeat) {
      e.preventDefault();
      if (state.speaking) speechSynthesis.cancel();
      startRecognition();
    }
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    stopRecognition();
  }
});

// Session timer
setInterval(updateStats, 30000);

// ── Init ──────────────────────────────────────────────────────
loadConfig();
drawWave(false);
setStatus('ready', 'Ready');
addWelcome();
updateStats();

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = populateVoices;
  populateVoices();
} else {
  toast('⚠️ Text-to-speech not supported in this browser.', 'error');
}

if (!SpeechRecognition) {
  if (micBtn) { micBtn.style.opacity = '0.4'; micBtn.title = 'Voice not supported — use Chrome or Edge'; }
  setStatus('error', 'No voice support');
} else {
  initRecognition();
}
