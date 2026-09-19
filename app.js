/* ---------- Navegação entre abas ---------- */
const tabButtons = document.querySelectorAll('nav.tabs button');
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('section.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ---------- Contexto de áudio compartilhado ---------- */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

async function decodeFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
}

/* ---------- Codificador WAV (PCM 16-bit) ---------- */
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2 + 44;
  const arrBuf = new ArrayBuffer(length);
  const view = new DataView(arrBuf);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + buffer.length * numChannels * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, buffer.length * numChannels * 2, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return new Blob([arrBuf], { type: 'audio/wav' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* =========================================================
   ABA 2 — EDITAR ÁUDIO (unir/recortar trechos)
   ========================================================= */
let clips = [];

document.getElementById('edit-files').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  const status = document.getElementById('edit-status');
  status.textContent = 'Carregando ' + files.length + ' arquivo(s)...';
  for (const file of files) {
    try {
      const buffer = await decodeFile(file);
      clips.push({ id: crypto.randomUUID(), name: file.name, buffer, start: 0, end: buffer.duration });
    } catch (err) {
      status.textContent = 'Não foi possível ler "' + file.name + '".';
    }
  }
  status.textContent = clips.length + ' trecho(s) prontos.';
  renderClipList();
  e.target.value = '';
});

function renderClipList() {
  const list = document.getElementById('clip-list');
  list.innerHTML = '';
  clips.forEach(clip => {
    const row = document.createElement('div');
    row.className = 'clip';
    row.innerHTML = `
      <span class="name">${clip.name} (${clip.buffer.duration.toFixed(1)}s)</span>
      <div class="trim">
        início <input type="number" step="0.1" min="0" max="${clip.buffer.duration}" value="${clip.start.toFixed(1)}" data-role="start">
        fim <input type="number" step="0.1" min="0" max="${clip.buffer.duration}" value="${clip.end.toFixed(1)}" data-role="end">
      </div>
      <button class="remove">remover</button>
    `;
    row.querySelector('[data-role="start"]').addEventListener('input', (e) => {
      clip.start = Math.max(0, Math.min(parseFloat(e.target.value) || 0, clip.buffer.duration));
    });
    row.querySelector('[data-role="end"]').addEventListener('input', (e) => {
      clip.end = Math.max(0, Math.min(parseFloat(e.target.value) || 0, clip.buffer.duration));
    });
    row.querySelector('.remove').addEventListener('click', () => {
      clips = clips.filter(c => c.id !== clip.id);
      renderClipList();
    });
    list.appendChild(row);
  });
  document.getElementById('edit-join').disabled = clips.length === 0;
  document.getElementById('edit-clear').style.display = clips.length ? 'inline-block' : 'none';
}

document.getElementById('edit-clear').addEventListener('click', () => {
  clips = [];
  renderClipList();
  document.getElementById('edit-audio').style.display = 'none';
  document.getElementById('edit-status').textContent = '';
});

document.getElementById('edit-join').addEventListener('click', async () => {
  const status = document.getElementById('edit-status');
  const valid = clips.filter(c => c.end > c.start);
  if (!valid.length) { status.textContent = 'Ajuste início/fim: nenhum trecho tem duração válida.'; return; }

  status.textContent = 'Processando...';
  const sampleRate = audioCtx.sampleRate;
  const totalDuration = valid.reduce((sum, c) => sum + (c.end - c.start), 0);
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

  let cursor = 0;
  for (const clip of valid) {
    const src = offlineCtx.createBufferSource();
    src.buffer = clip.buffer;
    src.connect(offlineCtx.destination);
    const dur = clip.end - clip.start;
    src.start(cursor, clip.start, dur);
    cursor += dur;
  }

  try {
    const rendered = await offlineCtx.startRendering();
    const blob = audioBufferToWav(rendered);
    const player = document.getElementById('edit-audio');
    player.src = URL.createObjectURL(blob);
    player.style.display = 'block';
    status.textContent = 'Pronto — ' + totalDuration.toFixed(1) + 's. Use o player para ouvir ou baixe abaixo.';

    let dlBtn = document.getElementById('edit-download');
    if (!dlBtn) {
      dlBtn = document.createElement('button');
      dlBtn.id = 'edit-download';
      dlBtn.className = 'action';
      dlBtn.style.marginTop = '12px';
      dlBtn.textContent = 'Baixar WAV';
      player.insertAdjacentElement('afterend', dlBtn);
    }
    dlBtn.onclick = () => downloadBlob(blob, 'edicao_maqam.wav');
  } catch (err) {
    status.textContent = 'Erro ao processar: ' + err.message;
  }
});

/* =========================================================
   ABA 3 — COMPOR POR ENCOMENDA (sintetizador de ritmos)
   ========================================================= */
const RITMOS = {
  maqsum: { label: 'Maqsum', pattern: ['D','T','-','T','D','-','T','-'] },
  saidi:  { label: 'Saidi',  pattern: ['D','D','-','T','D','-','T','-'] },
  baladi: { label: 'Baladi', pattern: ['D','T','-','T','D','D','-','T'] },
  malfuf: { label: 'Malfuf', pattern: ['-','D','-','T','-','D','-','T'] },
  ayyub:  { label: 'Ayyub',  pattern: ['D','-','T','T','-','-','D','-'] },
};

const ritmoSelect = document.getElementById('comp-ritmo');
Object.entries(RITMOS).forEach(([key, r]) => {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = r.label;
  ritmoSelect.appendChild(opt);
});

function renderPatternGrid() {
  const grid = document.getElementById('comp-pattern');
  grid.innerHTML = '';
  const pattern = RITMOS[ritmoSelect.value].pattern;
  pattern.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'step ' + (step === 'D' ? 'dum' : step === 'T' ? 'tek' : 'rest');
    div.dataset.index = i;
    div.textContent = step === 'D' ? 'dum' : step === 'T' ? 'tek' : '';
    grid.appendChild(div);
  });
}
ritmoSelect.addEventListener('change', renderPatternGrid);
renderPatternGrid();

/* síntese de um golpe de percussão num destino qualquer (ctx pode ser live ou offline) */
function scheduleHit(ctx, destination, type, time) {
  if (type === 'D') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(55, time + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(gain).connect(destination);
    osc.start(time);
    osc.stop(time + 0.3);
  } else if (type === 'T') {
    const bufSize = Math.floor(ctx.sampleRate * 0.06);
    const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    noise.connect(filter).connect(gain).connect(destination);
    noise.start(time);
  }
}

function buildSchedule(bpm, cycles) {
  const pattern = RITMOS[ritmoSelect.value].pattern;
  const stepDur = (60 / bpm) / 2; // colcheias
  const events = [];
  for (let c = 0; c < cycles; c++) {
    pattern.forEach((step, i) => {
      if (step !== '-') events.push({ time: (c * pattern.length + i) * stepDur, type: step, stepIndex: i });
    });
  }
  return { events, stepDur, totalSteps: pattern.length * cycles, totalDuration: pattern.length * cycles * stepDur };
}

document.getElementById('comp-play').addEventListener('click', () => {
  const bpm = parseInt(document.getElementById('comp-bpm').value) || 96;
  const cycles = Math.min(parseInt(document.getElementById('comp-ciclos').value) || 1, 16);
  const { events, stepDur, totalDuration } = buildSchedule(bpm, cycles);
  const startAt = audioCtx.currentTime + 0.08;
  events.forEach(ev => scheduleHit(audioCtx, audioCtx.destination, ev.type, startAt + ev.time));

  const steps = document.querySelectorAll('#comp-pattern .step');
  events.forEach(ev => {
    setTimeout(() => {
      steps.forEach(s => s.classList.remove('playing'));
      steps[ev.stepIndex].classList.add('playing');
    }, (startAt - audioCtx.currentTime + ev.time) * 1000);
  });
  setTimeout(() => steps.forEach(s => s.classList.remove('playing')), (totalDuration + 0.2) * 1000);

  document.getElementById('comp-status').textContent = 'Tocando ' + RITMOS[ritmoSelect.value].label + ' a ' + bpm + ' BPM...';
});

document.getElementById('comp-export').addEventListener('click', async () => {
  const status = document.getElementById('comp-status');
  const bpm = parseInt(document.getElementById('comp-bpm').value) || 96;
  const cycles = Math.min(parseInt(document.getElementById('comp-ciclos').value) || 1, 16);
  const { events, totalDuration } = buildSchedule(bpm, cycles);

  status.textContent = 'Gerando áudio...';
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil((totalDuration + 0.5) * sampleRate), sampleRate);
  events.forEach(ev => scheduleHit(offlineCtx, offlineCtx.destination, ev.type, ev.time));

  try {
    const rendered = await offlineCtx.startRendering();
    const blob = audioBufferToWav(rendered);
    const player = document.getElementById('comp-audio');
    player.src = URL.createObjectURL(blob);
    player.style.display = 'block';
    status.textContent = 'Pronto. Baixando...';
    downloadBlob(blob, RITMOS[ritmoSelect.value].label.toLowerCase() + '_' + bpm + 'bpm.wav');
  } catch (err) {
    status.textContent = 'Erro ao gerar: ' + err.message;
  }
});

/* =========================================================
   ABA 1 — RECONHECER RITMO (heurística de energia + correlação)
   ========================================================= */
const TEMPLATES = {}; // perfis normalizados 0..1 por passo, derivados dos padrões acima
Object.entries(RITMOS).forEach(([key, r]) => {
  TEMPLATES[key] = r.pattern.map(s => s === 'D' ? 1.0 : s === 'T' ? 0.6 : 0.12);
});

let recBuffer = null;

document.getElementById('rec-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const status = document.getElementById('rec-status');
  const analyzeBtn = document.getElementById('rec-analyze');
  const player = document.getElementById('rec-audio');
  document.getElementById('rec-result').style.display = 'none';
  if (!file) return;

  status.textContent = 'Carregando áudio...';
  try {
    recBuffer = await decodeFile(file);
    player.src = URL.createObjectURL(file);
    player.style.display = 'block';
    analyzeBtn.disabled = false;
    status.textContent = 'Áudio carregado (' + recBuffer.duration.toFixed(1) + 's). Clique em analisar.';
  } catch (err) {
    status.textContent = 'Não foi possível ler este arquivo.';
    analyzeBtn.disabled = true;
  }
});

function computeEnvelope(buffer, windowSize = 1024, hop = 512) {
  const data = buffer.numberOfChannels > 1
    ? averageChannels(buffer)
    : buffer.getChannelData(0);
  const envelope = [];
  for (let i = 0; i + windowSize <= data.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) sum += data[i + j] * data[i + j];
    envelope.push(Math.sqrt(sum / windowSize));
  }
  return envelope;
}

function averageChannels(buffer) {
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] += d[i] / buffer.numberOfChannels;
  }
  return out;
}

function estimateCycleLenHops(envelope, hopSeconds) {
  // procura o ciclo (8 pulsos) dentro da faixa de BPM 55-150 -> duração de ciclo = 240/bpm segundos
  const minSec = 240 / 150;
  const maxSec = 240 / 55;
  const minLag = Math.max(2, Math.round(minSec / hopSeconds));
  const maxLag = Math.min(envelope.length - 1, Math.round(maxSec / hopSeconds));

  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
  const centered = envelope.map(v => v - mean);

  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0, count = 0;
    for (let i = 0; i + lag < centered.length; i++) {
      score += centered[i] * centered[i + lag];
      count++;
    }
    score = count ? score / count : 0;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  return bestLag;
}

function foldToSteps(envelope, cycleLenHops, numSteps = 8) {
  const bins = new Array(numSteps).fill(0);
  const counts = new Array(numSteps).fill(0);
  const hopsPerStep = cycleLenHops / numSteps;
  envelope.forEach((val, i) => {
    const posInCycle = i % cycleLenHops;
    const stepIdx = Math.min(numSteps - 1, Math.floor(posInCycle / hopsPerStep));
    bins[stepIdx] += val;
    counts[stepIdx]++;
  });
  const profile = bins.map((b, i) => counts[i] ? b / counts[i] : 0);
  const max = Math.max(...profile) || 1;
  return profile.map(v => v / max);
}

function correlate(a, b) {
  const meanA = a.reduce((x, y) => x + y, 0) / a.length;
  const meanB = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

document.getElementById('rec-analyze').addEventListener('click', () => {
  const status = document.getElementById('rec-status');
  if (!recBuffer) return;
  if (recBuffer.duration < 3) {
    status.textContent = 'O trecho é muito curto — envie pelo menos uns 3-4 segundos de percussão.';
    return;
  }
  status.textContent = 'Analisando...';

  setTimeout(() => {
    const hop = 512;
    const envelope = computeEnvelope(recBuffer, 1024, hop);
    const hopSeconds = hop / recBuffer.sampleRate;
    const cycleLenHops = estimateCycleLenHops(envelope, hopSeconds);
    const profile = foldToSteps(envelope, cycleLenHops, 8);
    const estBpm = Math.round(240 / (cycleLenHops * hopSeconds));

    const scores = Object.entries(TEMPLATES).map(([key, template]) => {
      const corr = correlate(profile, template); // -1..1
      const pct = Math.max(0, Math.round(((corr + 1) / 2) * 100));
      return { key, label: RITMOS[key].label, pct };
    }).sort((a, b) => b.pct - a.pct);

    const matchesDiv = document.getElementById('rec-matches');
    matchesDiv.innerHTML = '';
    scores.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'match' + (i === 0 ? ' best' : '');
      row.innerHTML = `
        <div class="label">${s.label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${s.pct}%"></div></div>
        <div class="pct">${s.pct}%</div>
      `;
      matchesDiv.appendChild(row);
    });

    document.getElementById('rec-result').style.display = 'block';
    status.textContent = 'Andamento estimado: ~' + estBpm + ' BPM. Melhor correspondência: ' + scores[0].label + '.';
  }, 50);
});
