from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import sys
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


class GenerationError(RuntimeError):
    pass


@dataclass
class Segment:
    index: int
    text: str
    image_path: str
    audio_path: str | None = None
    duration: float = 0.0
    audio_source: str | None = None


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_script_into_segments(script_text: str, max_chars: int = 90) -> list[str]:
    text = normalize_text(script_text)
    if not text:
        return []

    # Paragraphs take priority because users often structure tutorial scripts by step.
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    seeds = paragraphs if paragraphs else [text]

    output: list[str] = []
    sentence_break = re.compile(r"(?<=[。！？.!?])\s+")

    for seed in seeds:
        if len(seed) <= max_chars:
            output.append(seed)
            continue

        chunks = [s.strip() for s in sentence_break.split(seed) if s.strip()]
        if len(chunks) == 1 and len(chunks[0]) > max_chars:
            chunks = _split_long_chunk(chunks[0], max_chars=max_chars)

        current = ""
        for chunk in chunks:
            if len(current) + len(chunk) + (1 if current else 0) <= max_chars:
                current = f"{current} {chunk}".strip()
            else:
                if current:
                    output.append(current)
                if len(chunk) > max_chars:
                    output.extend(_split_long_chunk(chunk, max_chars=max_chars))
                    current = ""
                else:
                    current = chunk
        if current:
            output.append(current)

    return [line for line in output if line.strip()]


def _split_long_chunk(text: str, max_chars: int) -> list[str]:
    pieces: list[str] = []
    remaining = text.strip()

    while len(remaining) > max_chars:
        cut_candidates = [
            remaining.rfind(sep, 0, max_chars)
            for sep in ("。", "！", "？", ".", "!", "?", "；", ";", "，", ",", " ")
        ]
        cut = max(cut_candidates)
        if cut <= 0:
            cut = max_chars
        else:
            cut += 1
        pieces.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()

    if remaining:
        pieces.append(remaining)
    return pieces


def estimate_duration_from_text(text: str) -> float:
    compact = re.sub(r"\s+", "", text or "")
    if not compact:
        return 2.5

    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", compact))
    latin_count = len(re.findall(r"[A-Za-z0-9]", compact))
    other_count = max(0, len(compact) - cjk_count - latin_count)

    units = (cjk_count * 1.0) + (latin_count * 0.45) + (other_count * 0.7)
    seconds = units / 3.8
    return round(max(2.5, min(16.0, seconds + 0.7)), 2)


def format_srt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours = total_ms // 3_600_000
    total_ms %= 3_600_000
    minutes = total_ms // 60_000
    total_ms %= 60_000
    secs = total_ms // 1000
    ms = total_ms % 1000
    return f"{hours:02}:{minutes:02}:{secs:02},{ms:03}"


def build_srt(segments: Iterable[Segment]) -> str:
    cursor = 0.0
    lines: list[str] = []
    for idx, seg in enumerate(segments, start=1):
        start = cursor
        end = cursor + max(0.1, seg.duration)
        lines.extend(
            [
                str(idx),
                f"{format_srt_timestamp(start)} --> {format_srt_timestamp(end)}",
                seg.text,
                "",
            ]
        )
        cursor = end
    return "\n".join(lines).strip() + "\n"


class TutorialVideoGenerator:
    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir)
        self.uploads_dir = self.base_dir / "data" / "uploads"
        self.outputs_dir = self.base_dir / "data" / "outputs"
        self.tmp_dir = self.base_dir / "data" / "tmp"
        self.output_size = (1280, 720)
        self.fps = 30

    def generate(
        self,
        *,
        job_id: str,
        title: str,
        script_text: str,
        photo_paths: list[Path],
        partial_voice_path: Path | None,
        voice: str,
        tts_instructions: str,
        enable_tts: bool,
        use_uploaded_voice_as_first_segment: bool,
    ) -> dict:
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        self.tmp_dir.mkdir(parents=True, exist_ok=True)

        output_dir = self.outputs_dir / job_id
        work_dir = self.tmp_dir / job_id
        clips_dir = work_dir / "clips"
        for path in (output_dir, work_dir, clips_dir):
            path.mkdir(parents=True, exist_ok=True)

        segments_text = split_script_into_segments(script_text)
        if not segments_text:
            raise GenerationError("內容稿無法切分為段落，請檢查輸入內容。")

        warnings: list[str] = []
        segments = [
            Segment(
                index=i,
                text=text,
                image_path=str(photo_paths[(i - 1) % len(photo_paths)]),
            )
            for i, text in enumerate(segments_text, start=1)
        ]

        self._ensure_ffmpeg_or_raise()

        next_tts_index = 0
        if partial_voice_path and use_uploaded_voice_as_first_segment and segments:
            segments[0].audio_path = str(partial_voice_path)
            segments[0].audio_source = "uploaded_partial_voice"
            duration = self._probe_duration(Path(segments[0].audio_path))
            segments[0].duration = duration or estimate_duration_from_text(segments[0].text)
            next_tts_index = 1
            if duration is None:
                warnings.append("未能讀取上載聲音長度，第一段時長已改用文字估算。")

        tts_available = enable_tts and self._openai_tts_available()
        if enable_tts and not tts_available:
            warnings.append("未偵測到可用的 OpenAI TTS（缺少 API Key 或 speech CLI），其餘段落將使用靜音佔位。")
        if not enable_tts:
            warnings.append("你已關閉 AI TTS 補齊，其餘段落將使用靜音佔位。")

        for segment in segments[next_tts_index:]:
            audio_basename = f"audio_{segment.index:03d}"
            if tts_available:
                tts_out = work_dir / f"{audio_basename}.mp3"
                try:
                    self._generate_tts_audio(
                        text=segment.text,
                        out_path=tts_out,
                        voice=voice,
                        instructions=tts_instructions,
                    )
                    segment.audio_path = str(tts_out)
                    segment.audio_source = "openai_tts"
                    duration = self._probe_duration(tts_out)
                    segment.duration = duration or estimate_duration_from_text(segment.text)
                    if duration is None:
                        warnings.append(f"第 {segment.index} 段 TTS 長度讀取失敗，改用估算時長。")
                    continue
                except Exception as exc:
                    warnings.append(f"第 {segment.index} 段 TTS 失敗，改用靜音：{exc}")

            silence_out = work_dir / f"{audio_basename}.wav"
            segment.duration = estimate_duration_from_text(segment.text)
            self._generate_silence_wav(silence_out, duration_sec=segment.duration)
            segment.audio_path = str(silence_out)
            segment.audio_source = "silence_fallback"

        # If the user uploaded voice but chose not to use it as the first segment, keep a note.
        if partial_voice_path and not use_uploaded_voice_as_first_segment:
            warnings.append("已上載聲音檔，但未套用到第一段（你可勾選『把上載聲音當第一段旁白』）。")

        srt_path = output_dir / "captions.srt"
        srt_path.write_text(build_srt(segments), encoding="utf-8")

        clip_paths: list[Path] = []
        for segment in segments:
            clip_path = clips_dir / f"clip_{segment.index:03d}.mp4"
            self._render_segment_clip(
                clip_path=clip_path,
                image_path=Path(segment.image_path),
                audio_path=Path(segment.audio_path) if segment.audio_path else None,
                duration=segment.duration,
                title=title,
                subtitle_text=segment.text,
            )
            clip_paths.append(clip_path)

        final_video = output_dir / "tutorial_video.mp4"
        self._concat_clips(clip_paths=clip_paths, out_path=final_video, work_dir=work_dir)

        metadata = {
            "job_id": job_id,
            "title": title,
            "segment_count": len(segments),
            "total_duration_sec": round(sum(s.duration for s in segments), 2),
            "voice": voice,
            "tts_enabled": enable_tts,
            "warnings": warnings,
            "segments": [asdict(s) for s in segments],
        }
        metadata_path = output_dir / "job.json"
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

        return {
            "job_id": job_id,
            "title": title,
            "segment_count": len(segments),
            "total_duration_sec": metadata["total_duration_sec"],
            "video_url": f"/outputs/{job_id}/{final_video.name}",
            "captions_url": f"/outputs/{job_id}/{srt_path.name}",
            "metadata_url": f"/outputs/{job_id}/{metadata_path.name}",
            "warnings": warnings,
        }

    def _ensure_ffmpeg_or_raise(self) -> None:
        missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
        if missing:
            tools = ", ".join(missing)
            raise GenerationError(
                f"找不到必要工具：{tools}。請先安裝 ffmpeg（通常會附帶 ffprobe），再重新執行。"
            )

    def _run(self, args: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess:
        completed = subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            detail = stderr or stdout or "unknown error"
            raise GenerationError(f"指令失敗：{' '.join(args)}\n{detail}")
        return completed

    def _probe_duration(self, path: Path) -> float | None:
        if not path.exists() or shutil.which("ffprobe") is None:
            return None
        try:
            completed = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(path),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            if completed.returncode != 0:
                return None
            return round(float(completed.stdout.strip()), 3)
        except Exception:
            return None

    def _openai_tts_available(self) -> bool:
        return bool(os.getenv("OPENAI_API_KEY")) and self._tts_cli_path().exists()

    def _tts_cli_path(self) -> Path:
        codex_home = Path(os.getenv("CODEX_HOME", str(Path.home() / ".codex")))
        return codex_home / "skills" / "speech" / "scripts" / "text_to_speech.py"

    def _generate_tts_audio(self, *, text: str, out_path: Path, voice: str, instructions: str) -> None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        cli = self._tts_cli_path()
        if not cli.exists():
            raise GenerationError(f"找不到 speech CLI：{cli}")

        args = [
            sys.executable,
            str(cli),
            "speak",
            "--input",
            text,
            "--voice",
            voice or "cedar",
            "--response-format",
            "mp3",
            "--out",
            str(out_path),
        ]
        if instructions:
            args.extend(["--instructions", instructions])
        self._run(args)

    def _generate_silence_wav(self, out_path: Path, duration_sec: float, sample_rate: int = 22050) -> None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        duration_sec = max(0.2, duration_sec)
        frame_count = int(math.ceil(duration_sec * sample_rate))
        silence_frame = (0).to_bytes(2, byteorder="little", signed=True)
        with wave.open(str(out_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            chunk_size = 4096
            written = 0
            while written < frame_count:
                take = min(chunk_size, frame_count - written)
                wav_file.writeframes(silence_frame * take)
                written += take

    def _render_segment_clip(
        self,
        *,
        clip_path: Path,
        image_path: Path,
        audio_path: Path | None,
        duration: float,
        title: str,
        subtitle_text: str,
    ) -> None:
        if audio_path is None:
            raise GenerationError("片段缺少音訊，無法輸出影片。")
        if not image_path.exists():
            raise GenerationError(f"找不到圖片：{image_path}")

        clip_path.parent.mkdir(parents=True, exist_ok=True)
        width, height = self.output_size
        wrapped_subtitle = _wrap_for_overlay(subtitle_text, width=22)
        wrapped_title = _wrap_for_overlay(title, width=28, max_lines=1)
        fontfile = self._detect_fontfile()

        filters = [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x101318",
            "format=yuv420p",
            "eq=saturation=1.05:contrast=1.03",
            "drawbox=x=36:y=h-212:w=w-72:h=176:color=0x050608@0.50:t=fill",
        ]

        title_text = _escape_drawtext(wrapped_title)
        subtitle_text_escaped = _escape_drawtext(wrapped_subtitle)
        draw_title = (
            "drawtext="
            + (f"fontfile='{_escape_drawtext_path(fontfile)}':" if fontfile else "")
            + "fontcolor=0xE6EDF8:fontsize=26:x=40:y=34:"
            + f"text='{title_text}'"
        )
        draw_body = (
            "drawtext="
            + (f"fontfile='{_escape_drawtext_path(fontfile)}':" if fontfile else "")
            + "fontcolor=white:fontsize=38:line_spacing=8:x=58:y=h-188:"
            + f"text='{subtitle_text_escaped}'"
        )
        filters.extend([draw_title, draw_body])
        vf = ",".join(filters)

        self._run(
            [
                "ffmpeg",
                "-y",
                "-loop",
                "1",
                "-t",
                f"{max(0.3, duration):.3f}",
                "-i",
                str(image_path),
                "-i",
                str(audio_path),
                "-vf",
                vf,
                "-r",
                str(self.fps),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-ar",
                "44100",
                "-ac",
                "2",
                "-shortest",
                str(clip_path),
            ]
        )

    def _concat_clips(self, *, clip_paths: list[Path], out_path: Path, work_dir: Path) -> None:
        if not clip_paths:
            raise GenerationError("沒有可拼接的片段。")

        manifest = work_dir / "concat.txt"
        lines = []
        for clip in clip_paths:
            path_str = str(clip.resolve()).replace("'", "'\\''")
            lines.append(f"file '{path_str}'")
        manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")

        self._run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(manifest),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "22",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
                str(out_path),
            ]
        )

    def _detect_fontfile(self) -> str | None:
        candidates = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "C:/Windows/Fonts/msyh.ttc",
        ]
        for path in candidates:
            if Path(path).exists():
                return path
        return None


def _escape_drawtext(text: str) -> str:
    replacements = {
        "\\": "\\\\",
        ":": "\\:",
        "'": "\\'",
        "%": "\\%",
        ",": "\\,",
        "[": "\\[",
        "]": "\\]",
        "\n": "\\n",
    }
    out = text
    for src, dst in replacements.items():
        out = out.replace(src, dst)
    return out


def _escape_drawtext_path(path: str) -> str:
    return path.replace("\\", "\\\\").replace(":", "\\:")


def _wrap_for_overlay(text: str, width: int = 24, max_lines: int = 3) -> str:
    cleaned = normalize_text(text).replace("\n", " ")
    if not cleaned:
        return ""

    tokens = re.findall(r"[\u4e00-\u9fff]|[A-Za-z0-9_./+-]+|[^\s]", cleaned)
    lines: list[str] = []
    current = ""
    truncated = False

    for token in tokens:
        candidate = f"{current}{token}" if _is_cjk_token(token) else f"{current} {token}".strip()
        if len(candidate) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = token
            if len(lines) >= max_lines:
                truncated = True
                break

    if current and len(lines) < max_lines:
        lines.append(current)
    elif current:
        truncated = True

    if len(lines) > max_lines:
        lines = lines[:max_lines]
        truncated = True
    if truncated and lines:
        if not lines[-1].endswith("…"):
            lines[-1] = (lines[-1][: max(0, width - 1)] + "…").strip()
    return "\n".join(lines)


def _is_cjk_token(token: str) -> bool:
    return bool(re.fullmatch(r"[\u4e00-\u9fff]", token))
