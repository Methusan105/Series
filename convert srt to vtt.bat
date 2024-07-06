@echo off
for %%f in (*.srt) do (
    (
        echo WEBVTT
        echo.
        sed "s/,/./g" "%%~nf.srt"
    ) > "%%~nf.vtt"
)
