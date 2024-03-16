@echo off
setlocal enabledelayedexpansion

rem Loop through all MKV files in the current directory
for %%f in (*.mkv) do (
  rem Check if the file exists and is a regular file
  if exist "%%f" (
    rem Extract the filename without extension
    set "filename=%%~nf"
    
    rem Convert audio from DTS to AAC using ffmpeg
    ffmpeg -i "%%f" -c:v copy -c:a aac -strict experimental "Converted\!filename!_aac.mkv"
  )
)

echo Conversion complete
pause
