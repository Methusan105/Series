#!/bin/bash
for f in *.srt; do
  {
    echo "WEBVTT"
    echo ""
    sed 's/,/./g' "$f"
  } > "${f%.srt}.vtt"
done
