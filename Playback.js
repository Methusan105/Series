// ============================================================
// Device detection - tags <html> with device-tv / device-mobile /
// device-desktop plus has-touch / no-touch and is-fullscreen.
// player.css uses these classes instead of raw screen-width media
// queries so a 1080p desktop fullscreen is not treated like a TV.
// Override with ?device=tv|mobile|desktop (or localStorage.seriesDevice).
// ============================================================
(function detectSeriesDevice() {
  var root = document.documentElement;
  if (!root) return;

  var override = '';
  var search = (window.location && window.location.search) || '';
  var match = /[?&]device=([a-z]+)/i.exec(search);
  if (match) override = match[1].toLowerCase();
  if (!override) {
    try { override = String(localStorage.getItem('seriesDevice') || '').toLowerCase(); } catch (e) {}
  }

  var ua = String(navigator.userAgent || '').toLowerCase();
  var tvTokens = ['appletv', 'googletv', 'tizen', 'webtv', 'webos', 'viera', 'smarttv', 'hbbtv', 'netcast', 'net tv', 'bravia', 'aftb', 'aftm', 'aftt', 'fire tv', 'roku', 'crkey', 'chromecast'];
  var isTv = /(^|[^a-z])tv([^a-z]|$)/.test(ua) || tvTokens.some(function (token) { return ua.indexOf(token) !== -1; });
  if (!isTv && window.matchMedia) {
    try { isTv = window.matchMedia('(display-mode: tv)').matches; } catch (e) {}
  }

  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  var isMobileUA = /mobile|android|iphone|ipad|ipod|iemobile|blackberry|opera mini|windows phone/i.test(ua);
  var sw = window.screen ? window.screen.width : 9999;
  var sh = window.screen ? window.screen.height : 9999;
  var smallScreen = Math.min(sw, sh) <= 820;
  var isMobile = !isTv && (isMobileUA || (isTouch && smallScreen));

  var device = override === 'tv' || override === 'mobile' || override === 'desktop'
    ? override
    : (isTv ? 'tv' : (isMobile ? 'mobile' : 'desktop'));

  function setClass(name, on) {
    if (!root.classList) return;
    if (on) root.classList.add(name);
    else root.classList.remove(name);
  }

  setClass('device-tv', false);
  setClass('device-mobile', false);
  setClass('device-desktop', false);
  setClass('device-' + device, true);
  setClass('has-touch', !!isTouch);
  setClass('no-touch', !isTouch);

  function syncFullscreen() {
    var fs = document.fullscreenElement || document.webkitFullscreenElement ||
      document.mozFullScreenElement || document.msFullscreenElement;
    setClass('is-fullscreen', !!fs);
  }
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(function (evt) {
    document.addEventListener(evt, syncFullscreen, false);
  });
  syncFullscreen();

  window.SeriesDevice = {
    type: device,
    isTv: device === 'tv',
    isMobile: device === 'mobile',
    isTouch: !!isTouch
  };
})();

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
    var headers = authHeaders(creds);
    headers['Accept'] = 'application/vnd.github+json';
    fetch(gistUrl(creds) + '?t=' + Date.now(), { headers: headers })
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

  var suppressWrites = false;
  var writeQueue = Promise.resolve();

  function gistUrl(creds) {
    return 'https://api.github.com/gists/' + encodeURIComponent(creds.gistId);
  }

  function authHeaders(creds) {
    var headers = {};
    if (creds && creds.token) headers['Authorization'] = 'token ' + creds.token;
    return headers;
  }

  // Read video_progress.json straight from the gist. Resolves with the parsed
  // JSON, or null when the file is missing / unreadable / malformed.
  function readProgressFile(creds) {
    var headers = authHeaders(creds);
    headers['Accept'] = 'application/vnd.github+json';
    return fetch(gistUrl(creds) + '?t=' + Date.now(), { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.files || !data.files[GIST_FILENAME]) return null;
        var raw = data.files[GIST_FILENAME].content;
        if (typeof raw !== 'string') return null;
        try {
          return JSON.parse(raw);
        } catch (e) {
          return null;
        }
      })
      .catch(function () { return null; });
  }

  // A file "has progress" when it contains a usable, non-zero position.
  function hasProgress(data) {
    if (!data || typeof data.progress !== 'number') return false;
    return data.progress > 0;
  }

  function writeProgress(creds, progressData) {
    if (suppressWrites) return writeQueue;
    writeQueue = writeQueue.then(function () {
      if (suppressWrites) return null;
      var gistData = { files: {} };
      gistData.files[GIST_FILENAME] = { content: JSON.stringify(progressData, null, 2) };
      return fetch(gistUrl(creds), {
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
    });
    return writeQueue;
  }

  function clearProgress(creds) {
    var gistData = { files: {} };
    gistData.files[GIST_FILENAME] = { content: JSON.stringify(12, null, 2) };
    return fetch(gistUrl(creds), {
      method: 'PATCH',
      headers: {
        'Authorization': 'token ' + creds.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(gistData)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { console.log('Progress cleared:', d); return d; })
      .catch(function (e) { console.error('Clear error:', e); throw e; });
  }

  // PATCH the gist, then re-read it to prove the progress is really gone.
  function clearProgressWithVerification(creds, cb) {
    var attempts = 0;
    var maxAttempts = 5;
    function retryDelay() {
      return 350 + attempts * 250;
    }
    function attempt() {
      attempts += 1;
      // Let any save that was already in flight finish first, so it cannot
      // land after our clear and re-add the progress.
      writeQueue
        .then(function () { return clearProgress(creds); })
        .then(function () { return readProgressFile(creds); })
        .then(function (data) {
          if (!hasProgress(data)) {
            cb(true);
            return;
          }
          if (attempts < maxAttempts) {
            setTimeout(attempt, retryDelay());
            return;
          }
          console.error('Progress still present in gist after clearing');
          cb(false);
        })
        .catch(function (e) {
          if (attempts < maxAttempts) {
            setTimeout(attempt, retryDelay());
            return;
          }
          console.error('Could not verify cleared progress:', e);
          cb(false);
        });
    }
    attempt();
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

  // Always show the sign-in overlay (used by "Resume Playback" so the
  // user can confirm credentials or import a .txt file each time).
  function requireFresh(cb) {
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

    // Prefill from saved credentials (localStorage) or legacy sessionStorage
    var saved = get() || {};
    siUser.value = saved.username || sessionStorage.getItem(LEGACY_KEYS.username) || '';
    siGist.value = saved.gistId || sessionStorage.getItem(LEGACY_KEYS.gistId) || '';
    siToken.value = saved.token || sessionStorage.getItem(LEGACY_KEYS.token) || '';

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
    clearProgressWithVerification: clearProgressWithVerification,
    readProgressFile: readProgressFile,
    hasProgress: hasProgress,
    setSuppressWrites: function (value) { suppressWrites = !!value; },
    require: require,
    requireFresh: requireFresh,
    signOut: signOut,
    mountSignOut: mountSignOut
  };
})();

// Clear progress in the Gist and confirm it is gone before calling back.
// cb(true) when the gist really has no progress, cb(false) otherwise.
function clearGistProgress(cb) {
  var creds = SeriesAuth.get();
  if (!creds) {
    if (typeof cb === 'function') cb(false);
    return;
  }
  SeriesAuth.clearProgressWithVerification(creds, function (verified) {
    if (typeof cb === 'function') cb(verified);
  });
}

function showClearingBadge() {
  if (!document.body) return null;
  var badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;background:rgba(20,20,20,.92);color:#e5e5e5;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:9px 18px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.4);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  badge.textContent = 'Clearing progress\u2026';
  document.body.appendChild(badge);
  return badge;
}

// Keep the gist cleared: pause playback and block the 15s autosave from
// writing progress again until the user actually starts watching again.
function holdWritesUntilPlayback() {
  var resume = function () { SeriesAuth.setSuppressWrites(false); };

  var player = window.player;
  if ((!player || typeof player.pause !== 'function') && window.videojs) {
    try { player = videojs('my-video'); } catch (e) { player = null; }
  }

  if (player && typeof player.pause === 'function') {
    try { player.pause(); } catch (e) {}
    if (typeof player.currentTime === 'function') {
      try { player.currentTime(0); } catch (e) {}
    }
    if (typeof player.one === 'function') {
      player.one('play', resume);
    } else if (typeof player.on === 'function') {
      var handler = function () {
        if (typeof player.off === 'function') player.off('play', handler);
        resume();
      };
      player.on('play', handler);
    }
    return;
  }

  var video = document.getElementById('my-video');
  if (video && typeof video.pause === 'function') {
    try { video.pause(); } catch (e) {}
    try { video.currentTime = 0; } catch (e) {}
    video.addEventListener('play', resume, { once: true });
    return;
  }

  // No player on this page: don't leave autosave suppressed.
  SeriesAuth.setSuppressWrites(false);
}

// Clear progress, then navigate once the gist has been verified as empty.
// Without a target URL (e.g. "Clear Progress") the page stays put and autosave
// is held back until playback resumes, so the clear is not undone after 15s.
function navigateAfterClearingProgress(url, onDone) {
  var badge = showClearingBadge();
  SeriesAuth.setSuppressWrites(true);
  clearGistProgress(function (verified) {
    if (badge && badge.remove) badge.remove();
    if (url) {
      window.location.href = url;
    } else {
      if (verified) {
        holdWritesUntilPlayback();
      } else {
        SeriesAuth.setSuppressWrites(false);
        alert('Could not clear saved progress. Please try again.');
      }
    }
    if (typeof onDone === 'function') onDone(verified);
  });
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

// Intercept "Next Episode", "Back to main menu", season cards and any control
// wired to clearGistProgress(). The default navigation is cancelled until the
// gist has been cleared and re-read to prove the progress is gone.
function setupClearBeforeNavigate() {
  var busy = false;

  document.addEventListener('click', function (event) {
    if (busy) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    var el = event.target;
    while (el && el.nodeType === 1 && el !== document.body) {
      if (el.classList && el.classList.contains('next-episode')) break;
      if (/^(A|BUTTON)$/.test(el.tagName)) break;
      if (((el.getAttribute && el.getAttribute('onclick')) || '').indexOf('clearGistProgress') !== -1) break;
      el = el.parentNode;
    }
    if (!el || el.nodeType !== 1) return;

    var inlineClear = (el.getAttribute && el.getAttribute('onclick')) || '';
    var clears = inlineClear.indexOf('clearGistProgress') !== -1;
    var isNextLink = !!(el.classList && el.classList.contains('next-episode'));
    if (!clears && !isNextLink) return;

    var href = el.tagName === 'A' ? el.getAttribute('href') : null;
    // e.g. the disabled "Series Complete" label: nothing to navigate to.
    if (isNextLink && !clears && !href) return;

    event.preventDefault();
    event.stopPropagation();

    if (!SeriesAuth.get()) {
      // Nothing stored to clear, keep the previous behaviour.
      if (href) window.location.href = href;
      return;
    }

    busy = true;
    navigateAfterClearingProgress(href, function () {
      if (!href) busy = false;
    });
  }, true);
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
          navigateAfterClearingProgress(nextEpisodeUrl);
        }
        return;
      }

      if (nextEpisodeUrl) {
        navigateAfterClearingProgress(nextEpisodeUrl);
      }
    }, 500);
  });
}

function goToNextEpisode() {
  var nextUrl = findNextEpisodeUrl();
  if (nextUrl) {
    navigateAfterClearingProgress(nextUrl);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  setupClearBeforeNavigate();

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