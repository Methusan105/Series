#!/usr/bin/env bash
# Remux a video into an MP4 that carries AAC audio, without re-encoding video.
#
#   ./aac-mp4.sh <input> <output> [--keep <spec>] [--drop <spec>] [--dry-run]
#                [--skip-when-done]
#
# --dry-run prints the same per-track report and stops before ffmpeg runs, so
# the tracks can be listed and chosen from before anything is converted.
# --skip-when-done exits early with a "noop:" line when the input is already an
# MP4 whose audio is all AAC, which is what makes replacing an asset in place
# idempotent instead of re-uploading it on every run.
#
# Audio policy, decided per track:
#   aac            -> stream copy, bit-for-bit
#   anything else  -> transcode to AAC at a bitrate that follows the channel
#                     count, keeping the channels (downmixed to 5.1 only above
#                     eight channels, which is all AAC can hold)
#
# <spec> is a comma-separated list of selectors, each anchored to one attribute
# so a short code can never be mistaken for part of a title:
#   all             every track (what --keep defaults to)
#   <number>        the track at that index, as numbered in the report below
#   <language>      tracks whose language tag equals that code (und = untagged)
#   title:<text>    tracks whose title contains <text>, e.g. title:commentary
#   default         tracks the source marks as default
#
# --keep narrows the output to the union of its selectors; --drop then removes
# the union of its selectors from whatever is left. A selector that matches no
# track is an error rather than a silent no-op. Surviving tracks keep their
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
dry_run=0
skip_when_done=0
while [ "$#" -gt 0 ]; do
  case $1 in
    --keep) keep=${2:-} && shift 2 ;;
    --drop) drop=${2:-} && shift 2 ;;
    --dry-run) dry_run=1 && shift ;;
    --skip-when-done) skip_when_done=1 && shift ;;
    *) die "unknown option: $1" ;;
  esac
done
[ -n "$keep" ] || keep=all

[ -f "$in" ] || die "no such file: $in"

probe=$(ffprobe -v error -show_streams -show_format -of json -- "$in")
container=$(jq -r '.format.format_name // ""' <<<"$probe")

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

declare -a idx=() codecs=() chans=() langs=() titles=() flags=()
mapfile -t rows <<<"$audio"
for row in "${rows[@]}"; do
  IFS=$'\t' read -r i c n l t f <<<"$row"
  idx+=("$i")
  codecs+=("$c")
  chans+=("$n")
  langs+=("${l/#-/und}")
  titles+=("$t")
  flags+=("$f")
done

if [ "$skip_when_done" = 1 ] && [ "$dry_run" = 0 ] && [[ $container == *mp4* ]]; then
  unconverted=0
  for c in "${codecs[@]}"; do
    [ "$c" = aac ] || unconverted=1
  done
  if [ "$unconverted" = 0 ]; then
    printf 'noop: %s is already an AAC MP4, nothing to convert\n' "$in"
    exit 0
  fi
fi

matches() {
  local token=${1,,} index=$2 language=${3,,} title=${4,,} is_default=$5
  case $token in
    all) return 0 ;;
    default) [ "$is_default" = 1 ] && return 0 || return 1 ;;
  esac
  if [[ $token =~ ^[0-9]+$ ]]; then
    [ "$token" = "$index" ] && return 0 || return 1
  fi
  if [[ $token == title:* ]]; then
    [[ $title == *"${token#title:}"* ]] && return 0 || return 1
  fi
  [ "$token" = "$language" ]
}

declare -a keep_tokens=() drop_tokens=()
read_spec() {
  printf '%s' "$1" | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' || true
}
mapfile -t keep_tokens < <(read_spec "$keep")
mapfile -t drop_tokens < <(read_spec "$drop")

for token in "${keep_tokens[@]}" "${drop_tokens[@]}"; do
  if [ "${token,,}" = title: ]; then
    die "empty selector 'title:': give it a title fragment, e.g. title:commentary"
  fi
done

join() { local IFS=,; printf '%s' "$*"; }
keep_desc=$(join "${keep_tokens[@]}")
drop_desc=$(join "${drop_tokens[@]}")

# Every selector must hit something: a typo would otherwise quietly keep all
# tracks (or drop none) and, with removal enabled, cost the source file.
declare -A keep_hits=() drop_hits=()
inventory=
for i in "${!idx[@]}"; do
  inventory+="${idx[$i]}:${langs[$i]}[${titles[$i]/#-/${langs[$i]}}] "
done
for token in "${keep_tokens[@]}"; do
  for i in "${!idx[@]}"; do
    if matches "$token" "${idx[$i]}" "${langs[$i]}" "${titles[$i]}" "${flags[$i]}"; then
      keep_hits[$token]=1
      break
    fi
  done
  [ "${keep_hits[$token]:-}" = 1 ] || die "keep=$token matches no audio track; tracks are: $inventory (title:<text> matches a title)"
done
for token in "${drop_tokens[@]}"; do
  for i in "${!idx[@]}"; do
    if matches "$token" "${idx[$i]}" "${langs[$i]}" "${titles[$i]}" "${flags[$i]}"; then
      drop_hits[$token]=1
      break
    fi
  done
  [ "${drop_hits[$token]:-}" = 1 ] || die "drop=$token matches no audio track; tracks are: $inventory (title:<text> matches a title)"
done

in_keep() { local token; for token in "${keep_tokens[@]}"; do matches "$token" "$@" && return 0; done; return 1; }
in_drop() { local token; for token in "${drop_tokens[@]}"; do matches "$token" "$@" && return 0; done; return 1; }

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
for i in "${!idx[@]}"; do
  index=${idx[$i]}
  codec=${codecs[$i]}
  channels=${chans[$i]}
  language=${langs[$i]}
  title=${titles[$i]}
  if [ "$title" = - ]; then
    label=$language
  else
    label=$title
  fi

  if ! in_keep "$index" "$language" "$title" "${flags[$i]}"; then
    printf 'audio %d: %-9s %-4s %-4s %-24s dropped (keep=%s did not match)\n' \
      "$index" "$codec" "${channels}ch" "$language" "[$label]" "$keep_desc"
    continue
  fi
  if in_drop "$index" "$language" "$title" "${flags[$i]}"; then
    printf 'audio %d: %-9s %-4s %-4s %-24s dropped (drop=%s matched)\n' \
      "$index" "$codec" "${channels}ch" "$language" "[$label]" "$drop_desc"
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
  if [ "${flags[$i]}" = 1 ] && [ "$claimed_default" = 0 ]; then
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

[ "$kept" -gt 0 ] || die "keep=$keep_desc drop=${drop_desc:-none} leaves no audio track in $in"

if [ "$dry_run" = 1 ]; then
  printf 'dry run: %d of %d track(s) would be kept, nothing written\n' "$kept" "${#idx[@]}"
  exit 0
fi

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
