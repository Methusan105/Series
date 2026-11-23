// ============================================================
// SeriesAuth - persistent (Netflix-style) GitHub Gist sign-in
// Creds are stored in localStorage so you only sign in once
// per browser. sessionStorage keys are mirrored for backwards
// compatibility with older pages.
// ============================================================
var SeriesAuth = (function () {
  var STORE_KEY = 'seriesAuth';
  var GIST_FILENAME = 'video_progress.json';
  var LEGACY_KEYS = {
    username: 'githubUsername',
    gistId: 'githubGistId',
    token: 'githubAccessToken'
  };

  function get() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.username && data.gistId && data.token) return data;
      }
    } catch (e) {}
    var username = sessionStorage.getItem(LEGACY_KEYS.username);
    var gistId = sessionStorage.getItem(LEGACY_KEYS.gistId);
    var token = sessionStorage.getItem(LEGACY_KEYS.token);
    if (username && gistId && token) {
      return { username: username, gistId: gistId, token: token };
    }
    return null;
  }

  function save(creds) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(creds));
    } catch (e) {}
    sessionStorage.setItem(LEGACY_KEYS.username, creds.username);
    sessionStorage.setItem(LEGACY_KEYS.gistId, creds.gistId);
    sessionStorage.setItem(LEGACY_KEYS.token, creds.token);
  }

  function clear() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    sessionStorage.removeItem(LEGACY_KEYS.username);
    sessionStorage.removeItem(LEGACY_KEYS.gistId);
    sessionStorage.removeItem(LEGACY_KEYS.token);
  }

  function verify(creds, cb) {
    fetch('https://api.github.com/gists/' + encodeURIComponent(creds.gistId), {
      headers: { 'Authorization': 'token ' + creds.token }
    })
      .then(function (r) { cb(r.ok); })
      .catch(function () { cb(false); });
  }

  function fetchProgress(creds, cb) {
    fetch('https://api.github.com/gists/' + encodeURIComponent(creds.gistId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.files && data.files[GIST_FILENAME]) {
          try {
            cb(JSON.parse(data.files[GIST_FILENAME].content));
          } catch (e) { cb(null); }
        } else {
          cb(null);
        }
      })
      .catch(function () { cb(null); });
  }

  function writeProgress(creds, progressData) {
    var gistData = { files: {} };
    gistData.files[GIST_FILENAME] = { content: JSON.stringify(progressData, null, 2) };
    return fetch('https://api.github.com/gists/' + encodeURIComponent(creds.gistId), {
      method: 'PATCH',
      headers: {
        'Authorization': 'token ' + creds.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(gistData)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { console.log('Progress saved:', d); })
      .catch(function (e) { console.error('Save error:', e); });
  }

  function clearProgress(creds) {
    var gistData = { files: {} };
    gistData.files[GIST_FILENAME] = { content: JSON.stringify(12, null, 2) };
    return fetch('https://api.github.com/gists/' + encodeURIComponent(creds.gistId), {
      method: 'PATCH',
      headers: {
        'Authorization': 'token ' + creds.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(gistData)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { console.log('Progress cleared:', d); })
      .catch(function (e) { console.error('Clear error:', e); });
  }

  // Run cb(creds) once signed in; show sign-in overlay otherwise.
  function require(cb) {
    var creds = get();
    if (creds) {
      cb(creds);
      return;
    }
    showOverlay(function (newCreds) { cb(newCreds); });
  }

  function signOut() {
    clear();
    window.location.reload();
  }

  function ensureFloatingStyles() {
    if (document.getElementById('signOutStyle')) return;
    var st = document.createElement('style');
    st.id = 'signOutStyle';
    st.textContent = '.sign-out-btn--floating{position:fixed;right:20px;bottom:20px;z-index:9999;margin:0;padding:10px 20px;border-radius:999px;background:rgba(20,20,20,.9);color:#e5e5e5;border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer;font-size:14px}@media(max-width:640px){.sign-out-btn--floating{right:12px;bottom:12px}}';
    document.head.appendChild(st);
  }

  function mountSignOut() {
    if (document.getElementById('signOutBtn')) return;
    var footer = document.querySelector('.player-footer');
    var btn = document.createElement('button');
    btn.id = 'signOutBtn';
    btn.type = 'button';
    btn.textContent = 'Sign out';
    btn.className = 'sign-out-btn';
    btn.addEventListener('click', function () {
      if (confirm('Sign out on this browser?')) signOut();
    });
    if (footer) {
      footer.appendChild(btn);
    } else {
      ensureFloatingStyles();
      btn.className += ' sign-out-btn--floating';
      document.body.appendChild(btn);
    }
  }

  function showOverlay(afterLogin) {
    if (document.getElementById('seriesAuthOverlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'seriesAuthOverlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,0.88)', 'backdrop-filter:blur(6px)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
    ].join(';');

    overlay.innerHTML = [
      '<div style="width:min(420px,90vw);background:#141414;border:1px solid #333;border-radius:16px;padding:40px 36px;box-shadow:0 20px 60px rgba(0,0,0,0.7);color:#e5e5e5;box-sizing:border-box">',
      '  <div style="width:64px;height:64px;margin:0 auto 18px;border-radius:16px;background:linear-gradient(135deg,#e50914,rgba(229,9,20,0.55));display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(229,9,20,0.4)">',
      '    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,4 20,12 6,20" fill="#fff" stroke="none"/></svg>',
      '  </div>',
      '  <h2 style="margin:0 0 6px;font-size:26px;font-weight:900;text-align:center;color:#fff">Sign in</h2>',
      '  <p style="margin:0 0 26px;text-align:center;color:#a5a5a5;font-size:14px">Sync your watch progress across devices</p>',
      '  <input id="siUser" type="text" placeholder="GitHub username" autocomplete="username" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:12px 14px;background:#0a0a0a;border:1px solid #333;border-radius:6px;color:#e5e5e5;font-size:15px;outline:none" />',
      '  <input id="siGist" type="text" placeholder="Gist ID" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:12px 14px;background:#0a0a0a;border:1px solid #333;border-radius:6px;color:#e5e5e5;font-size:15px;outline:none" />',
      '  <input id="siToken" type="password" placeholder="Personal access token" autocomplete="current-password" style="width:100%;box-sizing:border-box;margin-bottom:16px;padding:12px 14px;background:#0a0a0a;border:1px solid #333;border-radius:6px;color:#e5e5e5;font-size:15px;outline:none" />',
      '  <button id="siSubmit" type="button" style="width:100%;padding:12px;border:none;border-radius:6px;background:#e50914;color:#fff;font-weight:700;font-size:15px;cursor:pointer">Sign In</button>',
      '  <div id="siStatus" style="min-height:18px;margin-top:12px;text-align:center;font-size:13px;color:#a5a5a5"></div>',
      '  <button id="siImport" type="button" style="display:block;width:100%;margin-top:10px;padding:10px;border:none;border-radius:6px;background:transparent;color:#a5a5a5;font-size:13px;cursor:pointer;text-decoration:underline">Import credentials file (.txt)</button>',
      '  <input id="siFile" type="file" accept=".txt" style="display:none" />',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);

    var siUser = overlay.querySelector('#siUser');
    var siGist = overlay.querySelector('#siGist');
    var siToken = overlay.querySelector('#siToken');
    var siSubmit = overlay.querySelector('#siSubmit');
    var siStatus = overlay.querySelector('#siStatus');
    var siImport = overlay.querySelector('#siImport');
    var siFile = overlay.querySelector('#siFile');

    // Prefill from sessionStorage (legacy) if present
    siUser.value = sessionStorage.getItem(LEGACY_KEYS.username) || '';
    siGist.value = sessionStorage.getItem(LEGACY_KEYS.gistId) || '';
    siToken.value = sessionStorage.getItem(LEGACY_KEYS.token) || '';

    function setStatus(text, color) {
      siStatus.textContent = text;
      siStatus.style.color = color || '#a5a5a5';
    }

    function finish(creds) {
      save(creds);
      overlay.remove();
      mountSignOut();
      afterLogin(creds);
    }

    function submit() {
      var creds = {
        username: siUser.value.trim(),
        gistId: siGist.value.trim(),
        token: siToken.value.trim()
      };
      if (!creds.username || !creds.gistId || !creds.token) {
        setStatus('Please fill in all three fields.', '#e50914');
        return;
      }
      siSubmit.disabled = true;
      siSubmit.textContent = 'Checking\u2026';
      setStatus('Verifying with GitHub\u2026');
      verify(creds, function (ok) {
        siSubmit.disabled = false;
        siSubmit.textContent = 'Sign In';
        if (ok) {
          finish(creds);
        } else {
          setStatus('Could not verify. Check the Gist ID and token.', '#e50914');
        }
      });
    }

    function importFile(file) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var content = String(e.target.result || '');
        var lines = content.split('\n');
        lines.forEach(function (line) {
          var parts = line.split('=');
          if (parts.length === 2) {
            var key = parts[0].trim().toLowerCase();
            var value = parts[1].trim();
            if (key === 'username') siUser.value = value;
            else if (key === 'gist id' || key === 'gistid') siGist.value = value;
            else if (key === 'token') siToken.value = value;
          }
        });
        setStatus('File imported \u2014 press Sign In.');
      };
      reader.readAsText(file);
    }

    siSubmit.addEventListener('click', submit);
    [siUser, siGist, siToken].forEach(function (el) {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    });
    siImport.addEventListener('click', function () { siFile.click(); });
    siFile.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
    });

    setTimeout(function () { siUser.focus(); }, 50);
  }

  return {
    get: get,
    save: save,
    clear: clear,
    verify: verify,
    fetchProgress: fetchProgress,
    writeProgress: writeProgress,
    clearProgress: clearProgress,
    require: require,
    signOut: signOut,
    mountSignOut: mountSignOut
  };
})();

// Clear progress in the Gist
function clearGistProgress() {
  var creds = SeriesAuth.get();
  if (!creds) return;
  SeriesAuth.clearProgress(creds);
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
  // Mount sign-out button if user is already logged in
  if (SeriesAuth.get()) {
    SeriesAuth.mountSignOut();
  }
});