// PTC 路線動畫：逐格畫出教師移動，輸出 MP4（或 WebM）與 GIF
// MP4：優先用 WebCodecs（H.264）編碼，速度快；不支援時改用 MediaRecorder 即時錄製
// GIF：用 gifenc 編碼，所有瀏覽器都能產生
import { mapSVG, ptcStats } from './ptcmodel.js';
import { fmt, clockHMS, wallTime } from './model.js';

const COLORS = { bg: '#FFFFFF', ink: '#17262A', muted: '#56686C', line: '#D3DCDA', accent: '#0F6E66', warn: '#9A6400' };
const even = (n) => Math.ceil(n / 2) * 2;

// 產生第 i 格要顯示的課堂時間：前面是動畫，最後停留 hold 秒顯示完整路線
function frameTimes(D, fps, seconds, hold) {
  const n = Math.max(2, Math.round(seconds * fps));
  const list = Array.from({ length: n }, (_, i) => (D * i) / (n - 1));
  for (let i = 0; i < Math.round(hold * fps); i++) list.push(D);
  return list;
}

async function drawFrame(ctx, s, width, t, D, final) {
  const svg = mapSVG(s, width, COLORS, {
    header: true, legend: true, until: t, live: !final, progress: t / D,
    stamp: [`課堂 ${fmt(t)}`, clockHMS(wallTime(s, t))],
  });
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.width * (img.height / img.width));
}

function makeCanvas(s, width) {
  // 先畫一次取得高度（寬高都要是偶數，H.264 才能編碼）
  const probe = mapSVG(s, width, COLORS, { header: true, legend: true });
  const h = +probe.match(/height="(\d+)"/)[1];
  const c = document.createElement('canvas');
  c.width = even(width);
  c.height = even(h);
  return c;
}

// ---------- GIF ----------
export async function gifBlob(s, { seconds = 20, fps = 8, width = 800, hold = 2, onProgress, signal } = {}) {
  const { GIFEncoder, quantize, applyPalette } = await import('../vendor/gifenc.esm.js');
  const D = ptcStats(s).D;
  const canvas = makeCanvas(s, width);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const times = frameTimes(D, fps, seconds, hold);
  // 調色盤用最後一格（完整路線）計算，所有格共用，顏色一致、速度也快
  await drawFrame(ctx, s, width, D, D, true);
  // 255 色給畫面，最後一格保留作「透明」：和上一格相同的像素設成透明，只存變動的部分，檔案小很多
  const palette = quantize(ctx.getImageData(0, 0, canvas.width, canvas.height).data, 255);
  while (palette.length < 255) palette.push([0, 0, 0]);
  const TP = palette.length;
  palette.push([255, 0, 255]);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  let prev = null;
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    await drawFrame(ctx, s, width, times[i], D, i >= times.length - Math.round(hold * fps));
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const idx = applyPalette(data, palette.slice(0, TP));
    let out = idx;
    if (prev) {
      out = new Uint8Array(idx.length);
      for (let k = 0; k < idx.length; k++) out[k] = idx[k] === prev[k] ? TP : idx[k];
    }
    prev = idx;
    gif.writeFrame(out, canvas.width, canvas.height, i === 0
      ? { palette, delay, repeat: 0 }
      : { delay, transparent: true, transparentIndex: TP, dispose: 1 });
    onProgress?.((i + 1) / times.length);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r));
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

// ---------- MP4 ----------
const AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f'];
async function pickAvc(width, height, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of AVC) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 2_500_000, framerate: fps });
      if (r.supported) return codec;
    } catch (e) { /* 試下一個 */ }
  }
  return null;
}

export async function videoBlob(s, { seconds = 20, fps = 15, width = 1200, hold = 2, onProgress, signal } = {}) {
  const D = ptcStats(s).D;
  const canvas = makeCanvas(s, width);
  const ctx = canvas.getContext('2d');
  const times = frameTimes(D, fps, seconds, hold);
  const finalFrom = times.length - Math.round(hold * fps);
  const codec = await pickAvc(canvas.width, canvas.height, fps);
  if (codec) {
    const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: canvas.width, height: canvas.height }, fastStart: 'in-memory' });
    let err = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { err = e; } });
    enc.configure({ codec, width: canvas.width, height: canvas.height, bitrate: 2_500_000, framerate: fps });
    const dur = 1e6 / fps;
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) { enc.close(); throw new DOMException('已取消', 'AbortError'); }
      if (err) throw err;
      await drawFrame(ctx, s, width, times[i], D, i >= finalFrom);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * dur), duration: Math.round(dur) });
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      onProgress?.((i + 1) / times.length);
      if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 10));
    }
    await enc.flush();
    if (err) throw err;
    muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
  }
  return recordBlob(canvas, ctx, s, width, times, D, fps, finalFrom, onProgress, signal);
}

// 不支援 WebCodecs 時：用 MediaRecorder 即時錄製（需要和影片一樣長的時間）
async function recordBlob(canvas, ctx, s, width, times, D, fps, finalFrom, onProgress, signal) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('這個瀏覽器無法產生影片，請改用 GIF');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error('這個瀏覽器無法產生影片，請改用 GIF');
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((r) => { rec.onstop = r; });
  await drawFrame(ctx, s, width, 0, D, false);
  rec.start();
  const start = performance.now();
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) { rec.stop(); throw new DOMException('已取消', 'AbortError'); }
    await drawFrame(ctx, s, width, times[i], D, i >= finalFrom);
    track.requestFrame?.();
    onProgress?.((i + 1) / times.length);
    const wait = start + ((i + 1) * 1000) / fps - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  rec.stop();
  await done;
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), ext };
}
