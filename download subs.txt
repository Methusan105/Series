curl -s https://api.github.com/repos/Methusan105/Series/releases/tags/SV5 | grep -o 'https://[^"]*\.vtt' | xargs -n 1 curl -LO
curl: (2) no URL specified
curl: try 'curl --help' for more information
