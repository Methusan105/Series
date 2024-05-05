import os

release_file_path = r"C:\Users\Methu\Videos\Knuckles.S01E"

# Assuming you want to iterate from 2 to 29
for i in range(6, 7):
    file_number = f"{i:02d}"  # Format the number with leading zeros
    file_path = f'{release_file_path}{file_number}.mp4'
    
    command = f'gh release upload L1 "{file_path}" --clobber'
    
    # Execute the command
    os.system(command)
