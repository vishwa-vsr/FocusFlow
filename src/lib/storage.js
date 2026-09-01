// FocusFlow shared storage + date helpers — single source of truth.
// Loaded via importScripts() in the service worker AND via <script src> in pages.
// Exposes: gSync, sSync, gLocal, sLocal, todayKey on globalThis.
(function (root) {
  // Polyfill chrome.storage for environment safety (file://, local testing, or unsupported browsers)
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
    const memoryStore = {};
    root.chrome = root.chrome || {};
    root.chrome.storage = root.chrome.storage || {};
    root.chrome.storage.sync = {
      get: (keys, cb) => {
        let res = {};
        if (!keys) res = { ...memoryStore };
        else if (typeof keys === "string") res[keys] = memoryStore[keys];
        else if (Array.isArray(keys)) keys.forEach(k => res[k] = memoryStore[k]);
        else if (typeof keys === "object") {
          Object.keys(keys).forEach(k => res[k] = memoryStore[k] !== undefined ? memoryStore[k] : keys[k]);
        }
        if (cb) setTimeout(() => cb(res), 0);
        return Promise.resolve(res);
      },
      set: (obj, cb) => {
        if (obj && typeof obj === "object") Object.assign(memoryStore, obj);
        if (cb) setTimeout(() => cb(), 0);
        return Promise.resolve();
      }
    };
    root.chrome.storage.local = root.chrome.storage.sync;
    root.chrome.storage.onChanged = { addListener: () => {}, removeListener: () => {} };
  }

  // Polyfill chrome.storage.session with chrome.storage.local if session storage is unsupported (like in Firefox)
  if (typeof chrome !== "undefined" && chrome.storage && !chrome.storage.session) {
    chrome.storage.session = chrome.storage.local;
  }

  function _logErr(label) {
    try {
      const err = chrome.runtime.lastError;
      if (err) console.warn("[FF storage]", label, err.message);
    } catch (_) {}
  }

  // FF v6.18: Smart Memory Cache to prevent 48x redundant disk reads of sync settings
  let _syncCache = null;
  let _syncCachePromise = null;
  const _cachedSyncKeys = new Set();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && (changes.settings || changes.focusPresets || changes.customCategories)) {
        _syncCache = null;
        _cachedSyncKeys.clear();
      }
    });
  } catch (_) {}

  root.gSync = function (keys) {
    if (_syncCache) {
      if (!keys) return Promise.resolve(_syncCache);
      const resObj = {};
      const keysArr = Array.isArray(keys) ? keys : [keys];
      let hit = true;
      keysArr.forEach(k => {
        if (!_cachedSyncKeys.has(k)) hit = false;
        else if (_syncCache[k] !== undefined) resObj[k] = _syncCache[k];
      });
      if (hit) return Promise.resolve(resObj);
    }

    if (_syncCachePromise) {
      return _syncCachePromise.then(() => {
        if (_syncCache) {
          if (!keys) return _syncCache;
          const resObj = {};
          const keysArr = Array.isArray(keys) ? keys : [keys];
          let hit = true;
          keysArr.forEach(k => {
            if (!_cachedSyncKeys.has(k)) hit = false;
            else if (_syncCache[k] !== undefined) resObj[k] = _syncCache[k];
          });
          if (hit) return resObj;
        }
        return root.gSync(keys);
      });
    }

    const p = new Promise((res) => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get(keys, (r) => {
            _logErr("gSync");
            const data = r || {};
            if (data.settings !== undefined) {
              let s = data.settings;
              if (typeof s !== "object" || s === null || Array.isArray(s)) s = {};
              s.idleTimeout = typeof s.idleTimeout === "number" ? s.idleTimeout : 30;
              s.passcodeEnabled = typeof s.passcodeEnabled === "boolean" ? s.passcodeEnabled : false;
              s.passcodeHash = typeof s.passcodeHash === "string" ? s.passcodeHash : "";
              s.freeTimeHours = Array.isArray(s.freeTimeHours) ? s.freeTimeHours : [];
              s.timeWarningEnabled = typeof s.timeWarningEnabled === "boolean" ? s.timeWarningEnabled : true;
              s.timeWarningSecs = typeof s.timeWarningSecs === "number" ? s.timeWarningSecs : 60;
              s.maxGapSecs = typeof s.maxGapSecs === "number" ? s.maxGapSecs : 300;
              s.trackMedia = typeof s.trackMedia === "boolean" ? s.trackMedia : true;
              s.minVisitSecs = typeof s.minVisitSecs === "number" ? s.minVisitSecs : 0;
              s.trackLocalFiles = typeof s.trackLocalFiles === "boolean" ? s.trackLocalFiles : false;
              s.dayRolloverHour = typeof s.dayRolloverHour === "number" ? s.dayRolloverHour : 0;
              s.dataRetentionDays = typeof s.dataRetentionDays === "number" ? s.dataRetentionDays : 365;
              s.autoBackupEnabled = typeof s.autoBackupEnabled === "boolean" ? s.autoBackupEnabled : false;
              s.showIdleBadge = typeof s.showIdleBadge === "boolean" ? s.showIdleBadge : false;
              s.lockPrivacy = typeof s.lockPrivacy === "boolean" ? s.lockPrivacy : true;
              s.lockAdjustTime = typeof s.lockAdjustTime === "boolean" ? s.lockAdjustTime : true;
              const lockFlags = ["lockDash", "lockSettings", "lockStop", "lockRules", "lockFreetime", "lockDanger", "lockTweaks", "lockFocusScheds", "lockFocusPresets", "lockPrivacy", "lockAdjustTime"];
              lockFlags.forEach(f => { s[f] = typeof s[f] === "boolean" ? s[f] : (f !== "lockDash" && f !== "lockSettings"); });
              data.settings = s;
            }
            _syncCache = { ...(_syncCache || {}), ...data };
            if (keys) {
              const keysArr = Array.isArray(keys) ? keys : [keys];
              keysArr.forEach(k => _cachedSyncKeys.add(k));
            } else {
              Object.keys(data).forEach(k => _cachedSyncKeys.add(k));
            }
            res(data);
          });
        } else {
          res({});
        }
      } catch (e) {
        res({});
      }
    });

    _syncCachePromise = p;
    p.finally(() => { _syncCachePromise = null; });
    return p;
  };

  root.sSync = function (obj) {
    if (obj && (obj.settings !== undefined || obj.focusPresets !== undefined)) {
      _syncCache = null;
      _cachedSyncKeys.clear();
    }
    return new Promise((res) => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.set(obj, (r) => {
            _logErr("sSync");
            res(r || {});
          });
        } else {
          res({});
        }
      } catch (e) {
        res({});
      }
    });
  };
  root.gLocal = function (keys) {
    return new Promise((res) =>
      chrome.storage.local.get(keys, (r) => {
        _logErr("gLocal");
        const data = r || {};
        
        // Data Guard: Sanitize cooldownConfig shape and types
        if (data.cooldownConfig !== undefined) {
          let cc = data.cooldownConfig;
          if (typeof cc !== "object" || cc === null || Array.isArray(cc)) {
            cc = {};
          }
          cc.domains = Array.isArray(cc.domains) ? cc.domains : [];
          cc.settings = (typeof cc.settings === "object" && cc.settings !== null && !Array.isArray(cc.settings)) ? cc.settings : {};
          for (const key of Object.keys(cc.settings)) {
            if (cc.settings[key] && typeof cc.settings[key] === "object") {
              let freq = cc.settings[key].frequency;
              if (freq === "always") {
                cc.settings[key].frequency = "everyVisit";
              } else if (freq === "daily") {
                cc.settings[key].frequency = "oncePerDay";
              } else if (freq === "session") {
                cc.settings[key].frequency = "every10min";
              }
              if (root.COOLDOWN_FREQS && !root.COOLDOWN_FREQS.includes(cc.settings[key].frequency)) {
                cc.settings[key].frequency = "every10min";
              }
            }
          }
          cc.reasons = (typeof cc.reasons === "object" && cc.reasons !== null && !Array.isArray(cc.reasons)) ? cc.reasons : {};
          data.cooldownConfig = cc;
        }
        if (data.privacyModeActive === undefined) data.privacyModeActive = false;
        if (data.privacyModeUntil === undefined) data.privacyModeUntil = 0;
        if (data.lastBackupAt === undefined) data.lastBackupAt = 0;
        if (data.blockPresets === undefined) {
          data.blockPresets = [];
        }
        if (data.sessionLimitsState === undefined) data.sessionLimitsState = {};
        res(data);
      })
    );
  };
  root.sLocal = function (obj) {
    return new Promise((res) =>
      chrome.storage.local.set(obj, (r) => {
        _logErr("sLocal");
        res(r);
      })
    );
  };

  // FF v6.6: session storage helpers — data cleared automatically when browser closes.
  // Use for transient runtime state (activeSession, wentIdleAt, lastMediaPing).
  root.gSession = function (keys) {
    return new Promise((res) =>
      chrome.storage.session.get(keys, (r) => {
        _logErr("gSession");
        res(r || {});
      })
    );
  };
  root.sSession = function (obj) {
    return new Promise((res) =>
      chrome.storage.session.set(obj, (r) => {
        _logErr("sSession");
        res(r);
      })
    );
  };

  root.todayKey = function (rolloverHour) {
    if (typeof rolloverHour !== "number") {
      rolloverHour = 0;
      if (_syncCache && _syncCache.settings && typeof _syncCache.settings.dayRolloverHour === "number") {
        rolloverHour = _syncCache.settings.dayRolloverHour;
      }
    }
    const d = new Date();
    if (rolloverHour > 0 && rolloverHour <= 23) {
      d.setHours(d.getHours() - rolloverHour);
    }
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  };
})(typeof self !== "undefined" ? self : this);
