for f in *.mkv; do n=$(echo "$f" | sed -E 's/^(.*) \([0-9]{4}\) - (S[0-9]{2}E[0-9]{2}).*\.mkv$/\1.\2.mkv/'); [ "$f" != "$n" ] && echo "$f  --->  $n"; done; read -p "Proceed with rename? (y/n): " confirm && [ "$confirm" = "y" ] && for f in *.mkv; do n=$(echo "$f" | sed -E 's/^(.*) \([0-9]{4}\) - (S[0-9]{2}E[0-9]{2}).*\.mkv$/\1.\2.mkv/'); [ "$f" != "$n" ] && mv -v "$f" "$n"; done

for f in *_converted.mp4; do echo "$f  --->  ${f/_converted/}"; done; read -p "Proceed with rename? (y/n): " confirm && [ "$confirm" = "y" ] && for f in *_converted.mp4; do mv -v "$f" "${f/_converted/}"; done
