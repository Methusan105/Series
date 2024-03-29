import os

release_file_path = r"C:\Users\Methusan\Downloads\Teen Wolf (2011) Season 03 S03 (1080p BluRay x265 HEVC 10bit DTS 5.1 Qman) [UTR]\Converted\Teen.Wolf.S03E"

# Assuming you want to iterate from 2 to 29
for i in range(1, 25):
    file_number = f"{i:02d}"  # Format the number with leading zeros
    file_path = f'{release_file_path}{file_number}.mkv'
    
    command = f'gh release upload TW3 "{file_path}"'
    
    # Execute the command
    os.system(command)
