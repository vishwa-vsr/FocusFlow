// FF v4.2: shared constants + Custom/IDB storage layer.
// AUTO_CATEGORIES, CSS_MAP, CAT_COLORS, CAT_LABELS, DEFAULT_CATS, FALLBACK_ICON now live in lib/constants.js
// FFDB replaces the chrome.storage.local "daily" blob — see lib/db.js.
if (typeof importScripts !== "undefined") {
    try {
        importScripts(
            "../lib/constants.js",
            "../lib/storage.js",
            "../lib/db.js"
        );
    } catch (e) {
        console.error("[FF] importScripts failed", e);
    }
}
const BLOCKED_PAGE = "/blocked/index.html";
const SSO_EXCLUSIONS = [
    "accounts.google.com",
    "accounts.youtube.com",
    "login.live.com",
    "login.microsoftonline.com",
    "appleid.apple.com"
];

function safeBtoa(str) {
    try {
        return btoa(str);
    } catch (e) {
        return str;
    }
}

function safeAtob(str) {
    try {
        return atob(str);
    } catch (e) {
        return str;
    }
}

let focusState = {
    active: !1,
    phase: "work",
    fullDuration: 1500,
    remaining: 1500,
    paused: !1,
    cyclesCompleted: 0,
    startedAt: null,
    phaseEndsAt: null,
    durationMins: 0
};
let _injectedCSSTabs = {};
// Bug #7 fix: in-memory streak cache with 1-hour TTL (invalidated on scrub/import)
let _streakCache = null; // { data: {currentStreak, bestStreak, bestDay}, ts: number }
let _streakCacheDay = ""; // FF v6.18: track which day the cache was built for (clears at midnight)

// Memory Cache for today's stats to eliminate IndexedDB database reads on every tick/tab switch
let _todayDataCache = null;
let _todayDataCacheKey = "";

// Bug fix #3: in-memory cache for all-time totals (invalidated on every flush, reset, or import)
// Prevents STATS_GET_ALLTIME_TOTALS from scanning every IDB day on every popup open.
let _allTimeTotalsCache = null;  // { totals: {domain: secs}, ts: number }
const _ATT_CACHE_TTL_MS = 300000; // 5 minutes — refreshed automatically on any flush

async function getTodayData() {
    const today = todayKey();
    if (_todayDataCache && _todayDataCacheKey === today) {
        return _todayDataCache;
    }
    await FFDB.ensureMigrated();
    _todayDataCache = await FFDB.getDay(today) || { sites: {}, timeline: [] };
    _todayDataCacheKey = today;
    return _todayDataCache;
}

// Database Bloat Fix: Pre-aggregated all-time totals cached in meta store
async function getAllTimeTotals() {
    let totals = await FFDB.getMeta("all_time_totals", null);
    if (totals === null) {
        // Calculate by scanning all days (once-off)
        const all = await FFDB.getAllDays();
        totals = {};
        for (const entry of Object.values(all)) {
            if (!entry || !entry.sites) continue;
            for (const [domain, secs] of Object.entries(entry.sites)) {
                totals[domain] = (totals[domain] || 0) + (secs | 0);
            }
        }
        await FFDB.setMeta("all_time_totals", totals);
    }
    return totals;
}

async function saveAllTimeTotals(totals) {
    await FFDB.setMeta("all_time_totals", totals);
    _allTimeTotalsCache = { totals, ts: Date.now() };
}

// gSync / sSync / gLocal / sLocal / todayKey now come from src/lib/storage.js

function domain(t) {
    try {
        const e = new URL(t);
        // FF v6.7: track local PDF/HTML files opened in the browser
        if (e.protocol === "file:") {
            const cache = typeof getSyncCache === "function" ? getSyncCache() : null;
            const trackLocal = (cache && cache.settings) ? cache.settings.trackLocalFiles : false;
            if (!trackLocal) return null;

            const fname = decodeURIComponent(e.pathname.split("/").pop() || "local-file");
            const sanitized = fname.replace(/[<>"'&`\/\\#?%]/g, "_");
            return ("local:" + sanitized).slice(0, 80).toLowerCase();
        }
        return ["http:", "https:"].includes(e.protocol) ? e.hostname.replace(/^www\./, "") : null
    } catch {
        return null
    }
}

function capElapsed(secs) {
    const cache = typeof getSyncCache === "function" ? getSyncCache() : null;
    const maxGap = (cache && cache.settings && typeof cache.settings.maxGapSecs === "number") ? cache.settings.maxGapSecs : 300;
    return secs < maxGap ? secs : 0;
}

let isSessionUpdating = false;
const sessionUpdateQueue = [];

async function safeUpdateSession(fn) {
    return new Promise((resolve, reject) => {
        sessionUpdateQueue.push({ fn, resolve, reject });
        processSessionQueue();
    });
}

async function processSessionQueue() {
    if (isSessionUpdating) return;
    isSessionUpdating = true;
    try {
        while (sessionUpdateQueue.length > 0) {
            const { fn, resolve, reject } = sessionUpdateQueue.shift();
            try {
                const res = await fn();
                resolve(res);
            } catch (err) {
                reject(err);
            }
        }
    } finally {
        isSessionUpdating = false;
    }
}

async function saveFavicon(dom, favIconUrl) {
    if (!dom || !favIconUrl) return;
    if (favIconUrl.startsWith("chrome://") || favIconUrl.startsWith("about:") || favIconUrl.startsWith("chrome-extension://") || favIconUrl.startsWith("moz-extension://")) return;
    try {
        const data = await gLocal(["favicons"]);
        const favicons = data.favicons || {};
        if (favicons[dom] === favIconUrl) return;
        favicons[dom] = favIconUrl;
        await sLocal({ favicons });
    } catch (_) {}
}

let flushQueue = [],
    isFlushing = !1,
    warnedSitesMemory = {},
    lastWarnDate = "",
    _activeRedirects = {};


// Bug#3 fix: persist flushQueue to session storage
async function persistFlushQueue() {
    try { await chrome.storage.session.set({ _ffFlushQueue: JSON.stringify(flushQueue) }); } catch (_) { }
}
async function restoreFlushQueue() {
    try {
        const r = await chrome.storage.session.get(["_ffFlushQueue"]);
        if (r._ffFlushQueue) {
            const q = JSON.parse(r._ffFlushQueue);
            if (Array.isArray(q) && q.length) flushQueue = q.concat(flushQueue);
            await chrome.storage.session.remove(["_ffFlushQueue"]);
        }
    } catch (_) { }
}

// FF v6.16 perf: in-memory cache of the storage values that updateDNRRules() and
// categorize() read on every tab switch. Invalidated by chrome.storage.onChanged
// for the relevant keys, with a safety TTL of 5s in case a write slips by.
const _storCache = {
    local: { data: null, ts: 0 },
};
const _CACHE_TTL_MS = 3600000; // 1 hour (invalidated instantly on storage change)
const _LOCAL_CACHE_KEYS = ["blockRules", "allowList", "siteCategories", "granularRules", "hiddenDefaultSites", "neverTrackDomains", "privacyModeActive", "privacyModeUntil", "lastBackupAt"];
const _SYNC_CACHE_KEYS = ["settings"];

async function getCachedLocal() {
    const now = Date.now();
    if (_storCache.local.data && (now - _storCache.local.ts) < _CACHE_TTL_MS) {
        return _storCache.local.data;
    }
    const data = await gLocal(_LOCAL_CACHE_KEYS);
    _storCache.local = { data, ts: now };
    return data;
}
async function getCachedSync() {
    return gSync(_SYNC_CACHE_KEYS);
}
try {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && _LOCAL_CACHE_KEYS.some(k => k in changes)) {
            _storCache.local = { data: null, ts: 0 };
        }
    });
} catch (_) { }
// Visited sites are computed dynamically from IndexedDB log keys now

async function getAllCats() {
    return DEFAULT_CATS;
}

async function safeFlush(t, e, a = Date.now() - 1e3 * e) {
    if (e <= 0 || !t) return;
    flushQueue.push({ domainStr: t, elapsedSecs: e, startTimeMs: a });
    persistFlushQueue();
    if (isFlushing) return;
    isFlushing = true;
    try {
        await FFDB.ensureMigrated();
        while (flushQueue.length > 0) {
            const { domainStr, elapsedSecs, startTimeMs } = flushQueue.shift();
            const start = new Date(startTimeMs);
            const end = new Date(startTimeMs + 1e3 * elapsedSecs);
            const cat = await categorize(domainStr);
            const dirtyDays = new Set();
            // Pre-load both possible day rows (covers midnight crossover)
            const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
            const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
            const cache = await FFDB.getDays([startKey, endKey]);
            const apply = (key, secs, sMs, eMs) => {
                if (!cache[key]) cache[key] = { sites: {}, timeline: [] };
                const entry = cache[key];
                if (!entry.sites) entry.sites = {};
                if (!entry.timeline) entry.timeline = [];
                entry.sites[domainStr] = (entry.sites[domainStr] || 0) + secs;
                
                const [y, m, d] = key.split("-").map(Number);
                const midnightMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
                
                const startSecs = Math.round((sMs - midnightMs) / 1000);
                const durSecs = Math.round((eMs - sMs) / 1000);
                
                // Merge into the last block if it belongs to the same category and is within 30 seconds of the last block's end.
                if (entry.timeline.length > 0) {
                    const last = entry.timeline[entry.timeline.length - 1];
                    const lastStartMs = typeof last.start === "number" && last.start < 86400 ? (midnightMs + last.start * 1000) : last.start;
                    const lastEndMs = typeof last.end === "number" ? last.end : (typeof last.dur === "number" ? (lastStartMs + last.dur * 1000) : lastStartMs);
                    
                    if (last.cat === cat && sMs - lastEndMs <= 30000) {
                        const mergedEndMs = Math.max(lastEndMs, eMs);
                        const newDur = Math.round((mergedEndMs - lastStartMs) / 1000);
                        if (typeof last.dur === "number" || typeof last.start === "number") {
                            last.start = Math.round((lastStartMs - midnightMs) / 1000);
                            last.dur = newDur;
                            delete last.end;
                        } else {
                            last.end = mergedEndMs;
                        }
                    } else {
                        entry.timeline.push({ start: startSecs, dur: durSecs, cat });
                    }
                } else {
                    entry.timeline.push({ start: startSecs, dur: durSecs, cat });
                }
                dirtyDays.add(key);
            };
            if (start.toDateString() === end.toDateString()) {
                apply(startKey, elapsedSecs, start.getTime(), end.getTime());
            } else {
                const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
                const beforeSecs = Math.floor((midnight - startTimeMs) / 1e3);
                const afterSecs = elapsedSecs - beforeSecs;
                if (beforeSecs > 0) apply(startKey, beforeSecs, start.getTime(), midnight);
                if (afterSecs > 0) apply(endKey, afterSecs, midnight, end.getTime());
            }
            const writeMap = {};
            for (const k of dirtyDays) {
                writeMap[k] = cache[k];
                if (k === todayKey()) {
                    _todayDataCache = cache[k];
                    _todayDataCacheKey = k;
                }
            }
            await FFDB.bulkSetDays(writeMap);
            // Update all-time totals incrementally
            try {
                const totals = await getAllTimeTotals();
                totals[domainStr] = (totals[domainStr] || 0) + elapsedSecs;
                await saveAllTimeTotals(totals);
            } catch (err) {
                console.warn("[FF] Failed to update all-time totals:", err);
            }

            // Session Limit Check
            try {
              const localData = await getCachedLocal();
              const blockRules = localData.blockRules || [];
              const rule = blockRules.find(r => r.domain && r.sessionLimitEnabled && (domainStr === r.domain || domainStr.endsWith("." + r.domain)));
              if (rule) {
                const sessionLimitsState = (await gSession(["sessionLimitsState"])).sessionLimitsState || {};
                const state = sessionLimitsState[rule.domain] || { spentSecs: 0, lastActiveAt: 0, cooldownActiveUntil: 0 };
                const now = Date.now();
                
                // If away for more than 60 seconds, reset session spent time
                if (now - state.lastActiveAt > 60 * 1000) {
                  state.spentSecs = 0;
                }
                
                state.spentSecs += elapsedSecs;
                state.lastActiveAt = now;
                
                if (state.spentSecs >= rule.sessionLimitSecs && (!state.cooldownActiveUntil || now >= state.cooldownActiveUntil)) {
                  state.cooldownActiveUntil = now + (rule.sessionCooldownSecs * 1000);
                  sessionLimitsState[rule.domain] = state;
                  await sSession({ sessionLimitsState });
                  await updateDNRRules();
                  chrome.tabs.query({}).then(tabs => {
                    tabs.forEach(tab => {
                      if (tab.url) {
                        const tabDomain = domain(tab.url);
                        if (tabDomain && (tabDomain === rule.domain || tabDomain.endsWith("." + rule.domain))) {
                          chrome.tabs.update(tab.id, {
                            url: chrome.runtime.getURL("blocked/index.html") + "?r=session_limit&d=" + safeBtoa(rule.domain) + "&cooldown_ends=" + state.cooldownActiveUntil
                          }).catch(() => {});
                        }
                      }
                    });
                  });
                } else {
                  sessionLimitsState[rule.domain] = state;
                  await sSession({ sessionLimitsState });
                }
              }
            } catch (errLimit) {
              console.warn("[FF] safeFlush session limit check error:", errLimit);
            }

            persistFlushQueue();
        }
    } finally {
        isFlushing = false;
    }
}

function isNeverTrack(domainStr, neverTrackDomains) {
    if (!domainStr || !neverTrackDomains || !neverTrackDomains.length) return false;
    const lowerDom = domainStr.toLowerCase();
    return neverTrackDomains.some(d => {
        const lowerD = d.toLowerCase().trim();
        return lowerDom === lowerD || lowerDom.endsWith("." + lowerD);
    });
}

async function handleTabChange() {
    try {
        await restoreState();
        const t = await chrome.windows.getLastFocused().catch(() => null),
            e = t && t.focused && t.id !== chrome.windows.WINDOW_ID_NONE;
        let a = null,
            s = null;
        if (e) {
            const e = await chrome.tabs.query({
                active: !0,
                windowId: t.id
            }).catch(() => []);
            if (e && e.length && e[0].url) {
                a = domain(e[0].url);
                s = e[0].id;
                if (e[0].favIconUrl) {
                    saveFavicon(a, e[0].favIconUrl);
                }
            }
        }
        
        let localData = await getCachedLocal();
        let isPrivacyActive = localData.privacyModeActive === true;
        if (isPrivacyActive && localData.privacyModeUntil > 0) {
            if (Date.now() >= localData.privacyModeUntil) {
                isPrivacyActive = false;
                await sLocal({ privacyModeActive: false, privacyModeUntil: 0 });
                await updateDNRRules();
            }
        }
        const neverTrack = localData.neverTrackDomains || [];
        const trackingDomain = (isPrivacyActive || isNeverTrack(a, neverTrack)) ? null : a;

        if (a && s && !isPrivacyActive) {
            if (!_injectedCSSTabs[s] || _injectedCSSTabs[s].domain !== a) {
                _injectedCSSTabs[s] = { domain: a, rules: {} };
            }
            let t = await getCachedLocal(),
                e = t.granularRules || {},
                matchDom = Object.keys(e).find(t => a === t || a.endsWith("." + t));
            if (matchDom && e[matchDom]) {
                for (let rule in e[matchDom]) {
                    if (e[matchDom][rule] === true && CSS_MAP[rule]) {
                        if (!_injectedCSSTabs[s].rules[rule]) {
                            _injectedCSSTabs[s].rules[rule] = true;
                            chrome.scripting.insertCSS({
                                target: { tabId: s },
                                css: CSS_MAP[rule],
                                origin: "USER"
                            }).catch(() => { });
                        }
                    }
                }
            }
        }
        await safeUpdateSession(async () => {
            const o = (await gSession(["activeSession"])).activeSession || {
                domain: null,
                startTime: null,
                visitStartTime: null,
                accumulatedTime: 0
            };
            if (o.domain === trackingDomain) return;
            if (o.domain && o.startTime) {
                const t = Math.floor((Date.now() - o.startTime) / 1e3);
                if (t > 0) {
                    const elapsed = capElapsed(t);
                    if (elapsed > 0) {
                        const syncData = await getCachedSync();
                        const settings = syncData.settings || {};
                        const minVisitSecs = settings.minVisitSecs || 0;
                        const visitDuration = Math.floor((Date.now() - (o.visitStartTime || o.startTime)) / 1000);
                        if (visitDuration >= minVisitSecs) {
                            const flushSecs = elapsed + (o.accumulatedTime || 0);
                            await safeFlush(o.domain, flushSecs, o.startTime);
                        }
                    }
                }
            }
            if (trackingDomain) {
                // Bug#4 fix: write lastProductiveSite when domain is a productive/learning category
                const _domCat = await categorize(trackingDomain);
                if (_domCat === "productivity" || _domCat === "learning") {
                    await sLocal({ lastProductiveSite: trackingDomain });
                }
                await ensureHeartbeatAlarm();
                await sSession({
                    activeSession: {
                        domain: trackingDomain,
                        startTime: Date.now(),
                        visitStartTime: Date.now(),
                        accumulatedTime: 0,
                        tabId: s
                    }
                });
                updateBadge();
            } else {
                await sSession({
                    activeSession: {
                        domain: null,
                        startTime: null,
                        visitStartTime: null,
                        accumulatedTime: 0,
                        tabId: null
                    }
                });
                updateBadge();
            }
        });
    } catch (t) {
        // Bug fix #5: log instead of silently swallowing — makes debugging possible
        console.warn("[FF] handleTabChange error", t);
    }
}
async function compressOldData() {
    // FF v4.2 (Dexie edition): roll up old days (default 1 year / 365 days) into monthly_rollups,
    // strip heavy `timeline` + `sites` fields but KEEP the day row so streaks + heatmap survive.
    // FF v6.17: throttle to once-per-day so onStartup doesn't iterate every key on every Chrome launch.
    const { lastCompressedAt = 0 } = await gLocal(["lastCompressedAt"]);
    if (Date.now() - lastCompressedAt < 864e5) return; // 24h
    await FFDB.ensureMigrated();
    
    const _ss = await getCachedSync();
    const settings = _ss.settings || {};
    const retentionDays = typeof settings.dataRetentionDays === "number" ? settings.dataRetentionDays : 365;
    if (retentionDays === 0) {
        // 0 means Keep Forever
        await sLocal({ lastCompressedAt: Date.now() });
        return;
    }
    const cutoff = Date.now() - (retentionDays * 864e5);
    const allKeys = await FFDB.getDayKeys();
    const oldKeys = allKeys.filter(k => {
        const pK = k.split("-");
        const t = new Date(parseInt(pK[0], 10), parseInt(pK[1], 10) - 1, parseInt(pK[2], 10)).getTime();
        return !isNaN(t) && t < cutoff;
    });
    if (!oldKeys.length) { await sLocal({ lastCompressedAt: Date.now() }); return; }
    const oldDays = await FFDB.getDays(oldKeys);
    const rollups = await FFDB.getRollups();
    const writeBack = {};
    let touched = false;
    for (const day of oldKeys) {
        const entry = oldDays[day];
        if (!entry) continue;
        // Already rolled up? (no sites/timeline) — skip.
        if (!entry.sites && !entry.timeline) continue;
        if (entry.sites) {
            const catsList = await getAllCats();
            catsList.forEach(c => {
                if (entry[c] === undefined) entry[c] = 0;
            });
            for (const [dom, secs] of Object.entries(entry.sites)) {
                const cat = await categorize(dom);
                entry[cat] = (entry[cat] || 0) + secs;
            }
        }
        const month = day.slice(0, 7);
        if (!rollups[month]) rollups[month] = { days: 0, sites: {} };
        rollups[month].days = (rollups[month].days || 0) + 1;
        for (const k of Object.keys(entry)) {
            if (k === "sites" || k === "timeline") continue;
            if (typeof entry[k] === "number") {
                rollups[month][k] = (rollups[month][k] || 0) + entry[k];
            }
        }
        const topSites = Object.entries(entry.sites || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
        for (const [dom, secs] of topSites) {
            rollups[month].sites[dom] = (rollups[month].sites[dom] || 0) + secs;
        }
        delete entry.timeline;
        delete entry.sites;
        writeBack[day] = entry;
        touched = true;
    }
    if (touched) {
        await FFDB.bulkSetDays(writeBack);
        await FFDB.setRollups(rollups);
    }

    try {
        const { favicons = {} } = await gLocal(["favicons"]);
        if (Object.keys(favicons).length > 0) {
            const visitedDomains = new Set();
            const allDayKeys = await FFDB.getDayKeys();
            const allDaysData = await FFDB.getDays(allDayKeys);
            for (const dayKey of Object.keys(allDaysData)) {
                const dayEntry = allDaysData[dayKey];
                if (dayEntry && dayEntry.sites) {
                    for (const dom of Object.keys(dayEntry.sites)) {
                        visitedDomains.add(dom.toLowerCase().trim());
                    }
                }
            }
            const currentRollups = await FFDB.getRollups();
            for (const month of Object.keys(currentRollups)) {
                const rollupEntry = currentRollups[month];
                if (rollupEntry && rollupEntry.sites) {
                    for (const dom of Object.keys(rollupEntry.sites)) {
                        visitedDomains.add(dom.toLowerCase().trim());
                    }
                }
            }
            const { cooldownConfig = {}, granularRules = {}, blockRules = [] } = await gLocal(["cooldownConfig", "granularRules", "blockRules"]);
            blockRules.forEach(r => { if (r.domain) visitedDomains.add(r.domain.toLowerCase().trim()); });
            if (cooldownConfig.domains) {
                cooldownConfig.domains.forEach(d => visitedDomains.add(String(d).toLowerCase().trim()));
            }
            if (cooldownConfig.activeDomains) {
                cooldownConfig.activeDomains.forEach(d => visitedDomains.add(String(d).toLowerCase().trim()));
            }
            Object.keys(granularRules).forEach(d => visitedDomains.add(d.toLowerCase().trim()));
            let prunedCount = 0;
            const newFavicons = {};
            for (const [dom, url] of Object.entries(favicons)) {
                const cleanDom = dom.toLowerCase().trim();
                let keep = visitedDomains.has(cleanDom);
                if (!keep) {
                    for (const vDom of visitedDomains) {
                        if (vDom.endsWith("." + cleanDom) || cleanDom.endsWith("." + vDom)) {
                            keep = true;
                            break;
                        }
                    }
                }
                if (keep) {
                    newFavicons[dom] = url;
                } else {
                    prunedCount++;
                }
            }
            if (prunedCount > 0) {
                await sLocal({ favicons: newFavicons });
                console.log(`[FF] Pruned ${prunedCount} unused favicons from storage cache.`);
            }
        }
    } catch (favErr) {
        console.warn("[FF] Failed to prune favicons map:", favErr);
    }

    await sLocal({ lastCompressedAt: Date.now() });
}

function inSchedule(t, e) {
    if (!t || !e) return false;
    const a = new Date,
        s = 60 * a.getHours() + a.getMinutes(),
        [o, i] = t.split(":").map(Number),
        [n, c] = e.split(":").map(Number),
        r = 60 * o + i,
        u = 60 * n + c;
    return r <= u ? s >= r && s < u : s >= r || s < u
}

function isTimeWindowActive(startStr, endStr, days, now = new Date()) {
    if (!startStr || !endStr) return false;
    const daysArr = days || [0, 1, 2, 3, 4, 5, 6];
    const curDow = now.getDay();
    const s = 60 * now.getHours() + now.getMinutes();
    const [o, i] = startStr.split(":").map(Number);
    const [n, c] = endStr.split(":").map(Number);
    const r = 60 * o + i;
    const u = 60 * n + c;
    
    const isTimeActive = r <= u ? s >= r && s < u : s >= r || s < u;
    if (!isTimeActive) return false;
    
    if (r > u && s < u) {
        const yesterdayDow = (curDow + 6) % 7;
        return daysArr.includes(yesterdayDow);
    } else {
        return daysArr.includes(curDow);
    }
}
async function updateRuleDomainsCache() {
    try {
        const _loc = await gLocal(["blockRules", "cooldownConfig", "granularRules"]);
        const blockRules = _loc.blockRules || [];
        const cooldownConfig = _loc.cooldownConfig || {};
        const granularRules = _loc.granularRules || {};
        
        const domains = new Set();
        
        // 1. Add block rule domains
        blockRules.forEach(r => {
            if (r.domain) {
                domains.add(r.domain.toLowerCase().trim());
            }
        });
        
        // 2. Add active cooldown domains
        const cooldowns = cooldownConfig.activeDomains || [];
        cooldowns.forEach(d => {
            domains.add(d.toLowerCase().trim());
        });
        
        // 3. Add domains with at least one active advanced tweak
        Object.entries(granularRules).forEach(([dom, tweaks]) => {
            if (tweaks && typeof tweaks === "object") {
                const hasActiveTweak = Object.values(tweaks).some(val => val === true);
                if (hasActiveTweak) {
                    domains.add(dom.toLowerCase().trim());
                }
            }
        });
        
        // Save the unique sorted domains as an array
        await sLocal({ ruleDomainsCache: Array.from(domains) });
    } catch (err) {
        console.warn("[FF] Error updating ruleDomainsCache:", err);
    }
}

let updateDNRQueue = Promise.resolve();

async function updateDNRRules() {
    let resolvePromise;
    const promise = new Promise((resolve) => {
        resolvePromise = resolve;
    });

    updateDNRQueue = updateDNRQueue.then(async () => {
        try {
            await updateDNRRulesInternal();
        } catch (err) {
            console.error("[FF] Error in updateDNRRules:", err);
        } finally {
            resolvePromise();
        }
    });

    return promise;
}

async function updateDNRRulesInternal() {
    await restoreState();
    await ensureHeartbeatAlarm();
    // FF v6.16 perf: cached reads (was 2 storage round-trips per call).
    const _loc = await getCachedLocal();
const sessionLimitsState = (await gSession(["sessionLimitsState"])).sessionLimitsState || {};
let sessionLimitsChanged = false;
const now = Date.now();
for (const [dom, state] of Object.entries(sessionLimitsState)) {
  if (state.cooldownActiveUntil && now >= state.cooldownActiveUntil) {
    state.cooldownActiveUntil = 0;
    state.spentSecs = 0;
    sessionLimitsChanged = true;
  }
}
if (sessionLimitsChanged) {
  await sSession({ sessionLimitsState });
}
let isPrivacyActive = _loc.privacyModeActive === true;
    if (isPrivacyActive && _loc.privacyModeUntil > 0 && Date.now() >= _loc.privacyModeUntil) {
        isPrivacyActive = false;
        await sLocal({ privacyModeActive: false, privacyModeUntil: 0 });
    }
    const t = isPrivacyActive ? [] : (_loc.blockRules || []);
    const e = _loc.allowList || [];
    const effectiveAllowList = [...e];
    const a = _loc.siteCategories || {};
    const hiddenDefaultSites = _loc.hiddenDefaultSites || [];

    const isHiddenDefault = (dom) => {
        if (!dom || !hiddenDefaultSites.length) return false;
        const lower = dom.toLowerCase().trim();
        if (hiddenDefaultSites.includes(lower)) return true;
        const parts = lower.split(".");
        for (let idx = 1; idx < parts.length - 1; idx++) {
            if (hiddenDefaultSites.includes(parts.slice(idx).join("."))) return true;
        }
        return false;
    };
    
    const isAllowListed = (dom) => {
        if (!dom) return false;
        const lower = dom.toLowerCase();
        return effectiveAllowList.some(allow => {
            const lowerAllow = allow.toLowerCase();
            return lower === lowerAllow || lower.endsWith("." + lowerAllow);
        });
    };
    
    const _syn = await getCachedSync();
    const o = _syn.settings || {};
    // FF v4.2: pull only today's row from IDB instead of the entire daily blob.
    const todayEntry = await getTodayData();
    const s = { [todayKey()]: todayEntry || { sites: {} } };
    let i = {};
    let activeCooldowns = [];
    let cooldownBlockActive = {};
    // FF v6.8: free-time now supports per-window day-of-week
    if (!isPrivacyActive && !(o.freeTimeHours || []).some(t => {
        return isTimeWindowActive(t.start, t.end, t.days);
    })) {
        if (focusState.active && "work" === focusState.phase && !focusState.paused) {
            // Prefer schedule's category list if an active schedule exists
            let t = null;
            const activeSched = (o.focusSchedules || []).find(sc => 
                sc.enabled !== false && 
                sc.startTime && sc.endTime && isTimeWindowActive(sc.startTime, sc.endTime, sc.days)
            );
            if (activeSched && Array.isArray(activeSched.blockCats)) {
                t = activeSched.blockCats;
            } else {
                const ap2 = await getActivePreset();
                t = (ap2 && Array.isArray(ap2.blockCats)) ? ap2.blockCats : (o.focusBlockCats || ["distraction"]);
            }
            Object.entries(AUTO_CATEGORIES).forEach(([e, aCat]) => {
                if (!isAllowListed(e) && !isHiddenDefault(e)) {
                    t.includes(aCat) && (i[e] = BLOCKED_PAGE + "?r=strict");
                }
            }), Object.entries(a).forEach(([e, aCat]) => {
                if (!isAllowListed(e)) {
                    t.includes(aCat) ? i[e] = BLOCKED_PAGE + "?r=strict" : delete i[e];
                }
            })
        }
        const e = todayKey();
        lastWarnDate !== e && (warnedSitesMemory = {}, lastWarnDate = e);
        const n = s[e]?.sites || {};
        await Promise.all(t.map(async rule => {
            if (rule.domain && isAllowListed(rule.domain)) {
                return;
            }
            // Determine if we are in an active focus work session
            const isFocusActive = focusState.active && focusState.phase === "work" && !focusState.paused;
            let shouldBlock = false; // Prevent clashing with outer 'e' constant scope variable!
            let reason = "strict";   // Declare locally to prevent scope bleeding
            let schedEnd = "";

            if ((rule.focusOnly || "focus_only" === rule.mode) && isFocusActive) {
                shouldBlock = !0;
                reason = "strict";
            }

            if (!shouldBlock && (rule.instantBlock || "always" === rule.mode)) {
                shouldBlock = !0;
                reason = "instant";
            }

            if (!shouldBlock && (rule.scheduleEnabled || "schedule" === rule.mode)) {
                let activeSchedEnd = "";
                const isScheduled = Array.isArray(rule.schedules) && rule.schedules.length
                    ? rule.schedules.some(s => {
                        if (inSchedule(s.start, s.end)) {
                            activeSchedEnd = s.end;
                            return true;
                        }
                        return false;
                    })
                    : inSchedule(rule.scheduleStart, rule.scheduleEnd || "23:59") && (activeSchedEnd = rule.scheduleEnd || "23:59", true);
                if (isScheduled) {
                    shouldBlock = !0;
                    reason = "schedule";
                    schedEnd = activeSchedEnd;
                }
            }

            if (!shouldBlock && (rule.timeLimitEnabled || "time_limit" === rule.mode) && rule.dailyLimitSecs >= 0) {
                const spent = n[rule.domain] || 0;
                const remaining = rule.dailyLimitSecs - spent;
                const timeWarningEnabled = o.timeWarningEnabled !== false;
                const timeWarningSecs = typeof o.timeWarningSecs === "number" ? o.timeWarningSecs : 60;
                
                if (timeWarningEnabled && remaining > 0 && remaining <= timeWarningSecs && !warnedSitesMemory[rule.domain]) {
                    warnedSitesMemory[rule.domain] = !0;
                    (await chrome.tabs.query({})).forEach(tab => {
                        if (tab.url) {
                            const tabDomain = domain(tab.url);
                            if (tabDomain && (tabDomain === rule.domain || tabDomain.endsWith("." + rule.domain))) {
                                chrome.tabs.sendMessage(tab.id, {
                                    type: "SHOW_NUDGE",
                                    seconds: timeWarningSecs
                                }).catch(() => { })
                            }
                        }
                    });
                }
                if (spent >= rule.dailyLimitSecs) {
                    shouldBlock = !0;
                    reason = "time_limit";
                }
            }

            if (!shouldBlock && rule.sessionLimitEnabled) {
                const state = sessionLimitsState[rule.domain];
                if (state && state.cooldownActiveUntil && Date.now() < state.cooldownActiveUntil) {
                    shouldBlock = !0;
                    reason = "session_limit";
                }
            }

            let cooldownShouldApply = rule.cooldownEnabled;
            if (cooldownShouldApply && Array.isArray(rule.activeDays) && rule.activeDays.length > 0) {
                const _todayDow = new Date().getDay();
                if (!rule.activeDays.includes(_todayDow)) cooldownShouldApply = false;
            } else if (cooldownShouldApply && Array.isArray(rule.activeDays) && rule.activeDays.length === 0) {
                cooldownShouldApply = false;
            }

            if (cooldownShouldApply) {
                // Determine if this rule would result in a hard block right now based on active conditions
                let isRuleBlocked = shouldBlock;
                if (isRuleBlocked && Array.isArray(rule.activeDays) && rule.activeDays.length > 0) {
                    const _todayDow = new Date().getDay();
                    if (!rule.activeDays.includes(_todayDow)) isRuleBlocked = false;
                } else if (Array.isArray(rule.activeDays) && rule.activeDays.length === 0) {
                    isRuleBlocked = false;
                }

                // Only apply the cool-down screen if the site is NOT currently hard-blocked!
                // If it is hard-blocked, we skip the cool-down and let the DNR rule block it immediately.
                if (!isRuleBlocked) {
                    activeCooldowns.push(rule.domain);
                }
            }

            if (shouldBlock && Array.isArray(rule.activeDays) && rule.activeDays.length > 0) {
                const _todayDow = new Date().getDay();
                if (!rule.activeDays.includes(_todayDow)) shouldBlock = false;
            } else if (Array.isArray(rule.activeDays) && rule.activeDays.length === 0) {
                shouldBlock = false; // Bug fix: empty activeDays = no days selected — never fire
            }
            if (shouldBlock) {
                const tgt = rule.redirectUrl || (BLOCKED_PAGE + "?r=" + reason + (reason === "time_limit" ? "&l=" + rule.dailyLimitSecs : "") + (reason === "session_limit" ? "&cooldown_ends=" + (sessionLimitsState[rule.domain]?.cooldownActiveUntil || 0) : "") + (reason === "schedule" && schedEnd ? "&sched_end=" + schedEnd : ""));
                i[rule.domain] = tgt;
                cooldownBlockActive[rule.domain] = tgt;
            }
        }))
    }
    // Bug#2 fix: collect keys first then delete
    effectiveAllowList.forEach(t => {
        delete i[t];
        Object.keys(i).filter(k => k.endsWith("." + t)).forEach(k => delete i[k]);
    });
    _activeRedirects = { ...i };
    const n = Object.entries(i).map(([t, e], a) => {
        const isLocal = e.startsWith(BLOCKED_PAGE);
        const exclusions = SSO_EXCLUSIONS.filter(ex => ex === t.toLowerCase().trim() || ex.endsWith("." + t.toLowerCase().trim()));
        if (isLocal) {
            const [path, query] = e.split("?");
            const relativePath = path.startsWith("/") ? path : "/" + path;
            const separator = query ? "&" : "?";
            const fullPath = relativePath + (query ? "?" + query : "") + separator + "d=" + safeBtoa(t);
            return {
                id: a + 1,
                priority: 1,
                action: {
                    type: "redirect",
                    redirect: {
                        extensionPath: fullPath
                    }
                },
                condition: {
                    urlFilter: `||${t}`,
                    resourceTypes: ["main_frame"],
                    ...(exclusions.length > 0 ? { excludedRequestDomains: exclusions } : {})
                }
            };
        } else {
            let targetUrl = e;
            if (!e.startsWith("http")) {
                targetUrl = "https://" + e;
            }
            return {
                id: a + 1,
                priority: 1,
                action: {
                    type: "redirect",
                    redirect: {
                        url: targetUrl
                    }
                },
                condition: {
                    urlFilter: `||${t}`,
                    resourceTypes: ["main_frame"],
                    ...(exclusions.length > 0 ? { excludedRequestDomains: exclusions } : {})
                }
            }
        }
    }),
        c = await chrome.declarativeNetRequest.getDynamicRules();

    const areRulesIdentical = (oldRules, newRules) => {
        if (oldRules.length !== newRules.length) return false;
        const oMap = new Map(oldRules.map(r => [r.id, r]));
        for (const nr of newRules) {
            const or = oMap.get(nr.id);
            if (!or) return false;
            if (or.priority !== nr.priority) return false;
            if (or.action?.type !== nr.action?.type) return false;
            if (or.action?.redirect?.url !== nr.action?.redirect?.url) return false;
            if (or.action?.redirect?.extensionPath !== nr.action?.redirect?.extensionPath) return false;
            if (or.condition?.urlFilter !== nr.condition?.urlFilter) return false;
            const oEx = (or.condition?.excludedRequestDomains || []).slice().sort().join(",");
            const nEx = (nr.condition?.excludedRequestDomains || []).slice().sort().join(",");
            if (oEx !== nEx) return false;
        }
        return true;
    };
    if (!areRulesIdentical(c, n)) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: c.map(t => t.id),
            addRules: n
        });
        const r = await chrome.tabs.query({});
        for (let t of r) {
            if (!t.url) continue;
            const e = domain(t.url);
            if (e) {
                let a = Object.keys(i).find(t => {
                    if (SSO_EXCLUSIONS.includes(e)) return false;
                    return e === t || e.endsWith("." + t);
                });
                if (a && !t.url.includes(chrome.runtime.id)) {
                    let redirectUrl = i[a];
                    if (redirectUrl.startsWith(BLOCKED_PAGE)) {
                        const [path, query] = redirectUrl.split("?");
                        const relativePath = path.startsWith("/") ? path.slice(1) : path;
                        const separator = query ? "&" : "?";
                        redirectUrl = chrome.runtime.getURL(relativePath) + (query ? "?" + query : "") + separator + "d=" + safeBtoa(a);
                    } else if (!redirectUrl.startsWith("http")) {
                        redirectUrl = "https://" + redirectUrl;
                    }
                    chrome.tabs.update(t.id, {
                        url: redirectUrl
                    }).catch(() => { })
                }
            }
            // Check if tab is already on the blocked page but needs its reason updated
            const isBlockedPage = t.url.includes(chrome.runtime.id) && t.url.includes("blocked/index.html");
            if (isBlockedPage) {
                try {
                    const uObj = new URL(t.url);
                    const rawTabDom = uObj.searchParams.get("d") || uObj.searchParams.get("domain");
                    if (rawTabDom) {
                        const tabDom = safeAtob(rawTabDom);
                        let ruleDom = Object.keys(i).find(domain => tabDom === domain || tabDom.endsWith("." + domain));
                        if (ruleDom) {
                            let redirectUrl = i[ruleDom];
                            if (redirectUrl.startsWith(BLOCKED_PAGE)) {
                                const [path, query] = redirectUrl.split("?");
                                const relativePath = path.startsWith("/") ? path.slice(1) : path;
                                const separator = query ? "&" : "?";
                                redirectUrl = chrome.runtime.getURL(relativePath) + (query ? "?" + query : "") + separator + "d=" + safeBtoa(ruleDom);
                            } else if (!redirectUrl.startsWith("http")) {
                                redirectUrl = "https://" + redirectUrl;
                            }
                            const newUObj = new URL(redirectUrl);
                            const oldR = uObj.searchParams.get("r") || uObj.searchParams.get("reason");
                            const newR = newUObj.searchParams.get("r") || newUObj.searchParams.get("reason");
                            if (oldR !== newR) {
                                chrome.tabs.update(t.id, { url: redirectUrl }).catch(() => {});
                            }
                        }
                    }
                } catch (err) {
                    console.warn("[FF] Error updating blocked tab reason:", err);
                }
            }
        }
    }
    try {
        const { cooldownConfig = {} } = await gLocal(["cooldownConfig"]);

        const activeDomainsChanged = (arr1, arr2) => {
            const a1 = arr1 || [];
            const a2 = arr2 || [];
            if (a1.length !== a2.length) return true;
            const s1 = [...a1].sort();
            const s2 = [...a2].sort();
            return s1.some((val, idx) => val !== s2[idx]);
        };

        const blockActiveChanged = (obj1, obj2) => {
            const o1 = obj1 || {};
            const o2 = obj2 || {};
            const k1 = Object.keys(o1).sort();
            const k2 = Object.keys(o2).sort();
            if (k1.length !== k2.length) return true;
            for (let i = 0; i < k1.length; i++) {
                const k = k1[i];
                if (k !== k2[i] || o1[k] !== o2[k]) return true;
            }
            return false;
        };

        if (activeDomainsChanged(cooldownConfig.activeDomains, activeCooldowns) ||
            blockActiveChanged(cooldownConfig.blockActive, cooldownBlockActive)) {
            cooldownConfig.activeDomains = activeCooldowns;
            cooldownConfig.blockActive = cooldownBlockActive;
            await sLocal({ cooldownConfig });
        }
    } catch (_) {}
    await updateRuleDomainsCache();
}
async function categorize(t) {
    if (!t) return "uncategorized";
    // FF v6.16 perf: cached reads (was 1 storage round-trip per tab switch).
    const _loc = await getCachedLocal();
    const e = _loc.siteCategories || {};
    const a = _loc.blockRules || [];
    const hidden = _loc.hiddenDefaultSites || [];
    const s = t.split(".");
    if (e[t]) return e[t];
    for (let t = 1; t < s.length - 1; t++) {
        const a = s.slice(t).join(".");
        if (e[a]) return e[a]
    }
    if (hidden.includes(t)) return "uncategorized";
    for (let t = 1; t < s.length - 1; t++) {
        const a = s.slice(t).join(".");
        if (hidden.includes(a)) return "uncategorized";
    }
    if (AUTO_CATEGORIES[t]) return AUTO_CATEGORIES[t];
    const i = s.length > 2 ? s.slice(1).join(".") : t;
    if (AUTO_CATEGORIES[i]) return AUTO_CATEGORIES[i];
    return "uncategorized";
}
chrome.tabs.onActivated.addListener(handleTabChange);
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const url = changeInfo.url || tab.url;
    if (!url) return;

    const dom = domain(url);
    if (!dom) return;

    if (tab.favIconUrl) {
        saveFavicon(dom, tab.favIconUrl);
    }

    // 0.5. Intercept blocked pages and redirect using chrome.tabs.update (avoids Brave's network redirect hang bug)
    if (changeInfo.status === "loading" || changeInfo.url) {
        if (typeof _activeRedirects !== "undefined" && _activeRedirects) {
            const matchedDom = Object.keys(_activeRedirects).find(d => {
                if (SSO_EXCLUSIONS.includes(dom)) return false;
                return dom === d || dom.endsWith("." + d);
            });
            if (matchedDom && !url.includes(chrome.runtime.id)) {
                let redirectUrl = _activeRedirects[matchedDom];
                if (redirectUrl.startsWith(BLOCKED_PAGE)) {
                    const [path, query] = redirectUrl.split("?");
                    const relativePath = path.startsWith("/") ? path.slice(1) : path;
                    const separator = query ? "&" : "?";
                    redirectUrl = chrome.runtime.getURL(relativePath) + (query ? "?" + query : "") + separator + "d=" + safeBtoa(matchedDom);
                } else if (!redirectUrl.startsWith("http")) {
                    redirectUrl = "https://" + redirectUrl;
                }
                chrome.tabs.update(tabId, { url: redirectUrl }).catch(() => {});
                return;
            }
        }
    }

    // 1. Dynamic path blocking/redirection for tweaks (Shorts & Reels)
    if (changeInfo.status === "loading" || changeInfo.url) {
        if (dom === "youtube.com" && url.includes("/shorts")) {
            let r = await getCachedLocal();
            let gr = r.granularRules || {};
            if (gr["youtube.com"] && gr["youtube.com"]["yt-shorts"] === true) {
                chrome.tabs.update(tabId, {
                    url: chrome.runtime.getURL("blocked/index.html") + "?r=tweak&d=" + safeBtoa("youtube.com")
                }).catch(() => {});
                return;
            }
        }
        if (dom === "instagram.com" && url.includes("/reels")) {
            let r = await getCachedLocal();
            let gr = r.granularRules || {};
            if (gr["instagram.com"] && gr["instagram.com"]["ig-reels"] === true) {
                chrome.tabs.update(tabId, {
                    url: chrome.runtime.getURL("blocked/index.html") + "?r=tweak&d=" + safeBtoa("instagram.com")
                }).catch(() => {});
                return;
            }
        }
    }

    // 2. CSS Injection Cache Management & Application
    if (changeInfo.status === "loading") {
        // Reset cache on loading so we re-apply styles on fresh page loads
        _injectedCSSTabs[tabId] = { domain: dom, rules: {} };
    } else if (changeInfo.status === "complete" || changeInfo.url) {
        // Only inject when the page is fully complete or during client-side (SPA) URL changes
        if (!_injectedCSSTabs[tabId] || _injectedCSSTabs[tabId].domain !== dom) {
            _injectedCSSTabs[tabId] = { domain: dom, rules: {} };
        }
        
        let r = await getCachedLocal();
        let gr = r.granularRules || {};
        let match = Object.keys(gr).find(k => dom === k || dom.endsWith("." + k));
        if (match && gr[match]) {
            for (let rule in gr[match]) {
                if (gr[match][rule] === true && CSS_MAP[rule]) {
                    if (!_injectedCSSTabs[tabId].rules[rule]) {
                        _injectedCSSTabs[tabId].rules[rule] = true;
                        chrome.scripting.insertCSS({ target: { tabId: tabId }, css: CSS_MAP[rule], origin: "USER" }).catch(() => { });
                    }
                }
            }
        }
    }

    if (tab.active && changeInfo.url) {
        handleTabChange();
    }
});
chrome.tabs.onRemoved.addListener((tabId) => {
    delete _injectedCSSTabs[tabId];
});
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    await restoreState();
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // OS focus lost completely (user switched to another app). Stop the timer.
        await safeUpdateSession(async () => {
            const o = (await gSession(["activeSession"])).activeSession;
            if (o && o.domain && o.startTime) {
                const t = Math.floor((Date.now() - o.startTime) / 1000);
                if (t > 0) {
                    const elapsed = capElapsed(t);
                    if (elapsed > 0) {
                        await safeFlush(o.domain, elapsed, o.startTime);
                    }
                }
            }
            await sSession({
                activeSession: { domain: null, startTime: null }
            });
        });
        updateBadge();
    } else {
        // Window gained focus (could be a restore from minimize, tab switch, etc.).
        // Always call handleTabChange() so the session + badge are restarted immediately.
        handleTabChange();
    }
});


chrome.idle.onStateChanged.addListener(async state => {
    if ("active" === state) {
        await sSession({ wentIdleAt: 0 });
        handleTabChange();
    } else {
        const syncData = await getCachedSync();
        const settings = syncData.settings || {};
        const trackMedia = settings.trackMedia !== false;
        
        const [_idleSess, _idleLocal, _sessionInfo] = await Promise.all([
            gSession(["activeSession"]),
            gLocal(["idleWhitelist"]),
            gSession(["lastHeartbeatReceivedAt"])
        ]);
        
        const lastHeartbeat = _sessionInfo.lastHeartbeatReceivedAt || 0;
        if (state === "idle" && Date.now() - lastHeartbeat < 20000) {
            return;
        }

        if (trackMedia) {
            const t = await chrome.windows.getLastFocused().catch(() => null);
            if (t) {
                const e = await chrome.tabs.query({
                    active: !0,
                    windowId: t.id
                }).catch(() => []);
                if (e.length > 0 && e[0].audible) {
                    const activeDom = domain(e[0].url);
                    if (activeDom && _idleSess.activeSession && _idleSess.activeSession.domain === activeDom) {
                        return;
                    }
                }
            }
        }

        await safeUpdateSession(async () => {
            const s = _idleLocal.idleWhitelist || [];
            const idleTimeout = settings.idleTimeout || 30;
            const minVisitSecs = settings.minVisitSecs || 0;
            if (_idleSess.activeSession && _idleSess.activeSession.domain) {
                if (s.includes(_idleSess.activeSession.domain)) return;
                const totalElapsed = Math.floor((Date.now() - _idleSess.activeSession.startTime) / 1e3);
                let elapsed = 0;
                if (state === "locked") {
                    // Lock event: record all time up to the lock without subtracting idle threshold
                    elapsed = totalElapsed;
                } else {
                    // Idle event: subtract the idle threshold
                    if (totalElapsed > idleTimeout + 60) {
                        // Sleep/Suspension occurred. Cap the active time before sleep to 0 seconds.
                        elapsed = 0;
                    } else {
                        // Normal idle detection. Subtract the idleTimeout since they were inactive.
                        elapsed = Math.max(0, totalElapsed - idleTimeout);
                    }
                }
                const finalElapsed = capElapsed(elapsed);
                if (finalElapsed > 0) {
                    const visitDuration = Math.floor((Date.now() - (_idleSess.activeSession.visitStartTime || _idleSess.activeSession.startTime)) / 1000);
                    if (visitDuration >= minVisitSecs) {
                        await safeFlush(_idleSess.activeSession.domain, finalElapsed, _idleSess.activeSession.startTime);
                    }
                }
            }
            await sSession({
                activeSession: { domain: null, startTime: null, visitStartTime: null, accumulatedTime: 0, tabId: null },
                wentIdleAt: Date.now()
            });
        });
    }
});
const FOCUS_ALARM = "focus_phase_end",
    PAUSE_EXPLOIT_ALARM = "focus_pause_timeout";
async function updateBadge() {
    if (focusState.active && !focusState.paused && focusState.phaseEndsAt) {
        let remainSecs = Math.max(0, Math.round((focusState.phaseEndsAt - Date.now()) / 1e3)),
            remainMins = Math.floor(remainSecs / 60);
        chrome.action.setBadgeText({
            text: remainMins > 0 ? remainMins + "m" : "<1m"
        }), chrome.action.setBadgeBackgroundColor({
            color: "work" === focusState.phase ? "#05D581" : "#F6B846"
        })
    } else {
        // FF v6.18: renamed variables to avoid confusing name collisions
        const _ss = await getCachedSync();
        const cfg = _ss.settings || {};
        if (!1 !== cfg.showBadge) {
            const sess = await gSession(["activeSession"]),
                active = sess.activeSession;
            if (active && active.domain) {
                const todayEntry = await getTodayData();
                const stored = (todayEntry && todayEntry.sites && todayEntry.sites[active.domain]) || 0;
                let extra = 0;
                if (active.startTime) {
                    extra = Math.max(0, Math.floor((Date.now() - active.startTime) / 1000));
                }
                const totalSecs = stored + extra;
                const fmtB = (e) => {
                    if (!e || e <= 0) return "<1m";
                    const m = Math.floor(e / 60);
                    if (m < 60) return m > 0 ? m + "m" : "<1m";
                    const h = m / 60;
                    if (h < 24) return (h === Math.floor(h) ? h : h.toFixed(1)) + "h";
                    const d = Math.floor(h / 24), rh = Math.floor(h % 24);
                    return rh > 0 ? d + "d " + rh + "h" : d + "d";
                };
                chrome.action.setBadgeText({
                    text: fmtB(totalSecs)
                });
                chrome.action.setBadgeBackgroundColor({
                    color: "#5C9CFC"
                });
            } else {
                if (!!cfg.showIdleBadge) {
                    chrome.action.setBadgeText({ text: "idl" });
                    chrome.action.setBadgeBackgroundColor({ color: "#9CA3AF" });
                } else {
                    chrome.action.setBadgeText({ text: "" });
                }
            }
        } else {
            chrome.action.setBadgeText({ text: "" });
        }
    }
}

function syncFocusRemaining() {
    focusState.active && !focusState.paused && focusState.phaseEndsAt && (focusState.remaining = Math.max(0, Math.round((focusState.phaseEndsAt - Date.now()) / 1e3)), updateBadge())
}

function saveFocus() {
    return sLocal({
        focusSession: {
            ...focusState
        }
    })
}

// Battery optimization: track active port connections to avoid broadcasting when popup/newtab are closed
let _activePorts = new Set();
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "flow-tracker") {
        _activePorts.add(port);
        port.onDisconnect.addListener(() => {
            _activePorts.delete(port);
        });
    }
});

function broadcastFocus() {
    if (_activePorts.size === 0) return;
    try {
        chrome.runtime.sendMessage({
            type: "FOCUS_TICK",
            focusState: {
                ...focusState
            }
        }, () => {
            if (chrome.runtime.lastError) {
                // Ignore expected connection errors when popup closes abruptly
            }
        })
    } catch (t) { }
}
async function startFocus(scheduledDurationMins = null) {
    // FF v6.7: clear zombie-stop flag so scheduled sessions can start fresh
    try { 
        await chrome.storage.local.set({ userStoppedFocus: false }); 
        await sLocal({ privacyModeActive: false, privacyModeUntil: 0 });
        await chrome.alarms.clear("privacy_mode_end");
    } catch (_) { }
    // FF v5.0: if a preset is active, use its work/break durations + cycles; else fall back to 25.
    const preset = await getActivePreset();
    const workMins = scheduledDurationMins !== null ? scheduledDurationMins : (preset ? (preset.work ?? 25) : 25);
    const e = 60 * workMins;
    await chrome.alarms.clear(FOCUS_ALARM), await chrome.alarms.clear(PAUSE_EXPLOIT_ALARM), focusState = {
        active: !0,
        phase: "work",
        fullDuration: e,
        remaining: e,
        paused: !1,
        cyclesCompleted: 0,
        totalCycles: scheduledDurationMins !== null ? 1 : (preset ? (preset.cycles || 4) : 4),
        startedAt: Date.now(),
        phaseEndsAt: Date.now() + 1e3 * e,
        durationMins: 0,
        presetId: scheduledDurationMins !== null ? "schedule" : (preset ? preset.id : null),
        isSchedule: scheduledDurationMins !== null
    }, await chrome.alarms.create(FOCUS_ALARM, {
        when: focusState.phaseEndsAt
    }), updateBadge(), await saveFocus(), broadcastFocus(), await updateDNRRules()
}
async function stopFocus() {
    if (await chrome.alarms.clear(FOCUS_ALARM), await chrome.alarms.clear(PAUSE_EXPLOIT_ALARM), focusState.active && focusState.startedAt) {
        if ("work" === focusState.phase) {
            const t = Math.round((Date.now() - focusState.startedAt) / 6e4);
            t > 0 && (focusState.durationMins += t)
        }
        if (focusState.durationMins > 0 || focusState.cyclesCompleted > 0) {
            const {
                focusHistory: t = []
            } = await gLocal(["focusHistory"]);
            t.push({
                date: todayKey(),
                startedAt: focusState.startedAt,
                durationMins: focusState.durationMins || 0,
                cyclesCompleted: focusState.cyclesCompleted || 0,
                presetId: focusState.presetId || "pomodoro",
                isSchedule: focusState.isSchedule || false
            });
            // Bug fix #1: cap at 365 entries so chrome.storage never hits quota
            await sLocal({ focusHistory: t.slice(-365) });
        }
    }
    focusState.active = !1, focusState.paused = !1, focusState.phaseEndsAt = null;
    // Record that this specific schedule was stopped today so it doesn't auto-restart
    try {
        const _ss = (await getCachedSync()).settings || {};
        const _schedules = _ss.focusSchedules || [];
        const _now = new Date();
        const _dow = _now.getDay();
        const _today = todayKey();
        let _stoppedSchedId = null;

        for (const _sc of _schedules) {
            if (_sc.enabled === false) continue;
            if (!Array.isArray(_sc.days) || !_sc.days.includes(_dow)) continue;
            if (_sc.startTime && _sc.endTime && inSchedule(_sc.startTime, _sc.endTime)) {
                _stoppedSchedId = _sc.id || (_sc.startTime + _sc.endTime);
                break;
            }
        }

        if (_stoppedSchedId) {
            const key = `stopped_sched_${_stoppedSchedId}_at`;
            await chrome.storage.local.set({ [key]: Date.now() });
        }
    } catch (_) { }
    // FF v6.7: mark as user-stopped so schedules don't auto-restart this session window
    try { await chrome.storage.local.set({ userStoppedFocus: true, userStoppedAt: Date.now() }); } catch (_) { }
    updateBadge(), await saveFocus(), broadcastFocus(), await updateDNRRules()
}
async function pauseFocus() {
    focusState.active && !focusState.paused && (focusState.paused = !0, focusState.pausedAt = Date.now(), focusState.remaining = Math.max(0, Math.round((focusState.phaseEndsAt - Date.now()) / 1e3)), focusState.phaseEndsAt = null, await chrome.alarms.clear(FOCUS_ALARM), await chrome.alarms.create(PAUSE_EXPLOIT_ALARM, {
        delayInMinutes: 5
    }), updateBadge(), await saveFocus(), broadcastFocus(), await updateDNRRules())
}
async function resumeFocus() {
    focusState.active && focusState.paused && (focusState.paused = !1, focusState.pausedAt = null, focusState.startedAt || "work" !== focusState.phase || (focusState.startedAt = Date.now()), focusState.phaseEndsAt = Date.now() + 1e3 * focusState.remaining, await chrome.alarms.clear(PAUSE_EXPLOIT_ALARM), await chrome.alarms.create(FOCUS_ALARM, {
        when: focusState.phaseEndsAt
    }), updateBadge(), await saveFocus(), broadcastFocus(), await updateDNRRules())
}
async function skipFocus() {
    if (!focusState.active) return;
    if ("work" === focusState.phase) return;
    const ap = await getActivePreset();
    const o = (ap && ap.cycles) ?? 4;
    if ("long_break" === focusState.phase && focusState.cyclesCompleted >= o) {
        return await stopFocus();
    }
    await chrome.alarms.clear(FOCUS_ALARM), await chrome.alarms.clear(PAUSE_EXPLOIT_ALARM);
    // FF v6.16: honour the active preset's work duration
    const workMins = (ap && ap.work) ?? 25;
    const e = 60 * workMins;
    focusState.phase = "work", focusState.fullDuration = e, focusState.remaining = e, focusState.paused = !1, focusState.startedAt = Date.now(), focusState.phaseEndsAt = Date.now() + 1e3 * e, await chrome.alarms.create(FOCUS_ALARM, {
        when: focusState.phaseEndsAt
    }), updateBadge(), await saveFocus(), broadcastFocus(), await updateDNRRules()
}

let _isHandlingPhaseEnd = false;
async function handleFocusPhaseEnd() {
    if (_isHandlingPhaseEnd) return;
    if (!focusState.active || focusState.paused || !focusState.phaseEndsAt) return;
    _isHandlingPhaseEnd = true;
    try {
        const ap = await getActivePreset();
        const e = 60 * ((ap && ap.work) ?? 25),
            a = 60 * ((ap && ap.brk) ?? 5),
            s = 60 * ((ap && (ap.longBrk ?? ap.long)) ?? 15),
            o = (ap && ap.cycles) ?? 4;

        const endFocusSession = async () => {
            if (await chrome.alarms.clear(FOCUS_ALARM), await chrome.alarms.clear(PAUSE_EXPLOIT_ALARM), focusState.durationMins > 0 || focusState.cyclesCompleted > 0) {
                const {
                    focusHistory: t = []
                } = await gLocal(["focusHistory"]);
                t.push({
                    date: todayKey(),
                    startedAt: focusState.startedAt,
                    durationMins: focusState.durationMins || 0,
                    cyclesCompleted: focusState.cyclesCompleted || 0,
                    presetId: focusState.presetId || "pomodoro",
                    isSchedule: focusState.isSchedule || false
                });
                await sLocal({ focusHistory: t.slice(-365) });
            }
            const completedCount = focusState.cyclesCompleted;
            focusState.active = !1;
            focusState.paused = !1;
            focusState.phaseEndsAt = null;
            focusState.cyclesCompleted = 0;
            try { await chrome.storage.local.set({ userStoppedFocus: true, userStoppedAt: Date.now() }); } catch (_) { }
            try {
                if (!ap || ap.notify !== false) {
                    let t = chrome.runtime.getURL("assets/icons/icon128.png");
                    chrome.notifications.create("focus_done_" + Date.now(), {
                        type: "basic",
                        iconUrl: t,
                        title: "Session Complete! 🎉",
                        message: focusState.isSchedule ? "Your scheduled session has ended. Great work!" : "All " + completedCount + " cycle(s) done. Great work!"
                    });
                }
            } catch (t) { }
            updateBadge(), await saveFocus(), broadcastFocus(), await updateDNRRules();
        };

        if ("work" === focusState.phase) {
            focusState.durationMins += Math.round(focusState.fullDuration / 60);
            focusState.cyclesCompleted++;

            if (focusState.isSchedule) {
                return await endFocusSession();
            }

            if (focusState.cyclesCompleted >= o) {
                if (s > 0) {
                    focusState.phase = "long_break";
                    focusState.fullDuration = s;
                    focusState.remaining = s;
                    try {
                        if (!ap || ap.notify !== false) {
                            let t = chrome.runtime.getURL("assets/icons/icon128.png");
                            chrome.notifications.create("focus_break_start_" + Date.now(), {
                                type: "basic",
                                iconUrl: t,
                                title: "Work Period Over! ☕",
                                message: "Time for a well-deserved long break!"
                            });
                        }
                    } catch (t) { }
                } else {
                    return await endFocusSession();
                }
            } else {
                if (a > 0) {
                    focusState.phase = "short_break";
                    focusState.fullDuration = a;
                    focusState.remaining = a;
                    try {
                        if (!ap || ap.notify !== false) {
                            let t = chrome.runtime.getURL("assets/icons/icon128.png");
                            chrome.notifications.create("focus_break_start_" + Date.now(), {
                                type: "basic",
                                iconUrl: t,
                                title: "Work Period Over! ☕",
                                message: "Time for a short break."
                            });
                        }
                    } catch (t) { }
                } else {
                    focusState.phase = "work";
                    focusState.fullDuration = e;
                    focusState.remaining = e;
                    focusState.startedAt = Date.now();
                }
            }
        } else {
            if ("long_break" === focusState.phase || focusState.cyclesCompleted >= o) {
                return await endFocusSession();
            } else {
                focusState.phase = "work";
                focusState.fullDuration = e;
                focusState.remaining = e;
                focusState.startedAt = Date.now();
                try {
                    if (!ap || ap.notify !== false) {
                        let t = chrome.runtime.getURL("assets/icons/icon128.png");
                        chrome.notifications.create("focus_work_" + Date.now(), {
                            type: "basic",
                            iconUrl: t,
                            title: "Break Over!",
                            message: "Time to focus."
                        });
                    }
                } catch (t) { }
            }
        }

        if (!focusState.active) return;

        if (ap && ap.autoStart) {
            focusState.paused = !1;
            focusState.startedAt = Date.now();
            focusState.phaseEndsAt = Date.now() + 1e3 * focusState.fullDuration;
            await chrome.alarms.create(FOCUS_ALARM, {
                when: focusState.phaseEndsAt
            });
        } else {
            focusState.paused = !0;
            focusState.phaseEndsAt = null;
        }
        updateBadge();
        await saveFocus();
        broadcastFocus();
        await updateDNRRules();
    } finally {
        _isHandlingPhaseEnd = false;
    }
}

async function computeStreak(dat) {
    const _ss = await getCachedSync();
    const st = _ss.settings || {};
    const cats = st.goalCats || ["productivity", "learning"];
    const showWasted = st.showWastedDays !== false;
    const minActiveSecs = 60 * (st.heatmapMinActive || 10);
    const ratioThresh = (st.heatmapRatioThresh || 50) / 100;
    const days = Object.keys(dat).sort();

    const checkActiveDay = async (dKey) => {
        const entry = dat[dKey];
        if (!entry) return false;
        
        let focus = 0;
        let prod = 0;
        let learn = 0;
        let distract = 0;
        let comm = 0;
        let unc = 0;
        
        if (entry.sites) {
            for (const [dom, s] of Object.entries(entry.sites)) {
                const cat = await categorize(dom);
                if (cats.includes(cat)) focus += s;
                if (cat === "productivity") prod += s;
                else if (cat === "learning") learn += s;
                else if (cat === "distraction") distract += s;
                else if (cat === "communication") comm += s;
                else if (cat === "uncategorized") unc += s;
            }
        } else {
            focus = cats.reduce((sum, c) => sum + (entry[c] || 0), 0);
            prod = entry.productivity || 0;
            learn = entry.learning || 0;
            distract = entry.distraction || 0;
            comm = entry.communication || 0;
            unc = entry.uncategorized || 0;
        }
        
        const total = prod + learn + distract + comm + unc;
        if (total < minActiveSecs) return false;
        
        const denominator = focus + distract;
        if (denominator === 0) return false;
        
        const ratio = focus / denominator;
        return ratio >= ratioThresh;
    };

    let bs = 0,
        bd = null,
        ms = 0,
        tmp = 0,
        lst = null;
    for (const d of days) {
        let focusSecs = 0;
        const entry = dat[d];
        if (entry) {
            if (entry.sites) {
                for (const [dom, s] of Object.entries(entry.sites)) {
                    const cat = await categorize(dom);
                    if (cats.includes(cat)) focusSecs += s;
                }
            } else {
                focusSecs = cats.reduce((sum, c) => sum + (entry[c] || 0), 0);
            }
        }
        if (focusSecs > ms) {
            ms = focusSecs;
            bd = d;
        }

        const isActive = await checkActiveDay(d);
        if (isActive) {
            if (!lst) tmp = 1;
            else {
                const pD = d.split("-"), pLst = lst.split("-");
                const dateD = new Date(parseInt(pD[0], 10), parseInt(pD[1], 10) - 1, parseInt(pD[2], 10));
                const dateLst = new Date(parseInt(pLst[0], 10), parseInt(pLst[1], 10) - 1, parseInt(pLst[2], 10));
                tmp = 1 === Math.round((dateD - dateLst) / 864e5) ? tmp + 1 : 1
            }
            lst = d, tmp > bs && (bs = tmp)
        }
    }
    let cur = 0,
        td = new Date,
        yd = new Date;
    yd.setDate(yd.getDate() - 1);
    let tdS = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, "0")}-${String(td.getDate()).padStart(2, "0")}`,
        ydS = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`,
        tdActive = await checkActiveDay(tdS),
        ydActive = await checkActiveDay(ydS),
        chk = new Date;
    if (tdActive) chk = td;
    else {
        if (!ydActive) return {
            currentStreak: 0,
            bestStreak: bs,
            bestDay: bd
        };
        chk = yd
    }
    for (; ;) {
        let str = `${chk.getFullYear()}-${String(chk.getMonth() + 1).padStart(2, "0")}-${String(chk.getDate()).padStart(2, "0")}`;
        const isActive = await checkActiveDay(str);
        if (!isActive) break;
        cur++, chk.setDate(chk.getDate() - 1);
        if (cur > 3650) break; // safety bound
    }
    return {
        currentStreak: cur,
        bestStreak: bs,
        bestDay: bd
    }
}

async function handle(t, e) {
    await restoreState();
    switch (t.type) {
        case "TRACKING_HEARTBEAT": {
            const domainStr = t.domain;
            const elapsed = Math.min(15, Math.max(1, t.elapsed || 10));
            if (!domainStr) return { ok: !1 };
            await sSession({ lastHeartbeatReceivedAt: Date.now() });
            const localData = await getCachedLocal();
            let isPrivacyActive = localData.privacyModeActive === true;
            if (isPrivacyActive) {
                if (localData.privacyModeUntil > 0 && Date.now() >= localData.privacyModeUntil) {
                    isPrivacyActive = false;
                    await sLocal({ privacyModeActive: false, privacyModeUntil: 0 });
                    await updateDNRRules();
                } else {
                    return { ok: !0 };
                }
            }
            const senderTabId = e.tab ? e.tab.id : null;
            await safeUpdateSession(async () => {
                const sess = (await gSession(["activeSession"])).activeSession;
                if (sess && sess.domain === domainStr && sess.startTime && (!senderTabId || sess.tabId === senderTabId)) {
                    const elapsedReal = Math.floor((Date.now() - sess.startTime) / 1000);
                    const finalElapsed = Math.min(elapsed, elapsedReal);
                    if (finalElapsed > 0) {
                        const settings = (await getCachedSync()).settings || {};
                        const minVisitSecs = settings.minVisitSecs || 0;
                        const visitDuration = Math.floor((Date.now() - (sess.visitStartTime || sess.startTime)) / 1000);
                        if (visitDuration >= minVisitSecs) {
                            const flushSecs = finalElapsed + (sess.accumulatedTime || 0);
                            await sSession({
                                activeSession: {
                                    domain: domainStr,
                                    startTime: Date.now(),
                                    visitStartTime: sess.visitStartTime || sess.startTime,
                                    accumulatedTime: 0,
                                    tabId: sess.tabId
                                }
                            });
                            await safeFlush(domainStr, flushSecs, Date.now() - finalElapsed * 1000);
                        } else {
                            await sSession({
                                activeSession: {
                                    domain: domainStr,
                                    startTime: Date.now(),
                                    visitStartTime: sess.visitStartTime || sess.startTime,
                                    accumulatedTime: (sess.accumulatedTime || 0) + finalElapsed,
                                    tabId: sess.tabId
                                }
                            });
                        }
                    }
                }
            });
            updateBadge();
            return { ok: !0 };
        }

        // FF v6.18: Content script fires this the instant the browser is minimized.
        // Stops the timer immediately without waiting for the 60s heartbeat.
        case "TRACKING_VISIBILITY_HIDDEN": {
            await safeUpdateSession(async () => {
                const o = (await gSession(["activeSession"])).activeSession;
                if (o && o.domain && o.startTime) {
                    const elapsed = Math.floor((Date.now() - o.startTime) / 1000);
                    const finalElapsed = capElapsed(elapsed);
                    if (finalElapsed > 0) {
                        const settings = (await getCachedSync()).settings || {};
                        const minVisitSecs = settings.minVisitSecs || 0;
                        const visitDuration = Math.floor((Date.now() - (o.visitStartTime || o.startTime)) / 1000);
                        if (visitDuration >= minVisitSecs) {
                            const flushSecs = finalElapsed + (o.accumulatedTime || 0);
                            await safeFlush(o.domain, flushSecs, o.startTime);
                        }
                    }
                    await sSession({ activeSession: { domain: null, startTime: null, visitStartTime: null, accumulatedTime: 0, tabId: null } });
                }
            });
            updateBadge();
            return { ok: !0 };
        }

        case "MEDIA_PING": {
            await sSession({ lastMediaPing: Date.now() });
            return { ok: !0 };
        }

        // FF v6.18: Content script fires this the instant the browser is restored.
        // Restarts the session and badge immediately.
        case "TRACKING_VISIBILITY_VISIBLE": {
            await handleTabChange();
            return { ok: !0 };
        }

        case "INJECT_GRANULAR_CSS": {
            // FF v4.4: re-apply granular CSS rules to a tab when the user toggles a tweak.
            try {
                const tabId = t.tabId;
                if (!tabId) return { ok: !1, error: "no tabId" };

                if (t.ruleId && CSS_MAP[t.ruleId]) {
                    if (t.enabled) {
                        await chrome.scripting.insertCSS({ target: { tabId }, css: CSS_MAP[t.ruleId], origin: "USER" }).catch(() => { });
                    } else {
                        await chrome.scripting.removeCSS({ target: { tabId }, css: CSS_MAP[t.ruleId], origin: "USER" }).catch(() => { });
                    }
                    return { ok: !0 };
                }

                const tab = await chrome.tabs.get(tabId).catch(() => null);
                if (!tab || !tab.url) return { ok: !1, error: "no tab" };
                const host = domain(tab.url);
                if (!host) return { ok: !1, error: "no host" };
                const { granularRules: rules = {} } = await getCachedLocal();
                const siteRules = rules[host] || {};

                for (const rId of Object.keys(CSS_MAP)) {
                    await chrome.scripting.removeCSS({ target: { tabId }, css: CSS_MAP[rId], origin: "USER" }).catch(() => { });
                }
                for (const rId of Object.keys(siteRules)) {
                    if (siteRules[rId] && CSS_MAP[rId]) {
                        await chrome.scripting.insertCSS({ target: { tabId }, css: CSS_MAP[rId], origin: "USER" }).catch(() => { });
                    }
                }
                return { ok: !0 };
            } catch (err) {
                return { ok: !1, error: err.message };
            }
        }
        case "STATS_SCRUB_DAY": {
            // Bug #7 fix: invalidate streak cache when day data changes
            _streakCache = null;
            // FF v4.4: subtract `secs` from a domain on a given day in IndexedDB.
            await FFDB.ensureMigrated();
            const day = t.day, dom = t.domain, secs = Math.max(0, t.secs | 0);
            if (!day || !dom || !secs) return { ok: !1 };
            const entry = await FFDB.getDay(day);
            if (!entry || !entry.sites || !entry.sites[dom]) return { ok: !1 };
            const cat = await categorize(dom);
            const cur = entry.sites[dom] || 0;
            const sub = Math.min(secs, cur);
            entry.sites[dom] = Math.max(0, cur - sub);
            entry[cat] = Math.max(0, (entry[cat] || 0) - sub);
            if (entry.sites[dom] === 0) delete entry.sites[dom];
            await FFDB.setDay(day, entry);
            if (day === todayKey()) {
                _todayDataCache = entry;
                _todayDataCacheKey = day;
            }
            // FF v6.17: keep allTimeTotals in sync with manual scrubs.
            try {
                const totals = await getAllTimeTotals();
                if (totals[dom] !== undefined) {
                    totals[dom] = Math.max(0, (totals[dom] || 0) - sub);
                    if (totals[dom] === 0) delete totals[dom];
                    await saveAllTimeTotals(totals);
                }
            } catch (err) {
                console.warn("[FF] Failed to scrub all-time totals:", err);
            }
            return { ok: !0 };
        }
        case "STATS_RESET_ALL": {
            // FF v4.4: wipe Dexie daily_logs + monthly_rollups + activeSession.
            _todayDataCache = null;
            _todayDataCacheKey = "";
            _allTimeTotalsCache = null; // Bug fix #3: invalidate all-time cache on full reset
            _streakCache = null;        // Invalidate streak cache on full reset
            _streakCacheDay = "";
            await FFDB.ensureMigrated();
            await FFDB.clearDays();
            await FFDB.setRollups({});
            try {
                await FFDB.deleteMeta("all_time_totals");
            } catch (_) {}
            // FF v6.17: also clear running totals + allow re-migration after backup restore.
            // Bug#9 fix: remove legacy ghost keys instead of writing empty objects
            await chrome.storage.local.remove(["daily", "monthly_rollups"]);
            await sSession({ activeSession: null });
            await sLocal({
                lastCompressedAt: 0,
            });
            await chrome.storage.local.remove([
                "focusHistory", "lastProductiveSite"
            ]);
            await updateDNRRules();
            return { ok: !0 };
        }
        case "BACKUP_EXPORT": {
            await FFDB.ensureMigrated();
            const daily = await FFDB.getAllDays();
            const rollups = await FFDB.getRollups();
            const local = await gLocal(["blockRules", "allowList", "siteCategories", "granularRules",
                "focusHistory", "cooldownConfig"]);
            const sync = await gSync(["settings", "focusPresets"]);
            const payload = {
                version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "unknown",
                exportedAt: Date.now(),
                daily, rollups,
                local,
                settings: sync.settings || {},
                focusPresets: sync.focusPresets || []
            };
            const id = "backup_" + Math.floor(Date.now() / 1000);
            await FFDB.saveLocalBackup(id, "Exported Backup", payload);
            return {
                ok: !0,
                payload
            };
        }
        case "CLOSE_CURRENT_TAB": {
            if (e && e.tab && e.tab.id) {
                await chrome.tabs.remove(e.tab.id).catch(() => {});
                return { ok: !0 };
            }
            return { ok: !1 };
        }
        case "INVALIDATE_CACHES": {
            _streakCache = null;
            _todayDataCache = null;
            _todayDataCacheKey = "";
            _allTimeTotalsCache = null;
            return { ok: true };
        }
        case "BACKUP_IMPORT": {
            // Bug #7 fix: invalidate streak cache on import since all data changes
            _streakCache = null;
            _todayDataCache = null;
            _todayDataCacheKey = "";
            _allTimeTotalsCache = null; // Bug fix #3: invalidate all-time cache on import
            // FF v4.7: replace all data with provided payload (caller must confirm).
            // FF v6.17: stricter shape validation — daily/rollups/local/settings must be plain objects
            // (not arrays, not strings) and daily values must look like day entries.
            const p = t.payload || {};
            const isPlainObj = (v) => v && typeof v === "object" && !Array.isArray(v);
            if (!isPlainObj(p)) return { ok: !1, error: "invalid payload" };
            const fields = ["daily", "rollups", "local", "settings"];
            for (const f of fields) {
                if (p[f] !== undefined && !isPlainObj(p[f])) {
                    return { ok: !1, error: `invalid field: ${f}` };
                }
            }
            if (p.focusPresets !== undefined && !Array.isArray(p.focusPresets)) {
                return { ok: !1, error: "invalid field: focusPresets" };
            }
            if (isPlainObj(p.daily)) {
                for (const [day, entry] of Object.entries(p.daily)) {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isPlainObj(entry)) {
                        return { ok: !1, error: `invalid daily entry: ${day}` };
                    }
                }
            }
            if (isPlainObj(p.rollups)) {
                for (const month of Object.keys(p.rollups)) {
                    if (!/^\d{4}-\d{2}$/.test(month) || !isPlainObj(p.rollups[month])) {
                        return { ok: !1, error: `invalid rollup: ${month}` };
                    }
                }
            }
            try {
                await FFDB.ensureMigrated();

                // Snapshot current configuration before clearing storage
                const snapshotSync = await gSync(["settings", "focusPresets"]);
                const snapshotLocal = await gLocal([
                    "blockRules", "allowList", "siteCategories", "granularRules",
                    "focusHistory", "cooldownConfig", "favicons", "hiddenDefaultSites"
                ]);

                // Auto-save current state as a local backup named "Pre-Import Backup"
                try {
                    const preDaily = await FFDB.getAllDays();
                    const preRollups = await FFDB.getRollups();
                    const prePayload = {
                        version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "unknown",
                        exportedAt: Date.now(),
                        daily: preDaily,
                        rollups: preRollups,
                        local: snapshotLocal,
                        settings: snapshotSync.settings || {},
                        focusPresets: snapshotSync.focusPresets || []
                    };
                    const preId = "backup_preimport_" + Math.floor(Date.now() / 1000);
                    await FFDB.saveLocalBackup(preId, "Pre-Import Backup", prePayload);
                } catch (errBackup) {
                    console.warn("Failed to create pre-import backup:", errBackup);
                }

                // Wipe and import days first (if writing fails, local storage won't be cleared)
                await FFDB.clearDays();
                if (isPlainObj(p.daily)) {
                    await FFDB.bulkSetDays(p.daily);
                    await FFDB.optimizeTimelines();
                }
                if (isPlainObj(p.rollups)) await FFDB.setRollups(p.rollups);



                // Merge local configurations
                const mergedLocal = {
                    blockRules: p.local?.blockRules ?? snapshotLocal.blockRules ?? [],
                    allowList: p.local?.allowList ?? snapshotLocal.allowList ?? [],
                    siteCategories: p.local?.siteCategories ?? snapshotLocal.siteCategories ?? {},
                    granularRules: p.local?.granularRules ?? snapshotLocal.granularRules ?? {},
                    focusHistory: p.local?.focusHistory ?? snapshotLocal.focusHistory ?? [],
                    cooldownConfig: p.local?.cooldownConfig ?? snapshotLocal.cooldownConfig ?? {},
                    favicons: p.local?.favicons ?? snapshotLocal.favicons ?? {},
                    hiddenDefaultSites: p.local?.hiddenDefaultSites ?? snapshotLocal.hiddenDefaultSites ?? []
                };
                await sLocal(mergedLocal);

                // Merge settings
                const mergedSettings = {
                    ...(snapshotSync.settings || {}),
                    ...(p.settings || {})
                };
                await sSync({ settings: mergedSettings });

                // Merge presets
                const mergedPresets = (p.focusPresets && p.focusPresets.length > 0)
                    ? p.focusPresets
                    : (snapshotSync.focusPresets || []);
                await sSync({ focusPresets: mergedPresets });

                // Return success immediately to avoid message port timeout on heavy JSON files
                const response = { ok: !0 };

                // FF v6.17: rebuild allTimeTotals from imported days in background.
                (async () => {
                    try {
                        await sLocal({ lastCompressedAt: 0 });
                        try {
                            await FFDB.deleteMeta("all_time_totals");
                        } catch (_) {}
                        await getAllTimeTotals();
                        await updateDNRRules();
                    } catch (err) {
                        console.error("Post-import migration failed", err);
                    }
                })();

                return response;
            } catch (err) {
                return { ok: !1, error: "import failed: " + (err && err.message || err) };
            }
        }
        case "BACKUP_LIST_GET": {
            const list = await FFDB.getLocalBackupsList();
            return { ok: true, list };
        }
        case "BACKUP_CREATE_LOCAL": {
            await FFDB.ensureMigrated();
            const daily = await FFDB.getAllDays();
            const rollups = await FFDB.getRollups();
            const local = await gLocal(["blockRules", "allowList", "siteCategories", "granularRules",
                "focusHistory", "cooldownConfig"]);
            const sync = await gSync(["settings", "focusPresets"]);
            const payload = {
                version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "unknown",
                exportedAt: Date.now(),
                daily, rollups,
                local,
                settings: sync.settings || {},
                focusPresets: sync.focusPresets || []
            };
            const id = "backup_" + Math.floor(Date.now() / 1000);
            await FFDB.saveLocalBackup(id, t.label || "Manual Backup", payload);
            return { ok: true, id };
        }
        case "BACKUP_DELETE_LOCAL": {
            if (!t.id) return { ok: false, error: "Missing backup ID" };
            await FFDB.deleteLocalBackup(t.id);
            return { ok: true };
        }
        case "BACKUP_RESTORE_LOCAL": {
            if (!t.id) return { ok: false, error: "Missing backup ID" };
            const payload = await FFDB.getLocalBackupData(t.id);
            if (!payload) return { ok: false, error: "Backup data not found" };

            // Invalidate caches
            _streakCache = null;
            _todayDataCache = null;
            _todayDataCacheKey = "";
            _allTimeTotalsCache = null;

            const p = payload || {};
            const isPlainObj = (v) => v && typeof v === "object" && !Array.isArray(v);
            if (!isPlainObj(p)) return { ok: !1, error: "invalid payload" };
            const fields = ["daily", "rollups", "local", "settings"];
            for (const f of fields) {
                if (p[f] !== undefined && !isPlainObj(p[f])) {
                    return { ok: !1, error: `invalid field: ${f}` };
                }
            }
            if (p.focusPresets !== undefined && !Array.isArray(p.focusPresets)) {
                return { ok: !1, error: "invalid field: focusPresets" };
            }
            if (isPlainObj(p.daily)) {
                for (const [day, entry] of Object.entries(p.daily)) {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isPlainObj(entry)) {
                        return { ok: !1, error: `invalid daily entry: ${day}` };
                    }
                }
            }
            if (isPlainObj(p.rollups)) {
                for (const month of Object.keys(p.rollups)) {
                    if (!/^\d{4}-\d{2}$/.test(month) || !isPlainObj(p.rollups[month])) {
                        return { ok: !1, error: `invalid rollup: ${month}` };
                    }
                }
            }

            try {
                await FFDB.ensureMigrated();
                const snapshotSync = await gSync(["settings", "focusPresets"]);
                const snapshotLocal = await gLocal([
                    "blockRules", "allowList", "siteCategories", "granularRules",
                    "focusHistory", "cooldownConfig", "favicons", "hiddenDefaultSites"
                ]);

                // Wipe and import days first (if writing fails, local storage won't be cleared)
                await FFDB.clearDays();
                if (isPlainObj(p.daily)) await FFDB.bulkSetDays(p.daily);
                if (isPlainObj(p.rollups)) await FFDB.setRollups(p.rollups);

                const mergedLocal = {
                    blockRules: p.local?.blockRules ?? snapshotLocal.blockRules ?? [],
                    allowList: p.local?.allowList ?? snapshotLocal.allowList ?? [],
                    siteCategories: p.local?.siteCategories ?? snapshotLocal.siteCategories ?? {},
                    granularRules: p.local?.granularRules ?? snapshotLocal.granularRules ?? {},
                    focusHistory: p.local?.focusHistory ?? snapshotLocal.focusHistory ?? [],
                    cooldownConfig: p.local?.cooldownConfig ?? snapshotLocal.cooldownConfig ?? {},
                    favicons: p.local?.favicons ?? snapshotLocal.favicons ?? {},
                    hiddenDefaultSites: p.local?.hiddenDefaultSites ?? snapshotLocal.hiddenDefaultSites ?? []
                };
                await sLocal(mergedLocal);

                const mergedSettings = {
                    ...(snapshotSync.settings || {}),
                    ...(p.settings || {})
                };
                await sSync({ settings: mergedSettings });

                const mergedPresets = (p.focusPresets && p.focusPresets.length > 0)
                    ? p.focusPresets
                    : (snapshotSync.focusPresets || []);
                await sSync({ focusPresets: mergedPresets });

                (async () => {
                    try {
                        await sLocal({ lastCompressedAt: 0 });
                        try {
                            await FFDB.deleteMeta("all_time_totals");
                        } catch (_) {}
                        await getAllTimeTotals();
                        await updateDNRRules();
                    } catch (err) {
                        console.error("Post-import migration failed", err);
                    }
                })();

                return { ok: true };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        }
        case "GET_COOLDOWNS": {
            const { cooldownConfig = {} } = await gLocal(["cooldownConfig"]);
            return { cooldowns: cooldownConfig.domains || [], settings: cooldownConfig.settings || {}, reasons: cooldownConfig.reasons || {} };
        }
        case "SET_COOLDOWNS": {
            const { cooldownConfig = {} } = await gLocal(["cooldownConfig"]);
            cooldownConfig.domains = Array.isArray(t.cooldowns) ? t.cooldowns : [];
            await sLocal({ cooldownConfig });
            return { ok: !0 };
        }
        case "SET_COOLDOWN_SETTINGS": {
            if (!t.settings || typeof t.settings !== "object") return { ok: !1, error: "invalid settings" };
            const { cooldownConfig = {} } = await gLocal(["cooldownConfig"]);
            cooldownConfig.settings = t.settings;
            await sLocal({ cooldownConfig });
            return { ok: !0 };
        }
        case "GET_LAST_PRODUCTIVE": {
            // New: return last domain visited in a productive category
            const { lastProductiveSite = null } = await gLocal(["lastProductiveSite"]);
            return { domain: lastProductiveSite };
        }
        case "GET_AUTO_CATEGORIES":
            return {
                autoCategories: AUTO_CATEGORIES
            };
        case "FOCUS_START":
            return await startFocus(null), {
                ok: !0,
                focusState: {
                    ...focusState
                }
            };
        case "FOCUS_STOP":
            return await stopFocus(), {
                ok: !0,
                focusState: {
                    ...focusState
                }
            };
        case "FOCUS_PAUSE":
            return await pauseFocus(), {
                ok: !0,
                focusState: {
                    ...focusState
                }
            };
        case "FOCUS_RESUME":
            return await resumeFocus(), {
                ok: !0,
                focusState: {
                    ...focusState
                }
            };
        case "FOCUS_SKIP":
            return await skipFocus(), {
                ok: !0,
                focusState: {
                    ...focusState
                }
            };
        case "FOCUS_GET_STATE":
            await restoreState();
            if (focusState.active && !focusState.paused && focusState.phaseEndsAt && Date.now() >= focusState.phaseEndsAt) {
                await handleFocusPhaseEnd();
            } else {
                syncFocusRemaining();
            }
            return {
                focusState: {
                    ...focusState
                }
            };
        case "PRESETS_GET": {
            const presets = await ensurePresets();
            const _ss = await getCachedSync();
            const ss = _ss.settings || {};
            return { presets, activeId: ss.activePresetId || presets[0]?.id || null };
        }
        case "PRESETS_SAVE": {
            const arr = Array.isArray(t.presets) ? t.presets : [];
            await sSync({ focusPresets: arr });
            return { ok: !0 };
        }
        case "PRESETS_SET_ACTIVE": {
            if (focusState.active) return { ok: !1, error: "focus_active" };
            const _ss = await getCachedSync();
            const ss = { ...(_ss.settings || {}) };
            ss.activePresetId = t.id;
            await sSync({ settings: ss });
            return { ok: !0 };
        }
        case "TRIGGER_DNR_UPDATE":
            return await updateDNRRules(), {
                ok: !0
            };
        case "STATS_GET_DAY": {
            await FFDB.ensureMigrated();
            const data = await FFDB.getDay(t.day || todayKey());
            return { data: data || null };
        }
        case "STATS_GET_RANGE": {
            await FFDB.ensureMigrated();
            const data = await FFDB.getDays(t.days || []);
            return { data };
        }
        case "STATS_GET_ALLTIME_TOTALS": {
            await FFDB.ensureMigrated();
            const totals = await getAllTimeTotals();
            return { allTimeTotals: totals };
        }
        case "STATS_GET_TOTAL_DAYS": {
            await FFDB.ensureMigrated();
            const keys = await FFDB.getDayKeys();
            if (!keys || !keys.length) return { totalDays: 1 };
            const parts = keys[0].split("-");
            const oldestDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            oldestDate.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diffMs = today.getTime() - oldestDate.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
            return { totalDays: Math.max(1, diffDays) };
        }
        case "STATS_GET_ROLLUPS": {
            // New in v4.2: monthly summaries for >90 day history.
            await FFDB.ensureMigrated();
            return { rollups: await FFDB.getRollups() };
        }
        case "STATS_GET_WEEK": {
            // FF v4.2: anchor to true calendar week (Mon/Sun configurable) — no more sliding 7-day window.
            await FFDB.ensureMigrated();
            const _ss = await getCachedSync();
            const a = _ss.settings || {};
            const s = a.goalCats || ["productivity", "learning"];
            const weekStartsOn = a.weekStartsOn === "sun" ? 0 : 1; // 0=Sun, 1=Mon (default)
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const dow = now.getDay();
            const diff = (dow - weekStartsOn + 7) % 7;
            const start = new Date(now); start.setDate(now.getDate() - diff);
            const days = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(start); d.setDate(start.getDate() + i);
                if (d > now) break; // don't include future days
                days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
            }
            const e = await FFDB.getDays(days);
            let studySecs = 0;
            for (const k of days) {
                const entry = e[k];
                if (entry) {
                    if (entry.sites) {
                        for (const [dom, secs] of Object.entries(entry.sites)) {
                            const cat = await categorize(dom);
                            if (s.includes(cat)) {
                                studySecs += secs;
                            }
                        }
                    } else {
                        studySecs += s.reduce((u, c) => u + (entry[c] || 0), 0);
                    }
                }
            }
            return {
                studySecs,
                goalSecs: 3600 * (a.weeklyGoalHours || 0),
                goalHours: a.weeklyGoalHours || 0,
                weekStart: days[0] || null,
                weekStartsOn: weekStartsOn === 0 ? "sun" : "mon"
            }
        }
        case "STATS_GET_STREAK": {
            // Bug #7 fix: cache streak result to avoid expensive getAllDays() on every poll
            // FF v6.18: also invalidate when the calendar day changes (midnight rollover)
            await FFDB.ensureMigrated();
            const _now = Date.now();
            const _today = todayKey();
            if (_streakCache && _streakCacheDay === _today && (_now - _streakCache.ts) < 3600000) {
                return { streak: _streakCache.data };
            }
            const daily = await FFDB.getAllDays();
            // FF v6.7.0: Add currently active session to daily totals before computing streak to eliminate lag
            const sess = (await gSession(["activeSession"])).activeSession;
            if (sess && sess.domain && sess.startTime) {
                const elapsed = Math.floor((Date.now() - sess.startTime) / 1000);
                if (elapsed > 0) {
                    const today = _today;
                    if (!daily[today]) daily[today] = { sites: {} };
                    const cat = await categorize(sess.domain);
                    daily[today][cat] = (daily[today][cat] || 0) + elapsed;
                    daily[today].sites[sess.domain] = (daily[today].sites[sess.domain] || 0) + elapsed;
                }
            }
            const _streakData = await computeStreak(daily);
            _streakCache = { data: _streakData, ts: _now };
            _streakCacheDay = _today;
            return { streak: _streakData };
        }
        case "GET_SITE_CATEGORIES": {
            const {
                siteCategories: t = {}
            } = await gLocal(["siteCategories"]);
            return {
                siteCategories: t
            }
        }
        case "CATEGORIZE_SITE": {
            const {
                siteCategories: e = {},
                hiddenDefaultSites: h = []
            } = await gLocal(["siteCategories", "hiddenDefaultSites"]);
            const clean = sanitizeDomain(t.domain);
            e[t.domain] = t.category;
            e[clean] = t.category;
            const noWww = clean.replace(/^www\./, "");
            if (clean.startsWith("www.")) {
                e[noWww] = t.category;
            } else {
                e["www." + clean] = t.category;
            }
            const newHidden = h.filter(d => d !== clean && d !== noWww && d !== t.domain);
            await sLocal({
                siteCategories: e,
                hiddenDefaultSites: newHidden
            });
            if (_storCache.local && _storCache.local.data) {
                _storCache.local.data.siteCategories = e;
                _storCache.local.data.hiddenDefaultSites = newHidden;
            }
            await updateRules();
            return {
                ok: !0
            };
        }
        case "GET_VISITED_SITES": {
            await FFDB.ensureMigrated();
            const all = await FFDB.getAllDays();
            const visited = new Set();
            for (const entry of Object.values(all)) {
                if (!entry || !entry.sites) continue;
                for (const domain of Object.keys(entry.sites)) {
                    visited.add(domain);
                }
            }
            const { siteCategories = {}, blockRules = [] } = await gLocal(["siteCategories", "blockRules"]);
            Object.keys(siteCategories).forEach(d => visited.add(d));
            blockRules.forEach(r => { if (r.domain) visited.add(r.domain); });
            return {
                visitedSites: Array.from(visited)
            }
        }
        case "UPDATE_IDLE": {
            const _ss = await getCachedSync();
            const t = _ss.settings || {};
            chrome.idle.setDetectionInterval(t.idleTimeout || 30);
            updateBadge();
            return {
                ok: !0
            }
        }
        case "GET_FOCUS_HISTORY": {
            const {
                focusHistory: t = []
            } = await gLocal(["focusHistory"]);
            return {
                focusHistory: t
            }
        }
        case "CLEAR_FOCUS_HISTORY":
            return await sLocal({
                focusHistory: []
            }), {
                ok: !0
            }
        case "DELETE_FOCUS_SESSION": {
            const payloadIdx = parseInt(t.idx);
            const { focusHistory: hist = [] } = await gLocal(["focusHistory"]);
            if (isNaN(payloadIdx) || payloadIdx < 0 || payloadIdx >= hist.length) return { ok: false };
            hist.splice(payloadIdx, 1);
            await sLocal({ focusHistory: hist });
            return { ok: true };
        }
        case "START_PRIVACY_MODE": {
            if (focusState.active) return { ok: false, error: "focus_active" };
            const duration = parseInt(t.duration) || 0;
            const until = duration > 0 ? Date.now() + duration * 60 * 1000 : 0;
            await sLocal({ privacyModeActive: true, privacyModeUntil: until });
            if (duration > 0) {
                await chrome.alarms.create("privacy_mode_end", { delayInMinutes: duration });
            } else {
                await chrome.alarms.clear("privacy_mode_end");
            }
            await safeUpdateSession(async () => {
                const o = (await gSession(["activeSession"])).activeSession;
                if (o && o.domain && o.startTime) {
                    const elapsed = Math.floor((Date.now() - o.startTime) / 1000);
                    const finalElapsed = capElapsed(elapsed);
                    if (finalElapsed > 0) {
                        const settings = (await getCachedSync()).settings || {};
                        const minVisitSecs = settings.minVisitSecs || 0;
                        const visitDuration = Math.floor((Date.now() - (o.visitStartTime || o.startTime)) / 1000);
                        if (visitDuration >= minVisitSecs) {
                            const flushSecs = finalElapsed + (o.accumulatedTime || 0);
                            await safeFlush(o.domain, flushSecs, o.startTime);
                        }
                    }
                }
                await sSession({ activeSession: { domain: null, startTime: null, visitStartTime: null, accumulatedTime: 0 } });
            });
            await updateDNRRules();
            updateBadge();
            return { ok: true };
        }
        case "STOP_PRIVACY_MODE": {
            await sLocal({ privacyModeActive: false, privacyModeUntil: 0 });
            await chrome.alarms.clear("privacy_mode_end");
            await updateDNRRules();
            await handleTabChange();
            updateBadge();
            return { ok: true };
        }
        case "GET_PRIVACY_STATE": {
            const localData = await gLocal(["privacyModeActive", "privacyModeUntil"]);
            let active = localData.privacyModeActive === true;
            let until = localData.privacyModeUntil || 0;
            if (active && until > 0 && Date.now() >= until) {
                active = false;
                until = 0;
                await sLocal({ privacyModeActive: false, privacyModeUntil: 0 });
                await updateDNRRules();
            }
            return { active, until };
        }
        default:
            return {
                ok: !0
            }
    }
}


async function restoreState() {
    const t = await gLocal(["focusSession"]);
    if (t && t.focusSession) {
        focusState = {
            ...focusState,
            ...t.focusSession
        };
        if (focusState.active && focusState.paused && focusState.pausedAt) {
            if (Date.now() - focusState.pausedAt >= 300000) {
                await stopFocus();
                return;
            }
        }
        if (focusState.active && !focusState.paused && focusState.phaseEndsAt) {
            if (Date.now() >= focusState.phaseEndsAt) {
                await handleFocusPhaseEnd();
            }
        }
    }
}


async function ensureHeartbeatAlarm() {
    try {
        const alarm = await chrome.alarms.get("tracker_heartbeat");
        if (!alarm) {
            await chrome.alarms.create("tracker_heartbeat", { periodInMinutes: 1 });
        }
    } catch (_) {}
}

async function init() {
    try {
        const { customCategories } = await gSync(["customCategories"]);
        if (customCategories && typeof applyCustomCategories === "function") {
            applyCustomCategories(customCategories);
        }
    } catch (_) {}
    await restoreFlushQueue().catch(() => { }); // Bug#3 fix: restore queued flushes from session storage
    const t = await gLocal(["focusSession"]);
    t.focusSession && (focusState = {
        ...focusState,
        ...t.focusSession
    });
    // FF v4.2: migrate chrome.storage.local.daily → IndexedDB on first run, then compact.
    await FFDB.ensureMigrated();
    try { await getAllTimeTotals(); } catch (err) { console.warn("[FF] Failed to build allTimeTotals in init:", err); }
    
    // FF v6.18: Automatically clean up legacy ghost data from storage to save space.
    try { await chrome.storage.local.remove(["daily", "monthly_rollups"]); } catch (_) {}

    // Sync focusPresets migration from local to sync storage
    try {
        const { focusPresets: localPresets } = await gLocal(["focusPresets"]);
        if (localPresets && localPresets.length) {
            const { focusPresets: syncPresets } = await gSync(["focusPresets"]);
            if (!syncPresets || !syncPresets.length) {
                await sSync({ focusPresets: localPresets });
                console.log("[FF] Migrated focusPresets from local to sync storage");
            }
            await chrome.storage.local.remove(["focusPresets"]);
        }
    } catch (_) {}

    // Bug fix #2: clean up accumulated notified_* and stopped_sched_* keys older than yesterday.
    try {
        const _allStor = await new Promise(res => chrome.storage.local.get(null, res));
        const _todayStr = todayKey();
        const _yd = new Date(); _yd.setDate(_yd.getDate() - 1);
        const _yesterdayStr = `${_yd.getFullYear()}-${String(_yd.getMonth()+1).padStart(2,'0')}-${String(_yd.getDate()).padStart(2,'0')}`;
        const _staleKeys = [];

        const _staleNotifyKeys = Object.keys(_allStor).filter(k => {
            if (!k.startsWith('notified_')) return false;
            const datePart = k.slice(-10); // last 10 chars are YYYY-MM-DD
            return datePart !== _todayStr && datePart !== _yesterdayStr;
        });
        _staleKeys.push(..._staleNotifyKeys);

        Object.keys(_allStor).forEach(k => {
            if (k.startsWith('stopped_sched_') && k.endsWith('_at')) {
                const val = _allStor[k];
                if (typeof val === 'number' && (Date.now() - val) > 86400000) {
                    _staleKeys.push(k);
                }
            }
        });

        if (_staleKeys.length) {
            await chrome.storage.local.remove(_staleKeys);
            console.log(`[FF] cleaned up ${_staleKeys.length} stale scheduled session tracking keys`);
        }
    } catch (_) {}

    // Clean up cooldownPassedAt old timestamps to prevent storage bloat
    try {
        const _res = await chrome.storage.local.get(["cooldownPassedAt"]);
        if (_res && _res.cooldownPassedAt) {
            const _passed = _res.cooldownPassedAt;
            const _now = Date.now();
            let _changed = false;
            for (const [dom, ts] of Object.entries(_passed)) {
                if (typeof ts !== 'number' || (_now - ts) > 86400000) {
                    delete _passed[dom];
                    _changed = true;
                }
            }
            if (_changed) {
                await chrome.storage.local.set({ cooldownPassedAt: _passed });
                console.log("[FF] cleaned up stale cooldownPassedAt bypass entries");
            }
        }
    } catch (_) {}

    // FF v6.18: Migrate 5 disjointed cooldown keys to single cooldownConfig
    try {
        const _oldCd = await gLocal(["cooldownDomains", "cooldownSettings", "cooldownReasons", "cooldownBlockActive", "activeCooldownDomains", "cooldownConfig"]);
        
        const hasOldKeys = _oldCd.cooldownDomains !== undefined || 
                           _oldCd.cooldownSettings !== undefined || 
                           _oldCd.cooldownReasons !== undefined || 
                           _oldCd.cooldownBlockActive !== undefined || 
                           _oldCd.activeCooldownDomains !== undefined;

        if (hasOldKeys && !_oldCd.cooldownConfig) {
            const _newCd = {
                domains: _oldCd.cooldownDomains || [],
                settings: _oldCd.cooldownSettings || {},
                reasons: _oldCd.cooldownReasons || {},
                blockActive: _oldCd.cooldownBlockActive || {},
                activeDomains: _oldCd.activeCooldownDomains || []
            };
            await sLocal({ cooldownConfig: _newCd });
        }
        
        // Always clean up legacy storage keys to keep the database tidy
        await chrome.storage.local.remove([
            "cooldownDomains", "cooldownSettings", "cooldownReasons", 
            "cooldownBlockActive", "activeCooldownDomains", 
            "allTimeTotals", "allTimeMigrated"
        ]);
    } catch (_) {}
    await compressOldData();
    const _scRes = await gLocal(["siteCategories", "presetsPreApplied"]);
    if (!_scRes.presetsPreApplied) {
        const scMap = _scRes.siteCategories || {};
        Object.entries(AUTO_CATEGORIES).forEach(([dom, cat]) => {
            if (!scMap[dom]) scMap[dom] = cat;
        });
        await sLocal({ siteCategories: scMap, presetsPreApplied: true });
    }
    try {
        const _alRes = await gLocal(["allowList", "ssoPreApplied"]);
        if (!_alRes.ssoPreApplied) {
            const al = _alRes.allowList || [];
            const defaults = [
                "accounts.google.com",
                "accounts.youtube.com",
                "login.live.com",
                "login.microsoftonline.com",
                "appleid.apple.com"
            ];
            defaults.forEach(dom => {
                if (!al.includes(dom)) al.push(dom);
            });
            await sLocal({ allowList: al, ssoPreApplied: true });
        }
    } catch (_) {}
    await updateDNRRules();
    const e = await getCachedSync();
    chrome.idle.setDetectionInterval(e.settings?.idleTimeout || 30), await chrome.alarms.create("tracker_heartbeat", {
        periodInMinutes: 1
    }), handleTabChange()
}
chrome.runtime.onMessage.addListener((t, e, a) => (handle(t, e).then(a).catch(t => a({
    error: t.message
})), !0)), chrome.alarms.onAlarm.addListener(async t => {
    await restoreState();
    if ("privacy_mode_end" === t.name) {
        await sLocal({ privacyModeActive: false, privacyModeUntil: 0 });
        await updateDNRRules();
        await handleTabChange();
        updateBadge();
        return;
    }
    if ("tracker_heartbeat" === t.name) {
        const _today = todayKey();
        await safeUpdateSession(async () => {
            const t = (await gSession(["activeSession"])).activeSession;
            if (t && t.domain && t.startTime) {
                // Content script handles minimize instantly via TRACKING_VISIBILITY_HIDDEN.
                // Heartbeat only runs here as a safety net (e.g. extension pages with no content script).
                const e = Date.now(),
                    a = Math.floor((e - t.startTime) / 1e3);
                if (a > 0) {
                    const elapsed = capElapsed(a);
                    if (elapsed > 0) {
                        const settings = (await getCachedSync()).settings || {};
                        const minVisitSecs = settings.minVisitSecs || 0;
                        const visitDuration = Math.floor((Date.now() - (t.visitStartTime || t.startTime)) / 1000);
                        if (visitDuration >= minVisitSecs) {
                            const flushSecs = elapsed + (t.accumulatedTime || 0);
                            await safeFlush(t.domain, flushSecs, t.startTime);
                        }
                    }
                }
                await sSession({
                    activeSession: {
                        domain: t.domain,
                        startTime: e,
                        visitStartTime: t.visitStartTime || t.startTime,
                        accumulatedTime: Math.floor((Date.now() - (t.visitStartTime || t.startTime)) / 1000) >= ((await getCachedSync()).settings?.minVisitSecs || 0) ? 0 : (t.accumulatedTime || 0) + (a > 0 ? capElapsed(a) : 0),
                        tabId: t.tabId
                    }
                });
            }
        });
        await updateDNRRules(), await restoreState(), updateBadge(), focusState.active && !focusState.paused && (syncFocusRemaining(), broadcastFocus());
        if (!focusState.active) {
            try {
                const _ss = (await getCachedSync()).settings || {};
                const _schedules = _ss.focusSchedules || [];
                if (_schedules.length) {
                    const _now = new Date();
                    const _dow = _now.getDay();
                    const _hhmm = String(_now.getHours()).padStart(2, "0") + ":" + String(_now.getMinutes()).padStart(2, "0");
                    for (const _sc of _schedules) {
                        if (_sc.enabled === false) continue;
                        // FF v6.7.0: notify N minutes before schedule starts
                        if (_sc.notifyMinsBefore > 0 && _sc.startTime && Array.isArray(_sc.days) && _sc.days.includes(_dow)) {
                            const _notifyMins = parseInt(_sc.notifyMinsBefore) || 0;
                            const _startTotal = parseInt(_sc.startTime.split(":")[0]) * 60 + parseInt(_sc.startTime.split(":")[1]);
                            const _nowTotal = _now.getHours() * 60 + _now.getMinutes();
                            const _diff = _startTotal - _nowTotal;
                            // FF v6.7.0: more reliable range check (5 to 1 min before) + duplicate guard
                            if (_diff > 0 && _diff <= _notifyMins) {
                                const _scId = _sc.id || (_sc.startTime + _sc.endTime);
                                const _notifyKey = `notified_${_scId}_${_today}`;
                                const _already = (await chrome.storage.local.get([_notifyKey]))[_notifyKey];
                                if (!_already) {
                                    try {
                                        await chrome.storage.local.set({ [_notifyKey]: true });
                                        chrome.notifications.create("ff-sched-notify-" + Date.now(), {
                                            type: "basic",
                                            iconUrl: chrome.runtime.getURL("assets/icons/icon128.png"),
                                            title: "Flow - Session Starting Soon",
                                            message: '"' + (_sc.label || "Focus") + '" starts in ' + _diff + ' minute' + (_diff !== 1 ? 's' : '') + '.'
                                        });
                                    } catch (_) { }
                                }
                            }
                        }
                        if (_sc.startTime && _sc.endTime) {
                            const _scId = _sc.id || (_sc.startTime + _sc.endTime);
                            const _stoppedKey = `stopped_sched_${_scId}_at`;
                            if (isTimeWindowActive(_sc.startTime, _sc.endTime, _sc.days)) {
                                if (focusState.active) break;
                                let _windowMins = (parseInt(_sc.endTime.split(":")[0]) * 60 + parseInt(_sc.endTime.split(":")[1])) - (parseInt(_sc.startTime.split(":")[0]) * 60 + parseInt(_sc.startTime.split(":")[1]));
                                if (_windowMins < 0) _windowMins += 1440;
                                
                                // Zombie Schedule fix: skip if user manually stopped this specific schedule recently
                                let _zombieStopped = false;
                                try {
                                    const _res = await chrome.storage.local.get([_stoppedKey]);
                                    if (_res[_stoppedKey]) {
                                        if (Math.round((Date.now() - _res[_stoppedKey]) / 60000) < _windowMins) {
                                            _zombieStopped = true;
                                        }
                                    }
                                } catch (_) { }
                                if (_zombieStopped) continue;
                                
                                // Since we are starting the session, calculate how many minutes remain in the schedule window from NOW
                                const _nowMins = (new Date()).getHours() * 60 + (new Date()).getMinutes();
                                const _startMins = parseInt(_sc.startTime.split(":")[0]) * 60 + parseInt(_sc.startTime.split(":")[1]);
                                let _elapsed = _nowMins - _startMins;
                                if (_elapsed < 0) _elapsed += 1440;
                                let _remainingMins = _windowMins - _elapsed;
                                if (_remainingMins <= 0 || _remainingMins > _windowMins) _remainingMins = _windowMins; // fallback
                                
                                await startFocus(_remainingMins);
                                try {
                                    chrome.notifications.create("ff-sched-" + Date.now(), {
                                        type: "basic",
                                        iconUrl: chrome.runtime.getURL("assets/icons/icon128.png"),
                                        title: "Flow - Scheduled Session",
                                        message: "Auto-starting \"" + (_sc.label || "Focus") + "\" session."
                                    });
                                } catch (_) { }
                                break;
                            } else {
                                // Automatically clear the stop note when that schedule window ends
                                try {
                                    const _res = await chrome.storage.local.get([_stoppedKey]);
                                    if (_res[_stoppedKey]) {
                                        await chrome.storage.local.remove([_stoppedKey]);
                                    }
                                } catch (_) { }
                            }
                        }
                    }
                }
            } catch (_schedErr) { }
        }

    }


    if (t.name === PAUSE_EXPLOIT_ALARM) {
        await restoreState();
        if (focusState.active && focusState.paused) {
            await stopFocus();
        }
    }
    if (t.name === FOCUS_ALARM) {
        await restoreState();
        if (focusState.active && !focusState.paused && focusState.phaseEndsAt && Date.now() >= focusState.phaseEndsAt) {
            await handleFocusPhaseEnd();
        }
    }
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.customCategories && typeof applyCustomCategories === "function") {
        applyCustomCategories(changes.customCategories.newValue);
    }
    if (
        (area === "local" && (changes.allowList || changes.blockRules || changes.siteCategories)) ||
        (area === "sync" && (changes.focusPresets || changes.settings || changes.customCategories))
    ) {
        updateDNRRules();
    }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes.granularRules) {
        const oldRules = changes.granularRules.oldValue || {};
        const newRules = changes.granularRules.newValue || {};
        
        const allDomains = new Set([...Object.keys(oldRules), ...Object.keys(newRules)]);
        for (const dom of allDomains) {
            const oldDomRules = oldRules[dom] || {};
            const newDomRules = newRules[dom] || {};
            
            const allRuleIds = new Set([...Object.keys(oldDomRules), ...Object.keys(newDomRules)]);
            for (const ruleId of allRuleIds) {
                if (oldDomRules[ruleId] !== newDomRules[ruleId]) {
                    const enabled = newDomRules[ruleId] === true;
                    const tabs = await chrome.tabs.query({}).catch(() => []);
                    for (const tab of tabs) {
                        if (tab.id && tab.url) {
                            const tabDom = domain(tab.url);
                            if (tabDom === dom || tabDom.endsWith("." + dom)) {
                                if (CSS_MAP[ruleId]) {
                                    if (enabled) {
                                        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css: CSS_MAP[ruleId], origin: "USER" }).catch(() => { });
                                    } else {
                                        await chrome.scripting.removeCSS({ target: { tabId: tab.id }, css: CSS_MAP[ruleId], origin: "USER" }).catch(() => { });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        await updateRuleDomainsCache();
    }
});

// FF v6.17: a single onInstalled / onStartup pair. `init()` already calls
// `ensurePresets()` indirectly via `updateDNRRules → getActivePreset`, so the
// explicit second call has been removed (was seeding presets twice on first install).
chrome.runtime.onInstalled.addListener(async (details) => {
    try { await init(); } catch (e) { console.warn("[FF] onInstalled init failed", e); }
    try {
        chrome.runtime.setUninstallURL("https://docs.google.com/forms/d/e/1FAIpQLSelORGL9j0n_nudcnCKRpjQ1OctoPmTWSgZwYa6mPkGLwWm-Q/viewform?usp=publish-editor");
    } catch (e) {
        console.warn("[FF] Failed to set uninstall URL", e);
    }
});
chrome.runtime.onStartup.addListener(async () => {
    try {
        try {
            await sSession({
                activeSession: { domain: null, startTime: null, visitStartTime: null, accumulatedTime: 0, tabId: null }
            });
        } catch (_) {}
        await init();
    } catch (e) { console.warn("[FF] onStartup init failed", e); }
});





// =====================================================================
// FF v5.0 — Focus Presets module
// Each preset: { id, emoji, name, work, brk, longBrk, cycles, strict, blockCats }
// Defaults: 🍅 Pomodoro (25/5, strict off, blocks distractions),
//           🧠 Deep Work (90/15, strict on),
//           ⚡ Short Sprint (15/2, strict off).
// First-run migration: if user already has focusWork/focusBreak settings, append
// them as a 4th "⚙️ Custom" preset so nothing they configured is lost.
// =====================================================================
const FF_DEFAULT_PRESETS = [
    { id: "pomodoro", emoji: "🍅", name: "Pomodoro", work: 25, brk: 5, longBrk: 15, cycles: 4, strict: false, blockCats: [], notify: true, autoStart: true },
    { id: "deep_work", emoji: "🧠", name: "Deep Work", work: 90, brk: 15, longBrk: 30, cycles: 2, strict: false, blockCats: [], notify: true, autoStart: true },
    { id: "sprint", emoji: "⚡", name: "Short Sprint", work: 15, brk: 2, longBrk: 10, cycles: 4, strict: false, blockCats: [], notify: true, autoStart: true },
];

async function ensurePresets() {
    let { focusPresets } = await gSync(["focusPresets"]);
    if (!focusPresets || !focusPresets.length) {
        try {
            const { focusPresets: localPresets } = await gLocal(["focusPresets"]);
            if (localPresets && localPresets.length) {
                focusPresets = localPresets;
                await sSync({ focusPresets });
                await chrome.storage.local.remove(["focusPresets"]);
                console.log("[FF] Migrated presets from local to sync in ensurePresets()");
            }
        } catch (_) {}
    }
    const _ss = await getCachedSync();
    const s = _ss.settings || {};

    if (Array.isArray(focusPresets) && focusPresets.length) {
        let changed = false;

        // One-time migration of legacy cloud settings into the custom preset
        if (!s.settings_migrated_v1) {
            const customPreset = focusPresets.find(x => x.id === "custom");
            const hasLegacy = s.focusWork !== undefined || s.focusBreak !== undefined ||
                              s.focusLongBreak !== undefined || s.focusCycles !== undefined;
            if (hasLegacy) {
                if (customPreset) {
                    customPreset.work = s.focusWork ?? customPreset.work ?? 25;
                    customPreset.brk = s.focusBreak ?? customPreset.brk ?? 5;
                    customPreset.longBrk = s.focusLongBreak ?? customPreset.longBrk ?? 15;
                    customPreset.cycles = s.focusCycles ?? customPreset.cycles ?? 4;
                    customPreset.blockCats = s.focusBlockCats ?? customPreset.blockCats ?? [];
                    changed = true;
                }
            }
            s.settings_migrated_v1 = true;
            delete s.focusWork;
            delete s.focusBreak;
            delete s.focusLongBreak;
            delete s.focusCycles;
            delete s.focusBlockCats;
            await sSync({ settings: s });
        }

        // One-time migration: Clear all default blockCats from presets so they are unselected by default
        if (!s.presets_blockcats_cleared_v2) {
            focusPresets.forEach(p => {
                p.blockCats = [];
                if (p.cats) p.cats = [];
            });
            s.presets_blockcats_cleared_v2 = true;
            changed = true;
            await sSync({ settings: s });
        }

        focusPresets.forEach(p => { 
            if (p.autoStart === undefined) { p.autoStart = true; changed = true; }
            if (p.id === "custom" && p.name === "Custom") {
                p.name = "Flow";
                p.emoji = "🌊";
                changed = true;
            }
        });
        if (changed) await sSync({ focusPresets });
        return focusPresets;
    }

    // First run — seed defaults + (optional) user's existing single-timer config as a 4th preset
    const seeded = FF_DEFAULT_PRESETS.slice();
    const hasCustom =
        s.focusWork !== undefined || s.focusBreak !== undefined ||
        s.focusLongBreak !== undefined || s.focusCycles !== undefined;
    if (hasCustom) {
        seeded.push({
            id: "custom",
            emoji: "🌊",
            name: "Flow",
            work: s.focusWork ?? 25,
            brk: s.focusBreak ?? 5,
            longBrk: s.focusLongBreak ?? 15,
            cycles: s.focusCycles ?? 4,
            strict: false,
            blockCats: s.focusBlockCats || [],
            notify: true,
            autoStart: true,
        });
    } else {
        // Ensure "Flow" is present even if no legacy custom timer settings existed
        seeded.push({
            id: "custom",
            emoji: "🌊",
            name: "Flow",
            work: 25,
            brk: 5,
            longBrk: 15,
            cycles: 4,
            strict: false,
            blockCats: [],
            notify: true,
            autoStart: true,
        });
    }

    s.settings_migrated_v1 = true;
    s.presets_blockcats_cleared_v2 = true;
    delete s.focusWork;
    delete s.focusBreak;
    delete s.focusLongBreak;
    delete s.focusCycles;
    delete s.focusBlockCats;

    await sSync({ focusPresets: seeded });
    if (!s.activePresetId) {
        s.activePresetId = hasCustom ? "custom" : "pomodoro";
    }
    await sSync({ settings: s });
    return seeded;
}

async function getActivePreset() {
    try {
        const presets = await ensurePresets();
        const _ss = await getCachedSync();
        const s = _ss.settings || {};
        const id = s.activePresetId;
        return presets.find(p => p.id === id) || presets[0] || null;
    } catch (_) { return null; }
}
