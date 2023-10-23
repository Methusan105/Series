// Function to clear the progress from the Gist
    function clearGistProgress() {
      var gistData = {
        "files": {
          [gistFilename]: {
            "content": ''
          }
        }
      };
      fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'token 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', // Replace with your GitHub Personal Access Token
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gistData)
      })
      .then(response => response.json())
      .then(data => {
        console.log('Progress cleared from Gist:', data);
        // After clearing the progress, navigate to the new page
      });
    }