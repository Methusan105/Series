var video = document.getElementById('my-video');
var player = videojs("my-video");
var spacePressed = false;

document.addEventListener("keydown", function (event) {
    if (event.key === " ") {
        event.preventDefault(); // Prevent default spacebar behavior (scrolling down)
        togglePause();
    }
    if (event.key === "f") {
        fullscr();
    }
});

function togglePause() {
    if (player.paused()) {
        player.play();
    } else {
        player.pause();
    }
}
function fullscr() {
    if (player.isFullscreen()) {
        player.exitFullscreen();
    } else {
        player.requestFullscreen();
    }
}

var gistFilename = 'video_progress.json';
var isVideoPaused = false; // Track video pause/resume status

// Retrieve user credentials from sessionStorage
var username = sessionStorage.getItem('githubUsername');
var gistId = sessionStorage.getItem('githubGistId');
var accessToken = sessionStorage.getItem('githubAccessToken');

// If user credentials are not in sessionStorage, ask for a file input
if (!username || !gistId || !accessToken) {
    var isTV = detectTV(); // Function to detect if user is on TV

    if (isTV) {
        var fileContent = prompt('Paste the content of your text file here:');
        if (fileContent) {
            processFileContent(fileContent);
        }
        setupVideoPlayback();
    } else {
        if (!document.getElementById('fileInput')) {
            var fileInput = createFileInput();
            document.body.appendChild(fileInput);
            button.addEventListener('click', function() {
                fileInput.click();
            });
            document.body.appendChild(button);
        }
    }
} else {
    setupVideoPlayback();
}

function detectTV() {
    // Example check based on user agent string for TV
    var userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('tv');
}

function createFileInput() {
    var input = document.createElement('input');
    input.id = 'fileInput';
    input.type = 'file';
    input.accept = '.txt';
    input.addEventListener('change', function(event) {
        var file = event.target.files[0];
        if (file) {
            var reader = new FileReader();
            reader.onload = function(e) {
                processFileContent(e.target.result);
            };
            reader.readAsText(file);
        }
    });
    return input;
}

function processFileContent(content) {
    var lines = content.split('\n');
    lines.forEach(function(line) {
        var parts = line.split('=');
        if (parts.length === 2) {
            var key = parts[0].trim().toLowerCase();
            var value = parts[1].trim();
            if (key === 'username') {
                username = value;
            } else if (key === 'gist id') {
                gistId = value;
            } else if (key === 'token') {
                accessToken = value;
            }
        }
    });

    console.log('Username:', username);
    console.log('Gist ID:', gistId);
    console.log('Access Token:', accessToken);

    sessionStorage.setItem('githubUsername', username);
    sessionStorage.setItem('githubGistId', gistId);
    sessionStorage.setItem('githubAccessToken', accessToken);

    setupVideoPlayback();
}

function setupVideoPlayback() {
    // Use the provided values for GitHub username, Gist ID, and token
    var gistScript = document.createElement('script');
    gistScript.src = `https://gist.github.com/${username}/${gistId}.js?access_token=${accessToken}`;
    document.head.appendChild(gistScript);

    // Function to handle the network error
    function handleNetworkError() {
        console.log('A network error has occurred. Refreshing video...')

        // Now load the video after saving the progress
        video.load();

        // Retrieve progress data from Gist and set currentTime
        fetch(`https://api.github.com/gists/${gistId}`)
            .then(response => response.json())
            .then(data => {
                if (data.files[gistFilename]) {
                    var progressData = JSON.parse(data.files[gistFilename].content);
                    if (progressData.progress) {
                        video.currentTime = parseFloat(progressData.progress);
                    }
                }
            });
    }

    // Add an error event listener to the video element
    video.addEventListener('error', function () {
        if (video.error && video.error.code === 2) {
            // Save the progress to the Gist when a network error occurs
            var progressData = {
                "progress": video.currentTime,
                "url": window.location.href // Add the URL here
            };
            var gistData = {
                "files": {
                    [gistFilename]: {
                        "content": JSON.stringify(progressData, null, 2)
                    }
                }
            };
            fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': 'token ' + `${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(gistData)
            })
                .then(response => response.json())
                .then(data => {
                    console.log('Progress saved to Gist:', data);

                    // Introduce a 3-second timeout before calling handleNetworkError() and playing the video
                    setTimeout(function () {
                        handleNetworkError();
                        video.play();
                    }, 3000);
                });
        }
    });

    // Handle saving and loading video playback progress
    video.addEventListener('timeupdate', function () {
        // Check if the video is paused
        if (video.paused && !isVideoPaused) {
            isVideoPaused = true;
            // Save the progress to the Gist when paused
            var progressData = {
                "progress": video.currentTime,
                "url": window.location.href // Add the URL here
            };
            var gistData = {
                "files": {
                    [gistFilename]: {
                        "content": JSON.stringify(progressData, null, 2)
                    }
                }
            };
            fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': 'token ' + `${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(gistData)
            })
                .then(response => response.json())
                .then(data => console.log('Progress saved to Gist:', data));
        }
    });
}