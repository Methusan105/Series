#!/usr/bin/env bash
# Remux a video into an MP4 that carries AAC audio, without re-encoding video.
#
#   ./aac-mp4.sh <input> <output>
#
# Audio policy, decided per track:
#   aac            -> stream copy, bit-for-bit
#   anything else  -> transcode to AAC at a bitrate that follows the channel
#                     count, keeping the channels (downmixed to 5.1 only above
#                     eight channels, which is all AAC can hold)
#
# Every audio track is kept in input order along with its language and default
# flag, so a multi-audio release keeps every dub and commentary. MP4 has no
# per-track title field, so track titles cannot come across; the list printed
# below says which track holds what. Subtitles and font attachments are dropped:
# MP4 cannot carry PGS or SSA, and keeping only the ones it can would silently
# lose the rest.
set -euo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$#" -eq 2 ] || die "usage: $0 <input> <output>"
in=$1
out=$2
[ -f "$in" ] || die "no such file: $in"

probe=$(ffprobe -v error -show_streams -of json -- "$in")

video_codec=$(jq -r '[.streams[] | select(.codec_type == "video" and ((.disposition.attached_pic // 0) == 0))][0].codec_name // empty' <<<"$probe")
[ -n "$video_codec" ] || die "$in has no video stream, so there is nothing to remux"
case $video_codec in
  h264 | hevc | av1) ;;
  *) die "$in carries $video_codec video, which the MP4 container cannot hold; keep it in Matroska instead" ;;
esac

# "-" stands in for a missing tag: read(1) treats a tab as IFS whitespace, so an
# empty field would collapse and shift every column after it.
audio=$(jq -r '[.streams[] | select(.codec_type == "audio")] | to_entries[] |
  [.key, .value.codec_name, (.value.channels // 2), (.value.tags.language // "-"),
   (.value.tags.title // "-"), ((.value.disposition.default // 0) | tostring)] | @tsv' <<<"$probe")
[ -n "$audio" ] || die "$in has no audio stream, so there is nothing to convert"

printf 'video: %s (copied)\n' "$video_codec"

args=(-nostdin -hide_banner -loglevel warning -y -i "$in" -map 0:V:0 -c:v copy)
if [ "$video_codec" = hevc ]; then
  # Matroska tags HEVC as hev1, which QuickTime and Safari refuse in MP4.
  args+=(-tag:v hvc1)
fi

declare -a per_stream=()
tracks=0
claimed_default=0
while IFS=$'\t' read -r index codec channels language title is_default; do
  args+=(-map "0:a:$index")
  if [ "$title" = - ]; then
    label=${language/#-/und}
  else
    label=$title
  fi
  if [ "$codec" = aac ]; then
    per_stream+=(-c:a:"$tracks" copy)
    conversion="copy"
  else
    if [ "$channels" -le 2 ]; then
      bitrate=160k
    elif [ "$channels" -le 6 ]; then
      bitrate=256k
    else
      bitrate=384k
    fi
    per_stream+=(-c:a:"$tracks" aac -b:a:"$tracks" "$bitrate")
    if [ "$channels" -gt 8 ]; then
      per_stream+=(-ac:a:"$tracks" 6)
      conversion="aac $bitrate (downmixed 5.1 from $codec ${channels}ch)"
    else
      conversion="aac $bitrate (from $codec ${channels}ch)"
    fi
  fi
  if [ "$is_default" = 1 ] && [ "$claimed_default" = 0 ]; then
    per_stream+=(-disposition:a:"$tracks" default)
    claimed_default=1
  else
    per_stream+=(-disposition:a:"$tracks" 0)
  fi
  printf 'audio %d: %-5s %-4s %-9s %-24s %s\n' "$tracks" "$codec" "${channels}ch" "$language" "[$label]" "$conversion"
  tracks=$((tracks + 1))
done <<<"$audio"

ffmpeg "${args[@]}" "${per_stream[@]}" \
  -map_metadata 0 -map_chapters 0 -movflags +faststart "$out"
[ -s "$out" ] || die "ffmpeg produced no output for $in"

after=$(ffprobe -v error -show_streams -of json -- "$out")
out_codec=$(jq -r '[.streams[] | select(.codec_type == "video")][0].codec_name // empty' <<<"$after")
out_audio=$(jq -r '[.streams[] | select(.codec_type == "audio") | .codec_name] | join(" ")' <<<"$after")
non_aac=$(jq -r '[.streams[] | select(.codec_type == "audio" and .codec_name != "aac")] | length' <<<"$after")
out_tracks=$(jq -r '[.streams[] | select(.codec_type == "audio")] | length' <<<"$after")

[ "$out_codec" = "$video_codec" ] || die "video came out as $out_codec, expected $video_codec"
[ "$out_tracks" = "$tracks" ] || die "output has $out_tracks audio tracks, expected $tracks"
[ "$non_aac" = 0 ] || die "output still carries non-AAC audio: $out_audio"

printf 'ok: %s -> %s (%s video, %d audio: %s)\n' "$in" "$out" "$out_codec" "$out_tracks" "$out_audio"
