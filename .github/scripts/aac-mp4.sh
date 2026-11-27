#!/usr/bin/env bash
# Remux a video into an MP4 that carries AAC audio, without re-encoding video.
#
#   ./aac-mp4.sh <input> <output> [--keep <spec>] [--drop <spec>]
#
# Audio policy, decided per track:
#   aac            -> stream copy, bit-for-bit
#   anything else  -> transcode to AAC at a bitrate that follows the channel
#                     count, keeping the channels (downmixed to 5.1 only above
#                     eight channels, which is all AAC can hold)
#
# <spec> is a comma-separated list of selectors, any of which may be used:
#   all             every track (what --keep defaults to)
#   <number>        the track at that index, as numbered in the report below
#   <language>      tracks tagged with that ISO code (und = untagged)
#   default         tracks the source marks as default
#   <text>          tracks whose title contains that text, e.g. commentary
# --keep narrows the output to the union of its selectors; --drop then removes
# the union of its selectors from whatever is left. Surviving tracks keep their
# input order, language tag and default flag, so one dub stays the default.
#
# MP4 has no per-track title field, so track titles cannot come across; the
# report says which track held what. Subtitles and font attachments are dropped:
# MP4 cannot carry PGS or SSA, and keeping only the ones it could would silently
# lose the rest.
set -euo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$#" -ge 2 ] || die "usage: $0 <input> <output> [--keep <spec>] [--drop <spec>]"
in=$1
out=$2
shift 2

keep=all
drop=
while [ "$#" -gt 0 ]; do
  case $1 in
    --keep) keep=${2:-} && shift 2 ;;
    --drop) drop=${2:-} && shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done
[ -n "$keep" ] || keep=all

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

matches() {
  local token=${1,,} index=$2 language=${3,,} title=${4,,} is_default=$5
  case $token in
    all) return 0 ;;
    default) [ "$is_default" = 1 ] && return 0 || return 1 ;;
  esac
  if [[ $token =~ ^[0-9]+$ ]]; then
    [ "$token" = "$index" ] && return 0 || return 1
  fi
  [ "$token" = "$language" ] && return 0
  [[ $title == *"$token"* ]]
}

selected_by() {
  local spec=$1 token
  local IFS=,
  for token in $spec; do
    [ -n "$token" ] || continue
    matches "$token" "$2" "$3" "$4" "$5" && return 0
  done
  return 1
}

printf 'video: %s (copied)\n' "$video_codec"

declare -a args=(-nostdin -hide_banner -loglevel warning -y -i "$in" -map 0:V:0 -c:v copy)
if [ "$video_codec" = hevc ]; then
  # Matroska tags HEVC as hev1, which QuickTime and Safari refuse in MP4.
  args+=(-tag:v hvc1)
fi

declare -a per_stream=()
tracks=0
kept=0
claimed_default=0
mapfile -t rows <<<"$audio"
for row in "${rows[@]}"; do
  IFS=$'\t' read -r index codec channels language title is_default <<<"$row"
  if [ "$title" = - ]; then
    label=${language/#-/und}
  else
    label=$title
  fi
  if [ "$language" = - ]; then
    language=und
  fi

  if ! selected_by "$keep" "$index" "$language" "$title" "$is_default"; then
    printf 'audio %d: %-9s %-4s %-4s %-24s dropped (keep=%s did not match)\n' \
      "$index" "$codec" "${channels}ch" "$language" "[$label]" "$keep"
    continue
  fi
  if [ -n "$drop" ] && selected_by "$drop" "$index" "$language" "$title" "$is_default"; then
    printf 'audio %d: %-9s %-4s %-4s %-24s dropped (drop=%s matched)\n' \
      "$index" "$codec" "${channels}ch" "$language" "[$label]" "$drop"
    continue
  fi

  args+=(-map "0:a:$index")
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
  printf 'audio %d: %-9s %-4s %-4s %-24s %s -> out %d\n' \
    "$index" "$codec" "${channels}ch" "$language" "[$label]" "$conversion" "$tracks"
  tracks=$((tracks + 1))
  kept=$((kept + 1))
done

[ "$kept" -gt 0 ] || die "keep=$keep drop=${drop:-none} leaves no audio track in $in"

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

printf 'ok: %s -> %s (%s video, %d audio: %s)\n' "$in" "$out" "$out_codec" "$tracks" "$out_audio"
