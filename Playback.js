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
// SeriesAuth - GitHub Gist sync is the normal path.
// Signing in is offered first so progress follows you across
// devices. Skipping it is optional: "Continue without signing in"
// keeps progress in this browser instead, and that choice is
// remembered so a guest is not asked again on every page.
// Creds are stored in localStorage so you only sign in once per
// browser. sessionStorage keys are mirrored for backwards
// compatibility with older pages.
// ============================================================
var SeriesAuth = (function () {
  var STORE_KEY = 'seriesAuth';
  var LOCAL_KEY = 'seriesLocalProgress';
  var GUEST_KEY = 'seriesGuestMode';
  var GIST_FILENAME = 'video_progress.json';
  // Both sites share one gist file, each owning one section of it.
  var SECTION = 'series';
  var LEGACY_KEYS = {
    username: 'githubUsername',
    gistId: 'githubGistId',
    token: 'githubAccessToken'
  };

  // The guest copy of the progress file: same shape as the gist file.
  function readLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch (e) {
      return null;
    }
  }

  function writeLocal(data) {
    try {
      if (data) localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      else localStorage.removeItem(LOCAL_KEY);
    } catch (e) {}
  }

  // Sync needs a gist id and a token; without them progress is browser-only.
  function canSync(creds) {
    return !!(creds && creds.gistId && creds.token);
  }

  // Set once a guest declines sign-in, so the overlay stops asking.
  function isGuestMode() {
    try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { return false; }
  }

  function setGuestMode(on) {
    try {
      if (on) localStorage.setItem(GUEST_KEY, '1');
      else localStorage.removeItem(GUEST_KEY);
    } catch (e) {}
  }

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

  // Resolve the newest progress: the gist when signed in, otherwise the copy
  // this browser keeps. Never fails - cb always gets an object or null.
  // ---- the progress file ---------------------------------------------
  // One position per episode, keyed by absolute URL:
  //   { episodes: { "<href>": { progress, duration, updatedAt } }, last }
  // Files written by earlier versions held a single { progress, url };
  // normalize() upgrades those on read, and mergeProgress() keeps the flat
  // progress/url fields in sync so an older page still understands the file.
  // One key per episode: ?device=tv, #t=30 and friends are display-only and
  // must not fork a second entry for the same page.
  function absolute(url) {
    try {
      var parsed = new URL(url, window.location.href);
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch (e) {
      return url;
    }
  }

  function currentUrl() {
    return absolute(window.location.href);
  }

  function isEpisodePage() {
    return !!document.getElementById('my-video');
  }

  function sectionOf(url) {
    return /\/Movies\//.test(String(url)) ? 'movies' : 'series';
  }

  function inThisSection(url) {
    return sectionOf(url) === SECTION;
  }

  function newestOf(entries) {
    var urls = Object.keys(entries);
    if (!urls.length) return null;
    urls.sort(function (a, b) {
      return (entries[b].updatedAt || 0) - (entries[a].updatedAt || 0);
    });
    return urls[0];
  }

  function coalesce(into, url, entry) {
    if (!entry || typeof entry.progress !== 'number') return;
    var key = absolute(url);
    // Two keys can collapse onto one once the query string is stripped; the
    // newer position is the one worth keeping.
    if (!into[key] || (entry.updatedAt || 0) > (into[key].updatedAt || 0)) into[key] = entry;
  }

  // This site's entries, from the sectioned file, an older `episodes` file or
  // the original single pointer.
  function normalize(data) {
    var entries = {};
    if (!data || typeof data !== 'object') return { episodes: {} };

    var bucket = data[SECTION];
    if (bucket && typeof bucket === 'object') {
      Object.keys(bucket).forEach(function (url) { coalesce(entries, url, bucket[url]); });
      return { episodes: entries, last: newestOf(entries) };
    }

    if (data.episodes && typeof data.episodes === 'object') {
      Object.keys(data.episodes).forEach(function (url) {
        if (inThisSection(url)) coalesce(entries, url, data.episodes[url]);
      });
      return { episodes: entries, last: newestOf(entries) };
    }

    if (typeof data.progress === 'number' && data.url && inThisSection(data.url)) {
      coalesce(entries, data.url, { progress: data.progress, updatedAt: Date.now() });
      return { episodes: entries, last: newestOf(entries) };
    }

    return { episodes: {} };
  }

  // The whole file for the gist: both sections preserved, older flat files folded
  // into them on the way through.
  function buildFile(base, entries) {
    var src = base && typeof base === 'object' ? base : {};
    var file = {};
    Object.keys(src).forEach(function (key) {
      // Only the two sections survive; the old flat fields and loose `last`
      // pointer are folded into them and dropped.
      if (key === 'episodes' || key === 'series' || key === 'movies' ||
          key === 'progress' || key === 'url' || key === 'last') return;
      file[key] = src[key];
    });

    // This site's section is replaced outright by `entries`; the other site's
    // is carried over untouched. Merging here would make a clear a no-op.
    var sections = { series: {}, movies: {} };
    ['series', 'movies'].forEach(function (name) {
      if (name === SECTION) return;
      var bucket = src[name];
      if (bucket && typeof bucket === 'object') {
        Object.keys(bucket).forEach(function (url) { coalesce(sections[name], url, bucket[url]); });
      }
    });
    if (src.episodes && typeof src.episodes === 'object') {
      Object.keys(src.episodes).forEach(function (url) {
        if (sectionOf(url) === SECTION) return;
        coalesce(sections[sectionOf(url)], url, src.episodes[url]);
      });
    }
    Object.keys(entries).forEach(function (url) { coalesce(sections[SECTION], url, entries[url]); });

    file.series = sections.series;
    file.movies = sections.movies;
    return file;
  }

  function progressAt(data, url) {
    var entry = normalize(data).episodes[absolute(url)];
    if (!entry || typeof entry.progress !== 'number') return null;
    return {
      progress: entry.progress,
      duration: typeof entry.duration === 'number' ? entry.duration : null,
      part: typeof entry.part === 'number' ? entry.part : null,
      updatedAt: entry.updatedAt || 0,
      url: absolute(url)
    };
  }

  function recentUrl(store) {
    var urls = Object.keys(store.episodes);
    if (!urls.length) return null;
    urls.sort(function (a, b) {
      return (store.episodes[b].updatedAt || 0) - (store.episodes[a].updatedAt || 0);
    });
    return urls[0];
  }

  // How many episodes keep a position: chosen on the home page, 500 by default.
  // Bounded because the file is a gist, and because nobody resumes their way
  // back through five hundred episodes.
  var LIMIT_KEY = 'seriesProgressLimit';
  var LIMIT_CHOICES = [1, 3, 10, 25, 50, 100, 200, 500];
  var DEFAULT_LIMIT = 500;

  function progressLimit() {
    try {
      var value = parseInt(localStorage.getItem(LIMIT_KEY), 10);
      return value > 0 ? value : DEFAULT_LIMIT;
    } catch (e) {
      return DEFAULT_LIMIT;
    }
  }

  // Which show an episode belongs to: /Series/<name>/... keeps its own history,
  // so a binge on one show cannot push the others out.
  function seriesKey(url) {
    try {
      var parts = new URL(url, window.location.href).pathname.split('/');
      var at = parts.indexOf('Series');
      if (at === -1 || !parts[at + 1]) return '';
      return '/' + parts.slice(0, at + 2).join('/') + '/';
    } catch (e) {
      return '';
    }
  }

  // The limit counts per show, not in total.
  function trim(store) {
    var limit = progressLimit();
    var byShow = {};
    Object.keys(store.episodes).forEach(function (url) {
      var key = seriesKey(url) || url;
      (byShow[key] = byShow[key] || []).push(url);
    });
    Object.keys(byShow).forEach(function (key) {
      var urls = byShow[key];
      if (urls.length <= limit) return;
      urls.sort(function (a, b) {
        return (store.episodes[b].updatedAt || 0) - (store.episodes[a].updatedAt || 0);
      });
      urls.slice(limit).forEach(function (url) { delete store.episodes[url]; });
    });
    if (store.last && !store.episodes[store.last]) store.last = recentUrl(store);
    return store;
  }

  // Change the limit now: trim what is stored and push the result up.
  function setProgressLimit(value) {
    var limit = parseInt(value, 10);
    if (!(limit > 0)) return;
    try { localStorage.setItem(LIMIT_KEY, String(limit)); } catch (e) {}
    // Go through commit so the trim is written as the two-section file and the
    // other site's half survives.
    commit(get(), function (base) { return trim(normalize(base)); });
  }

  function mergeProgress(data, entry) {
    var store = normalize(data);
    var url = absolute(entry && entry.url ? entry.url : currentUrl());
    if (entry && typeof entry.progress === 'number') {
      var previous = store.episodes[url] || {};
      store.episodes[url] = {
        progress: entry.progress,
        duration: typeof entry.duration === 'number' ? entry.duration : (previous.duration || null),
        // Which part of a split title a position belongs to; the movies site
        // uses it, series leave it null. Kept so the field survives a round trip.
        part: typeof entry.part === 'number' ? entry.part : (typeof previous.part === 'number' ? previous.part : null),
        updatedAt: Date.now()
      };
      store.last = url;
    }
    trim(store);
    if (store.last && store.episodes[store.last]) store.progress = store.episodes[store.last].progress;
    store.url = store.last || null;
    return store;
  }

  function clearAt(data, url) {
    var store = normalize(data);
    delete store.episodes[absolute(url)];
    if (store.last === absolute(url)) store.last = recentUrl(store);
    store.progress = store.last ? store.episodes[store.last].progress : 0;
    store.url = store.last || null;
    return store;
  }

  // Where the last read came from: 'gist' when GitHub answered, 'local' when
  // we fell back to this browser. Pages show it so a stale count is visible.
  var lastReadSource = 'local';

  function progressSource() {
    return lastReadSource;
  }

  // Read the whole file: gist when signed in, this browser otherwise.
  function readProgress(creds, cb) {
    var local = readLocal();
    if (!canSync(creds)) {
      lastReadSource = 'local';
      cb(local);
      return;
    }
    var headers = authHeaders(creds);
    headers['Accept'] = 'application/vnd.github+json';
    fetch(gistUrl(creds) + '?t=' + Date.now(), { headers: headers })
      .then(function (r) {
        // A rejected read must reach the catch below, not look like an empty gist.
        if (!r.ok) throw new Error('gist read failed (' + r.status + ')');
        return r.json();
      })
      .then(function (data) {
        var parsed = null;
        if (data && data.files && data.files[GIST_FILENAME]) {
          try { parsed = JSON.parse(data.files[GIST_FILENAME].content); } catch (e) { parsed = null; }
        }
        lastReadSource = 'gist';
        if (parsed && typeof parsed === 'object') {
          writeLocal(parsed);
          cb(parsed);
        } else {
          cb(local);
        }
      })
      .catch(function () {
        // Signed in but GitHub could not be read: say so rather than quietly
        // showing this browser's copy as if it were the account's.
        lastReadSource = 'local';
        reportSyncFailure();
        cb(local);
      });
  }

  // What a page needs: its own position on an episode page, otherwise the
  // place to resume from.
  function fetchProgress(creds, cb) {
    readProgress(creds, function (data) {
      var store = normalize(data);
      if (isEpisodePage()) {
        cb(progressAt(store, currentUrl()) || { progress: 0, url: currentUrl() });
        return;
      }
      if (!store.last) { cb(null); return; }
      cb(progressAt(store, store.last) || null);
    });
  }

  // Every episode with a position, newest first, for the home page.
  function fetchLibrary(creds, cb) {
    readProgress(creds, function (data) {
      var store = normalize(data);
      var items = Object.keys(store.episodes).map(function (url) {
        return {
          url: url,
          progress: store.episodes[url].progress || 0,
          duration: store.episodes[url].duration || null,
          updatedAt: store.episodes[url].updatedAt || 0
        };
      }).filter(function (item) { return item.progress > 0; });
      items.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      cb(items);
    });
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

  // Read video_progress.json from the gist, falling back to this browser's
  // copy. Resolves with the parsed JSON, or null when there is none.
  // The gist file itself: resolves null when the gist has no progress file,
  // rejects when it could not be read at all. Callers that write must not
  // confuse the two, or a failed read overwrites another device's entries.
  function fetchRemoteStore(creds) {
    var headers = authHeaders(creds);
    headers['Accept'] = 'application/vnd.github+json';
    return fetch(gistUrl(creds) + '?t=' + Date.now(), { headers: headers })
      .then(function (r) {
        if (!r.ok) throw new Error('gist read failed (' + r.status + ')');
        return r.json();
      })
      .then(function (data) {
        var file = data && data.files && data.files[GIST_FILENAME];
        if (!file) return null;
        // The gists API returns only the first 1MB of a file, flagged as
        // truncated; the raw URL carries the whole thing.
        if (file.truncated && file.raw_url) {
          return fetch(file.raw_url, { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('gist file read failed (' + r.status + ')');
            return r.text();
          });
        }
        return typeof file.content === 'string' ? file.content : '';
      })
      .then(function (text) {
        if (text === null) return null;
        try {
          return JSON.parse(text);
        } catch (e) {
          // A hand-edited file must not read as "no file", or the next save
          // would overwrite it with this browser's copy.
          throw new Error('progress file is not valid JSON');
        }
      });
  }

  // Readers fall back to this browser's copy when the gist is unreachable.
  function readProgressFile(creds) {
    if (!canSync(creds)) return Promise.resolve(readLocal());
    return fetchRemoteStore(creds)
      .then(function (store) { return store || readLocal(); })
      .catch(function () { return readLocal(); });
  }

  // A file "has progress" when it contains a usable, non-zero position.
  function hasProgress(data) {
    var store = normalize(data);
    if (!store.last) return false;
    var at = store.episodes[store.last];
    return !!(at && at.progress > 0);
  }

  // After a clear: is the page we cleared still holding a position?
  function stillWatched(data) {
    if (!isEpisodePage()) return hasProgress(data);
    var at = progressAt(data, currentUrl());
    return !!(at && at.progress > 0);
  }

  // One pill, shown when a gist write does not land. Silent failures are worse
  // than no sync at all: the position looks saved and is silently local-only.
  var syncBadge = null;
  var syncListeners = [];

  function syncNotice(text) {
    if (!document.body) return;
    if (!syncBadge) {
      syncBadge = document.createElement('div');
      syncBadge.id = 'seriesSyncBadge';
      syncBadge.setAttribute('role', 'status');
      syncBadge.setAttribute('aria-live', 'polite');
      syncBadge.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:20px', 'transform:translateX(-50%)',
        'z-index:99998', 'max-width:min(440px,92vw)', 'box-sizing:border-box',
        'display:flex', 'align-items:center', 'gap:12px',
        'padding:12px 14px', 'border-radius:12px',
        'background:rgba(20,20,20,0.96)', 'border:1px solid rgba(229,9,20,0.55)',
        'box-shadow:0 10px 30px rgba(0,0,0,0.5)', 'color:#e5e5e5',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
        'font-size:13px', 'line-height:1.4'
      ].join(';');
      var label = document.createElement('span');
      label.id = 'seriesSyncText';
      syncBadge.appendChild(label);
      var close = document.createElement('button');
      close.type = 'button';
      close.textContent = '\u00d7';
      close.setAttribute('aria-label', 'Dismiss');
      close.style.cssText = 'flex:0 0 auto;width:26px;height:26px;padding:0;border-radius:50%;background:transparent;border:1px solid rgba(255,255,255,0.25);color:#e5e5e5;font-size:15px;line-height:1;cursor:pointer';
      close.addEventListener('click', hideSyncNotice);
      syncBadge.appendChild(close);
      document.body.appendChild(syncBadge);
    }
    syncBadge.querySelector('#seriesSyncText').textContent = text;
    syncBadge.style.display = 'flex';
  }

  function hideSyncNotice() {
    if (syncBadge) syncBadge.style.display = 'none';
  }

  function reportSyncFailure() {
    syncNotice('Saved in this browser only \u2014 GitHub could not be reached. It will sync on the next save.');
    syncListeners.forEach(function (fn) { try { fn(false); } catch (e) {} });
  }

  function reportSyncOk() {
    hideSyncNotice();
    syncListeners.forEach(function (fn) { try { fn(true); } catch (e) {} });
  }

  function patchProgress(creds, store) {
    var gistData = { files: {} };
    gistData.files[GIST_FILENAME] = { content: JSON.stringify(store, null, 2) };
    return fetch(gistUrl(creds), {
      method: 'PATCH',
      headers: {
        'Authorization': 'token ' + creds.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(gistData)
    }).then(function (r) {
      if (!r.ok) throw new Error('gist write failed (' + r.status + ')');
      return r.json();
    });
  }

  // Read-modify-write against the live file. A device that has been open for a
  // while holds a stale copy, so building the new file from that copy alone
  // would delete whatever another device saved in the meantime.
  function commit(creds, build) {
    var base = readLocal();
    writeLocal(buildFile(base, build(base).episodes));
    if (!canSync(creds)) return writeQueue;
    writeQueue = writeQueue.catch(function () { return null; }).then(function () {
      if (suppressWrites) return null;
      return fetchRemoteStore(creds).then(function (remote) {
        var source = remote || readLocal();
        var file = buildFile(source, build(source).episodes);
        writeLocal(file);
        return patchProgress(creds, file).then(function (d) {
          reportSyncOk();
          return d;
        });      }, function (e) {
        // Unreadable remote: leave it alone rather than overwrite it with this
        // browser's copy. The local one is already saved.
        console.warn('Progress not synced:', e && e.message);
        reportSyncFailure();
        return null;
      });
    });
    // Autosave failures stay out of the way of the next write.
    writeQueue = writeQueue.catch(function (e) {
      console.error('Save error:', e && e.message);
      reportSyncFailure();
      return null;
    });
    return writeQueue;
  }

  function writeProgress(creds, progressData) {
    if (suppressWrites) return writeQueue;
    return commit(creds, function (base) {
      return mergeProgress(base, progressData);
    });
  }

  // Forget everything saved for one show, leaving the others alone.
  function removeSeries(creds, url) {
    var key = seriesKey(url);
    return commit(creds, function (base) {
      var store = normalize(base);
      Object.keys(store.episodes).forEach(function (episode) {
        if (seriesKey(episode) === key) delete store.episodes[episode];
      });
      if (store.last && !store.episodes[store.last]) store.last = recentUrl(store);
      store.progress = store.last ? store.episodes[store.last].progress : 0;
      store.url = store.last || null;
      return store;
    });
  }

  // On a player page this forgets that one episode; anywhere else (the home
  // page's series cards) it clears the whole file, as it always did.
  function clearProgress(creds) {
    var forget = isEpisodePage()
      ? function (base) { return clearAt(base, currentUrl()); }
      : function () { return { episodes: {}, last: null }; };
    var base = readLocal();
    var local = buildFile(base, forget(base).episodes);
    writeLocal(local);
    if (!canSync(creds)) return Promise.resolve(local);

    // Rejections here reach the verification loop, which retries and finally
    // reports failure; the queue itself is reset so later writes still run.
    var done = writeQueue.catch(function () { return null; }).then(function () {
      return fetchRemoteStore(creds).then(function (remote) {
        var source = remote || readLocal();
        var file = buildFile(source, forget(source).episodes);
        writeLocal(file);
        return patchProgress(creds, file).then(function (d) {
          reportSyncOk();
          return d;
        });      });
    });
    done.catch(reportSyncFailure);
    writeQueue = done.catch(function (e) {
      console.error('Clear error:', e && e.message);
      return null;
    });
    return done;
  }

  // PATCH the gist, then re-read it to prove the progress is really gone.
  function clearProgressWithVerification(creds, cb) {
    if (!canSync(creds)) {
      // Nothing remote to verify: dropping this browser's copy is enough.
      writeQueue.then(function () {
        clearProgress(null);
        cb(true);
      });
      return;
    }
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
          if (!stillWatched(data)) {
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

  // How many titles this site is holding a position for.
  function savedCount() {
    return Object.keys(normalize(readLocal()).episodes).length;
  }

  function isSaved(url) {
    return !!normalize(readLocal()).episodes[absolute(url)];
  }

  // Whether anything under a folder has a saved position — i.e. this show has
  // been started, even if the page you clicked is not the saved one.
  function hasSavedUnder(prefix) {
    var key = absolute(prefix);
    return Object.keys(normalize(readLocal()).episodes).some(function (url) {
      return url.indexOf(key) === 0;
    });
  }

  // Asked when someone leaves for another title: keep the saves and add this
  // one, or wipe them and start fresh. cb('keep' | 'clear' | 'cancel').
  function askKeepOrClear(options, cb) {
    if (document.getElementById('seriesSwitchOverlay')) return;
    var opener = document.activeElement;
    var unit = options.unit || 'titles';
    var word = options.count === 1 ? unit.replace(/s$/, '') : unit;

    var overlay = document.createElement('div');
    overlay.id = 'seriesSwitchOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ssTitle');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999', 'padding:16px', 'box-sizing:border-box',
      'background:rgba(0,0,0,0.88)', 'backdrop-filter:blur(10px)', '-webkit-backdrop-filter:blur(10px)',
      'display:flex', 'align-items:center', 'justify-content:center', 'overflow-y:auto',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = 'width:min(430px,92vw);background:#141414;border:1px solid #333;border-radius:16px;padding:32px 28px;box-shadow:0 20px 60px rgba(0,0,0,0.7);color:#e5e5e5;box-sizing:border-box;margin:auto';
    card.innerHTML = [
      '<h2 id="ssTitle" style="margin:0 0 8px;font-size:21px;font-weight:800;color:#fff">Start fresh?</h2>',
      '<p style="margin:0 0 22px;color:#a5a5a5;font-size:14px;line-height:1.45">',
      'You have <strong style="color:#e5e5e5">' + options.count + ' ' + word + '</strong> saved.',
      ' Watching <strong style="color:#e5e5e5">' + String(options.title).replace(/[<>&]/g, '') + '</strong> can keep them',
      ' or clear them first.',
      '</p>'
    ].join('');
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function close(choice) {
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (opener && opener.focus) { try { opener.focus(); } catch (e) {} }
      if (typeof cb === 'function') cb(choice);
    }

    function onKey(event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        close('cancel');
        return;
      }
      if (event.key !== 'Tab') return;
      var items = card.querySelectorAll('button');
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    var keep = document.createElement('button');
    keep.type = 'button';
    keep.textContent = 'Keep them and watch';
    keep.style.cssText = 'display:block;width:100%;padding:13px;border:none;border-radius:8px;background:#e50914;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:10px';
    keep.addEventListener('click', function () { close('keep'); });

    var clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear my saves';
    clear.style.cssText = 'display:block;width:100%;padding:12px;border:1px solid rgba(229,9,20,0.6);border-radius:8px;background:transparent;color:#f2b4b8;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px';
    clear.addEventListener('click', function () { close('clear'); });

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Stay here';
    cancel.style.cssText = 'display:block;width:100%;padding:10px;border:none;border-radius:8px;background:transparent;color:#8f8f8f;font-size:13px;cursor:pointer';
    cancel.addEventListener('click', function () { close('cancel'); });

    card.appendChild(keep);
    card.appendChild(clear);
    card.appendChild(cancel);

    document.addEventListener('keydown', onKey, true);
    keep.focus();
  }

  // Gist sync first: a signed-in viewer goes straight through, a guest is
  // offered sign-in and may skip it. cb(creds) gets null for a guest, whose
  // progress stays in this browser.
  function require(cb) {
    var creds = get();
    if (creds) {
      cb(creds);
      return;
    }
    if (isGuestMode()) {
      cb(null);
      return;
    }
    showOverlay(function (newCreds) {
      setGuestMode(false);
      cb(newCreds);
    }, function () {
      setGuestMode(true);
      cb(null);
    });
  }

  // Ask for credentials even for a guest, for any explicit "sign in" action.
  function requireFresh(cb) {
    showOverlay(function (newCreds) {
      setGuestMode(false);
      cb(newCreds);
    });
  }

  // Sign in from the account button. The gist takes over when it already holds
  // progress; a guest's spot is pushed up only when the gist is still empty.
  function openSignIn(cb) {
    showOverlay(function (newCreds) {
      readProgressFile(newCreds).then(function (remote) {
        if (!hasProgress(remote)) {
          var local = readLocal();
          if (hasProgress(local)) writeProgress(newCreds, local);
        }
        setGuestMode(false);
        mountAccount();
        if (typeof cb === 'function') cb(newCreds);
      });
    });
  }

  function signOut() {
    clear();
    setGuestMode(true);
    window.location.reload();
  }

  function ensureFloatingStyles() {
    if (document.getElementById('signOutStyle')) return;
    var st = document.createElement('style');
    st.id = 'signOutStyle';
    st.textContent = '.sign-out-btn--floating{position:fixed;right:20px;bottom:20px;z-index:9999;margin:0;padding:10px 20px;border-radius:999px;background:rgba(20,20,20,.85);color:#e5e5e5;border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer;font-size:14px}@media(max-width:640px){.sign-out-btn--floating{right:12px;bottom:12px}}';
    document.head.appendChild(st);
  }

  // One account control for both states: guests get "Sign in to sync",
  // signed-in viewers get "Sign out".
  function mountAccount() {
    var existing = document.getElementById('seriesAccountBtn');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var signedIn = !!get();
    var footer = document.querySelector('.player-footer');
    var btn = document.createElement('button');
    btn.id = 'seriesAccountBtn';
    btn.type = 'button';
    btn.textContent = signedIn ? 'Sign out' : 'Sign in to sync';
    btn.className = 'sign-out-btn';
    btn.addEventListener('click', function () {
      if (get()) {
        if (confirm('Sign out on this browser? Progress stays saved in this browser.')) signOut();
      } else {
        openSignIn();
      }
    });
    if (footer) {
      footer.appendChild(btn);
    } else {
      ensureFloatingStyles();
      btn.className += ' sign-out-btn--floating';
      document.body.appendChild(btn);
    }
  }

  var mountSignOut = mountAccount;

  function ensureOverlayStyles() {
    if (document.getElementById('seriesAuthStyle')) return;
    var st = document.createElement('style');
    st.id = 'seriesAuthStyle';
    // !important because this markup carries its colours and spacing inline.
    st.textContent = [
      '#siSubmit:hover{background:#f40612!important}',
      '#siSkip:hover{border-color:#fff!important;color:#fff!important;background:rgba(255,255,255,0.13)!important}',
      '#siImport:hover{color:#fff!important}',
      '#siSkip:focus-visible,#siSubmit:focus-visible,#siImport:focus-visible{outline:2px solid #fff;outline-offset:2px}',
      /* A phone in landscape has ~390px of height; the card is taller than that,
         so the overlay has to scroll instead of clipping the buttons away.
         flex-start + margin:auto centres the card when it fits and starts it at
         the top when it does not, which centring alone cannot do. */
      '#seriesAuthOverlay{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:16px;box-sizing:border-box;align-items:flex-start!important}',
      '#seriesAuthOverlay>div{margin:auto}',
      /* 16px inputs: anything smaller makes iOS Safari zoom into the field. */
      '@media(max-width:640px),(max-height:640px){',
      '  #seriesAuthOverlay>div{padding:24px 20px!important;border-radius:14px!important}',
      '  #siUser,#siGist,#siToken{font-size:16px!important;padding:13px 14px!important;min-height:46px;box-sizing:border-box}',
      '  #siSubmit,#siSkip{padding:13px!important;font-size:15px!important;min-height:46px}',
      '  #siImport{min-height:42px}',
      '  #siSub{font-size:13px!important;margin-bottom:16px!important}',
      '}',
      /* Short screens trade the header for the fields. */
      '@media(max-height:640px){',
      '  #seriesAuthOverlay>div>div:first-child{width:48px!important;height:48px!important;margin-bottom:12px!important}',
      '  #seriesAuthOverlay>div>h2{font-size:22px!important}',
      '  #siSub{display:none}',
      '}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function showOverlay(afterLogin, onSkip) {
    if (document.getElementById('seriesAuthOverlay')) return;
    ensureOverlayStyles();

    var opener = document.activeElement;

    var overlay = document.createElement('div');
    overlay.id = 'seriesAuthOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'siTitle');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,0.88)', 'backdrop-filter:blur(12px)', '-webkit-backdrop-filter:blur(12px)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
    ].join(';');

    overlay.innerHTML = [
      '<div style="width:min(420px,90vw);background:#141414;border:1px solid #333;border-radius:16px;padding:40px 36px;box-shadow:0 20px 60px rgba(0,0,0,0.7);color:#e5e5e5;box-sizing:border-box;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);position:relative;overflow:hidden">',
      '  <div style="width:64px;height:64px;margin:0 auto 18px;border-radius:16px;background:linear-gradient(135deg,#e50914,rgba(229,9,20,0.55));display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(229,9,20,0.4);position:relative;z-index:1">',
      '    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,4 20,12 6,20" fill="#fff" stroke="none"/></svg>',
      '  </div>',
      '  <h2 id="siTitle" style="margin:0 0 6px;font-size:26px;font-weight:900;text-align:center;color:#fff;position:relative;z-index:1">Sign in</h2>',
      '  <p id="siSub" style="margin:0 0 26px;text-align:center;color:#a5a5a5;font-size:14px;position:relative;z-index:1">Sync your watch progress across devices</p>',
      '  <input id="siUser" type="text" placeholder="GitHub username" autocomplete="username" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:12px 14px;background:#0a0a0a;border:1px solid #333;border-radius:6px;color:#e5e5e5;font-size:15px;outline:none" />',
      '  <input id="siGist" type="text" placeholder="Gist ID" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:12px 14px;background:#0a0a0a;border:1px solid #333;border-radius:6px;color:#e5e5e5;font-size:15px;outline:none" />',
      '  <input id="siToken" type="password" placeholder="Personal access token" autocomplete="current-password" style="width:100%;box-sizing:border-box;margin-bottom:16px;padding:12px 14px;background:#0a0a0a;border:1px solid #333;border-radius:6px;color:#e5e5e5;font-size:15px;outline:none" />',
      '  <button id="siSubmit" type="button" style="width:100%;padding:12px;border:none;border-radius:6px;background:#e50914;color:#fff;font-weight:700;font-size:15px;cursor:pointer;position:relative;z-index:1">Sign In</button>',
      '  <div id="siStatus" role="status" aria-live="polite" style="min-height:18px;margin-top:12px;text-align:center;font-size:13px;color:#a5a5a5;position:relative;z-index:1"></div>',
      '  <button id="siSkip" type="button" style="display:block;width:100%;margin-top:4px;padding:12px;border:1px solid rgba(255,255,255,0.32);border-radius:6px;background:rgba(255,255,255,0.07);color:#e5e5e5;font-size:14px;font-weight:600;cursor:pointer;position:relative;z-index:1">Continue as guest</button>',
      '  <p style="margin:8px 0 16px;text-align:center;color:#8f8f8f;font-size:12px;position:relative;z-index:1">No account needed \u00b7 progress stays in this browser</p>',
      '  <button id="siImport" type="button" style="display:block;width:100%;padding:10px;border:none;border-top:1px solid rgba(255,255,255,0.1);border-radius:6px;background:transparent;color:#a5a5a5;font-size:13px;cursor:pointer;text-decoration:underline">Import credentials file (.txt)</button>',
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

    // Escape dismisses; on a forced prompt that is the same choice as the
    // guest button, on an explicit sign-in it simply closes. Tab is kept
    // inside the card while it is open.
    function focusables() {
      return Array.prototype.filter.call(
        overlay.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'),
        function (el) { return el.offsetParent !== null && !el.disabled; }
      );
    }

    function onKeydown(event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        close(typeof onSkip === 'function');
        return;
      }
      if (event.key !== 'Tab') return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (!overlay.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function teardown() {
      document.removeEventListener('keydown', onKeydown, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (opener && typeof opener.focus === 'function') {
        try { opener.focus(); } catch (e) {}
      }
    }

    function close(choseSkip) {
      teardown();
      if (choseSkip && typeof onSkip === 'function') onSkip();
    }

    document.addEventListener('keydown', onKeydown, true);

    function setStatus(text, color) {
      siStatus.textContent = text;
      siStatus.style.color = color || '#a5a5a5';
    }

    function finish(creds) {
      save(creds);
      teardown();
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
    overlay.querySelector('#siSkip').addEventListener('click', function () {
      close(true);
    });
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
    fetchLibrary: fetchLibrary,
    removeSeries: removeSeries,
    writeProgress: writeProgress,
    clearProgress: clearProgress,
    clearProgressWithVerification: clearProgressWithVerification,
    readProgressFile: readProgressFile,
    hasProgress: hasProgress,
    readLocal: readLocal,
    seriesKey: seriesKey,
    savedCount: savedCount,
    progressSource: progressSource,
    isSaved: isSaved,
    hasSavedUnder: hasSavedUnder,
    askKeepOrClear: askKeepOrClear,
    progressLimit: progressLimit,
    limitChoices: LIMIT_CHOICES,
    setProgressLimit: setProgressLimit,
    isSignedIn: function () { return !!get(); },
    onSyncChange: function (fn) {
      if (typeof fn === 'function') syncListeners.push(fn);
    },
    isGuestMode: isGuestMode,
    setGuestMode: setGuestMode,
    setSuppressWrites: function (value) { suppressWrites = !!value; },
    require: require,
    requireFresh: requireFresh,
    openSignIn: openSignIn,
    signOut: signOut,
    mountAccount: mountAccount,
    mountSignOut: mountSignOut
  };
})();

// ============================================================
// Series resume - a series page carries an empty button marked
// [data-series="/Series/<name>/"], and this fills it with the last
// episode watched in that series, or leaves it hidden.
// ============================================================
function labelForEpisode(url) {
  var parts = new URL(url, window.location.href).pathname.split('/');
  var file = parts.pop() || '';
  var season = parts.pop() || '';
  var episode = file.replace(/\.html$/, '');
  if (!/^S\d+$/.test(season) || !/^\d+$/.test(episode)) return decodeURIComponent(file);
  return season + 'E' + (episode.length < 2 ? '0' + episode : episode);
}

function mountSeriesResume() {
  var buttons = document.querySelectorAll('[data-series]');
  if (!buttons.length) return;
  SeriesAuth.fetchLibrary(SeriesAuth.get(), function (items) {
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      // Stored keys are absolute URLs, so the folder prefix has to be too.
      var prefix = new URL(button.getAttribute('data-series'), window.location.href).href;
      var mine = (items || []).filter(function (item) {
        return item.url.indexOf(prefix) === 0;
      });
      if (!mine.length) continue;
      var last = mine[0];
      button.href = last.url;
      button.textContent = '\u25b6 Resume ' + labelForEpisode(last.url);
      button.hidden = false;
    }
  });
}

// ============================================================
// Catalogue navigation - a card for a title that has not been started
// asks whether to keep the saved positions or clear them, wherever the
// card lives (the home grid or a series page's season list).
// ============================================================
function mountSwitchGuard() {
  var cards = document.querySelectorAll('.season-card');
  Array.prototype.forEach.call(cards, function (card) {
    card.addEventListener('click', function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var href = card.getAttribute('href');
      if (!href) return;
      event.preventDefault();

      var match = /\/(Series|Movies)\/([^\/]+)\//.exec(href);
      var folder = match ? '/' + match[1] + '/' + match[2] + '/' : null;
      var unit = match && match[1] === 'Movies' ? 'movies' : 'shows';
      var started = folder ? SeriesAuth.hasSavedUnder(folder) : SeriesAuth.isSaved(href);
      if (started || SeriesAuth.savedCount() === 0) {
        window.location.href = href;
        return;
      }

      var title = match ? decodeURIComponent(match[2]) : card.textContent.trim();
      SeriesAuth.askKeepOrClear({ title: title, count: SeriesAuth.savedCount(), unit: unit }, function (choice) {
        if (choice === 'cancel') return;
        if (choice === 'keep') { window.location.href = href; return; }
        clearGistProgress(function (ok) {
          if (ok) window.location.href = href;
        });
      });
    });
  });
}

// ============================================================
// Viewport fit - the player.css 16:9 box is capped against the
// space below it, and that space differs per device (a TV footer
// is taller, a narrow laptop wraps it onto two rows). Measure the
// real footer/hint instead of guessing a reserve.
// ============================================================
function measurePlayerChrome() {
  var container = document.querySelector('.video-container');
  if (!container) return null;
  var cs = window.getComputedStyle(container);
  var total = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  var below = container.querySelectorAll('.player-footer, .episode-strip, .hint');
  for (var i = 0; i < below.length; i++) {
    var style = window.getComputedStyle(below[i]);
    total += below[i].offsetHeight + (parseFloat(style.marginTop) || 0);
  }
  return total;
}

function setPlayerChrome(px) {
  document.documentElement.style.setProperty('--player-chrome', Math.ceil(px) + 'px');
}

function fitPlayerToViewport() {
  if (measurePlayerChrome() === null) return;

  // Measure with the cap lifted: a reserve left over from portrait would
  // squeeze the very layout being measured, and each pass would shrink it
  // further. With no reserve the container shows its natural width.
  setPlayerChrome(0);
  var reserve = measurePlayerChrome();
  setPlayerChrome(reserve + 12);

  // The cap can narrow the footer enough to add a row, so refine once at the
  // width it actually settles at. Two passes converge; a third would chase it.
  var constrained = measurePlayerChrome();
  if (constrained > reserve) setPlayerChrome(constrained + 12);
}

var fitQueued = false;
function queuePlayerFit() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(function () {
    fitQueued = false;
    fitPlayerToViewport();
  });
}

// Clear progress in the Gist and confirm it is gone before calling back.
// cb(true) when the gist really has no progress, cb(false) otherwise.
function clearGistProgress(cb) {
  var creds = SeriesAuth.get();
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
  // Account control: sign-in for guests, sign-out when syncing is on.
  SeriesAuth.mountAccount();

  // Any catalogue card is a navigation worth asking about.
  mountSwitchGuard();

  // Series pages: point at the episode last watched in that series.
  mountSeriesResume();

  // Size the player to this device's viewport, now that the footer is final.
  fitPlayerToViewport();
  window.addEventListener('resize', queuePlayerFit);
  window.addEventListener('orientationchange', queuePlayerFit);
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (evt) {
    document.addEventListener(evt, queuePlayerFit, false);
  });
});