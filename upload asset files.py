import os

release_file_path = r"C:\Users\Methu\Videos\Teen.Wolf.S05E"

# Assuming you want to iterate from 2 to 29
for i in range(19, 21):
    file_number = f"{i:02d}"  # Format the number with leading zeros
    file_path = f'{release_file_path}{file_number}.mp4'
    
    command = f'gh release upload TW5 "{file_path}" --clobber'
    
    # Execute the command
    os.system(command)
