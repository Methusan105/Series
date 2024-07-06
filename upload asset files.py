import os

release_file_path = r"C:\Downloads\Stranger Things Season 3\Stranger.Things.S03E"

# Assuming you want to iterate from 2 to 29
for i in range(1, 9):
    file_number = f"{i:02d}"  # Format the number with leading zeros
    file_path = f'{release_file_path}{file_number}.mkvgh'
    
    command = f'gh release upload ST3 "{file_path}" --clobber'
    
    # Execute the command
    os.system(command)
