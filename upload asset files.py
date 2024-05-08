import os

release_file_path = r"C:\Users\Methu\Downloads\Lucifer (2016) Season 1-6 S01-S06 + Extras (1080p BluRay x265 HEVC 10bit EAC3 5.1 Ghost)\Season 2\Converted\Lucifer.S02E"

# Assuming you want to iterate from 2 to 29
for i in range(4, 19):
    file_number = f"{i:02d}"  # Format the number with leading zeros
    file_path = f'{release_file_path}{file_number}.mp4'
    
    command = f'gh release upload L2 "{file_path}" --clobber'
    
    # Execute the command
    os.system(command)
