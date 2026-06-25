// Function to clear the progress in the Gist
function clearGistProgress() {
  var username = sessionStorage.getItem('githubUsername');
  var gistId = sessionStorage.getItem('githubGistId');
  var accessToken = sessionStorage.getItem('githubAccessToken');
  var gistFilename = 'video_progress.json';

  if (!username || !gistId || !accessToken) {
    return;
  }

  var gistData = {
    "files": {
      [gistFilename]: {
        "content": JSON.stringify(12, null, 2)
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
    .then(data => console.log('Progress Cleared from Gist:', data))
    .catch(error => console.error('Error clearing gist progress:', error));
}

function findNextEpisodeUrl() {
  var anchors = document.querySelectorAll('a[href]');
  for (var i = 0; i < anchors.length; i++) {
    var anchor = anchors[i];
    var text = anchor.textContent.trim().toLowerCase();
    if (text.includes('next episode') || text.includes('next') && text.includes('episode')) {
      return anchor.href;
    }
  }
  return null;
}

function setupEpisodeAutoAdvance(player) {
  if (!player || typeof player.on !== 'function') {
    return;
  }

  var nextEpisodeUrl = findNextEpisodeUrl();
  var sourceEls = document.querySelectorAll('video#my-video source');
  var sources = Array.from(sourceEls).map(function (sourceEl) {
    return sourceEl.src;
  }).filter(function (src) {
    return !!src;
  });

  player.on('ended', function () {
    setTimeout(function () {
      var playing = false;
      if (typeof player.paused === 'function') {
        playing = !player.paused();
      }
      if (playing) {
        return;
      }

      var currentSrc = '';
      if (typeof player.currentSrc === 'function') {
        currentSrc = player.currentSrc();
      } else {
        currentSrc = player.currentSrc || '';
      }

      var index = sources.indexOf(currentSrc);
      if (index >= 0 && index < sources.length - 1) {
        player.src({
          src: sources[index + 1],
          type: 'video/mp4'
        });
        player.load();
        player.play();
        return;
      }

      if (index === -1 && sources.length > 0) {
        // If the current source is not one of the listed sources, it may be a fallback source.
        // If it has already switched, wait until it actually ends before redirecting.
        if (currentSrc && currentSrc !== sources[0]) {
          return;
        }
        if (nextEpisodeUrl && player.ended && player.ended()) {
          clearGistProgress();
          window.location.href = nextEpisodeUrl;
        }
        return;
      }

      if (nextEpisodeUrl) {
        clearGistProgress();
        window.location.href = nextEpisodeUrl;
      }
    }, 500);
  });
}

function goToNextEpisode() {
  var nextUrl = findNextEpisodeUrl();
  if (nextUrl) {
    clearGistProgress();
    window.location.href = nextUrl;
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (window.player && typeof window.player.on === 'function') {
    setupEpisodeAutoAdvance(window.player);
  } else if (window.videojs) {
    var defaultPlayer;
    try {
      defaultPlayer = videojs('my-video');
    } catch (e) {
      defaultPlayer = null;
    }
    if (defaultPlayer && typeof defaultPlayer.on === 'function') {
      setupEpisodeAutoAdvance(defaultPlayer);
    }
  }
});