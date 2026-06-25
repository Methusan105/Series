#!/usr/bin/env python3
"""
MP4 to VTT Transcription Script
Extracts audio from MP4, transcribes using Whisper, and generates a VTT file.
"""

import os
import sys
import argparse
import json
import threading
import subprocess
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

try:
    import whisper
except ImportError:
    print("Error: whisper not installed. Install with:")
    print("  python -m pip install openai-whisper")
    sys.exit(1)

# Try moviepy first, fall back to ffmpeg-python if unavailable
try:
    from moviepy.editor import VideoFileClip
    USE_MOVIEPY = True
except ImportError:
    try:
        import ffmpeg
        USE_MOVIEPY = False
    except ImportError:
        print("Error: Neither moviepy nor ffmpeg-python installed.")
        print("Install one of these:")
        print("  python -m pip install moviepy")
        print("  OR")
        print("  python -m pip install ffmpeg-python")
        print("\nAlso requires FFmpeg installed on system:")
        print("  Windows: winget install FFmpeg  OR  choco install ffmpeg")
        sys.exit(1)


def extract_audio_from_mp4(mp4_path, output_audio_path="temp_audio.wav"):
    """Extract audio from MP4 file using moviepy or ffmpeg."""
    print(f"Extracting audio from {mp4_path}...")
    
    if USE_MOVIEPY:
        try:
            video = VideoFileClip(mp4_path)
            audio = video.audio
            if audio is None:
                print("Error: No audio found in video file.")
                return None
            audio.write_audiofile(output_audio_path, verbose=False, logger=None)
            video.close()
            print(f"Audio extracted to {output_audio_path}")
            return output_audio_path
        except Exception as e:
            print(f"Error extracting audio with moviepy: {e}")
            return None
    else:
        # Fallback: use ffmpeg directly
        try:
            import subprocess
            cmd = [
                "ffmpeg",
                "-i", mp4_path,
                "-q:a", "9",
                "-n",  # don't overwrite
                output_audio_path
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            print(f"Audio extracted to {output_audio_path}")
            return output_audio_path
        except FileNotFoundError:
            print("Error: FFmpeg not found. Install with:")
            print("  winget install FFmpeg")
            return None
        except Exception as e:
            print(f"Error extracting audio with ffmpeg: {e}")
            return None


def transcribe_audio(audio_path, model_name="base"):
    """Transcribe audio using Whisper."""
    print(f"Transcribing audio with model '{model_name}'...")
    try:
        model = whisper.load_model(model_name)
        result = model.transcribe(audio_path, verbose=False)
        print("Transcription complete.")
        return result
    except Exception as e:
        print(f"Error during transcription: {e}")
        return None


def format_timestamp(seconds):
    """Convert seconds to VTT timestamp format (HH:MM:SS.mmm)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    millis = int((secs % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{int(secs):02d}.{millis:03d}"


def create_vtt_from_transcript(transcript_result, vtt_output_path):
    """Create VTT file from Whisper transcript result."""
    print(f"Creating VTT file: {vtt_output_path}")
    
    segments = transcript_result.get("segments", [])
    
    with open(vtt_output_path, "w", encoding="utf-8") as vtt_file:
        vtt_file.write("WEBVTT\n\n")
        
        for segment in segments:
            start = segment["start"]
            end = segment["end"]
            text = segment["text"].strip()
            
            if text:
                start_ts = format_timestamp(start)
                end_ts = format_timestamp(end)
                vtt_file.write(f"{start_ts} --> {end_ts}\n")
                vtt_file.write(f"{text}\n\n")
    
    print(f"VTT file created: {vtt_output_path}")
    return vtt_output_path


def mp4_to_vtt(mp4_path, vtt_output_path=None, model="base", cleanup=True):
    """
    Convert MP4 to VTT subtitle file.
    
    Args:
        mp4_path: Path to input MP4 file
        vtt_output_path: Path for output VTT file (optional, defaults to input name with .vtt)
        model: Whisper model size ('tiny', 'base', 'small', 'medium', 'large')
        cleanup: Whether to delete temporary audio file
    """
    
    # Verify input file exists
    if not os.path.exists(mp4_path):
        print(f"Error: Input file not found: {mp4_path}")
        return None
    
    # Determine output path
    if vtt_output_path is None:
        base_name = os.path.splitext(mp4_path)[0]
        vtt_output_path = f"{base_name}.vtt"
    
    # Extract audio
    audio_path = "temp_audio.wav"
    extracted_audio = extract_audio_from_mp4(mp4_path, audio_path)
    if not extracted_audio:
        return None
    
    # Transcribe
    transcript = transcribe_audio(extracted_audio, model)
    if not transcript:
        if os.path.exists(audio_path) and cleanup:
            os.remove(audio_path)
        return None
    
    # Create VTT
    result = create_vtt_from_transcript(transcript, vtt_output_path)
    
    # Cleanup temporary files
    if cleanup and os.path.exists(audio_path):
        os.remove(audio_path)
        print("Temporary audio file removed.")
    
    return result


class TranscriptGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("MP4 to VTT Transcriber")
        self.root.geometry("700x600")
        self.root.resizable(False, False)
        
        self.mp4_file = tk.StringVar()
        self.vtt_file = tk.StringVar()
        self.model = tk.StringVar(value="base")
        self.is_processing = False
        
        self.setup_ui()
    
    def setup_ui(self):
        """Create the GUI layout."""
        # Main frame
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Title
        title = ttk.Label(main_frame, text="MP4 to VTT Transcriber", font=("Arial", 14, "bold"))
        title.pack(pady=10)
        
        # Input file section
        input_frame = ttk.LabelFrame(main_frame, text="Input MP4 File", padding="10")
        input_frame.pack(fill=tk.X, pady=10)
        
        ttk.Entry(input_frame, textvariable=self.mp4_file, width=50).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        ttk.Button(input_frame, text="Browse", command=self.select_mp4).pack(side=tk.LEFT, padx=5)
        
        # Output file section
        output_frame = ttk.LabelFrame(main_frame, text="Output VTT File", padding="10")
        output_frame.pack(fill=tk.X, pady=10)
        
        ttk.Entry(output_frame, textvariable=self.vtt_file, width=50).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        ttk.Button(output_frame, text="Browse", command=self.select_vtt).pack(side=tk.LEFT, padx=5)
        
        # Model selection section
        model_frame = ttk.LabelFrame(main_frame, text="Whisper Model", padding="10")
        model_frame.pack(fill=tk.X, pady=10)
        
        models = ["tiny", "base", "small", "medium", "large"]
        for model in models:
            ttk.Radiobutton(model_frame, text=model, variable=self.model, value=model).pack(anchor=tk.W)
        
        # Info label
        info_text = "tiny=fastest | base=balanced | large=most accurate"
        ttk.Label(model_frame, text=info_text, font=("Arial", 8), foreground="gray").pack(anchor=tk.W, pady=5)
        
        # Progress bar
        self.progress = ttk.Progressbar(main_frame, mode='indeterminate')
        self.progress.pack(fill=tk.X, pady=10)
        
        # Status label
        self.status_label = ttk.Label(main_frame, text="Ready", foreground="blue")
        self.status_label.pack(pady=5)
        
        # Button frame
        button_frame = ttk.Frame(main_frame)
        button_frame.pack(fill=tk.X, pady=15)
        
        self.start_btn = ttk.Button(button_frame, text="Start Transcription", command=self.start_transcription)
        self.start_btn.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        ttk.Button(button_frame, text="Exit", command=self.root.quit).pack(side=tk.LEFT, padx=5)
    
    def select_mp4(self):
        """Open file dialog to select MP4."""
        file = filedialog.askopenfilename(
            title="Select MP4 File",
            filetypes=[("MP4 files", "*.mp4"), ("All files", "*.*")]
        )
        if file:
            self.mp4_file.set(file)
            # Auto-suggest output path
            base_name = os.path.splitext(file)[0]
            self.vtt_file.set(f"{base_name}.vtt")
    
    def select_vtt(self):
        """Open file dialog to select output VTT."""
        file = filedialog.asksaveasfilename(
            title="Save VTT File As",
            defaultextension=".vtt",
            filetypes=[("VTT files", "*.vtt"), ("All files", "*.*")]
        )
        if file:
            self.vtt_file.set(file)
    
    def start_transcription(self):
        """Start transcription in a separate thread."""
        if not self.mp4_file.get():
            messagebox.showerror("Error", "Please select an MP4 file.")
            return
        
        if not self.vtt_file.get():
            messagebox.showerror("Error", "Please select an output VTT file.")
            return
        
        if not os.path.exists(self.mp4_file.get()):
            messagebox.showerror("Error", f"File not found: {self.mp4_file.get()}")
            return
        
        # Disable button and start progress
        self.start_btn.config(state=tk.DISABLED)
        self.progress.start()
        self.status_label.config(text="Processing...", foreground="orange")
        self.root.update()
        
        # Run in separate thread to avoid freezing UI
        thread = threading.Thread(target=self.transcribe_thread)
        thread.daemon = True
        thread.start()
    
    def transcribe_thread(self):
        """Thread worker for transcription."""
        try:
            result = mp4_to_vtt(
                self.mp4_file.get(),
                vtt_output_path=self.vtt_file.get(),
                model=self.model.get(),
                cleanup=True
            )
            
            self.root.after(0, self.on_success, result)
        except Exception as e:
            self.root.after(0, self.on_error, str(e))
    
    def on_success(self, result):
        """Handle successful transcription."""
        self.progress.stop()
        self.start_btn.config(state=tk.NORMAL)
        
        if result:
            self.status_label.config(text="Transcription complete!", foreground="green")
            messagebox.showinfo("Success", f"VTT file created:\n{result}")
        else:
            self.status_label.config(text="Transcription failed", foreground="red")
            messagebox.showerror("Error", "Transcription failed. Check the output for details.")
    
    def on_error(self, error):
        """Handle transcription error."""
        self.progress.stop()
        self.start_btn.config(state=tk.NORMAL)
        self.status_label.config(text="Error occurred", foreground="red")
        messagebox.showerror("Error", f"An error occurred:\n{error}")


def main():
    parser = argparse.ArgumentParser(
        description="Convert MP4 video to VTT subtitle file using AI transcription."
    )
    parser.add_argument(
        "mp4_file",
        help="Path to MP4 file"
    )
    parser.add_argument(
        "-o", "--output",
        help="Output VTT file path (default: same name as input with .vtt extension)"
    )
    parser.add_argument(
        "-m", "--model",
        choices=["tiny", "base", "small", "medium", "large"],
        default="base",
        help="Whisper model size (default: base). Larger models are more accurate but slower."
    )
    parser.add_argument(
        "-k", "--keep-audio",
        action="store_true",
        help="Keep temporary audio file after transcription"
    )
    
    args = parser.parse_args()
    
    mp4_to_vtt(
        args.mp4_file,
        vtt_output_path=args.output,
        model=args.model,
        cleanup=not args.keep_audio
    )


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] != "--gui":
        main()
    else:
        # Launch GUI
        root = tk.Tk()
        app = TranscriptGUI(root)
        root.mainloop()
