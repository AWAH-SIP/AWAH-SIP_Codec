#!/usr/bin/env python3
import argparse
import wave
import numpy as np
from dataclasses import dataclass


DBFS_SILENCE_DEFAULT = -50.0


@dataclass
class Segment:
    kind: str  # 'burst' or 'silence'
    ch: int
    start_sample: int
    end_sample: int
    duration_ms: float
    peak_dbfs: float
    rms_dbfs: float


def dbfs_from_linear(x: float) -> float:
    x = max(x, 1e-12)
    return 20.0 * np.log10(x)


def read_wav(path: str):
    with wave.open(path, 'rb') as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)
    if sampwidth == 2:
        data = np.frombuffer(raw, dtype=np.int16)
        scale = 32768.0
    elif sampwidth == 1:
        data = np.frombuffer(raw, dtype=np.uint8).astype(np.int16) - 128
        scale = 128.0
    elif sampwidth == 3:
        # 24-bit packed little-endian
        a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        b = (a[:, 0].astype(np.int32) | (a[:, 1].astype(np.int32) << 8) | (a[:, 2].astype(np.int32) << 16))
        b = np.where(b & 0x800000, b | ~0xFFFFFF, b)  # sign extend
        data = b.astype(np.int32)
        scale = float(1 << 23)
    else:
        # Fallback to int16
        data = np.frombuffer(raw, dtype=np.int16)
        scale = 32768.0

    if n_channels > 1:
        data = data.reshape(-1, n_channels)
    else:
        data = data.reshape(-1, 1)
    audio = data.astype(np.float32) / scale
    return audio, framerate


def smooth_abs(x: np.ndarray, win_samples: int) -> np.ndarray:
    if win_samples <= 1:
        return np.abs(x)
    kernel = np.ones(win_samples, dtype=np.float32) / float(win_samples)
    # Pad reflect to keep alignment
    pad = win_samples // 2
    xabs = np.abs(x)
    xpad = np.pad(xabs, (pad, pad), mode='edge')
    return np.convolve(xpad, kernel, mode='valid')


def analyze_channel(x: np.ndarray, sr: int, th_dbfs: float, min_burst_ms: float):
    th_lin = 10.0 ** (th_dbfs / 20.0)
    smooth_ms = 10.0
    win = max(1, int(sr * smooth_ms / 1000.0))
    env = smooth_abs(x, win)
    above = env >= th_lin

    # Merge very short toggles using minimum durations
    min_burst = max(1, int(sr * min_burst_ms / 1000.0))
    min_sil = max(1, int(sr * 50 / 1000.0))  # 50 ms minimum silence to split bursts

    segs = []
    i = 0
    n = len(above)
    while i < n:
        start = i
        val = above[i]
        while i < n and above[i] == val:
            i += 1
        end = i
        length = end - start
        # Enforce minimums by merging with neighbors via simple filtering
        if val and length < min_burst:
            # reclassify as silence
            val = False
        if not val and length < min_sil:
            # reclassify as burst
            val = True
        segs.append((val, start, end))

    # Coalesce after reclassification
    merged = []
    for val, start, end in segs:
        if not merged:
            merged.append([val, start, end])
        else:
            if merged[-1][0] == val:
                merged[-1][2] = end
            else:
                merged.append([val, start, end])

    results = []
    for val, start, end in merged:
        seg = x[start:end]
        dur_ms = 1000.0 * (end - start) / float(sr)
        peak = float(np.max(np.abs(seg))) if seg.size else 0.0
        rms = float(np.sqrt(np.mean(np.square(seg), dtype=np.float64))) if seg.size else 0.0
        results.append(Segment(
            kind='burst' if val else 'silence',
            ch=0,
            start_sample=start,
            end_sample=end,
            duration_ms=dur_ms,
            peak_dbfs=dbfs_from_linear(peak),
            rms_dbfs=dbfs_from_linear(rms)
        ))
    return results


def pn_template(sr: int, ms: int = 200) -> np.ndarray:
    """PN/MLS template with same simple band-limiting and fade as C++ port.
    HP @300 Hz (1st-order), then LP @3400 Hz (1st-order), 5 ms fade-in/out, normalized.
    """
    n = int(sr * ms / 1000)
    lfsr = 0x1
    v = np.empty(n, dtype=np.float32)
    for i in range(n):
        bit = ((lfsr >> 0) ^ (lfsr >> 1)) & 1
        lfsr = (lfsr >> 1) | (bit << 14)
        v[i] = 1.0 if (lfsr & 1) else -1.0
    # HP then LP (match C++)
    hp_a = float(np.exp(-2.0 * np.pi * 300.0 / sr))
    lp_a = float(np.exp(-2.0 * np.pi * 3400.0 / sr))
    hp_prev = 0.0
    x_prev = 0.0
    for i in range(n):
        x = float(v[i])
        hp = hp_a * hp_prev + hp_a * (x - x_prev)
        hp_prev = hp
        x_prev = x
        v[i] = hp
    lp_prev = float(v[0])
    for i in range(1, n):
        y = lp_a * lp_prev + (1.0 - lp_a) * float(v[i])
        v[i] = y
        lp_prev = y
    # Fade in/out 5 ms
    fade = int(sr * 0.005)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        v[:fade] *= ramp
        v[-fade:] *= ramp[::-1]
    # Normalize
    peak = float(np.max(np.abs(v)))
    if peak > 1e-6:
        v /= peak
    return v.astype(np.float32)


def ncc(a: np.ndarray, b: np.ndarray) -> float:
    if a.size != b.size:
        m = min(a.size, b.size)
        a = a[:m]
        b = b[:m]
    num = float(np.dot(a, b))
    den = float(np.linalg.norm(a) * np.linalg.norm(b))
    return num / den if den > 1e-9 else 0.0


def resample_linear(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out or x.size == 0:
        return x.copy()
    duration = x.size / float(sr_in)
    # Ensure last sample aligns with duration
    t_in = np.linspace(0.0, duration, x.size, endpoint=False, dtype=np.float64)
    n_out = int(round(duration * sr_out))
    t_out = np.linspace(0.0, duration, n_out, endpoint=False, dtype=np.float64)
    y = np.interp(t_out, t_in, x.astype(np.float64)).astype(np.float32)
    return y


def duplication_checks(seg8: np.ndarray, tpl8: np.ndarray) -> dict:
    out = {}
    if seg8.size == 0:
        return {k: 0.0 for k in ["ncc200", "ncc400", "half_dupe", "dec2_ncc", "inc2_ncc"]}
    # NCC vs single 200 ms template
    m200 = min(seg8.size, tpl8.size)
    out["ncc200"] = ncc(seg8[:m200], tpl8[:m200])
    # NCC vs double-length template (concatenate twice)
    tpl2 = np.concatenate([tpl8, tpl8])
    m400 = min(seg8.size, tpl2.size)
    out["ncc400"] = ncc(seg8[:m400], tpl2[:m400])
    # Half duplication check
    h = seg8.size // 2
    if h > 32:
        out["half_dupe"] = ncc(seg8[:h], seg8[h:2*h])
    else:
        out["half_dupe"] = 0.0
    # Per-sample duplication heuristic: if each sample was repeated once
    dec2 = seg8[::2]
    mdec = min(dec2.size, tpl8.size)
    out["dec2_ncc"] = ncc(dec2[:mdec], tpl8[:mdec]) if mdec > 0 else 0.0
    # If original is too short, try comparing seg upsampled by 2 (repeat each sample)
    inc2 = np.repeat(seg8, 2)
    minc = min(inc2.size, tpl8.size)
    out["inc2_ncc"] = ncc(inc2[:minc], tpl8[:minc]) if minc > 0 else 0.0
    return out


def decimate_n(x: np.ndarray, n: int) -> np.ndarray:
    if n <= 1:
        return x
    return x[::n]


def frame_repeat_metrics(seg8: np.ndarray, frame_samples: int = 160) -> dict:
    """Within-burst diagnostics at 8 kHz: compare consecutive frame blocks.
    Returns mean and max NCC between adjacent 160-sample blocks and autocorr at lag=160.
    """
    out = {"adj_mean": 0.0, "adj_max": 0.0, "lag160": 0.0, "frames": 0}
    if seg8.size < 2 * frame_samples:
        return out
    n_frames = seg8.size // frame_samples
    blocks = [seg8[i*frame_samples:(i+1)*frame_samples] for i in range(n_frames)]
    scores = []
    for i in range(n_frames-1):
        scores.append(ncc(blocks[i], blocks[i+1]))
    out["adj_mean"] = float(np.mean(scores)) if scores else 0.0
    out["adj_max"] = float(np.max(scores)) if scores else 0.0
    out["frames"] = n_frames
    # Autocorr at lag=160 using NCC on overlapping segments
    a = seg8[:-frame_samples]
    b = seg8[frame_samples:]
    out["lag160"] = ncc(a, b)
    return out


def main():
    ap = argparse.ArgumentParser(description='Analyze bursts/silence in WAV and optional PN detect')
    ap.add_argument('wav', help='Path to WAV file recorded from conference')
    ap.add_argument('--threshold-db', type=float, default=DBFS_SILENCE_DEFAULT, help='Silence threshold in dBFS (default -50)')
    ap.add_argument('--min-burst-ms', type=float, default=80.0, help='Minimum burst duration to count (default 80 ms)')
    ap.add_argument('--ncc', action='store_true', help='Run NCC against 200 ms PN template if sr == 8000')
    args = ap.parse_args()

    audio, sr = read_wav(args.wav)
    n_channels = audio.shape[1]
    print(f"Loaded: {args.wav}, sr={sr}, ch={n_channels}, samples={audio.shape[0]}")
    th = args.threshold_db

    for ch in range(n_channels):
        x = audio[:, ch]
        segs = analyze_channel(x, sr, th, args.min_burst_ms)
        bursts = [s for s in segs if s.kind == 'burst']
        sils = [s for s in segs if s.kind == 'silence']
        total_ms = 1000.0 * len(x) / float(sr)
        burst_ms = sum(s.duration_ms for s in bursts)
        sil_ms = sum(s.duration_ms for s in sils)
        print(f"\nChannel {ch+1}:")
        print(f"  Total: {total_ms:.1f} ms | Bursts: {burst_ms:.1f} ms | Silence: {sil_ms:.1f} ms (th={th} dBFS)")
        if sils:
            # Exclude first/last silence from min/max as they may include lead-in/out
            sil_body = sils[1:-1] if len(sils) >= 3 else sils
            if sil_body:
                print(f"  Silence segments: {len(sils)} | min {min(s.duration_ms for s in sil_body):.1f} ms | max {max(s.duration_ms for s in sil_body):.1f} ms (excluding edges)")
            else:
                print(f"  Silence segments: {len(sils)} (edges only)")
        if bursts:
            print(f"  Burst segments: {len(bursts)} | min {min(s.duration_ms for s in bursts):.1f} ms | max {max(s.duration_ms for s in bursts):.1f} ms")
            print(f"  First 5 bursts:")
            for b in bursts[:5]:
                print(f"    @{b.start_sample/sr*1000:.1f} ms dur {b.duration_ms:.1f} ms peak {b.peak_dbfs:.1f} dBFS rms {b.rms_dbfs:.1f} dBFS")

        if args.ncc and bursts:
            # Resample to 8 kHz if needed for PN NCC
            xi = x
            eff_sr = sr
            note = ""
            if sr != 8000:
                xi = resample_linear(x, sr, 8000)
                eff_sr = 8000
                note = " (resampled)"
            tpl = pn_template(8000, 200)
            scores = []
            print("  PN checks (first 3 bursts):")
            for idx, b in enumerate(bursts[:3]):
                # Map burst segment to resampled index space
                if eff_sr == 8000 and sr == 8000:
                    seg = xi[b.start_sample:b.end_sample]
                else:
                    t0 = b.start_sample / sr
                    t1 = b.end_sample / sr
                    i0 = int(round(t0 * eff_sr))
                    i1 = int(round(t1 * eff_sr))
                    seg = xi[i0:i1]
                m = min(len(seg), len(tpl))
                if m > 0:
                    score = ncc(seg[:m], tpl[:m])
                    scores.append(score)
                fr = frame_repeat_metrics(seg, 160)
                print(f"    burst{idx+1}: dur {b.duration_ms:.1f} ms | ncc200 {scores[-1] if scores else 0.0:.3f} | adj_mean {fr['adj_mean']:.3f} | adj_max {fr['adj_max']:.3f} | lag160 {fr['lag160']:.3f}")
                # Try decimate-by-6 from 48kHz to ~8kHz when sr==48000 for comparison without resampler
                if sr == 48000:
                    seg48 = x[b.start_sample:b.end_sample]
                    seg8d = decimate_n(seg48, 6)
                    m2 = min(len(seg8d), len(tpl))
                    dscore = ncc(seg8d[:m2], tpl[:m2]) if m2 > 0 else 0.0
                    print(f"      decimate6_ncc {dscore:.3f}")
            if scores:
                print(f"  NCC vs 200 ms PN{note} (ch {ch+1}): mean {np.mean(scores):.3f} min {np.min(scores):.3f} max {np.max(scores):.3f}")


if __name__ == '__main__':
    main()


