// FocusFlow IndexedDB layer (Raw IndexedDB). Replaces the ever-growing chrome.storage.local "daily" blob.
// Schema:
//   daily_logs:      key=day, full granular entry { sites, timeline, productivity, ... }
//   monthly_rollups: key=month, compressed summary  { days, sites, productivity, ... }
//   meta:            key=key, value=any (migration flags, etc.)
//
// API mirrors the old shape so callers don't care about the backing store:
//   await FFDB.getDay("2025-04-21")               -> entry|null
//   await FFDB.getDays(["2025-04-20","2025-04-21"]) -> { "2025-04-20": entry|null, ... }
//   await FFDB.getAllDays()                       -> { "YYYY-MM-DD": entry, ... }
//   await FFDB.setDay(key, entry)
//   await FFDB.bulkSetDays({key: entry, ...})
//   await FFDB.getRollups() / setRollups(map)
//   await FFDB.deleteDay(key)
//   await FFDB.ensureMigrated()  // one-time: copies chrome.storage.local.daily into IDB
//
// Loaded via importScripts in the service worker AND via <script> tag in pages.

(function (root) {
  let dbPromise = null;
  let _isMigratedInMemory = false;

  function getDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("FocusFlowDB", 21);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("daily_logs")) {
          db.createObjectStore("daily_logs", { keyPath: "day" });
        }
        if (!db.objectStoreNames.contains("monthly_rollups")) {
          db.createObjectStore("monthly_rollups", { keyPath: "month" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = (e) => {
        dbPromise = null;
        reject(e.target.error);
      };
    });
    return dbPromise;
  }

  async function getStore(storeName, mode) {
    const db = await getDB();
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  const FFDB = {
    _migrating: null,

    async getDay(day) {
      const store = await getStore("daily_logs", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.get(day);
        req.onsuccess = () => {
          let res = req.result ? req.result.entry : null;
          if (res) {
            // Data Guard: Sanitize entry shape and types
            if (typeof res !== "object" || Array.isArray(res) || res === null) {
              res = { sites: {}, timeline: [] };
            } else {
              res.sites = (typeof res.sites === "object" && res.sites !== null && !Array.isArray(res.sites)) ? res.sites : {};
              res.timeline = Array.isArray(res.timeline) ? res.timeline : [];
            }
          }
          resolve(res);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async getDays(days) {
      if (!days || !days.length) return {};
      const db = await getDB();
      const tx = db.transaction("daily_logs", "readonly");
      const store = tx.objectStore("daily_logs");
      const promises = days.map(d => new Promise((resolve) => {
        const req = store.get(d);
        req.onsuccess = () => {
          let res = req.result ? req.result.entry : null;
          if (res) {
            // Data Guard: Sanitize entry shape and types
            if (typeof res !== "object" || Array.isArray(res) || res === null) {
              res = { sites: {}, timeline: [] };
            } else {
              res.sites = (typeof res.sites === "object" && res.sites !== null && !Array.isArray(res.sites)) ? res.sites : {};
              res.timeline = Array.isArray(res.timeline) ? res.timeline : [];
            }
          }
          resolve({ day: d, entry: res });
        };
        req.onerror = () => resolve({ day: d, entry: null });
      }));
      const results = await Promise.all(promises);
      const out = {};
      for (const r of results) {
        out[r.day] = r.entry;
      }
      return out;
    },

    async getAllDays() {
      const store = await getStore("daily_logs", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const out = {};
          for (const r of req.result || []) {
            let res = r.entry;
            if (res) {
              // Data Guard: Sanitize entry shape and types
              if (typeof res !== "object" || Array.isArray(res) || res === null) {
                res = { sites: {}, timeline: [] };
              } else {
                res.sites = (typeof res.sites === "object" && res.sites !== null && !Array.isArray(res.sites)) ? res.sites : {};
                res.timeline = Array.isArray(res.timeline) ? res.timeline : [];
              }
            }
            out[r.day] = res;
          }
          resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async getDayKeys() {
      const store = await getStore("daily_logs", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    async setDay(day, entry) {
      if (!entry) {
        return FFDB.deleteDay(day);
      }
      const store = await getStore("daily_logs", "readwrite");
      return new Promise((resolve, reject) => {
        const req = store.put({ day, entry });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async bulkSetDays(map) {
      const keys = Object.keys(map);
      if (!keys.length) return;
      const db = await getDB();
      const tx = db.transaction("daily_logs", "readwrite");
      const store = tx.objectStore("daily_logs");
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        for (const day of keys) {
          store.put({ day, entry: map[day] });
        }
      });
    },

    async deleteDay(day) {
      const store = await getStore("daily_logs", "readwrite");
      return new Promise((resolve, reject) => {
        const req = store.delete(day);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async clearDays() {
      const store = await getStore("daily_logs", "readwrite");
      return new Promise((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async getRollups() {
      const store = await getStore("monthly_rollups", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const out = {};
          for (const r of req.result || []) {
            out[r.month] = r.data;
          }
          resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async setRollups(map) {
      const db = await getDB();
      const tx = db.transaction("monthly_rollups", "readwrite");
      const store = tx.objectStore("monthly_rollups");
      return new Promise((resolve, reject) => {
        const req = store.getAllKeys();
        req.onsuccess = () => {
          const existing = req.result || [];
          const incoming = new Set(Object.keys(map));
          for (const k of existing) {
            if (!incoming.has(k)) {
              store.delete(k);
            }
          }
          for (const [month, data] of Object.entries(map)) {
            store.put({ month, data });
          }
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async getMeta(key, fallback = null) {
      const store = await getStore("meta", "readonly");
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
        req.onerror = () => reject(req.error);
      });
    },

    async setMeta(key, value) {
      const store = await getStore("meta", "readwrite");
      return new Promise((resolve, reject) => {
        const req = store.put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async deleteMeta(key) {
      const store = await getStore("meta", "readwrite");
      return new Promise((resolve, reject) => {
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async getLocalBackupsList() {
      return await FFDB.getMeta("backup_list", []);
    },

    async saveLocalBackup(id, label, payload) {
      const list = await FFDB.getLocalBackupsList();
      const sizeBytes = JSON.stringify(payload).length;
      const filtered = list.filter(item => item.id !== id);
      filtered.push({
        id,
        timestamp: Date.now(),
        label: label || "Manual Backup",
        size: sizeBytes
      });
      await FFDB.setMeta("backup_list", filtered);
      await FFDB.setMeta("backup_data_" + id, payload);
    },

    async deleteLocalBackup(id) {
      const list = await FFDB.getLocalBackupsList();
      const filtered = list.filter(item => item.id !== id);
      await FFDB.setMeta("backup_list", filtered);
      await FFDB.deleteMeta("backup_data_" + id);
    },

    async getLocalBackupData(id) {
      return await FFDB.getMeta("backup_data_" + id, null);
    },

    async optimizeTimelines() {
      try {
        const allDays = await FFDB.getAllDays();
        const updatedDays = {};
        let migratedCount = 0;
        for (const [dayKey, entry] of Object.entries(allDays)) {
          if (entry && Array.isArray(entry.timeline) && entry.timeline.length > 0) {
            const [y, m, d] = dayKey.split("-").map(Number);
            const midnightMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
            let isDirty = false;
            const newTimeline = entry.timeline.map(session => {
              if (typeof session.start === "number" && session.start >= 86400) {
                // Old format millisecond timestamp
                isDirty = true;
                const sSecs = Math.max(0, Math.round((session.start - midnightMs) / 1000));
                const eTime = session.end || session.start;
                const dSecs = Math.max(0, Math.round((eTime - session.start) / 1000));
                return { start: sSecs, dur: dSecs, cat: session.cat };
              }
              return session;
            });
            if (isDirty) {
              entry.timeline = newTimeline;
              updatedDays[dayKey] = entry;
              migratedCount++;
            }
          }
        }
        if (migratedCount > 0) {
          await FFDB.bulkSetDays(updatedDays);
          console.log(`[FFDB] optimized ${migratedCount} daily timelines.`);
        }
      } catch (err) {
        console.warn("[FFDB] failed timeline optimization:", err);
      }
    },

    async ensureMigrated() {
      if (_isMigratedInMemory) return;
      if (FFDB._migrating) return FFDB._migrating;
      FFDB._migrating = (async () => {
        const done = await FFDB.getMeta("migrated_v1", false);
        if (done) {
          await FFDB.optimizeTimelines();
          _isMigratedInMemory = true;
          return;
        }
        const data = await new Promise((res) =>
          chrome.storage.local.get(["daily", "monthly_rollups"], (r) => res(r || {}))
        );
        const daily = data.daily || {};
        const rollups = data.monthly_rollups || {};
        const dayCount = Object.keys(daily).length;
        const rollupCount = Object.keys(rollups).length;
        if (dayCount) await FFDB.bulkSetDays(daily);
        if (rollupCount) await FFDB.setRollups(rollups);
        await FFDB.setMeta("migrated_v1", { at: Date.now(), days: dayCount, rollups: rollupCount });
        console.log(`[FFDB] migrated ${dayCount} days + ${rollupCount} rollups to IndexedDB`);
        try {
          await new Promise((resolve) => {
            chrome.storage.local.remove(["daily", "monthly_rollups"], resolve);
          });
        } catch (_) {}
        await FFDB.optimizeTimelines();
        _isMigratedInMemory = true;
      })();
      try {
        await FFDB._migrating;
      } finally {
        FFDB._migrating = null;
      }
    }
  };

  root.FFDB = FFDB;
})(typeof self !== "undefined" ? self : this);
