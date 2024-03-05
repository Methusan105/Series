import os

release_file_path = r"C:\Users\Methusan\Downloads\The Mandalorian Seasons 1 and 2 [2160p 4K NVEnc H265][AAC 6Ch]\Season 2\The.Mandalorian.S02E"

# Assuming you want to iterate from 2 to 29
for i in range(1, 8):
    file_number = f"{i:02d}"  # Format the number with leading zeros
    file_path = f'{release_file_path}{file_number}.mp4'
    
    command = f'gh release upload M2 "{file_path}"'
    
    # Execute the command
    os.system(command)
