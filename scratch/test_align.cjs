const fs = require('fs');
const path = require('path');

const lyricsPath = path.join(__dirname, '..', 'audio-cache', 'yt_1k8craCGpgs', 'lyrics.json');
const wfPath = path.join(__dirname, '..', 'audio-cache', 'yt_1k8craCGpgs', 'waveform_vocals.json');

const l = JSON.parse(fs.readFileSync(lyricsPath, 'utf8'));
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const pts = wf.peaks;
const pps = wf.sampleRate || 50;

const nonMarkers = l.segments.filter(s => s.text !== '[INSTRUMENTAL]');

// 1. Global offset detection
const firstLine = nonMarkers[0];
let globalOffset = 0;
if (firstLine) {
  const i0 = Math.max(0, Math.floor((firstLine.start - 0.2) * pps));
  const i1 = Math.min(pts.length - 1, Math.ceil((firstLine.start + 0.4) * pps));
  let maxAmp = 0;
  for (let i = i0; i <= i1; i++) { if (pts[i] > maxAmp) maxAmp = pts[i]; }
  
  if (maxAmp < 0.08) {
    const s0 = Math.max(0, Math.floor((firstLine.start - 2.0) * pps));
    const s1 = Math.min(pts.length - 1, Math.ceil((firstLine.start + 10.0) * pps));
    for (let i = s0; i <= s1; i++) {
      if (pts[i] >= 0.15) {
        let v = i;
        for (let j = i; j >= Math.max(0, i - 30); j--) {
          if (pts[j] <= 0.04) { v = j; break; }
          if (pts[j] < pts[v]) v = j;
        }
        globalOffset = Math.round((v / pps - firstLine.start) * 100) / 100;
        break;
      }
    }
  }
}
console.log('Detected Global Offset:', globalOffset + 's');

if (globalOffset !== 0) {
  for (const seg of nonMarkers) {
    seg.start = Math.round((seg.start + globalOffset) * 100) / 100;
    seg.end = Math.round((seg.end + globalOffset) * 100) / 100;
    if (seg.words) {
      for (const w of seg.words) {
        w.start = Math.round((w.start + globalOffset) * 100) / 100;
        w.end = Math.round((w.end + globalOffset) * 100) / 100;
      }
    }
  }
}

// 2. Per-line calibration for lines sitting on silence
for (let sIdx = 0; sIdx < nonMarkers.length; sIdx++) {
  const seg = nonMarkers[sIdx];
  const nextSeg = sIdx < nonMarkers.length - 1 ? nonMarkers[sIdx + 1] : null;
  const maxSearchTime = nextSeg ? nextSeg.start - 0.5 : seg.start + 6.0;

  const i0 = Math.max(0, Math.floor((seg.start - 0.05) * pps));
  const i1 = Math.min(pts.length - 1, Math.ceil((seg.start + 0.12) * pps));
  let maxAmp = 0;
  for (let i = i0; i <= i1; i++) { if (pts[i] > maxAmp) maxAmp = pts[i]; }

  if (maxAmp < 0.08) {
    const s0 = Math.max(0, Math.floor((seg.start - 0.5) * pps));
    const s1 = Math.min(pts.length - 1, Math.ceil(maxSearchTime * pps));
    let lineOnset = null;
    for (let i = s0; i <= s1; i++) {
      if (pts[i] >= 0.15) {
        let v = i;
        for (let j = i; j >= Math.max(s0, i - 25); j--) {
          if (pts[j] <= 0.04) { v = j; break; }
          if (pts[j] < pts[v]) v = j;
        }
        lineOnset = v / pps;
        break;
      }
    }
    if (lineOnset !== null) {
      const lineDelta = Math.round((lineOnset - seg.start) * 100) / 100;
      if (Math.abs(lineDelta) >= 0.15) {
        console.log(`Line [${sIdx}] "${seg.text}" over silence (amp ${maxAmp.toFixed(3)}). Shifted by ${lineDelta}s -> ${lineOnset.toFixed(2)}s`);
        seg.start = Math.round((seg.start + lineDelta) * 100) / 100;
        seg.end = Math.round((seg.end + lineDelta) * 100) / 100;
        if (seg.words) {
          for (const w of seg.words) {
            w.start = Math.round((w.start + lineDelta) * 100) / 100;
            w.end = Math.round((w.end + lineDelta) * 100) / 100;
          }
        }
      }
    }
  }
}

console.log('\nFinal calibrated line timestamps:');
nonMarkers.slice(0, 8).forEach((s, idx) => {
  console.log(`[${idx}] ${s.start.toFixed(2)}s -> ${s.end.toFixed(2)}s: ${s.text}`);
});
