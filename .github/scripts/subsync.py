#!/usr/bin/env python3
"""Sync an episode's existing VTT against the video's audio, or build one from scratch.

The existing subtitle file keeps its text; only the timings are rewritten so they
line up with the audio. Alignment is done by transcribing the audio with
faster-whisper and matching the subtitle text to the recognized words, then
fitting a line (offset + drift) through the matches. If the text match is too
weak to trust, it falls back to matching subtitle windows against regions of
speech. A result that scores worse than leaving the file alone is discarded.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

VIDEO_EXT = re.compile(r"\.(mp4|mkv|mov|avi|webm)$", re.I)
EPISODE_RE = re.compile(r"(?<![a-z])s(\d{1,2})[ ._-]?e(\d{1,3})(?!\d)", re.I)
TIME_RE = re.compile(
    r"^\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})(.*)$"
)


# --------------------------------------------------------------------------- #
# VTT reading / writing
# --------------------------------------------------------------------------- #


@dataclass
class Cue:
    start: float
    end: float
    settings: str = ""
    cue_id: str | None = None
    text: list[str] = field(default_factory=list)

    @property
    def body(self) -> str:
        return " ".join(self.text)


@dataclass
class Block:
    """A cue or a block we do not touch (NOTE, STYLE, stray text)."""

    raw: str | None = None
    cue: Cue | None = None


@dataclass
class Document:
    header: list[str] = field(default_factory=list)
    blocks: list[Block] = field(default_factory=list)


def ts_to_sec(h, m, s, ms) -> float:
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def sec_to_ts(sec: float) -> str:
    if sec < 0:
        sec = 0.0
    total_ms = int(round(sec * 1000))
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def parse_vtt(text: str) -> Document:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if text.lstrip().startswith("\ufeff"):
        text = text.lstrip("\ufeff")
    document = Document()
    chunks = re.split(r"\n{2,}", text.strip("\n"))
    for position, chunk in enumerate(chunks):
        lines = chunk.split("\n")
        if not lines:
            continue
        timing_at = next((i for i, ln in enumerate(lines) if TIME_RE.match(ln)), None)
        if timing_at is None:
            if position == 0 and lines[0].strip().upper().startswith("WEBVTT"):
                document.header = [ln for ln in lines[1:] if ln.strip()]
            else:
                document.blocks.append(Block(raw=chunk.strip("\n")))
            continue
        m = TIME_RE.match(lines[timing_at])
        cue_id = lines[timing_at - 1].strip() if timing_at > 0 else None
        if timing_at > 1:
            document.blocks.append(Block(raw="\n".join(lines[: timing_at - 1])))
        document.blocks.append(Block(cue=Cue(
            start=ts_to_sec(m.group(1), m.group(2), m.group(3), m.group(4)),
            end=ts_to_sec(m.group(5), m.group(6), m.group(7), m.group(8)),
            settings=(m.group(9) or "").rstrip(),
            cue_id=cue_id,
            text=lines[timing_at + 1 :],
        )))
    return document


def render_vtt(document: Document) -> str:
    out = ["WEBVTT", *document.header, ""]
    for block in document.blocks:
        if block.cue is not None:
            cue = block.cue
            if cue.cue_id:
                out.append(cue.cue_id)
            out.append(f"{sec_to_ts(cue.start)} --> {sec_to_ts(cue.end)}{cue.settings}")
            out.extend(cue.text)
            out.append("")
        elif block.raw:
            out.append(block.raw)
            out.append("")
    return "\n".join(out).rstrip("\n") + "\n"


def cues_of(document: Document) -> list[Cue]:
    return [b.cue for b in document.blocks if b.cue is not None]


# --------------------------------------------------------------------------- #
# Text normalization
# --------------------------------------------------------------------------- #

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen " \
        "fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split()
_SCALES = [(10**9, "billion"), (10**6, "million"), (1000, "thousand")]


def number_to_words(n: int) -> str:
    if n < 0:
        return "minus " + number_to_words(-n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10 - 2] + (" " + _ONES[n % 10] if n % 10 else "")
    if n < 1000:
        head = _ONES[n // 100] + " hundred"
        return head + (" " + number_to_words(n % 100) if n % 100 else "")
    for value, name in _SCALES:
        if n >= value:
            head = number_to_words(n // value) + " " + name
            return head + (" " + number_to_words(n % value) if n % value else "")
    return str(n)


_WORD_NUMBERS = {}
for _i in range(0, 1000):
    _WORD_NUMBERS[" ".join(number_to_words(_i).split())] = str(_i)
for _value, _name in _SCALES:
    _WORD_NUMBERS[_name] = str(_value)


def canon_tokens(text: str) -> list[str]:
    """Lowercase word tokens with tags, dashes and number spellings normalized."""
    text = re.sub(r"<[^>]*>", " ", text)
    text = text.replace("♪", " ")
    text = re.sub(r"[–—―]", "-", text)
    text = re.sub(r"[\u2018\u2019]", "'", text)
    text = re.sub(r"[^0-9A-Za-z']+", " ", text.lower())
    tokens = []
    for token in text.split():
        token = token.strip("'")
        if not token or re.fullmatch(r"[-']+", token):
            continue
        if token.isdigit():
            tokens.extend(number_to_words(int(token)).split())
        else:
            tokens.append(token)
    merged: list[str] = []
    for token in tokens:
        if merged and f"{merged[-1]} {token}" in _WORD_NUMBERS:
            merged[-1] = f"{merged[-1]} {token}"
        else:
            merged.append(token)
    out = []
    for token in merged:
        if " " in token:
            out.extend(_WORD_NUMBERS[token].split())
        else:
            out.append(token)
    return out


# --------------------------------------------------------------------------- #
# Transcription
# --------------------------------------------------------------------------- #


def read_wav(path: str):
    """Read our own 16 kHz mono WAV without going through PyAV, whose API drifts
    between releases and breaks faster-whisper's decoder on some versions."""
    import numpy as np
    import wave

    with wave.open(path, "rb") as handle:
        if handle.getnchannels() != 1 or handle.getframerate() != 16000:
            return None
        if handle.getsampwidth() != 2:
            return None
        frames = handle.readframes(handle.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def load_words(audio: str, model_name: str, device: str, compute_type: str,
               language: str | None, beam_size: int) -> list[dict]:
    """Return recognized words with timings from faster-whisper."""
    from faster_whisper import WhisperModel

    def build(dev: str, ctype: str) -> WhisperModel:
        return WhisperModel(
            model_name,
            device=dev,
            compute_type=ctype,
            cpu_threads=max(1, os.cpu_count() or 1),
            num_workers=1,
        )

    if device == "auto":
        device, compute_type = "cpu", "int8"
    try:
        model = build(device, compute_type)
    except Exception as exc:  # no GPU on this runner, or an unsupported precision
        print(f"! could not load model as {device}/{compute_type} ({exc}); using cpu/int8", flush=True)
        model = build("cpu", "int8")

    source = read_wav(audio) if audio.lower().endswith(".wav") else None
    if source is None:
        source = audio

    segments, _info = model.transcribe(
        source,
        language=language or None,
        beam_size=beam_size,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        word_timestamps=True,
        condition_on_previous_text=False,
    )

    words: list[dict] = []
    for segment in segments:
        seg_words = list(getattr(segment, "words", None) or [])
        spans = []
        if seg_words:
            for word in seg_words:
                tokens = canon_tokens(word.word)
                if tokens:
                    spans.append((tokens, float(word.start), float(word.end)))
        else:
            tokens = canon_tokens(segment.text)
            if tokens:
                spans.append((tokens, float(segment.start), float(segment.end)))
        for tokens, start, end in spans:
            step = (end - start) / len(tokens)
            for index, token in enumerate(tokens):
                words.append({"start": start + step * index, "end": start + step * (index + 1), "word": token})
        print(f"  transcribed {float(segment.end):7.1f}s", flush=True)
    return words


def merge_intervals(intervals: list[tuple[float, float]], gap: float = 0.25) -> list[tuple[float, float]]:
    merged: list[list[float]] = []
    for start, end in sorted(intervals):
        if merged and start - merged[-1][1] <= gap:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


# --------------------------------------------------------------------------- #
# Alignment
# --------------------------------------------------------------------------- #


def cue_anchors(cues: list[Cue], words: list[dict]) -> tuple[list[tuple[float, float, float]], int]:
    """(subtitle time, spoken time, weight) samples joining subtitle text to recognized words.

    Cue boundaries are used rather than cue midpoints: the start of a line is what
    a viewer perceives as sync, and the end tightens the fit when a cue is fully
    covered by recognized words.
    """
    flat_tokens: list[tuple[int, int]] = []
    flat_text: list[str] = []
    cue_tokens: list[list[str]] = []
    for index, cue in enumerate(cues):
        tokens = canon_tokens(cue.body)
        cue_tokens.append(tokens)
        for token_index, token in enumerate(tokens):
            flat_tokens.append((index, token_index))
            flat_text.append(token)
    if not flat_text or not words:
        return [], 0

    matcher = SequenceMatcher(None, flat_text, [w["word"] for w in words], autojunk=False)
    matches: dict[int, list[tuple[int, float, float]]] = {}
    for block in matcher.get_matching_blocks():
        if block.size < 2:
            continue
        for offset in range(block.size):
            cue_index, token_index = flat_tokens[block.a + offset]
            word = words[block.b + offset]
            matches.setdefault(cue_index, []).append((token_index, word["start"], word["end"]))

    anchors: list[tuple[float, float, float]] = []
    for cue_index, samples in matches.items():
        if len(samples) < 2:
            continue
        samples.sort()
        total = max(1, len(cue_tokens[cue_index]))
        weight = min(1.0, len(samples) / total)
        first_token, first_start, _ = samples[0]
        _last_token, _last_start, last_end = samples[-1]
        share = (cues[cue_index].end - cues[cue_index].start) / total
        anchors.append((cues[cue_index].start + share * first_token, first_start, weight))
        if _last_token >= 0.75 * total:
            anchors.append((cues[cue_index].end, last_end, weight))
    anchors.sort()
    return anchors, len(matches)


def least_squares(pairs: list[tuple[float, float]]) -> tuple[float, float]:
    n = len(pairs)
    if n == 0:
        return 1.0, 0.0
    mean_x = sum(p[0] for p in pairs) / n
    mean_y = sum(p[1] for p in pairs) / n
    sxx = sum((p[0] - mean_x) ** 2 for p in pairs)
    if sxx < 1e-6:
        return 1.0, mean_y - mean_x
    sxy = sum((p[0] - mean_x) * (p[1] - mean_y) for p in pairs)
    slope = sxy / sxx
    return slope, mean_y - slope * mean_x


def robust_fit(anchors: list[tuple[float, float, float]], max_drift: float) -> tuple[float, float, int, float]:
    """Return (slope, intercept, inliers, mean residual seconds)."""
    pairs = [(old, new) for old, new, _w in anchors]
    slope, intercept = 1.0, statistics.median(new - old for old, new in pairs)
    keep = pairs
    inliers = 0
    for _ in range(6):
        residuals = [new - (slope * old + intercept) for old, new in pairs]
        centre = statistics.median(residuals)
        spread = statistics.median(abs(r - centre) for r in residuals) or 0.001
        limit = max(0.30, 4.0 * spread)
        subset = [pair for pair, res in zip(pairs, residuals) if abs(res - centre) <= limit]
        if len(subset) < 6 or len(subset) < 0.4 * len(pairs):
            break
        slope, intercept = least_squares(subset)
        slope = min(1.0 + max_drift, max(1.0 - max_drift, slope))
        keep, inliers = subset, len(subset)
    residuals = [new - (slope * old + intercept) for old, new in keep]
    return slope, intercept, inliers, statistics.mean(abs(r) for r in residuals) if residuals else 0.0


class SpeechMask:
    """Speech/non-speech lookup built once, so scoring a candidate fit stays cheap."""

    def __init__(self, speech: list[tuple[float, float]], resolution: float = 0.05):
        self.resolution = resolution
        last = max((end for _start, end in speech), default=0.0) + 1.0
        self.size = int(last / resolution) + 2
        delta = [0.0] * (self.size + 1)
        for start, end in speech:
            first = max(0, int(start / resolution))
            after = min(self.size, int(round(end / resolution)))
            if after > first:
                delta[first] += 1.0
                delta[after] -= 1.0
        prefix = [0.0] * (self.size + 1)
        running = 0.0
        for index in range(self.size):
            running += delta[index]
            prefix[index + 1] = prefix[index] + (1.0 if running > 0 else 0.0)
        self.prefix = prefix

    def covered(self, start: float, end: float) -> float:
        """Share of the window that holds speech; the window's own length is the denominator."""
        steps = (end - start) / self.resolution
        if steps <= 0:
            return 0.0
        first = max(0, min(self.size, int(start / self.resolution)))
        last = max(0, min(self.size, int(round(end / self.resolution))))
        if last <= first:
            return 0.0
        return min(1.0, (self.prefix[last] - self.prefix[first]) / steps)

    def score(self, cues: list[Cue]) -> float:
        """Mean agreement in -1..1: a cue on speech scores 1, one on silence scores -1."""
        total = 0.0
        counted = 0
        for cue in cues:
            if cue.end - cue.start <= 0.05:
                continue
            total += 2.0 * self.covered(cue.start, min(cue.end, cue.start + 8.0)) - 1.0
            counted += 1
        return total / counted if counted else 0.0


def search_offset(cues: list[Cue], mask: SpeechMask, centre: float,
                  radius: float, step: float) -> tuple[float, float]:
    """Score every candidate offset; near-ties go to the smallest correction."""
    best_offset, best_score = centre, -2.0
    steps = int(radius / step)
    for index in range(-steps, steps + 1):
        offset = centre + index * step
        score = mask.score([Cue(c.start + offset, c.end + offset) for c in cues])
        if score > best_score + 0.005 or (
            abs(score - best_score) <= 0.005 and abs(offset - centre) < abs(best_offset - centre)
        ):
            best_offset, best_score = offset, score
    return best_offset, best_score


def speech_align(cues: list[Cue], mask: SpeechMask) -> tuple[float, float, float]:
    """Offset + small-drift search driven by where speech actually happens."""
    base_offset, base_score = search_offset(cues, mask, 0.0, 180.0, 0.25)
    best = (1.0, base_offset, base_score)
    for drift_step in range(-15, 16):
        slope = 1.0 + drift_step * 0.002
        scaled = [Cue(c.start * slope, c.end * slope) for c in cues]
        offset, score = search_offset(scaled, mask, base_offset, 2.5, 0.1)
        if score > best[2]:
            best = (slope, offset, score)
    return best


def apply_fit(cues: list[Cue], slope: float, offset: float, duration: float | None) -> None:
    for cue in cues:
        cue.start = max(0.0, slope * cue.start + offset)
        cue.end = max(cue.start + 0.2, slope * cue.end + offset)
        if duration:
            cue.start = min(cue.start, max(0.0, duration - 0.2))
            cue.end = min(cue.end, duration)


def run_past_media(cues: list[Cue], slope: float, offset: float, duration: float | None) -> float:
    """Share of cues the fit would push beyond the end of the audio."""
    if not duration:
        return 0.0
    beyond = sum(1 for cue in cues if slope * cue.end + offset > duration + 2.0)
    return beyond / max(1, len(cues))


# --------------------------------------------------------------------------- #
# Building a VTT from a transcript
# --------------------------------------------------------------------------- #


def wrap_lines(text: str, width: int = 42) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    if len(lines) == 2 and len(lines[1]) <= 6 and len(lines[0]) > width - 8:
        lines = [lines[0][: len(lines[0])], lines[1]]
    return lines[:3]


def cues_from_words(words: list[dict], max_chars: int = 84, max_duration: float = 7.0,
                    min_duration: float = 1.0, max_gap: float = 0.9) -> list[Cue]:
    cues: list[Cue] = []
    chunk: list[dict] = []

    def flush() -> None:
        if not chunk:
            return
        text = " ".join(w["word"] for w in chunk)
        start = chunk[0]["start"]
        end = chunk[-1]["end"]
        if end - start < min_duration:
            end = start + min_duration
        cues.append(Cue(start=start, end=end, text=wrap_lines(text)))
        chunk.clear()

    for word in words:
        if chunk:
            gap = word["start"] - chunk[-1]["end"]
            length = len(" ".join(w["word"] for w in chunk)) + 1 + len(word["word"])
            too_long = length > max_chars
            too_slow = word["end"] - chunk[0]["start"] > max_duration
            if gap > max_gap or too_long or too_slow:
                flush()
        chunk.append(word)
    flush()
    return cues


# --------------------------------------------------------------------------- #
# Repo path resolution
# --------------------------------------------------------------------------- #


def canon_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def repo_vtt_files(root: Path) -> list[str]:
    found = []
    for path in root.rglob("*.vtt"):
        rel = path.relative_to(root).as_posix()
        if rel.startswith(".") or "/." in rel:
            continue
        found.append(rel)
    return found


def show_dir_for(root: Path, show: str) -> str:
    want = canon_name(show)
    best, best_ratio = None, 0.0
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        candidate = canon_name(entry.name)
        if candidate in (want, want.rstrip("s")):
            return entry.name
        ratio = SequenceMatcher(None, candidate, want).ratio()
        if ratio > best_ratio:
            best, best_ratio = entry.name, ratio
    return best if best_ratio >= 0.72 else show.replace(".", " ").strip()


def show_key(name: str) -> str:
    """Everything in a file name before its SxxExx marker, normalized."""
    found = EPISODE_RE.search(name)
    return canon_name(name[: found.start()] if found else name)


def same_show(asset_key: str, candidate_key: str) -> bool:
    if not asset_key or not candidate_key:
        return False
    if asset_key == candidate_key:
        return True
    if len(asset_key) >= 4 and len(candidate_key) >= 4:
        if asset_key.startswith(candidate_key) or candidate_key.startswith(asset_key):
            return True
    return SequenceMatcher(None, asset_key, candidate_key).ratio() >= 0.88


def dir_affinity(rel: str, asset_show: str) -> float:
    """How well the file's top folder matches the show in the asset name."""
    folder = canon_name(rel.split("/")[0])
    if not folder or not asset_show:
        return 0.0
    if folder == asset_show:
        return 1.0
    if folder.startswith(asset_show) or asset_show.startswith(folder):
        return 0.9
    return SequenceMatcher(None, folder, asset_show).ratio()


def resolve_target(root: Path, asset: str) -> tuple[str, bool]:
    """Return (repo-relative vtt path, exists)."""
    stem = VIDEO_EXT.sub("", asset)
    episode = EPISODE_RE.search(stem)
    asset_show = show_key(stem)
    files = repo_vtt_files(root)

    if episode:
        season_episode = (int(episode.group(1)), int(episode.group(2)))
        ranked = []
        for rel in files:
            name = Path(rel).stem
            found = EPISODE_RE.search(name)
            if not found:
                continue
            if (int(found.group(1)), int(found.group(2))) != season_episode:
                continue
            candidate_show = show_key(name)
            if not same_show(asset_show, candidate_show):
                continue
            exact = canon_name(name) == canon_name(stem)
            similarity = SequenceMatcher(None, canon_name(name), canon_name(stem)).ratio()
            affinity = dir_affinity(rel, asset_show)
            ranked.append((not exact, -round(affinity, 3), -similarity, len(Path(rel).name), rel))
        if ranked:
            ranked.sort()
            return ranked[0][4], True

    show = stem[: episode.start()] if episode else stem
    season = f"S{int(episode.group(1)):02d}" if episode else ""
    show_dir = show_dir_for(root, show.strip(" .-_")) if show.strip(" .-_") else ""
    parts = [p for p in (show_dir, season, "Subs") if p]
    return "/".join(parts + [f"{stem}.vtt"]), False


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def probe_duration(audio: str) -> float | None:
    try:
        import subprocess

        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", audio],
            capture_output=True, text=True, check=True,
        )
        return float(json.loads(out.stdout)["format"]["duration"])
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset", required=True, help="release asset name, e.g. Smallville.S01E01.mp4")
    parser.add_argument("--audio", required=True, help="audio file extracted from that video")
    parser.add_argument("--repo-root", default=".", help="repository root (default: .)")
    parser.add_argument("--vtt", help="override the subtitle file to sync (repo-relative)")
    parser.add_argument("--model", default="distil-large-v3")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="en", help="language code, or 'auto'")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--mode", default="align", choices=["align", "replace", "missing"],
                        help="align: keep existing text and fix timing; replace: rewrite from "
                             "transcript; missing: only create subtitles that do not exist yet")
    parser.add_argument("--max-drift", type=float, default=0.05,
                        help="largest allowed speed change (0.05 covers a 23.976/25 fps mismatch)")
    parser.add_argument("--stage", help="also write the result under this directory")
    parser.add_argument("--report", help="write a JSON report here")
    parser.add_argument("--words-json", help="reuse/produce transcript words instead of transcribing")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = Path(args.repo_root).resolve()
    target, exists = resolve_target(root, args.asset)
    if args.vtt:
        target, exists = args.vtt, (root / args.vtt).exists()

    report: dict = {
        "asset": args.asset,
        "target": target,
        "existed": exists,
        "mode": args.mode,
        "changed": False,
        "method": None,
    }
    print(f"asset    {args.asset}")
    print(f"target   {target} (exists={exists})", flush=True)

    if exists and args.mode == "missing":
        report["note"] = "subtitle already exists; mode=missing leaves it alone"
        return finish(report, args)

    words: list[dict]
    if args.words_json and Path(args.words_json).exists():
        print(f"reusing transcript words from {args.words_json}", flush=True)
        words = json.loads(Path(args.words_json).read_text())
    else:
        print(f"transcribing with {args.model} ...", flush=True)
        language = None if args.language == "auto" else args.language
        words = load_words(args.audio, args.model, args.device, args.compute_type,
                           language, args.beam_size)
        if args.words_json:
            Path(args.words_json).write_text(json.dumps(words))
    if not words:
        report["note"] = "no speech recognised in the audio"
        return finish(report, args)

    mask = SpeechMask(merge_intervals([(w["start"], w["end"]) for w in words], gap=0.6))
    duration = probe_duration(args.audio)
    report["media_duration"] = duration

    existing = exists and (root / target).exists()
    document = parse_vtt((root / target).read_text(encoding="utf-8")) if existing else Document()
    existing_cues = cues_of(document)

    use_existing = bool(existing_cues) and args.mode != "replace"
    if use_existing:
        anchors, covered = cue_anchors(existing_cues, words)
        coverage = covered / len(existing_cues)
        score_before = mask.score(existing_cues)
        report.update({"cues": len(existing_cues), "anchors": len(anchors), "coverage": round(coverage, 3),
                       "speech_overlap_before": round(score_before, 3)})
        print(f"text anchors on {covered}/{len(existing_cues)} cues ({coverage:.0%}), "
              f"speech agreement {score_before:+.2f}", flush=True)

        candidates: list[tuple[float, float, float, str]] = []

        if len(anchors) >= 3 and coverage >= 0.2:
            if len(anchors) >= 6:
                slope, offset, inliers, residual = robust_fit(anchors, args.max_drift)
                label = "text-align"
            else:
                diffs = [new - old for old, new, _weight in anchors]
                slope, offset = 1.0, statistics.median(diffs)
                inliers = len(anchors)
                residual = statistics.mean(abs(d - offset) for d in diffs)
                label = "text-align-sparse"
            report.update({
                "offset": round(offset, 3),
                "drift": round((slope - 1.0) * 100, 3),
                "inliers": inliers,
                "residual_ms": round(residual * 1000, 1),
            })

            scaled = [Cue(c.start * slope, c.end * slope) for c in existing_cues]
            refined, refined_score = search_offset(scaled, mask, offset, 1.5, 0.05)
            if refined_score > mask.score([Cue(c.start + offset, c.end + offset) for c in scaled]):
                offset = refined

            overrun = run_past_media(existing_cues, slope, offset, duration)
            if overrun > 0.02:
                report["note"] = (f"{overrun:.0%} of cues land past the end of the audio, so the video looks "
                                  "truncated or from a different cut; the subtitles were left untouched")
                return finish(report, args)

            score_after = mask.score([Cue(c.start * slope + offset, c.end * slope + offset) for c in existing_cues])
            report["speech_overlap_after_text"] = round(score_after, 3)
            print(f"{label}: offset {offset:+.2f}s, drift {(slope - 1) * 100:+.2f}%, "
                  f"residual {residual * 1000:.0f} ms, speech agreement {score_after:+.2f}", flush=True)
            if score_after > score_before + 0.005 and residual <= 0.75:
                candidates.append((score_after, slope, offset, label))

        if not candidates:
            slope, offset, score = speech_align(existing_cues, mask)
            print(f"speech-windows: offset {offset:+.2f}s, drift {(slope - 1) * 100:+.2f}%, "
                  f"speech agreement {score:+.2f}", flush=True)
            if score > score_before + 0.005:
                candidates.append((score, slope, offset, "speech-windows"))

        if not candidates:
            report["note"] = "existing timings already fit the audio; nothing to change"
            return finish(report, args)

        score_after, slope, offset, method = max(candidates)
        report.update({
            "method": method,
            "offset": round(offset, 3),
            "drift": round((slope - 1.0) * 100, 3),
            "speech_overlap": {"before": round(score_before, 3), "after": round(score_after, 3)},
        })
        apply_fit(existing_cues, slope, offset, duration)
        report.update({"out_offset": round(offset, 3), "out_drift_pct": round((slope - 1.0) * 100, 3)})
        output_text = render_vtt(document)
        print(f"aligned with {method}: offset {offset:+.2f}s, drift {(slope - 1) * 100:+.2f}%", flush=True)
    else:
        cues = cues_from_words(words)
        apply_fit(cues, 1.0, 0.0, duration)
        report.update({"method": "transcript", "cues": len(cues)})
        output_text = render_vtt(Document(blocks=[Block(cue=cue) for cue in cues]))
        print(f"built {len(cues)} cues from the transcript", flush=True)

    report["changed"] = True
    if args.dry_run:
        report["note"] = "dry run; nothing written"
        return finish(report, args)

    destination = root / target
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(output_text, encoding="utf-8")
    if args.stage:
        staged = Path(args.stage) / target
        staged.parent.mkdir(parents=True, exist_ok=True)
        staged.write_text(output_text, encoding="utf-8")
    print(f"wrote {destination}", flush=True)
    return finish(report, args)


def finish(report: dict, args: argparse.Namespace) -> int:
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2))
    print("RESULT " + json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
