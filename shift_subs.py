#!/usr/bin/env python3
import os
import re
import glob

def shift_vtt_timestamps(vtt_content, offset_seconds):
    """Shift all timestamps in VTT by offset_seconds (can be negative)."""
    def shift_timestamp(ts):
        # Parse HH:MM:SS.mmm
        parts = ts.split(':')
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
        total = hours * 3600 + minutes * 60 + seconds + offset_seconds
        if total < 0:
            total = 0
        h = int(total // 3600)
        m = int((total % 3600) // 60)
        s = total % 60
        return f"{h:02d}:{m:02d}:{s:06.3f}"
    
    lines = vtt_content.split('\n')
    result = []
    for line in lines:
        if '-->' in line:
            start, end = line.split('-->')
            start = start.strip()
            end = end.strip()
            new_start = shift_timestamp(start)
            new_end = shift_timestamp(end)
            result.append(f"{new_start} --> {new_end}")
        else:
            result.append(line)
    return '\n'.join(result)

def process_season(season_num, offset_seconds):
    subs_dir = f'/home/methu/Dokumenter/Series/Supernatural/S{season_num:02d}/Subs'
    vtt_files = sorted(glob.glob(os.path.join(subs_dir, '*.vtt')))
    
    for vtt_file in vtt_files:
        with open(vtt_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        shifted = shift_vtt_timestamps(content, offset_seconds)
        
        with open(vtt_file, 'w', encoding='utf-8') as f:
            f.write(shifted)
        
        print(f"Shifted {os.path.basename(vtt_file)} by {offset_seconds:+.1f}s")

if __name__ == '__main__':
    import sys
    if len(sys.argv) != 3:
        print("Usage: python3 shift_subs.py <season> <offset_seconds>")
        print("Example: python3 shift_subs.py 1 -1.5  # shift S01 earlier by 1.5s")
        sys.exit(1)
    
    season = int(sys.argv[1])
    offset = float(sys.argv[2])
    process_season(season, offset)