// Function to clear the progress in the Gist
function clearGistProgress() {
  var username = sessionStorage.getItem('githubUsername');
  var gistId = sessionStorage.getItem('githubGistId');
  var accessToken = sessionStorage.getItem('githubAccessToken');

  var gistFilename = 'video_progress.json';

  // Check if user credentials are available
  var gistData = {
    "files": {
      [gistFilename]: {
        "content": JSON.stringify(12, null, 2)
      }
    }
  }
  if (username && gistId && accessToken) {
    // Delete the file from the Gist
    fetch(`https://api.github.com/gists/${gistId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': 'token ' + `${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gistData)
        })
        .then(response => response.json())
        .then(data => console.log('Progress Cleared from Gist:', data));
      }
    };

// Function to redirect to the next episode
function goToNextEpisode() {
  // Clear the progress in the Gist
  clearGistProgress();
}