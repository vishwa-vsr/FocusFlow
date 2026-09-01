import { uid, sanitizeDomain, formatTime12 } from "./modules/utils-helpers.js";
import { getPresetName, catColor, catEmoji, catLabel, allCats } from "./modules/category-helpers.js";
import { showEditPresetModal as showEditPresetModalModule } from "./modules/preset-editor.js";
import { updDots, showPass, checkGate, promptPinIfEnabled, initPinEventListeners } from "./modules/pin-security.js";

var $ = function (e) {
    return document.getElementById(e)
},
    _barChartInstance = null,
    _trendChartInstance = null,
    _donutChartInstance = null,
    _trendBarChartInstance = null,
    activeTrendView = "line",
    _currentFocusState = null,
    _lastFavPct = -1,
    _tabHidden = false,
    // Bug #5 fix: single reusable off-screen canvas for favicon painting
    _favCanvas = (() => { const c = document.createElement("canvas"); c.width = 32; c.height = 32; return c; })(),
    // Bug #8 fix: undo toast stack counter
    _toastStackCount = 0,
    rules = [],
    allowList = [],
    neverTrackDomains = [],
    siteCategories = {},
    visitedSites = [],
    hiddenDefaultSites = [];

window.siteCategories = siteCategories;
window.siteCats = siteCategories;
window.hiddenDefaultSites = hiddenDefaultSites;

var FCIRC = 2 * Math.PI * 106,
    selectedCat = "all",
    currentView = "today",
    analyticsRange = 7,
    siteRange = 7,
    trendRange = 7,
    dailyRange = 7,           // FF v4.2: was implicit 45, now defaults to 7d for instant load
    dailyCustomFrom = null,   // FF v4.2: ISO date string (YYYY-MM-DD)
    dailyCustomTo = null,
    overviewCustomFrom = null,  // FF v4.4
    overviewCustomTo = null,    // FF v4.4
    trendCustomFrom = null,     // FF v4.4
    trendCustomTo = null,       // FF v4.4
    currentATab = "overview",
    isBulkMode = !1,
    bulkSelected = new Set,
    DEFAULT_CATS = ["productivity", "learning", "distraction", "communication", "uncategorized"],
    // FF v6.16: CAT_META + GRANULAR_SITES used to be redefined here. They now
    // live in src/lib/constants.js so popup.js + dashboard.js stay in sync.
    CAT_META = self.CAT_META || {};
const GRANULAR_SITES_DASHBOARD = self.GRANULAR_SITES || {};

function getLocale() {
    let loc = "";
    if (typeof currentLanguage !== "undefined" && currentLanguage && currentLanguage !== "default" && currentLanguage !== "auto") {
        loc = currentLanguage;
    } else {
        const sel = document.getElementById("lang-sel")?.value;
        if (sel && sel !== "default" && sel !== "auto") {
            loc = sel;
        }
    }
    if (!loc || loc === "auto" || loc === "default") {
        if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function") {
            loc = chrome.i18n.getUILanguage();
        } else {
            loc = navigator.language || "en-US";
        }
    }
    return (loc || "en-US").replace(/_/g, "-").replace(/\s+/g, "-");
}

function hideAnalyticsHeader() {
    const _desc = $("analytics-page-header-desc");
    if (_desc) {
        _desc.style.display = "none";
        const _parent = _desc.parentElement;
        if (_parent) {
            Array.from(_parent.children).forEach(e => {
                if (e !== _desc) e.style.display = "none";
            });
            const ph = _parent.closest(".ph");
            if (ph) ph.style.display = "none";
        }
    }
    document.querySelectorAll('[data-atab="trend"]').forEach(e => e.textContent = t_("comparison"));
}

async function applyTheme() {
    const e = await gLocal(["theme"]);
    let currentTheme = e ? e.theme : "dark";
    
    if (currentTheme === "custom" || currentTheme === "rain" || currentTheme === "mountain" || currentTheme === "cinematic") {
        currentTheme = "dark";
        await sLocal({ theme: "dark" });
    }
    
    const t = "light" === currentTheme;
          
    document.documentElement.classList.toggle("light", t);
    document.documentElement.classList.remove("cinematic", "custom");
    document.documentElement.setAttribute("data-os-theme", "nothing");
    
    $("btn-dark-mode") && $("btn-dark-mode").classList.toggle("act", currentTheme === "dark");
    $("btn-light-mode") && $("btn-light-mode").classList.toggle("act", currentTheme === "light");
}

applyTheme();
chrome.storage.onChanged.addListener((e, t) => {
    if ("local" === t) {
        if (e.theme) {
            applyTheme();
            loadAnalytics();
        }
        if (e.siteCategories || e.hiddenDefaultSites) {
            if (e.siteCategories) {
                siteCategories = e.siteCategories.newValue || {};
                window.siteCategories = siteCategories;
                window.siteCats = siteCategories;
            }
            if (e.hiddenDefaultSites) {
                hiddenDefaultSites = e.hiddenDefaultSites.newValue || [];
                window.hiddenDefaultSites = hiddenDefaultSites;
            }
            const activeNav = document.querySelector(".ni.act");
            if (activeNav && activeNav.getAttribute("data-tab") === "sitemanager") {
                renderCategories();
            }
            loadAnalytics();
        }
        if (e.privacyModeActive || e.privacyModeUntil) {
            if (typeof window.updateDashboardPrivacyUI === "function") {
                window.updateDashboardPrivacyUI();
            }
        }

    }
    if ("sync" === t) {
        if (e.settings) {
            applyTheme();
        }
        if (e.customCategories) {
            if (typeof applyCustomCategories === "function") {
                applyCustomCategories(e.customCategories.newValue);
            }
            renderCategories();
            loadWeeklyGoalSettings();
            loadAnalytics();
        }
    }
}); $("btn-dark-mode") && $("btn-dark-mode").addEventListener("click", () => sLocal({
    theme: "dark"
})), $("btn-light-mode") && $("btn-light-mode").addEventListener("click", () => sLocal({
    theme: "light"
}));
var fmtT = fmtTimer;

function toast(e, t) {
    // Bug #7 fix: dfferentiate toast duration by severity
    const TOAST_DURATION = { ok: 3500, er: 5000, err: 5000 };
    var a = $("toast");
    if (!a) {
        a = document.createElement("div");
        a.id = "toast";
        document.body.appendChild(a);
    } else if (a.parentNode !== document.body) {
        document.body.appendChild(a);
    }
    const isError = t === "er" || t === "err";
    const prefix = isError ? "✗ " : ("ok" === t ? "✓ " : "");
    a.textContent = prefix + (e || "Settings saved successfully");
    a.style.setProperty("position", "fixed", "important");
    a.style.setProperty("bottom", "40px", "important");
    a.style.setProperty("left", "50%", "important");
    a.style.setProperty("transform", "translateX(-50%) translateY(0)", "important");
    a.style.setProperty("background", isError ? "#ef4444" : "#05D581", "important");
    a.style.setProperty("color", "#000000", "important");
    a.style.setProperty("padding", "12px 24px", "important");
    a.style.setProperty("border-radius", "12px", "important");
    a.style.setProperty("box-shadow", "0 10px 25px -5px rgba(0, 0, 0, 0.5)", "important");
    a.style.setProperty("z-index", "2147483647", "important");
    a.style.setProperty("font-weight", "800", "important");
    a.style.setProperty("font-size", "14px", "important");
    a.style.setProperty("display", "flex", "important");
    a.style.setProperty("align-items", "center", "important");
    a.style.setProperty("gap", "8px", "important");
    a.style.setProperty("opacity", "1", "important");
    a.style.setProperty("visibility", "visible", "important");
    a.style.setProperty("pointer-events", "auto", "important");
    a.style.setProperty("transition", "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)", "important");
    a.className = "toast " + (isError ? "er" : (t || ""));
    void a.offsetHeight;
    clearTimeout(a._tid);
    a._tid = setTimeout(() => {
        a.className = "toast hide";
        a.style.setProperty("display", "none", "important");
        a.style.setProperty("opacity", "0", "important");
        a.style.setProperty("visibility", "hidden", "important");
        a.style.setProperty("pointer-events", "none", "important");
    }, TOAST_DURATION[t] ?? 3500);
}
window.toast = toast;
initPinEventListeners();

document.addEventListener("keydown", e => {
    const confModal = $("confirm-modal");
    if (confModal && !confModal.classList.contains("hide")) {
        if ("Enter" === e.key) {
            e.preventDefault();
            e.stopPropagation();
            $("confirm-modal-yes").click();
        } else if ("Escape" === e.key) {
            e.preventDefault();
            e.stopPropagation();
            $("confirm-modal-no").click();
        }
    } else if ("Escape" === e.key) {
        let closedAny = false;
        const ftModal = $("free-time-modal");
        if (ftModal && !ftModal.classList.contains("hide")) {
            ftModal.classList.add("hide");
            closedAny = true;
        }
        const arModal = $("add-rule-modal");
        if (arModal && !arModal.classList.contains("hide")) {
            arModal.classList.add("hide");
            closedAny = true;
        }
        const sModal = $("scrubModal");
        if (sModal && !sModal.classList.contains("hide")) {
            sModal.classList.add("hide");
            closedAny = true;
        }
        if (closedAny) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
});

let confirmResolver = null;
function showConfirm(title, message, options = {}) {
    const modal = document.getElementById("confirm-modal");
    if (!modal) return Promise.resolve(confirm(message));
    document.getElementById("confirm-modal-title").textContent = title || "Are you sure?";
    const escapedMessage = String(message)
        .replace(/[&<>'\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c))
        .replace(/\n/g, "<br>");
    setSafeHTML(document.getElementById("confirm-modal-message"), escapedMessage);
    const iconWrap = document.getElementById("confirm-modal-icon-wrap");
    const yesBtn = document.getElementById("confirm-modal-yes");
    const noBtn = document.getElementById("confirm-modal-no");
    yesBtn.textContent = options.confirmText || "Confirm";
    noBtn.textContent = options.cancelText || "Cancel";
    if (options.isDestructive) {
        if (iconWrap) iconWrap.style.color = "var(--red)";
        yesBtn.style.background = "var(--red)";
        yesBtn.style.borderColor = "var(--red)";
        yesBtn.style.color = "#ffffff";
    } else {
        if (iconWrap) iconWrap.style.color = "var(--amber)";
        yesBtn.style.background = "var(--green)";
        yesBtn.style.borderColor = "rgba(255,255,255,.08)";
        yesBtn.style.color = "#0a0a0a";
    }
    modal.classList.remove("hide");
    return new Promise((resolve) => {
        confirmResolver = resolve;
    });
}
function initConfirmModal() {
    const modal = document.getElementById("confirm-modal");
    if (!modal) return;
    const yesBtn = document.getElementById("confirm-modal-yes");
    const noBtn = document.getElementById("confirm-modal-no");
    const closeBtn = document.getElementById("confirm-modal-close");
    const closeWithResult = (res) => {
        modal.classList.add("hide");
        if (confirmResolver) {
            const resolve = confirmResolver;
            confirmResolver = null;
            resolve(res);
        }
    };
    yesBtn.onclick = () => closeWithResult(true);
    noBtn.onclick = () => closeWithResult(false);
    closeBtn.onclick = () => closeWithResult(false);
}
initConfirmModal();
let activeScrubDay = null,
    activeScrubDom = null,
    activeScrubSecs = 0;

function injectScrubModal() {
    if (!$("scrubModal")) {
        var e = document.createElement("div");
        e.id = "scrubModal";
        e.className = "overlay hide";
        setSafeHTML(e, `
        <div class="card" style="width: 100%; max-width: 400px; padding: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--bg2); border: 1px solid var(--bd);">
          <div style="padding: 24px 32px 16px; border-bottom: 1px solid var(--bd); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
            <div style="font-size: 20px; font-weight: 800; color: var(--tx); display: flex; align-items: center; gap: 10px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--purple);"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>${t_("reduceTime") || "Reduce Time"}</span>
            </div>
            <button id="scrub-close" style="background:none; border:none; color:var(--tx3); cursor:pointer; padding:4px; display:inline-flex; align-items:center; justify-content:center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div style="padding: 24px 32px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; flex: 1;">
            <div id="scrub-prompt" style="font-size: 13px; color: var(--tx2); line-height: 1.5;"></div>
            <input type="number" id="scrub-mins" class="inp" style="width: 100%; font-size: 24px; text-align: center; font-weight: 800;" placeholder="${t_("minutes") || "Minutes"}">
          </div>
          <div style="padding: 16px 32px 24px; border-top: 1px solid var(--bd); display: flex; gap: 12px; justify-content: flex-end; flex-shrink: 0;">
            <button class="bs" id="scrub-cancel" style="padding: 10px 20px;">${t_("cancel") || "Cancel"}</button>
            <button class="bp" id="scrub-save" style="padding: 10px 20px; background: var(--red); color: #fff; border-color: var(--red); font-size: 13px; font-weight: 700;">${t_("remove") || "Remove"}</button>
          </div>
        </div>
        `);
        document.body.appendChild(e);
        $("scrub-cancel").onclick = () => $("scrubModal").classList.add("hide");
        $("scrub-close").onclick = () => $("scrubModal").classList.add("hide");
        $("scrub-save").onclick = async () => {
            let e = parseInt($("scrub-mins").value) || 0;
            if (e <= 0) return;
            let t = 60 * e;
            t > activeScrubSecs && (t = activeScrubSecs);
            // FF v4.4: Dexie-aware scrub. Writes to IndexedDB via SW message instead of legacy chrome.storage.local.daily.
            const res = await msg("STATS_SCRUB_DAY", { day: activeScrubDay, domain: activeScrubDom, secs: t });
            if (res && res.ok) { toast(t_("timeAdjusted"), "ok"); loadAnalytics(); }
            else { toast(t_("adjustFailed"), "er"); }
            $("scrubModal").classList.add("hide");
        };
    }
}

function openScrubModal(e, t, a) {
    $("scrubModal") || injectScrubModal();
    activeScrubDay = e;
    activeScrubDom = t;
    activeScrubSecs = a;
    const domainSpan = `<span style="color: var(--tx); font-weight: 700;">${t}</span>`;
    setSafeHTML($("scrub-prompt"), t_("howManyMinutesRemove", [domainSpan]) || `How many minutes do you want to remove for ${domainSpan}?`);
    $("scrub-mins").value = "";
    $("scrub-mins").max = Math.ceil(a / 60);
    $("scrubModal").classList.remove("hide");
    setTimeout(() => $("scrub-mins").focus(), 50);
}
async function renderGranularBlocksUI(force = false) {
    let host = document.getElementById("ff-granular-host") || document.getElementById("tab-sitemanager");
    if (!host) return;
    let t = document.getElementById("granular-ui-wrapper");
    if (!t) {
        t = document.createElement("div");
        t.id = "granular-ui-wrapper";
        setSafeHTML(t, `
           <div style="font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--blue);margin:24px 0 12px;display:flex;align-items:center;gap:8px">
               <span style="width:8px;height:8px;border-radius:50%;background:var(--blue)"></span>Advanced Site Tweaks
           </div>
           <div id="granular-blocks-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;margin-bottom:16px;"></div>
        `);
        host.appendChild(t);
    } else if (t.parentElement !== host) {
        host.appendChild(t);
    }
    let a = document.getElementById("granular-blocks-grid");
    if (!a) return;

    if (a.children.length > 0 && !force) return;

    a.textContent = "";
    var n = (await gLocal(["granularRules"])).granularRules || {};
    const granularSitesMap = (typeof window !== "undefined" && window.GRANULAR_SITES) ? window.GRANULAR_SITES : (self.GRANULAR_SITES || {});
    Object.keys(granularSitesMap).forEach(e => {
        var card = document.createElement("div");
        card.className = "card";
        var i = `<div style="padding:16px; border-bottom:1px solid var(--bd); font-weight:800; display:flex; align-items:center; gap:8px;">${getFav(e)} ${e}</div>`,
            s = '<div style="padding:16px; display:flex; flex-direction:column; gap:12px;">';
        granularSitesMap[e].forEach(t => {
            var checked = n[e] && n[e][t.id] ? "checked" : "";
            const tweakLabel = t_(`tweak_${t.id.replace(/-/g, '_')}`) || t.label;
            s += `\n              <div style="display:flex; justify-content:space-between; align-items:center;">\n                 <span style="font-size:13px; font-weight:600; color:var(--tx2)">${tweakLabel}</span>\n                 <label class="tog"><input type="checkbox" class="g-db-cb" data-d="${e}" data-r="${t.id}" ${checked}><span class="ttrack"></span></label>\n              </div>`;
        });
        s += "</div>";
        setSafeHTML(card, i + s);
        a.appendChild(card);
    });

    document.querySelectorAll(".g-db-cb").forEach(e => {
        e.addEventListener("change", async e => {
            const turningOff = !e.target.checked;
            const okPin = turningOff ? await promptPinIfEnabled("lockTweaks") : true;
            if (okPin) {
                var d = e.target.getAttribute("data-d"),
                    r = e.target.getAttribute("data-r"),
                    val = e.target.checked,
                    rulesMap = (await gLocal(["granularRules"])).granularRules || {};
                rulesMap[d] || (rulesMap[d] = {});
                rulesMap[d][r] = val;
                await sLocal({ granularRules: rulesMap });
            } else e.target.checked = !e.target.checked;
        });
    });
}
window.renderGranularBlocksUI = renderGranularBlocksUI;
async function saveRulesAndSync(newRules) {
    rules = newRules;
    await sLocal({ blockRules: newRules });

    // Sync to cooldownDomains and cooldownSettings for the backend content script
    const cds = [];
    const css = {};
    newRules.forEach(r => {
        if (r.cooldownEnabled) {
            cds.push(r.domain);
            css[r.domain] = {
                timer: parseInt(r.cooldownTimer, 10) || 10,
                frequency: r.cooldownFrequency || "always"
            };
        }
    });

    await msg("SET_COOLDOWNS", { cooldowns: cds });
    await msg("SET_COOLDOWN_SETTINGS", { settings: css });
}

async function loadRules() {
    var e = await gLocal(["blockRules", "allowList", "neverTrackDomains"]);
    const cdResp = await msg("GET_COOLDOWNS");
    const legacyCooldowns = cdResp?.cooldowns || [];
    const legacySettings = cdResp?.settings || {};

    let blRules = e.blockRules || [];
    let migrated = false;

    blRules = blRules.map(r => {
        if (void 0 !== r.mode) {
            r.focusOnly = "focus_only" === r.mode;
            r.timeLimitEnabled = "time_limit" === r.mode;
            r.scheduleEnabled = "schedule" === r.mode || Array.isArray(r.schedules) && r.schedules.length > 0;
            delete r.mode;
        }
        return r;
    });

    // Migrating any separate old cool-downs to unified block rules
    legacyCooldowns.forEach(domain => {
        if (!blRules.some(r => r.domain === domain)) {
            const cfg = legacySettings[domain] || { timer: 10, frequency: "always" };
            blRules.push({
                id: uid(),
                domain: domain,
                category: "distraction",
                instantBlock: false,
                focusOnly: false,
                timeLimitEnabled: false,
                dailyLimitSecs: 0,
                scheduleEnabled: false,
                schedules: [],
                activeDays: null,
                cooldownEnabled: true,
                cooldownTimer: cfg.timer || 10,
                cooldownFrequency: cfg.frequency || "always"
            });
            migrated = true;
        }
    });

    if (migrated) {
        await sLocal({ blockRules: blRules });
    }

    rules = blRules;
    allowList = e.allowList || [];
    neverTrackDomains = e.neverTrackDomains || [];
    renderCombined();
}

function ruleMode(e) {
    var t = [];
    if (e.instantBlock) t.push("Always");
    if (e.focusOnly) t.push("Focus");
    if (e.timeLimitEnabled) t.push("Limit");
    if (e.scheduleEnabled) t.push("Schedule");
    if (e.cooldownEnabled) t.push("Cool-down");
    return t.length ? t.join(", ") : "Always";
}

function ruleSchedLabel(e) {
    return e.scheduleEnabled && Array.isArray(e.schedules) && e.schedules.length ? e.schedules.map(e => e.start + "–" + e.end).join(", ") : "—"
}

async function renderCombined() {
    var e = $("combined-list");
    e.className = isBulkMode ? "bulk-mode" : "", e.querySelectorAll(".brow").forEach(e => e.remove());

    const activeRules = window.activeRuleTab === "block" ? rules : (window.activeRuleTab === "allow" ? allowList : neverTrackDomains);
    const hasItems = activeRules.length > 0;

    const empty = $("combined-empty");
    if (empty) {
        if (hasItems) {
            empty.style.display = "none";
        } else {
            empty.style.display = "flex";
            if (window.activeRuleTab === "block") {
                setSafeHTML(empty, `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px 24px;width:100%;"><svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.2;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><p style="font-size:16px;font-weight:800;color:var(--tx2);margin:0;">${t_("noRulesYet") || "No rules yet"}</p><p style="font-size:13px;color:var(--tx3);margin:0;text-align:center;">${t_("blockSitesToGetStarted") || "Block distracting sites to get started."}</p></div>`);
            } else if (window.activeRuleTab === "allow") {
                setSafeHTML(empty, `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px 24px;width:100%;"><svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.2;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg><p style="font-size:16px;font-weight:800;color:var(--tx2);margin:0;">${t_("noExceptionsYet") || "No exceptions yet"}</p><p style="font-size:13px;color:var(--tx3);margin:0;text-align:center;">${t_("allowSitesDesc") || "Allow sites that bypass all blocking rules."}</p></div>`);
            } else {
                setSafeHTML(empty, `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px 24px;width:100%;"><svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.2;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg><p style="font-size:16px;font-weight:800;color:var(--tx2);margin:0;">${t_("noDomainsIgnored") || "No domains ignored"}</p><p style="font-size:13px;color:var(--tx3);margin:0;text-align:center;">${t_("neverTrackDesc") || "Domains on this list will never be tracked for analytics."}</p></div>`);
            }
        }
    }

    if (window.activeRuleTab === "block") {
        rules.forEach(function (t) {
            var a = document.createElement("div");
            const _sd = sanitizeDomain(t.domain);

            let limitText = "—";
            if (t.timeLimitEnabled && t.dailyLimitSecs >= 0) {
                limitText = Math.round(t.dailyLimitSecs / 60) + " min/day";
            }
            if (t.cooldownEnabled) {
                limitText = (limitText !== "—" ? limitText + " / " : "") + `⏳ ${t.cooldownTimer || 10}s wait`;
            }

            let schedText = ruleSchedLabel(t);
            if (t.cooldownEnabled) {
                const freqLabel = t.cooldownFrequency === "everyVisit" || t.cooldownFrequency === "always" ? "Every visit" : (t.cooldownFrequency === "oncePerDay" || t.cooldownFrequency === "daily" ? "Once a day" : "Every 10 min");
                schedText = (schedText !== "—" ? schedText + " / " : "") + freqLabel;
            }

            a.className = "brow brow-rules", setSafeHTML(a, `\n      <input type="checkbox" class="bulk-cb" data-id="${t.id}">\n      <span class="dom" style="display:flex;align-items:center;gap:8px;">${getFav(t.domain)} ${_sd}</span>\n      <span><span class="cbadge" style="background:var(--red-bg);color:var(--red);border:1px solid var(--red-bd)">Blocked</span></span>\n      <span class="mtxt">${ruleMode(t)}</span>\n      <span class="ltxt">${limitText}</span>\n      <span class="stxt">${schedText}</span>\n      <span class="ract"><button class="bic edit-r" data-id="${t.id}" title="Edit Rule">${FlowIcons.get("edit", { size: 12 })}</button><button class="bic del del-r" data-id="${t.id}" title="Delete Rule">${FlowIcons.get("close", { size: 12 })}</button></span>`), document.getElementById("combined-list-rows").appendChild(a)
        });
    } else if (window.activeRuleTab === "allow") {
        allowList.forEach(function (t) {
            var a = document.createElement("div");
            const _sa = sanitizeDomain(t);
            a.className = "brow brow-rules allow-row", setSafeHTML(a, `\n      <input type="checkbox" class="bulk-cb" data-d="${_sa}">\n      <span class="dom" style="display:flex;align-items:center;gap:8px;">${getFav(t)} ${_sa}</span>\n      <span><span class="cbadge" style="background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">Allowed</span></span>\n      <span class="mtxt" style="color:var(--tx3)">Always accessible</span><span class="ltxt">—</span><span class="stxt">—</span>\n      <span class="ract"><button class="bic del del-a" data-d="${_sa}" title="Delete Rule"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></span>`), document.getElementById("combined-list-rows").appendChild(a)
        });
    } else if (window.activeRuleTab === "never") {
        neverTrackDomains.forEach(function (t) {
            var a = document.createElement("div");
            const _sn = sanitizeDomain(t);
            a.className = "brow brow-rules never-row", setSafeHTML(a, `\n      <input type="checkbox" class="bulk-cb" data-n="${_sn}">\n      <span class="dom" style="display:flex;align-items:center;gap:8px;">${getFav(t)} ${_sn}</span>\n      <span><span class="cbadge" style="background:rgba(168,85,247,0.15);color:#A855F7;border:1px solid rgba(168,85,247,0.3)">Never Track</span></span>\n      <span class="mtxt" style="color:var(--tx3)">Privacy: Never tracked</span><span class="ltxt">—</span><span class="stxt">—</span>\n      <span class="ract"><button class="bic del del-n" data-n="${_sn}" title="Delete Rule"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></span>`), document.getElementById("combined-list-rows").appendChild(a)
        });
    }

    e.querySelectorAll(".edit-r").forEach(e => e.addEventListener("click", async () => {
        await promptPinIfEnabled("lockRules") && openModal(e.getAttribute("data-id"))
    }));
    e.querySelectorAll(".del-r").forEach(e => e.addEventListener("click", () => delRule(e.getAttribute("data-id"))));
    e.querySelectorAll(".del-a").forEach(e => e.addEventListener("click", () => delAllow(e.getAttribute("data-d"))));
    e.querySelectorAll(".del-n").forEach(e => e.addEventListener("click", () => delNever(e.getAttribute("data-n"))));
    e.querySelectorAll(".bulk-cb").forEach(e => {
        e.addEventListener("change", () => {
            let t = e.getAttribute("data-id") || e.getAttribute("data-d") || e.getAttribute("data-n");
            e.checked ? bulkSelected.add(t) : bulkSelected.delete(t)
        })
    });
}

async function delNever(e) {
    if (!await promptPinIfEnabled("lockRules")) return;
    let t = await gLocal(["neverTrackDomains"]);
    const _deletedNever = e;
    neverTrackDomains = (neverTrackDomains = t.neverTrackDomains || []).filter(t => t !== e);
    await sLocal({ neverTrackDomains: neverTrackDomains });
    renderCombined();
    let _undoneNever = false;
    const _undoBtnN = document.createElement("button");
    _undoBtnN.textContent = t_("undo10s"); _undoBtnN.style.cssText = "margin-left:12px;background:var(--bg4);border:1px solid var(--bd2);color:var(--tx);border-radius:8px;padding:4px 12px;font-size:12px;font-weight:700;cursor:pointer;";
    _undoBtnN.onclick = async () => {
        if (_undoneNever) return; _undoneNever = true;
        const _r2 = await gLocal(["neverTrackDomains"]); const _arr = _r2.neverTrackDomains || [];
        if (!_arr.includes(_deletedNever)) _arr.push(_deletedNever);
        neverTrackDomains = _arr; await sLocal({ neverTrackDomains: neverTrackDomains });
        renderCombined(); toast(t_("undoNeverTrackRestored"), "ok");
    };
    const _stackIdxN = _toastStackCount++;
    const _bottomPxN = 80 + _stackIdxN * 62;
    const _tdN = document.createElement("div");
    _tdN.style.cssText = `display:flex;align-items:center;gap:4px;position:fixed;bottom:${_bottomPxN}px;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid var(--bd2);color:var(--tx);padding:10px 18px;border-radius:12px;font-size:14px;font-weight:700;z-index:9999;box-shadow:var(--shadow-md);`;
    setSafeHTML(_tdN, "<span>Never-track removed</span>"); _tdN.appendChild(_undoBtnN);
    document.body.appendChild(_tdN);
    let _secs = 10;
    const _cdown = setInterval(() => { _secs--; if (!_undoneNever && _undoBtnN.parentNode) _undoBtnN.textContent = t_("undoXs", [_secs]); if (_secs <= 0) clearInterval(_cdown); }, 1000);
    setTimeout(() => { clearInterval(_cdown); _tdN.remove(); _toastStackCount = Math.max(0, _toastStackCount - 1); }, 10000);
}

async function delRule(e) {
    if (!await promptPinIfEnabled("lockRules")) return;
    const _deleted = rules.find(r => r.id === e);
    rules = rules.filter(t => t.id !== e);
    await saveRulesAndSync(rules);
    await msg("TRIGGER_DNR_UPDATE"); renderCombined();
    // FF v6.18: Undo toast — 10-second window with live countdown (was 5s)
    if (_deleted) {
        let _undone = false;
        const _undoBtn = document.createElement("button");
        _undoBtn.textContent = t_("undo10s"); _undoBtn.style.cssText = "margin-left:12px;background:var(--bg4);border:1px solid var(--bd2);color:var(--tx);border-radius:8px;padding:4px 12px;font-size:12px;font-weight:700;cursor:pointer;";
        _undoBtn.onclick = async () => {
            if (_undone) return; _undone = true;
            rules.push(_deleted);
            await saveRulesAndSync(rules);
            await msg("TRIGGER_DNR_UPDATE"); renderCombined(); toast(t_("undoRuleRestored"), "ok");
        };
        const _stackIdx = _toastStackCount++;
        const _bottomPx = 80 + _stackIdx * 62;
        const _td = document.createElement("div");
        _td.style.cssText = `display:flex;align-items:center;gap:4px;position:fixed;bottom:${_bottomPx}px;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid var(--bd2);color:var(--tx);padding:10px 18px;border-radius:12px;font-size:14px;font-weight:700;z-index:9999;box-shadow:var(--shadow-md);animation:fadeIn .2s;`;
        setSafeHTML(_td, "<span>Rule deleted</span>"); _td.appendChild(_undoBtn);
        document.body.appendChild(_td);
        let _secs = 10;
        const _cdown = setInterval(() => { _secs--; if (!_undone && _undoBtn.parentNode) _undoBtn.textContent = t_("undoXs", [_secs]); if (_secs <= 0) clearInterval(_cdown); }, 1000);
        setTimeout(() => { clearInterval(_cdown); _td.remove(); _toastStackCount = Math.max(0, _toastStackCount - 1); }, 10000);
    }
}
async function delAllow(e) {
    if (!await promptPinIfEnabled("lockRules")) return;
    let t = await gLocal(["allowList"]);
    const _deletedAllow = e;
    allowList = (allowList = t.allowList || []).filter(t => t !== e);
    await sLocal({ allowList: allowList });
    await msg("TRIGGER_DNR_UPDATE"); renderCombined();
    // FF v6.18: undo allow-rule — 10 seconds with live countdown
    let _undoneAllow = false;
    const _undoBtnA = document.createElement("button");
    _undoBtnA.textContent = t_("undo10s"); _undoBtnA.style.cssText = "margin-left:12px;background:var(--bg4);border:1px solid var(--bd2);color:var(--tx);border-radius:8px;padding:4px 12px;font-size:12px;font-weight:700;cursor:pointer;";
    _undoBtnA.onclick = async () => {
        if (_undoneAllow) return; _undoneAllow = true;
        const _r2 = await gLocal(["allowList"]); const _arr = _r2.allowList || [];
        if (!_arr.includes(_deletedAllow)) _arr.push(_deletedAllow);
        allowList = _arr; await sLocal({ allowList: _arr });
        await msg("TRIGGER_DNR_UPDATE"); renderCombined(); toast(t_("undoAllowRuleRestored"), "ok");
    };
    const _stackIdxA = _toastStackCount++;
    const _bottomPxA = 80 + _stackIdxA * 62;
    const _tdA = document.createElement("div");
    _tdA.style.cssText = `display:flex;align-items:center;gap:4px;position:fixed;bottom:${_bottomPxA}px;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid var(--bd2);color:var(--tx);padding:10px 18px;border-radius:12px;font-size:14px;font-weight:700;z-index:9999;box-shadow:var(--shadow-md);`;
    setSafeHTML(_tdA, "<span>Allow-rule removed</span>"); _tdA.appendChild(_undoBtnA);
    document.body.appendChild(_tdA);
    let _secsA = 10;
    const _cdownA = setInterval(() => { _secsA--; if (!_undoneAllow && _undoBtnA.parentNode) _undoBtnA.textContent = t_("undoXs", [_secsA]); if (_secsA <= 0) clearInterval(_cdownA); }, 1000);
    setTimeout(() => { clearInterval(_cdownA); if (!_undoneAllow) toast(t_("removed"), "ok"); _tdA.remove(); _toastStackCount = Math.max(0, _toastStackCount - 1); }, 10000);
}

function renderScheduleSlots(e) {
    var t = $("schedule-slots");
    t.textContent = "", (e || []).forEach((e, a) => {
        var n = document.createElement("div");
        n.className = "sched-slot", n.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:12px;background:var(--bg3);padding:12px 16px;border-radius:12px;border:1px solid var(--bd)", setSafeHTML(n, `<span style="font-size:13px;color:var(--tx2);font-weight:700">From</span><input type="time" class="inp sched-start" value="${e.start || "09:00"}" style="flex:1"/>\n      <span style="font-size:13px;color:var(--tx2);font-weight:700">to</span><input type="time" class="inp sched-end" value="${e.end || "21:00"}" style="flex:1"/>\n      <button class="bic del rm-slot" data-idx="${a}">✕</button>`), t.appendChild(n)
    }), t.querySelectorAll(".rm-slot").forEach(e => e.addEventListener("click", () => {
        var t = getSlots();
        t.splice(parseInt(e.getAttribute("data-idx"), 10), 1), renderScheduleSlots(t)
    }))
}

function getSlots() {
    var e = [];
    return $("schedule-slots").querySelectorAll(".sched-slot").forEach(t => {
        var a = t.querySelector(".sched-start").value,
            n = t.querySelector(".sched-end").value;
        a && n && e.push({
            start: a,
            end: n
        })
    }), e
}

function normalizeCdFreq(f) {
    if (!f || f === "always") return "everyVisit";
    if (f === "daily") return "oncePerDay";
    if (f === "session") return "every10min";
    return f;
}

function openModal(e) {
    var t = rules.find(t => t.id === e);
    if (!t) return;
    $("m-id").value = e;
    $("cat-inp").value = t.domain;
    $("cat-redir").value = t.redirectUrl || "";
    let isInstant = !!t.instantBlock;
    let isTimeLimit = !!t.timeLimitEnabled;

    // Cool-down Settings
    $("m-cd-wait").value = t.cooldownTimer || 10;
    $("m-cd-freq").value = normalizeCdFreq(t.cooldownFrequency);

    if (isInstant) {
        isTimeLimit = true;
        $("m-lim").value = 0;
    } else {
        $("m-lim").value = (t.dailyLimitSecs !== undefined && t.dailyLimitSecs !== null) ? Math.round(t.dailyLimitSecs / 60) : 30;
    }

    $("m-mode-focus").checked = !!t.focusOnly;
    $("m-mode-limit").checked = isTimeLimit;
    $("m-mode-schedule").checked = !!t.scheduleEnabled;
    $("m-mode-cooldown").checked = !!t.cooldownEnabled;
    $("m-mode-session").checked = !!t.sessionLimitEnabled;

    $("mf-tl").style.display = isTimeLimit ? "block" : "none";
    $("mf-sc").style.display = t.scheduleEnabled ? "block" : "none";
    $("mf-cd").style.display = t.cooldownEnabled ? "block" : "none";
    $("mf-session").style.display = t.sessionLimitEnabled ? "block" : "none";

    $("m-session-limit").value = t.sessionLimitSecs ? Math.round(t.sessionLimitSecs / 60) : 5;
    $("m-session-cooldown").value = t.sessionCooldownSecs ? Math.round(t.sessionCooldownSecs / 60) : 10;

    renderScheduleSlots(Array.isArray(t.schedules) && t.schedules.length ? t.schedules : t.scheduleEnabled && t.scheduleStart ? [{
        start: t.scheduleStart,
        end: t.scheduleEnd || "21:00"
    }] : [{
        start: "09:00",
        end: "21:00"
    }]);
    const _allDays = [0, 1, 2, 3, 4, 5, 6];
    const _activeDays = Array.isArray(t.activeDays) ? t.activeDays : _allDays;
    document.querySelectorAll('.m-day-cb').forEach(cb => {
        const fresh = cb.cloneNode(true);
        cb.parentNode.replaceChild(fresh, cb);
    });
    document.querySelectorAll('.m-day-cb').forEach(cb => {
        cb.checked = _activeDays.includes(parseInt(cb.value));
        const _lbl = cb.closest('label') || cb.parentElement;
        if (_lbl) {
            _lbl.style.background = cb.checked ? 'var(--green-bg)' : '';
            _lbl.style.borderColor = cb.checked ? 'var(--green-bd)' : '';
            _lbl.style.color = cb.checked ? 'var(--green)' : '';
        }
        cb.addEventListener('change', function () {
            const _l = this.closest('label') || this.parentElement;
            if (_l) {
                _l.style.background = this.checked ? 'var(--green-bg)' : '';
                _l.style.borderColor = this.checked ? 'var(--green-bd)' : '';
                _l.style.color = this.checked ? 'var(--green)' : '';
            }
        });
    });
    if ($("btn-add-block")) $("btn-add-block").textContent = t_("saveChanges");
    if ($("add-rule-modal-title")) $("add-rule-modal-title").textContent = t_("editBlockRule");
    if (typeof switchRuleModalTab === "function") switchRuleModalTab("block");
    if ($("add-rule-modal")) $("add-rule-modal").classList.remove("hide");
}


async function loadCategories() {
    var e = await gLocal(["siteCategories", "hiddenDefaultSites"]);
    siteCategories = e.siteCategories || {};
    window.siteCategories = siteCategories;
    window.siteCats = siteCategories;
    hiddenDefaultSites = e.hiddenDefaultSites || [];
    window.hiddenDefaultSites = hiddenDefaultSites;
    var syncRes = await gSync(["customCategories"]);
    if (syncRes && syncRes.customCategories && typeof applyCustomCategories === "function") {
        applyCustomCategories(syncRes.customCategories);
    }
    loadWeeklyGoalSettings();
}

function isDefaultSiteHidden(d) {
    if (typeof hiddenDefaultSites === "undefined" || !hiddenDefaultSites) return false;
    if (hiddenDefaultSites.includes(d)) return true;
    const parts = d.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
        if (hiddenDefaultSites.includes(parts.slice(i).join("."))) return true;
    }
    return false;
}

function recalculateRangeStats(data) {
    if (!data) return;
    Object.values(data).forEach(entry => {
        if (entry && entry.sites) {
            entry.productivity = 0;
            entry.learning = 0;
            entry.communication = 0;
            entry.distraction = 0;
            entry.uncategorized = 0;
            Object.entries(entry.sites).forEach(([dom, secs]) => {
                const catInfo = getEffectiveCat(dom);
                const cat = catInfo ? catInfo.cat : "uncategorized";
                entry[cat] = (entry[cat] || 0) + secs;
            });
        }
    });
}
async function loadVisitedSites() {
    var e = await msg("GET_VISITED_SITES");
    visitedSites = e?.visitedSites || []
}

function renderCatSquares() {
    var e = $("cat-squares");
    if (!e) return;
    e.textContent = "";
    const t = Array.from(new Set([...visitedSites, ...Object.keys(siteCategories)]))
        .filter(d => !isDefaultSiteHidden(d));
    // Feature: include "uncategorized" in Filter by Category and Smart Presets
    ["all"].concat(allCats()).forEach(a => {
        var n = "all" === a,
            i = n ? {
                label: t_("allSites") || "All Sites",
                emoji: "🌍",
                color: "var(--tx)"
            } : {
                label: catLabel(a, !1),
                emoji: catEmoji(a),
                color: CAT_COLORS[a] || "#555"
            },
            s = 0;
        n ? s = t.length : t.forEach(e => {
            getEffectiveCat(e).cat === a && s++
        });
        var o = document.createElement("div");
        const countStr = s === 1 ? (t_("siteCountSingle", ["1"]) || "1 site") : (t_("siteCountPlural", [String(s)]) || `${s} sites`);
        o.className = "cat-sq" + (selectedCat === a ? " selected" : "");
        o.style.borderColor = selectedCat === a ? i.color : void 0;

        const isEditable = !n && a !== "uncategorized";
        const editBtnHtml = isEditable ? `
            <button type="button" class="cat-sq-edit-btn" title="Edit Category" aria-label="Edit Category">
                ${FlowIcons.get("edit", { size: 12 })}
            </button>
        ` : "";

        setSafeHTML(o, `${editBtnHtml}<div class="cat-sq-icon">${i.emoji}</div><div class="cat-sq-name" style="color:${selectedCat === a ? i.color : "var(--tx)"}">${i.label}</div><div class="cat-sq-count">${countStr}</div>`);

        if (isEditable) {
            const editBtn = o.querySelector(".cat-sq-edit-btn");
            if (editBtn) {
                editBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    openEditCategoryModal(a);
                });
            }
        }

        o.addEventListener("click", () => {
            selectedCat = a;
            renderCategories();
        });
        e.appendChild(o);
    });
}

function openEditCategoryModal(catKey) {
    const existing = document.getElementById("edit-cat-modal-overlay");
    if (existing) existing.remove();

    const currentLabel = CAT_LABELS[catKey] || catKey;
    const currentEmoji = CAT_EMOJI[catKey] || "🏷️";
    const currentColor = CAT_COLORS[catKey] || "#05D581";

    const overlay = document.createElement("div");
    overlay.id = "edit-cat-modal-overlay";
    overlay.className = "overlay";
    overlay.style.zIndex = "10000";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const colorSwatches = [
        "#05D581", "#A855F7", "#F46B7A", "#5C9CFC",
        "#F59E0B", "#EC4899", "#14B8A6", "#3B82F6",
        "#8B5CF6", "#64748B"
    ];

    setSafeHTML(overlay, `
      <div class="overlay-card cat-edit-modal-card" style="max-width: 420px; padding: 24px; border-radius: var(--radius-lg, 16px); box-shadow: 0 16px 40px rgba(0,0,0,0.3);">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 20px;">
          <h3 style="margin:0; font-size: 18px; font-weight: 800; display:flex; align-items:center; gap: 8px; color:var(--tx);">
            ${FlowIcons.get("edit", { size: 20, style: "color:var(--green);" })}
            ${t_("editCategory") || "Edit Category"}
          </h3>
          <button id="cat-edit-close" style="background:none; border:none; color:var(--tx3); cursor:pointer; padding: 4px; display:inline-flex; align-items:center; justify-content:center;">
            ${FlowIcons.get("close", { size: 18 })}
          </button>
        </div>

        <div style="display:flex; flex-direction:column; gap: 16px;">
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:var(--tx2); margin-bottom:6px;">${t_("categoryName") || "Category Name"}</label>
            <input type="text" id="cat-edit-label" value="${sanitizeDomain(currentLabel)}" maxlength="20" placeholder="e.g. Work" style="width:100%; padding: 10px 14px; border-radius: 10px; border:1px solid var(--bd); background:var(--bg3); color:var(--tx); font-size:14px; font-weight:600;" />
          </div>

          <div style="display:flex; gap: 16px;">
            <div style="flex:1;">
              <label style="display:block; font-size:12px; font-weight:700; color:var(--tx2); margin-bottom:6px;">${t_("emojiIcon") || "Emoji Icon"}</label>
              <input type="text" id="cat-edit-emoji" value="${sanitizeDomain(currentEmoji)}" maxlength="4" style="width:100%; padding: 10px 14px; border-radius: 10px; border:1px solid var(--bd); background:var(--bg3); color:var(--tx); font-size:16px; text-align:center;" />
            </div>
            <div style="flex:1;">
              <label style="display:block; font-size:12px; font-weight:700; color:var(--tx2); margin-bottom:6px;">${t_("accentColor") || "Accent Color"}</label>
              <div style="display:flex; align-items:center; gap: 8px;">
                <input type="color" id="cat-edit-color" value="${currentColor}" style="width:42px; height:42px; padding:2px; border-radius:10px; border:1px solid var(--bd); background:var(--bg3); cursor:pointer;" />
                <span id="cat-edit-color-val" style="font-size:12px; font-weight:700; color:var(--tx2); text-transform:uppercase;">${currentColor}</span>
              </div>
            </div>
          </div>

          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:var(--tx2); margin-bottom:6px;">${t_("presetSwatches") || "Preset Swatches"}</label>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${colorSwatches.map(hex => `
                <button type="button" class="cat-swatch-btn" data-color="${hex}" style="width:26px; height:26px; border-radius:50%; border: 2px solid ${hex === currentColor ? 'var(--tx)' : 'transparent'}; background:${hex}; cursor:pointer; transition:transform 0.15s ease;"></button>
              `).join("")}
            </div>
          </div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; margin-top: 24px; padding-top: 16px; border-top:1px solid var(--bd);">
          <button id="cat-edit-reset" type="button" style="background:none; border:1px solid var(--bd); color:var(--tx2); padding: 8px 12px; border-radius: 10px; font-size: 12px; font-weight: 700; cursor:pointer; display:inline-flex; align-items:center; gap: 6px; transition:var(--trans);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
            ${t_("resetToDefault") || "Reset to Default"}
          </button>

          <div style="display:flex; gap: 8px;">
            <button id="cat-edit-cancel" type="button" style="background:var(--bg3); border:1px solid var(--bd); color:var(--tx); padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor:pointer;">${t_("cancel") || "Cancel"}</button>
            <button id="cat-edit-save" type="button" style="background:var(--green); border:none; color:#000; padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 800; cursor:pointer; display:inline-flex; align-items:center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ${t_("save") || "Save"}
            </button>
          </div>
        </div>
      </div>
    `);

    document.body.appendChild(overlay);

    const colorPicker = overlay.querySelector("#cat-edit-color");
    const colorValSpan = overlay.querySelector("#cat-edit-color-val");
    if (colorPicker && colorValSpan) {
        colorPicker.addEventListener("input", (e) => {
            colorValSpan.textContent = e.target.value.toUpperCase();
        });
    }

    overlay.querySelectorAll(".cat-swatch-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const hex = btn.getAttribute("data-color");
            if (colorPicker) colorPicker.value = hex;
            if (colorValSpan) colorValSpan.textContent = hex.toUpperCase();
            overlay.querySelectorAll(".cat-swatch-btn").forEach(b => b.style.borderColor = "transparent");
            btn.style.borderColor = "var(--tx)";
        });
    });

    overlay.querySelector("#cat-edit-close")?.addEventListener("click", () => overlay.remove());
    overlay.querySelector("#cat-edit-cancel")?.addEventListener("click", () => overlay.remove());

    overlay.querySelector("#cat-edit-reset")?.addEventListener("click", async () => {
        const syncRes = (await gSync(["customCategories"])).customCategories || {};
        delete syncRes[catKey];
        await sSync({ customCategories: syncRes });
        if (typeof applyCustomCategories === "function") applyCustomCategories(syncRes);
        overlay.remove();
        renderCategories();
        loadWeeklyGoalSettings();
        loadAnalytics();
        if (typeof buildPresetBuilder === "function") buildPresetBuilder();
    });

    overlay.querySelector("#cat-edit-save")?.addEventListener("click", async () => {
        const newLabel = (overlay.querySelector("#cat-edit-label").value || "").trim();
        const newEmoji = (overlay.querySelector("#cat-edit-emoji").value || "").trim() || "🏷️";
        const newColor = overlay.querySelector("#cat-edit-color").value || currentColor;

        if (!newLabel) return;

        const syncRes = (await gSync(["customCategories"])).customCategories || {};
        syncRes[catKey] = { label: newLabel, emoji: newEmoji, color: newColor };

        await sSync({ customCategories: syncRes });
        if (typeof applyCustomCategories === "function") applyCustomCategories(syncRes);
        overlay.remove();
        renderCategories();
        loadWeeklyGoalSettings();
        loadAnalytics();
        if (typeof buildPresetBuilder === "function") buildPresetBuilder();
    });
}
async function tagSite(e, t) {
    const cleanDom = sanitizeDomain(e);
    siteCategories[cleanDom] = t;
    if (cleanDom.startsWith("www.")) {
        siteCategories[cleanDom.replace(/^www\./, "")] = t;
    } else {
        siteCategories["www." + cleanDom] = t;
    }
    window.siteCategories = siteCategories;
    window.siteCats = siteCategories;
    const cleanNoWww = cleanDom.replace(/^www\./, "");
    if (hiddenDefaultSites.includes(cleanDom)) {
        hiddenDefaultSites = hiddenDefaultSites.filter(d => d !== cleanDom);
    }
    if (hiddenDefaultSites.includes(cleanNoWww)) {
        hiddenDefaultSites = hiddenDefaultSites.filter(d => d !== cleanNoWww);
    }
    window.hiddenDefaultSites = hiddenDefaultSites;
    await sLocal({ siteCategories: siteCategories, hiddenDefaultSites: hiddenDefaultSites });
    await msg("CATEGORIZE_SITE", {
        domain: cleanDom,
        category: t
    });
    await msg("TRIGGER_DNR_UPDATE");
    renderCategories();
}

function buildCustomDropdownHtml(domain, currentCat, customClass = "") {
    const cleanDom = typeof sanitizeDomain === "function" ? sanitizeDomain(domain) : domain;
    const catKeys = (typeof allCats === "function" ? allCats() : ["productivity", "learning", "distraction", "communication", "uncategorized"]);
    const currentLbl = (typeof getCatLabel === "function" ? getCatLabel(currentCat) : (typeof catLabel === "function" ? catLabel(currentCat, !1) : currentCat));
    const currentEmoji = (typeof catEmoji === "function" ? catEmoji(currentCat) : "");
    const color = (typeof catColor === "function" ? catColor(currentCat) : (CAT_COLORS?.[currentCat] || "#555555"));

    let itemsHtml = "";
    catKeys.forEach(catKey => {
        const lbl = (typeof getCatLabel === "function" ? getCatLabel(catKey) : (typeof catLabel === "function" ? catLabel(catKey, !1) : catKey));
        const emoji = (typeof catEmoji === "function" ? catEmoji(catKey) : "");
        const isSelected = catKey === currentCat;
        const itemColor = (typeof catColor === "function" ? catColor(catKey) : (CAT_COLORS?.[catKey] || "#555555"));

        itemsHtml += `
          <button type="button" class="ff-dropdown-item${isSelected ? ' selected' : ''}" data-cat="${catKey}">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${itemColor}; flex-shrink:0;"></span>
            <span>${emoji} ${lbl}</span>
            ${isSelected ? '<svg class="ff-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
          </button>
        `;
    });

    return `
    <div class="ff-dropdown ${customClass}" data-domain="${escHTML(cleanDom)}">
      <button type="button" class="ff-dropdown-btn" style="background:${color}22; color:${color}; border-color:${color}55;">
        <span>${currentEmoji} ${currentLbl}</span>
        <svg class="ff-dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <div class="ff-dropdown-menu">
        ${itemsHtml}
      </div>
    </div>
    `;
}

function initCustomDropdowns(containerEl, onSelectCallback) {
    if (!containerEl) return;
    containerEl.querySelectorAll(".ff-dropdown").forEach(dropdownEl => {
        const btn = dropdownEl.querySelector(".ff-dropdown-btn");
        const domain = dropdownEl.getAttribute("data-domain");

        if (btn) {
            btn.addEventListener("click", (evt) => {
                evt.stopPropagation();
                const isOpen = dropdownEl.classList.contains("open");
                document.querySelectorAll(".ff-dropdown.open").forEach(other => {
                    if (other !== dropdownEl) other.classList.remove("open");
                });
                dropdownEl.classList.toggle("open", !isOpen);
            });
        }

        dropdownEl.querySelectorAll(".ff-dropdown-item").forEach(itemBtn => {
            itemBtn.addEventListener("click", async (evt) => {
                evt.stopPropagation();
                const catVal = itemBtn.getAttribute("data-cat");
                dropdownEl.classList.remove("open");
                if (typeof onSelectCallback === "function") {
                    await onSelectCallback(domain, catVal);
                }
            });
        });
    });
}

// Global capture-phase click-outside listener for all custom dropdowns
if (!window._ffGlobalDropdownClickOutsideAdded) {
    window.addEventListener("click", (evt) => {
        if (!evt.target.closest(".ff-dropdown")) {
            document.querySelectorAll(".ff-dropdown.open").forEach(d => {
                d.classList.remove("open");
                d.closest(".card")?.classList.remove("ff-card-open");
                d.closest(".trow")?.classList.remove("ff-trow-open");
            });
        }
    }, true);
    window._ffGlobalDropdownClickOutsideAdded = true;
}

function upgradeSelectToCustomDropdown(selectEl) {
    if (!selectEl) return;
    if (selectEl.dataset.ffUpgraded === "true") {
        if (selectEl._ffWrapper && typeof selectEl._ffWrapper._updateUI === "function") {
            selectEl._ffWrapper._updateUI();
        }
        return;
    }
    selectEl.dataset.ffUpgraded = "true";

    const isFormSelect = Boolean(selectEl.closest(".overlay") || selectEl.closest(".add-form-pane") || selectEl.closest(".cat-edit-modal") || selectEl.closest(".ff-modal-card") || selectEl.style.width === "100%" || selectEl.classList.contains("sel-form"));
    const wrapper = document.createElement("div");
    wrapper.className = isFormSelect ? "ff-dropdown ff-dropdown-settings ff-dropdown-form" : "ff-dropdown ff-dropdown-settings";
    if (selectEl.style.width) {
        wrapper.style.width = selectEl.style.width;
    }

    const updateUI = () => {
        const selectedOpt = selectEl.options[selectEl.selectedIndex] || selectEl.options[0];
        const btnLabel = wrapper.querySelector(".ff-dropdown-btn > span:first-child");
        if (btnLabel && selectedOpt) {
            btnLabel.textContent = selectedOpt.textContent;
        }
        wrapper.querySelectorAll(".ff-dropdown-item").forEach(itemBtn => {
            const val = itemBtn.getAttribute("data-value");
            const isSelected = val === selectEl.value;
            itemBtn.classList.toggle("selected", isSelected);
            const matchOpt = Array.from(selectEl.options).find(o => o.value === val);
            if (matchOpt) {
                const itemSpan = itemBtn.querySelector("span:first-child");
                if (itemSpan) itemSpan.textContent = matchOpt.textContent;
            }
            let chk = itemBtn.querySelector(".ff-check-icon");
            if (isSelected && !chk) {
                const checkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                checkSvg.setAttribute("class", "ff-check-icon");
                checkSvg.setAttribute("viewBox", "0 0 24 24");
                checkSvg.setAttribute("fill", "none");
                checkSvg.setAttribute("stroke", "currentColor");
                checkSvg.setAttribute("stroke-width", "3");
                checkSvg.setAttribute("stroke-linecap", "round");
                checkSvg.setAttribute("stroke-linejoin", "round");
                const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
                polyline.setAttribute("points", "20 6 9 17 4 12");
                checkSvg.appendChild(polyline);
                itemBtn.appendChild(checkSvg);
            } else if (!isSelected && chk) {
                chk.remove();
            }
        });
    };

    wrapper._updateUI = updateUI;
    selectEl._ffWrapper = wrapper;

    const selectedOpt = selectEl.options[selectEl.selectedIndex] || selectEl.options[0];
    const initialLabel = selectedOpt ? selectedOpt.textContent : "";

    let itemsHtml = "";
    Array.from(selectEl.options).forEach(opt => {
        const isSelected = opt.value === selectEl.value;
        itemsHtml += `
          <button type="button" class="ff-dropdown-item${isSelected ? ' selected' : ''}" data-value="${escHTML(opt.value)}">
            <span>${escHTML(opt.textContent)}</span>
            ${isSelected ? '<svg class="ff-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
          </button>
        `;
    });

    setSafeHTML(wrapper, `
      <button type="button" class="ff-dropdown-btn">
        <span>${escHTML(initialLabel)}</span>
        <svg class="ff-dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <div class="ff-dropdown-menu">
        ${itemsHtml}
      </div>
    `);

    selectEl.style.display = "none";
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

    const btn = wrapper.querySelector(".ff-dropdown-btn");
    btn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        const isOpen = wrapper.classList.contains("open");
        document.querySelectorAll(".ff-dropdown.open").forEach(other => {
            if (other !== wrapper) other.classList.remove("open");
        });
        wrapper.classList.toggle("open", !isOpen);
    });

    wrapper.querySelectorAll(".ff-dropdown-item").forEach(itemBtn => {
        itemBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            const val = itemBtn.getAttribute("data-value");
            selectEl.value = val;
            selectEl.dispatchEvent(new Event("change", { bubbles: true }));
            wrapper.classList.remove("open");
            updateUI();
        });
    });

    selectEl.addEventListener("change", updateUI);
}

function upgradeAllSettingsSelects() {
    document.querySelectorAll("select").forEach(sel => {
        if (!sel.classList.contains("custom-dropdown-ignore")) {
            upgradeSelectToCustomDropdown(sel);
        }
    });

    if (!window._ffUniversalDropdownObserver && document.body) {
        window._ffUniversalDropdownObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        if (node.tagName === "SELECT") {
                            upgradeSelectToCustomDropdown(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll("select").forEach(s => upgradeSelectToCustomDropdown(s));
                        }
                    }
                });
            }
        });
        window._ffUniversalDropdownObserver.observe(document.body, { childList: true, subtree: true });
    }
}

function renderCategories() {
    renderCatSquares();
    var e = $("cat-groups");
    if (!e) return;
    e.textContent = "";
    const searchInput = $("cat-sites-search");
    const q = searchInput ? searchInput.value.toLowerCase().trim() : "";
    var t = {};
    const filtered = Array.from(new Set([...visitedSites, ...Object.keys(siteCategories)]))
        .filter(d => !isDefaultSiteHidden(d))
        .filter(d => !q || d.toLowerCase().includes(q));
    filtered.forEach(e => {
        var a = getEffectiveCat(e);
        t[a.cat] || (t[a.cat] = []), t[a.cat].push({
            domain: e,
            auto: a.auto
        })
    }), Object.keys(t).length ? allCats().forEach(a => {
        if (t[a] && t[a].length && ("all" === selectedCat || selectedCat === a)) {
            var n = document.createElement("div");
            const totalCountStr = t[a].length === 1 ? (t_("siteCountSingle", ["1"]) || "1 site") : (t_("siteCountPlural", [String(t[a].length)]) || `${t[a].length} sites`);
            const catLabelStr = (typeof getCatLabel === "function" ? getCatLabel(a) : (catLabel(a, !1) || a));
            const catEmojiStr = (typeof getCatEmoji === "function" ? getCatEmoji(a) : (catEmoji(a) || "🏷️"));
            n.className = "card card-spacious", n.style.marginBottom = "16px";
            setSafeHTML(n, `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--bd); padding-bottom:16px; margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${catColor(a)};"></span>
            <span style="font-size:18px; font-weight:800; color:var(--tx);">${catEmojiStr} ${catLabelStr}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="bs cat-edit-btn" data-cat="${a}">
              ${FlowIcons.get("edit", { size: 12, style: "vertical-align:middle; margin-right:4px;" })}
              ${t_("edit") || "Edit"}
            </button>
            <span class="cat-site-count-badge">${totalCountStr}</span>
          </div>
        </div>
        <div class="cat-group-list"></div>
      `);
            var i = n.querySelector(".cat-group-list");
            t[a].forEach(e => {
                var t = document.createElement("div");
                t.style.cssText = "display:flex;align-items:center;gap:16px;padding:12px 16px;background:transparent;border:1px solid var(--bd);border-radius:12px;margin-bottom:8px;transition:var(--trans)";
                t.onmouseover = () => t.style.borderColor = "var(--bd2)";
                t.onmouseout = () => t.style.borderColor = "var(--bd)";
                const cleanDom = sanitizeDomain(e.domain);
                var n = buildCustomDropdownHtml(cleanDom, a);
                setSafeHTML(t, `<span style="font-family:monospace;font-size:15px;font-weight:700;flex:1;word-break:break-all;display:flex;align-items:center;gap:8px;">${getFav(e.domain)} ${cleanDom}</span>${n}<button class="bic cat-rule-btn" data-domain="${cleanDom}" title="Add or Edit Rule"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg></button><button class="bic del rm-cat" data-domain="${cleanDom}">✕</button>`);
                i.appendChild(t);
            }), initCustomDropdowns(i, async (dom, newCat) => {
                await tagSite(dom, newCat);
            }), i.querySelectorAll(".rm-cat").forEach(el => el.addEventListener("click", async () => {
                const dom = el.getAttribute("data-domain");
                const cleanDom = sanitizeDomain(dom);
                const noWww = cleanDom.replace(/^www\./, "");
                
                if (a !== "uncategorized") {
                    await tagSite(cleanDom, "uncategorized");
                    toast(t_("movedToUncategorized") || "Moved to Uncategorized", "ok");
                } else {
                    delete siteCategories[dom];
                    delete siteCategories[cleanDom];
                    delete siteCategories[noWww];
                    delete siteCategories["www." + noWww];
                    if (!hiddenDefaultSites.includes(cleanDom)) {
                        hiddenDefaultSites.push(cleanDom);
                    }
                    if (!hiddenDefaultSites.includes(noWww)) {
                        hiddenDefaultSites.push(noWww);
                    }
                    window.siteCategories = siteCategories;
                    window.siteCats = siteCategories;
                    window.hiddenDefaultSites = hiddenDefaultSites;
                    await sLocal({
                        siteCategories: siteCategories,
                        hiddenDefaultSites: hiddenDefaultSites
                    });
                    await msg("TRIGGER_DNR_UPDATE");
                    renderCategories();
                    toast(t_("siteRemoved") || "Site removed", "ok");
                }
            })), i.querySelectorAll(".cat-rule-btn").forEach(e => e.addEventListener("click", () => {
                if (window.openAddOrEditModal) {
                    window.openAddOrEditModal(e.getAttribute("data-domain"));
                }
            })), n.appendChild(i), e.appendChild(n)
        }
    }) : setSafeHTML(e, '<div class="card"><div class="empty">\n      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>\n      <p>No sites visited yet.</p>\n    </div></div>')
}

function renderFocus(e, t = 25) {
    if (!e || !e.active) {
        $("frf") && $("frf").setAttribute("stroke-dashoffset", FCIRC), $("ftb") && ($("ftb").textContent = t + ":00"), $("fcyc") && ($("fcyc").textContent = t_("zeroCycles")), $("fpb") && ($("fpb").textContent = t_("work"), $("fpb").style.color = "var(--green)"), $("frf") && ($("frf").style.stroke = "var(--green)"), $("logo-img") && ($("logo-img").className = ""), $("btn-fs") && ($("btn-fs").style.display = "inline-flex"), $("btn-fst") && ($("btn-fst").style.display = "none"), $("btn-fp") && ($("btn-fp").style.display = "none"), $("btn-skip") && ($("btn-skip").style.display = "none"), $("frf") && ($("frf").style.opacity = "1");
        let e = document.getElementById("dynamic-favicon");
        return void (e && (e.href = "../assets/icons/icon128.png"))
    }
    $("logo-img") && ($("logo-img").className = "on");
    var a = "work" === e.phase,
        n = e.fullDuration || (a ? 1500 : "long_break" === e.phase ? 900 : 300),
        i = Math.max(0, 1 - Math.min(1, (e.remaining || 0) / n));
    $("frf") && ($("frf").style.stroke = a ? "var(--green)" : "var(--amber)", $("frf").setAttribute("stroke-dashoffset", (FCIRC * i).toFixed(1))), $("fpb") && ($("fpb").style.color = a ? "var(--green)" : "var(--amber)", $("fpb").textContent = a ? t_("work") : "long_break" === e.phase ? t_("longBreakPhase") : t_("shortBreakPhase")), $("ftb") && ($("ftb").textContent = fmtT(e.remaining || 0));
    
    let totalC = e.totalCycles || 4;
    let cycText = "";
    if (e.isSchedule) {
        cycText = t_("scheduledFocus") || "Scheduled Session";
    } else if (e.phase === "work") {
        let currentC = Math.min((e.cyclesCompleted || 0) + 1, totalC);
        cycText = `Cycle ${currentC} of ${totalC}`;
    } else if (e.phase === "long_break") {
        cycText = t_("longBreakPhase") || "Long Break";
    } else {
        cycText = `Break ${e.cyclesCompleted || 1} of ${totalC}`;
    }
    $("fcyc") && ($("fcyc").textContent = cycText);

    $("btn-fs") && ($("btn-fs").style.display = "none");
    if ($("btn-fst")) $("btn-fst").style.display = "inline-flex";
    if ($("btn-skip")) $("btn-skip").style.display = a ? "none" : "inline-flex";
    if ($("btn-fp")) {
        $("btn-fp").style.display = "inline-flex";
        $("btn-fp").dataset.state = e.paused ? "paused" : "running";
        const fpTxt = e.paused ? (e.remaining === n ? ("work" === e.phase ? t_("startWork") : t_("startBreak")) : t_("btnResume")) : t_("btnPause");
        const fpLabel = $("btn-fp-label") || $("btn-fp").querySelector("span[data-i18n]") || $("btn-fp").querySelector("span:last-child");
        if (fpLabel) {
            fpLabel.textContent = fpTxt;
        } else {
            $("btn-fp").textContent = fpTxt;
        }
        const fpIcon = $("btn-fp-icon") || $("btn-fp").querySelector("[data-icon]");
        if (fpIcon && typeof FlowIcons !== "undefined") {
            const iconName = e.paused ? "play" : "pause";
            setSafeHTML(fpIcon, FlowIcons.get(iconName, { size: 16 }));
        }
        if ($("frf")) $("frf").style.opacity = e.paused ? "0.5" : "1";
    }
    // Bug #5 fix: reuse the single off-screen canvas instead of allocating each tick
    const s = _favCanvas;
    s.width = 32; s.height = 32; // resetting width clears the canvas
    const o = s.getContext("2d"),
        r = document.documentElement.classList.contains("light");
    o.fillStyle = r ? "#f1f5f9" : "#121212", o.beginPath(), o.arc(16, 16, 16, 0, 2 * Math.PI), o.fill(), o.strokeStyle = "#2E2E2E", o.lineWidth = 4, o.beginPath(), o.arc(16, 16, 12, 0, 2 * Math.PI), o.stroke(), o.strokeStyle = a ? "#05D581" : "#F6B846", o.lineCap = "round", o.beginPath(), o.arc(16, 16, 12, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * (1 - i)), o.stroke();
    let l = document.getElementById("dynamic-favicon");
    l && (l.href = s.toDataURL())
}
async function getActiveWorkMins() {
    try {
        const localRes = await gSync(["focusPresets"]);
        const syncRes = await gSync(["settings"]);
        const presetsList = localRes.focusPresets;
        const settings = syncRes.settings || {};
        const activeId = settings.activePresetId || "pomodoro";
        if (Array.isArray(presetsList) && presetsList.length) {
            const ap = presetsList.find(p => p.id === activeId) || presetsList[0];
            if (ap && ap.work) return ap.work;
        }
        return settings.focusWork || 25;
    } catch (_) {
        return 25;
    }
}

async function loadFocusUI() {
    var e = await msg("FOCUS_GET_STATE"),
        a = await getActiveWorkMins();
    renderFocus(e?.focusState, a)
}
// Bug #5 fix: accept pre-loaded settings to avoid double gSync when called alongside loadExtendedSettings
async function loadSettings(preloadedSettings) {
    var e = preloadedSettings || (await gSync(["settings"])).settings || {};
    if ($("tog-badge")) $("tog-badge").checked = !1 !== e.showBadge;
    if ($("idle-timeout-sel")) $("idle-timeout-sel").value = e.idleTimeout || 30;
    if ($("welcome-back-thresh-sel")) $("welcome-back-thresh-sel").value = e.welcomeBackThresh || 10;
}

function ensureChartLibrary() {
    return Promise.resolve();
}

async function loadAnalytics() {
    await loadCategories();
    if ("overview" === currentATab || "trend" === currentATab) {
        try {
            await ensureChartLibrary();
        } catch (err) {
            console.warn("[FF] Failed to load charting library:", err);
        }
    }
    const tabEl = $("atab-" + currentATab);

    try {
        if ("overview" === currentATab) await renderOverview();
        else if ("daily" === currentATab) await renderDailyBreakdown();
        else if ("topsites" === currentATab) await renderTopSites();
        else if ("trend" === currentATab) await renderTrend();
    } catch (err) {
        console.error("[FF] Error rendering analytics view:", err);
    }
}

// FF v4.2: Insights — 365-day GitHub-style consistency heatmap.
async function renderInsights() {
    const canvas = $("heatmap-canvas");
    if (!canvas) return;
    const loader = $("heatmap-loading");
    if (loader) loader.style.display = "block";
    canvas.style.display = "none";
    // Build 365 day keys (oldest → newest)
    const keys = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 364; i >= 0; i--) {
        const d = new Date(today); d.setDate(today.getDate() - i);
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    const [rangeRes, settingsRes] = await Promise.all([
        msg("STATS_GET_RANGE", { days: keys }),
        gSync(["settings"])
    ]);
    const data = rangeRes?.data || {};
    recalculateRangeStats(data);
    const settings = settingsRes?.settings || {};
    const goalCats = settings.goalCats || ["productivity", "learning"];
    const showWasted = settings.showWastedDays !== false;
    const minActiveSecs = 60 * (settings.heatmapMinActive || 10);
    const ratioThresh = (settings.heatmapRatioThresh || 50) / 100;

    // FF v6.18: Start heatmap from first day of data
    let firstDataIdx = keys.findIndex(k => {
        const d = data[k] || {};
        return Object.keys(d).length > 0 && Object.values(d).some(v => v > 0);
    });
    if (firstDataIdx === -1) firstDataIdx = keys.length - 1; // At least today
    keys.splice(0, firstDataIdx);

    // Compute per-day status: 'empty' | 'ok' | 'good' | 'great' | 'best' | 'wasted'
    const cellStatus = {}, dailyTotals = {};
    let active = 0, wasted = 0;
    keys.forEach(k => {
        const d = data[k] || {};
        const focus = goalCats.reduce((s, c) => s + (d[c] || 0), 0);
        const prod = d.productivity || 0;
        const learn = d.learning || 0;
        const distract = d.distraction || 0;
        // Fix Issue 7: Calculate total by summing raw categories exactly once to prevent double-counting
        const total = prod + learn + distract + (d.communication || 0) + (d.uncategorized || 0);
        dailyTotals[k] = { focus, prod, learn, distract, total };
    });
    keys.forEach(k => {
        const { focus, prod, learn, distract, total } = dailyTotals[k];
        if (total < minActiveSecs) { cellStatus[k] = "empty"; return; }
        
        const denominator = focus + distract;
        if (denominator === 0) {
            cellStatus[k] = "empty";
            return;
        }
        
        const ratio = focus / denominator;
        if (showWasted && ratio < ratioThresh) {
            cellStatus[k] = "wasted"; wasted++; return;
        }
        
        active++;
        if (ratio >= 1.0) {
            cellStatus[k] = "best";
        } else {
            const range = 1.0 - ratioThresh;
            if (range <= 0) {
                cellStatus[k] = "best";
            } else {
                const normalized = (ratio - ratioThresh) / range;
                if (normalized >= 0.75) cellStatus[k] = "best";
                else if (normalized >= 0.5) cellStatus[k] = "great";
                else if (normalized >= 0.25) cellStatus[k] = "good";
                else cellStatus[k] = "ok";
            }
        }
    });

    // Layout: 53 columns × 7 rows, 28px cells with 6px gap, top-left = oldest week
    const cell = 28, gap = 6, rowH = cell + gap;
    // Safe split-based date construction to prevent RangeErrors/Invalid Dates on some systems
    const parts0 = keys[0].split("-");
    const firstDate = new Date(parseInt(parts0[0], 10), parseInt(parts0[1], 10) - 1, parseInt(parts0[2], 10));
    // Fix Issue 6: Pad based on chosen weekStartsOn setting (Monday vs Sunday start)
    const weekStartsOn = settings.weekStartsOn || "mon";
    const padStart = weekStartsOn === "sun" ? firstDate.getDay() : (firstDate.getDay() + 6) % 7;
    const totalCells = padStart + keys.length;
    const cols = Math.ceil(totalCells / 7);
    const W = cols * rowH + 60; // +60 for month labels area
    const H = 7 * rowH + 44;    // +44 for weekday + month labels
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const isLight = document.documentElement.classList.contains("light");
    const COLORS = isLight ? {
        empty: "rgba(0,0,0,0.05)",
        ok: "rgba(2,133,78,0.15)",
        good: "rgba(2,133,78,0.35)",
        great: "rgba(2,133,78,0.65)",
        best: "#02854e",
        wasted: "#d94152"
    } : {
        empty: "rgba(255,255,255,0.05)",
        ok: "rgba(5,213,129,0.30)",
        good: "rgba(5,213,129,0.55)",
        great: "rgba(5,213,129,0.80)",
        best: "#05D581",
        wasted: "#F46B7A"
    };
    const textStyle = isLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.45)";
    const monthTextStyle = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)";


    // Month labels along top
    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.fillStyle = textStyle;
    let lastMonth = -1;
    let lastMonthX = -Infinity;
    const MIN_LABEL_GAP = 30; // px — FF v4.9: skip month label if too close to previous
    const cellRects = []; // for tooltip hit-testing
    for (let i = 0; i < totalCells; i++) {
        const col = Math.floor(i / 7), row = i % 7;
        const x = 56 + col * rowH;
        const y = 28 + row * rowH;
        if (i < padStart) continue;
        const k = keys[i - padStart];
        const status = cellStatus[k] || "empty";
        ctx.fillStyle = COLORS[status];
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, cell, cell, 6); else ctx.rect(x, y, cell, cell);
        ctx.fill();
        cellRects.push({ x, y, k, status, focus: dailyTotals[k].focus, prod: dailyTotals[k].prod, learn: dailyTotals[k].learn, distract: dailyTotals[k].distract });
        if (row === 0) {
            const m = new Date(k + "T00:00:00").getMonth();
            if (m !== lastMonth && (x - lastMonthX) >= MIN_LABEL_GAP) {
                ctx.fillStyle = monthTextStyle;
                ctx.fillText(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m], x, 20);
                lastMonth = m;
                lastMonthX = x;
            } else if (m !== lastMonth) {
                // Track the month change even if label was skipped, so the next month
                // gets a chance to render once it's far enough away.
                lastMonth = m;
            }
        }
    }
    // Weekday labels
    ctx.fillStyle = textStyle;
    const weekdayLabels = (settings.weekStartsOn || "mon") === "sun"
        ? [t_("sun"), t_("mon"), t_("tue"), t_("wed"), t_("thu"), t_("fri"), t_("sat")]
        : [t_("mon"), t_("tue"), t_("wed"), t_("thu"), t_("fri"), t_("sat"), t_("sun")];
    weekdayLabels.forEach((lbl, idx) => {
        ctx.fillText(lbl, 0, 28 + idx * rowH + 20);
    });

    // KPI cards (FF v4.4: streak cards replaced by Good Days + Wasted)
    $("ins-good-days") && ($("ins-good-days").textContent = active);
    $("ins-wasted-days") && ($("ins-wasted-days").textContent = wasted);


    // Weekday vs weekend split + best DOW
    const dowFocus = [0, 0, 0, 0, 0, 0, 0], dowCount = [0, 0, 0, 0, 0, 0, 0];
    keys.forEach(k => {
        const partsK = k.split("-");
        const dow = new Date(parseInt(partsK[0], 10), parseInt(partsK[1], 10) - 1, parseInt(partsK[2], 10)).getDay();
        dowFocus[dow] += dailyTotals[k].focus;
        if (dailyTotals[k].total > 60) dowCount[dow]++;
    });
    const wkdSecs = dowFocus.slice(1, 6).reduce((a, b) => a + b, 0);
    const wknSecs = dowFocus[0] + dowFocus[6];
    const wkdAvg = wkdSecs / Math.max(1, dowCount.slice(1, 6).reduce((a, b) => a + b, 0));
    const wknAvg = wknSecs / Math.max(1, dowCount[0] + dowCount[6]);
    $("ins-wkd-split") && setSafeHTML($("ins-wkd-split"),
        `Weekdays avg: <strong style="color:var(--green)">${fmt(wkdAvg)}</strong>/day<br>Weekends avg: <strong style="color:var(--green)">${fmt(wknAvg)}</strong>/day`);
    const dowNames = [t_("sunday"), t_("monday"), t_("tuesday"), t_("wednesday"), t_("thursday"), t_("friday"), t_("saturday")];
    let bestDow = 0, bestAvg = 0;
    for (let i = 0; i < 7; i++) {
        const a = dowFocus[i] / Math.max(1, dowCount[i]);
        if (a > bestAvg) { bestAvg = a; bestDow = i; }
    }
    $("ins-best-dow") && setSafeHTML($("ins-best-dow"),
        bestAvg > 0 ? t_("bestDowStat", [dowNames[bestDow], fmt(bestAvg)]) : t_("notEnoughDataYet"));

    // Hide loading state and display canvas (FF v6.18)
    if (loader) loader.style.display = "none";
    canvas.style.display = "block";

    // Tooltip: use real invisible DOM cells over the canvas. This avoids fragile
    // canvas coordinate hit-testing and bypasses the browser's native title popup.
    const wrap = $("heatmap-wrap") || canvas.parentElement;
    let tip = $("heatmap-tooltip-live");
    if (!tip) {
        tip = document.createElement("div");
        tip.id = "heatmap-tooltip-live";
        tip.className = "chart-tooltip";
        document.body.appendChild(tip);
    }
    const oldTip = $("heatmap-tooltip");
    if (oldTip) oldTip.style.display = "none";
    canvas.onmousemove = null;
    canvas.onmouseleave = null;

    let hoverLayer = $("heatmap-hover-layer");
    if (!hoverLayer) {
        hoverLayer = document.createElement("div");
        hoverLayer.id = "heatmap-hover-layer";
    }
    if (wrap && hoverLayer.parentElement !== wrap) wrap.appendChild(hoverLayer);
    hoverLayer.textContent = "";
    hoverLayer.style.cssText = [
        "position:absolute",
        "left:0",
        "top:0",
        "width:" + W + "px",
        "height:" + H + "px",
        "z-index:5",
        "pointer-events:auto"
    ].join(";") + ";";
    canvas.style.position = "relative";
    canvas.style.zIndex = "1";

    const hideHeatmapTip = () => {
        tip.style.display = "none";
        tip.style.opacity = "0";
    };
    const showHeatmapTip = (ev, hit) => {
        let dateLabel = hit.k;
        try {
            const parts = hit.k.split("-");
            const dObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            dateLabel = dObj.toLocaleDateString(getLocale(), { weekday: "short", month: "short", day: "numeric" });
        } catch (e) {}
        setSafeHTML(tip, `<div style="font-weight:800;margin-bottom:8px;border-bottom:1px solid var(--bd2);padding-bottom:6px">${dateLabel}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:4px;color:#05D581"><span>Productivity:</span> <span class="num">${fmt(hit.prod)}</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:4px;color:#A855F7"><span>Learning:</span> <span class="num">${fmt(hit.learn)}</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;color:#F46B7A"><span>Distraction:</span> <span class="num">${fmt(hit.distract)}</span></div>`);
        tip.style.display = "flex";
        tip.style.opacity = "1";
        const tipRect = tip.getBoundingClientRect();
        let tx = ev.clientX + 12;
        let ty = ev.clientY + 12;
        if (tx + tipRect.width > window.innerWidth - 8) tx = ev.clientX - tipRect.width - 12;
        if (ty + tipRect.height > window.innerHeight - 8) ty = ev.clientY - tipRect.height - 12;
        tip.style.left = Math.max(8, tx) + "px";
        tip.style.top = Math.max(8, ty) + "px";
    };

    hoverLayer.textContent = "";
    hoverLayer.onmousemove = (ev) => {
        const rect = hoverLayer.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;
        const mouseY = ev.clientY - rect.top;
        const hit = cellRects.find(r => 
            mouseX >= r.x && mouseX <= r.x + cell &&
            mouseY >= r.y && mouseY <= r.y + cell
        );
        if (hit) {
            showHeatmapTip(ev, hit);
        } else {
            hideHeatmapTip();
        }
    };
    hoverLayer.onmouseleave = hideHeatmapTip;
    const legend = $("heatmap-legend");
    if (legend && !legend.dataset.wired) {
        legend.dataset.wired = "true";
        legend.addEventListener("click", async () => {
            const existing = document.querySelector(".hm-modal-overlay");
            if (existing) existing.remove();

            const settingsRes = await gSync(["settings"]);
            const settings = settingsRes?.settings || {};
            const goalCats = settings.goalCats || ["productivity", "learning"];
            const overlay = document.createElement("div");
            overlay.className = "overlay hm-modal-overlay";
            overlay.style.zIndex = "9999";
            setSafeHTML(overlay, `
              <div class="card" style="width:100%;max-width:460px;padding:0;display:flex;flex-direction:column;max-height:85vh;overflow:hidden;">
                <div style="padding:var(--space-lg) var(--space-lg) var(--space-md);border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                  <div style="font-size:20px;font-weight:800;color:var(--tx);display:flex;align-items:center;gap:var(--space-xs);">
                    ${FlowIcons.get("gear", { size: 20, style: "vertical-align:middle;flex-shrink:0;" })}
                    <span>${t_("heatmapThresholds") || "Heatmap Thresholds"}</span>
                  </div>
                  <button id="hm-close" style="background:none;border:none;color:var(--tx3);cursor:pointer;padding:var(--space-xxs);display:inline-flex;align-items:center;justify-content:center;">
                    ${FlowIcons.get("close", { size: 18 })}
                  </button>
                </div>
                <div style="padding:var(--space-lg);display:flex;flex-direction:column;gap:var(--space-lg);overflow-y:auto;flex:1;">
                  <div>
                    <label class="slbl" style="display:block;margin-bottom:var(--space-xs);">${t_("minActiveTimeMins") || "Minimum Active Time (minutes)"}</label>
                    <input type="number" id="hm-min-active" class="inp" value="${settings.heatmapMinActive || 10}" style="width:100%"/>
                    <div style="font-size:12px;color:var(--tx3);margin-top:var(--space-xxs);">${t_("minActiveTimeDesc") || "Minimum total tracked time to color a day."}</div>
                  </div>
                  <div>
                    <label class="slbl" style="display:block;margin-bottom:var(--space-xs);">${t_("ratioThresholdPct") || "Ratio Threshold (%)"}</label>
                    <input type="number" id="hm-ratio-threshold" class="inp" value="${settings.heatmapRatioThresh || 50}" style="width:100%"/>
                    <div style="font-size:12px;color:var(--tx3);margin-top:var(--space-xxs);">${t_("ratioThresholdDesc") || "If your focus ratio is below this %, the day is Wasted (Red). Otherwise, it is Active (Green)."}</div>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-sm) 0;border-bottom:1px solid var(--bd);">
                    <div>
                      <label class="slbl" style="display:block;">${t_("showWastedDays") || "Show Wasted Days (Red)"}</label>
                      <div style="font-size:12px;color:var(--tx3);margin-top:var(--space-xxs);">${t_("showWastedDaysDesc") || "Highlight high-distraction days as red blocks."}</div>
                    </div>
                    <label class="tog">
                      <input type="checkbox" id="hm-show-wasted" ${settings.showWastedDays !== false ? 'checked' : ''}/>
                      <span class="ttrack"></span>
                    </label>
                  </div>
                  <div>
                    <label class="slbl" style="display:block;margin-bottom:var(--space-xs);">${t_("focusCategories") || "Focus Categories"}</label>
                    <div class="c-checkbox-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
                      ${["productivity", "learning", "communication", "distraction", "uncategorized"].map(c => `
                        <label class="c-checkbox-lbl" style="padding:10px;font-size:13px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;cursor:pointer;border:1px solid var(--bd);border-radius:10px;background:var(--bg3);">
                          <input type="checkbox" class="hm-cat-cb" value="${c}" ${goalCats.includes(c) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--green);cursor:pointer;"/>
                          <span>${catEmoji(c)} ${catLabel(c, false)}</span>
                        </label>
                      `).join('')}
                    </div>
                    <div style="font-size:12px;color:var(--tx3);">${t_("selectFocusCatsDesc") || "Select which categories count towards your daily Focus Time."}</div>
                  </div>
                </div>
                <div style="padding:var(--space-md) var(--space-lg) var(--space-lg);border-top:1px solid var(--bd);display:flex;gap:var(--space-sm);justify-content:flex-end;flex-shrink:0;">
                  <button class="bs" id="hm-cancel">${t_("cancel") || "Cancel"}</button>
                  <button class="bp" id="hm-save" style="font-size:13px;font-weight:700;">${t_("saveSettings") || "Save Settings"}</button>
                </div>
              </div>
            `);
            document.body.appendChild(overlay);

            const cancelBtn = overlay.querySelector("#hm-cancel");
            const closeBtn = overlay.querySelector("#hm-close");
            const saveBtn = overlay.querySelector("#hm-save");

            if (cancelBtn) cancelBtn.onclick = () => overlay.remove();
            if (closeBtn) closeBtn.onclick = () => overlay.remove();
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

            if (saveBtn) {
                saveBtn.onclick = async () => {
                    const sv = (await gSync(["settings"])).settings || {};
                    sv.heatmapMinActive = parseInt(overlay.querySelector("#hm-min-active").value) || 10;
                    sv.heatmapRatioThresh = parseInt(overlay.querySelector("#hm-ratio-threshold").value) || 50;
                    sv.showWastedDays = overlay.querySelector("#hm-show-wasted").checked;
                    
                    const checkedCats = Array.from(overlay.querySelectorAll(".hm-cat-cb:checked")).map(cb => cb.value);
                    sv.goalCats = checkedCats.length > 0 ? checkedCats : ["productivity", "learning"];

                    await sSync({ settings: sv });
     
                    overlay.remove();
                    renderInsights();
                    if (typeof toast === "function") toast(t_("thresholdsUpdated") || "Thresholds updated", "ok");
                };
            }
        });
    }
}

function getDays(e) {
    // Bug #1 fix: use const/let throughout to prevent var-hoisting shadowing between branches.
    // FF v4.4: supports number-of-days OR { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }.
    if (e && typeof e === "object" && e.from && e.to) {
        const t = [], a = [];
        const start = new Date(e.from + "T00:00:00");
        const end = new Date(e.to + "T00:00:00");
        if (isNaN(start) || isNaN(end) || end < start) return { days: [], labels: [] };
        const maxDays = 365;
        let cursor = new Date(start);
        while (cursor <= end && t.length < maxDays) {
            const s = cursor.getFullYear(),
                o = String(cursor.getMonth() + 1).padStart(2, "0"),
                r = String(cursor.getDate()).padStart(2, "0");
            t.push(`${s}-${o}-${r}`);
            a.push(cursor.toLocaleDateString(getLocale(), { month: "short", day: "numeric" }));
            cursor.setDate(cursor.getDate() + 1);
        }
        return { days: t, labels: a };
    }
    const t = [], a = [];
    for (let n = (parseInt(e) || 7) - 1; n >= 0; n--) {
        const i = new Date;
        i.setDate(i.getDate() - n);
        const s = i.getFullYear(),
            o = String(i.getMonth() + 1).padStart(2, "0"),
            r = String(i.getDate()).padStart(2, "0");
        t.push(`${s}-${o}-${r}`);
        a.push(i.toLocaleDateString(getLocale(), { month: "short", day: "numeric" }));
    }
    return { days: t, labels: a };
}
document.querySelectorAll(".nav-links .ni").forEach(e => {
    e.addEventListener("click", async () => {
        var t = e.getAttribute("data-tab");
        if (!t) return;
        document.querySelectorAll(".nav-links .ni").forEach(button => {
            button.classList.remove("act");
            button.setAttribute("aria-selected", "false");
            button.removeAttribute("aria-current");
        });
        document.querySelectorAll(".tab").forEach(e => e.classList.remove("act"));
        e.classList.add("act");
        e.setAttribute("aria-selected", "true");
        e.setAttribute("aria-current", "page");
        const targetTab = $("tab-" + t);
        if (targetTab) targetTab.classList.add("act");
        "analytics" === t && loadAnalytics();
        "settings" === t && loadExtendedSettings();
        "focus" === t && (loadFocusUI(), loadWeeklyGoalSettings(), loadFocusHistory());
        "sitemanager" === t && (async () => { await Promise.all([loadRules(), loadCategories(), loadVisitedSites(), loadExtendedSettings()]); renderCategories(); renderGranularBlocksUI(); })();

    })
}),
    // FF v6.8: Settings sub-tab switching
    document.querySelectorAll("[data-settab]").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("[data-settab]").forEach(b => b.classList.remove("act"));
            btn.classList.add("act");
            const tab = btn.getAttribute("data-settab");
            const trackingPane = $("settab-tracking");
            const securityPane = $("settab-security");
            if (trackingPane) {
                trackingPane.style.display = tab === "tracking" ? "" : "none";
                if (tab === "tracking") {
                    trackingPane.classList.remove("ff-tab-anim");
                    void trackingPane.offsetWidth;
                    trackingPane.classList.add("ff-tab-anim");
                }
            }
            if (securityPane) {
                securityPane.style.display = tab === "security" ? "" : "none";
                if (tab === "security") {
                    securityPane.classList.remove("ff-tab-anim");
                    void securityPane.offsetWidth;
                    securityPane.classList.add("ff-tab-anim");
                }
            }
        });
    }), $("btn-bulk-edit") && $("btn-bulk-edit").addEventListener("click", async () => {
        await promptPinIfEnabled("lockRules") && (isBulkMode = !0, bulkSelected.clear(), $("btn-bulk-edit").style.display = "none", $("bulk-actions").style.display = "flex", renderCombined())
    }), $("btn-bulk-cancel") && $("btn-bulk-cancel").addEventListener("click", () => {
        isBulkMode = !1, bulkSelected.clear(), $("btn-bulk-edit").style.display = "", $("bulk-actions").style.display = "none", renderCombined()
    }), $("btn-bulk-delete") && $("btn-bulk-delete").addEventListener("click", async () => {
        if (0 === bulkSelected.size) return void toast(t_("noItemsSelected"), "er");
        if (!(await showConfirm(t_("deleteRules"), t_("deleteRulesConfirm", [bulkSelected.size]), { isDestructive: true, confirmText: t_("deleteConfirmBtn") }))) return;
        rules = rules.filter(e => !bulkSelected.has(e.id));
        allowList = allowList.filter(e => !bulkSelected.has(e));
        neverTrackDomains = neverTrackDomains.filter(e => !bulkSelected.has(e));
        await saveRulesAndSync(rules);
        await sLocal({
            allowList: allowList,
            neverTrackDomains: neverTrackDomains
        });
        await msg("TRIGGER_DNR_UPDATE");
        isBulkMode = !1;
        bulkSelected.clear();
        document.querySelectorAll("#btn-bulk-edit, .btn-bulk-edit-shared").forEach(btn => btn.style.display = "");
        $("bulk-actions").style.display = "none";
        renderCombined();
        toast(t_("itemsDeleted"), "ok");
    }), $("btn-add-block") && $("btn-add-block").addEventListener("click", async function () {
        var e = $("cat-inp").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
        if (!e) return toast(t_("enterDomain"), "er");

        var t = "distraction";
        var a = $("cat-redir").value.trim();



        var mId = $("m-id").value;
        var aIdx = rules.findIndex(r => r.id === mId || r.domain === e);

        var ruleObj;
        if (aIdx !== -1) {
            ruleObj = rules[aIdx];
            ruleObj.domain = e;
            ruleObj.category = t;
        } else {
            ruleObj = {
                id: uid(),
                domain: e,
                category: t
            };
            rules.push(ruleObj);
        }

        ruleObj.timeLimitEnabled = $("m-mode-limit").checked;
        ruleObj.dailyLimitSecs = ruleObj.timeLimitEnabled ? 60 * parseInt($("m-lim").value, 10) : 0;

        ruleObj.instantBlock = ruleObj.timeLimitEnabled && ruleObj.dailyLimitSecs === 0;
        if (ruleObj.instantBlock) {
            ruleObj.timeLimitEnabled = false; // Background script uses instantBlock
        }

        ruleObj.focusOnly = $("m-mode-focus").checked;
        ruleObj.scheduleEnabled = $("m-mode-schedule").checked;
        ruleObj.cooldownEnabled = $("m-mode-cooldown").checked;
        ruleObj.sessionLimitEnabled = $("m-mode-session").checked;
        ruleObj.redirectUrl = a || null;
        ruleObj.scheduleEnabled ? ruleObj.schedules = getSlots() : ruleObj.schedules = [];
        ruleObj.cooldownTimer = ruleObj.cooldownEnabled ? parseInt($("m-cd-wait").value, 10) : 10;
        ruleObj.cooldownFrequency = ruleObj.cooldownEnabled ? $("m-cd-freq").value : "always";
        ruleObj.sessionLimitSecs = ruleObj.sessionLimitEnabled ? 60 * parseInt($("m-session-limit").value, 10) : 300;
        ruleObj.sessionCooldownSecs = ruleObj.sessionLimitEnabled ? 60 * parseInt($("m-session-cooldown").value, 10) : 600;

        const _checkedDays = Array.from(document.querySelectorAll('.m-day-cb')).filter(cb => cb.checked).map(cb => parseInt(cb.value));
        ruleObj.activeDays = _checkedDays.length === 7 ? null : _checkedDays;

        await saveRulesAndSync(rules);

        await msg("TRIGGER_DNR_UPDATE");
        $("cat-inp").value = ""; $("cat-redir").value = ""; $("m-id").value = "";
        if ($("add-rule-modal")) $("add-rule-modal").classList.add("hide");
        renderCombined();
    }), $("btn-add-tag-inline") && $("btn-add-tag-inline").addEventListener("click", async function () {
        var e = $("mon-inp-domain").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
        if (e) {
            var t = $("mon-cat").value;
            await tagSite(e, t);
            $("mon-inp-domain").value = "";
            $("mon-inp-domain").blur();
            $("add-rule-modal") && $("add-rule-modal").classList.add("hide");
            toast(t_("taggedSuccessfully", [e]), "ok");
            if (typeof renderTopSites === "function") renderTopSites();
            if (typeof loadAnalytics === "function") loadAnalytics();
        } else toast(t_("enterDomain"), "er")
    }), $("cat-inp") && $("cat-inp").addEventListener("keydown", e => {
        // FF v4.9 — "Just Tag" removed from Rule Manager. Enter now triggers Block.
        if ("Enter" === e.key) {
            const target = $("btn-add-block") || $("btn-add-cat");
            if (target) target.click();
        }
    }), $("add-sched-slot") && $("add-sched-slot").addEventListener("click", () => {
        var e = getSlots();
        e.push({
            start: "09:00",
            end: "17:00"
        }), renderScheduleSlots(e)
    }), ["m-mode-focus", "m-mode-limit", "m-mode-schedule", "m-mode-cooldown", "m-mode-session"].forEach(e => {
        $(e)?.addEventListener("change", () => {
            $("mf-tl").style.display = $("m-mode-limit").checked ? "block" : "none";
            $("mf-sc").style.display = $("m-mode-schedule").checked ? "block" : "none";
            $("mf-cd").style.display = $("m-mode-cooldown").checked ? "block" : "none";
            $("mf-session").style.display = $("m-mode-session").checked ? "block" : "none";
        })
    }), $("btn-fs") && $("btn-fs").addEventListener("click", async () => {
        if ($("btn-fs").disabled) return; $("btn-fs").disabled = true;
        try { renderFocus((await msg("FOCUS_START"))?.focusState, await getActiveWorkMins()); }
        finally { $("btn-fs").disabled = false; }
    }), $("btn-fst") && $("btn-fst").addEventListener("click", async () => {
        if ($("btn-fst").disabled) return; $("btn-fst").disabled = true;
        try {
            if (await promptPinIfEnabled("lockStop")) {
                renderFocus((await msg("FOCUS_STOP"))?.focusState, await getActiveWorkMins()), loadFocusHistory()
            }
        } finally { $("btn-fst").disabled = false; }
    }), $("btn-fp") && $("btn-fp").addEventListener("click", async () => {
        if ($("btn-fp").disabled) return; $("btn-fp").disabled = true;
        try {
            var e = $("btn-fp").dataset.state === "paused";
            if (!e) {
                const confirmed = await showConfirm(
                    t_("confirmPauseTitle") || "Pause focus session?",
                    t_("confirmPauseDesc") || "Sessions can only be paused for up to 5 minutes. After 5 minutes, your session will automatically end.",
                    { confirmText: t_("btnPause") || "Pause", cancelText: t_("cancel") || "Cancel", icon: "⏳" }
                );
                if (!confirmed) return;
            }
            renderFocus((await msg(e ? "FOCUS_RESUME" : "FOCUS_PAUSE"))?.focusState, await getActiveWorkMins())
        } finally { $("btn-fp").disabled = false; }
    }), $("btn-skip") && $("btn-skip").addEventListener("click", async () => {
        if ($("btn-skip").disabled) return; $("btn-skip").disabled = true;
        try { renderFocus((await msg("FOCUS_SKIP"))?.focusState, await getActiveWorkMins()); }
        finally { $("btn-skip").disabled = false; }
    });

    const btnSaveGoalsEl = document.getElementById("btn-save-goals");
    if (btnSaveGoalsEl) {
        btnSaveGoalsEl.onclick = async function(evt) {
            if (evt) evt.preventDefault();
            try {
                var e = (await gSync(["settings"])).settings || {};
                if ($("weekly-goal-input")) e.weeklyGoalHours = parseInt($("weekly-goal-input").value) || 0;
                if ($("streak-min-input")) e.heatmapMinActive = parseInt($("streak-min-input").value) || 10;
                if ($("ratio-threshold-input")) e.heatmapRatioThresh = parseInt($("ratio-threshold-input").value) || 50;
                if ($("week-start-select")) e.weekStartsOn = $("week-start-select").value || "mon";
                let t = [];
                document.querySelectorAll(".goal-cb-cat:checked").forEach(cat => t.push(cat.value));
                e.goalCats = t.length ? t : ["productivity", "learning"];
                await sSync({ settings: e });
            } catch (err) {
                console.error("[FF] Save goals error:", err);
            } finally {
                toast(t_("settingsSaved") || "Settings saved successfully", "ok");
                if (typeof loadWeeklyGoalSettings === "function") loadWeeklyGoalSettings();
                if (typeof loadAnalytics === "function") loadAnalytics();
            }
        };
    }

    document.querySelectorAll("[data-atab]").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetName = btn.getAttribute("data-atab");
            document.querySelectorAll("[data-atab]").forEach(b => b.classList.remove("act"));
            btn.classList.add("act");
            currentATab = targetName;
            ["overview", "daily", "topsites", "trend"].forEach(name => {
                const tab = $("atab-" + name);
                if (tab) {
                    tab.style.display = (name === currentATab) ? "" : "none";
                }
            });
            loadAnalytics();
        });
    }), document.querySelectorAll("[data-range]").forEach(e => {
        e.addEventListener("click", () => {
            document.querySelectorAll("[data-range]").forEach(b => b.classList.remove("act"));
            e.classList.add("act");
            var v = e.getAttribute("data-range");
            var panel = $("ov-custom-panel");
            if (v === "custom") {
                if (panel) panel.style.display = "flex";
                if ($("ov-from") && !$("ov-from").value) {
                    var f = new Date(); f.setDate(f.getDate() - 30);
                    var t2 = new Date();
                    $("ov-from").value = f.toISOString().slice(0, 10);
                    $("ov-to").value = t2.toISOString().slice(0, 10);
                }
                return;
            }
            if (panel) panel.style.display = "none";
            analyticsRange = parseInt(v) || 7;
            overviewCustomFrom = null; overviewCustomTo = null;
            $("ov-range-lbl") && ($("ov-range-lbl").textContent = t_("lastXDays", [analyticsRange]));
            renderOverview();
        })
    }), document.querySelectorAll("[data-siterange]").forEach(e => {
        e.addEventListener("click", () => {
            document.querySelectorAll("[data-siterange]").forEach(e => e.classList.remove("act")), e.classList.add("act"), siteRange = e.getAttribute("data-siterange"), renderTopSites()
        })
    }), document.querySelectorAll("[data-trendrange]").forEach(e => {
        e.addEventListener("click", () => {
            document.querySelectorAll("[data-trendrange]").forEach(b => b.classList.remove("act"));
            e.classList.add("act");
            var v = e.getAttribute("data-trendrange");
            var panel = $("trend-custom-panel");
            if (v === "custom") {
                if (panel) panel.style.display = "flex";
                if ($("trend-from") && !$("trend-from").value) {
                    var f = new Date(); f.setDate(f.getDate() - 30);
                    var t2 = new Date();
                    $("trend-from").value = f.toISOString().slice(0, 10);
                    $("trend-to").value = t2.toISOString().slice(0, 10);
                }
                return;
            }
            if (panel) panel.style.display = "none";
            trendRange = parseInt(v) || 7;
            trendCustomFrom = null; trendCustomTo = null;
            renderTrend();
        })
    });

    const btnTrendLine = document.getElementById("btn-trend-view-line");
    const btnTrendBar = document.getElementById("btn-trend-view-bar");
    if (btnTrendLine && btnTrendBar) {
        if (activeTrendView === "line") {
            btnTrendLine.classList.add("act");
            btnTrendBar.classList.remove("act");
        } else {
            btnTrendBar.classList.add("act");
            btnTrendLine.classList.remove("act");
        }
        btnTrendLine.addEventListener("click", () => {
            if (activeTrendView === "line") return;
            activeTrendView = "line";
            btnTrendLine.classList.add("act");
            btnTrendBar.classList.remove("act");
            renderTrend();
        });
        btnTrendBar.addEventListener("click", () => {
            if (activeTrendView === "bar") return;
            activeTrendView = "bar";
            btnTrendBar.classList.add("act");
            btnTrendLine.classList.remove("act");
            renderTrend();
        });
    }
// FF v4.2: Daily Breakdown range selector
document.querySelectorAll("[data-dailyrange]").forEach(e => {
    e.addEventListener("click", () => {
        document.querySelectorAll("[data-dailyrange]").forEach(b => b.classList.remove("act"));
        e.classList.add("act");
        const v = e.getAttribute("data-dailyrange");
        const panel = $("db-custom-panel");
        if (v === "custom") {
            if (panel) panel.style.display = "flex";
            // Pre-fill with last 30 days if empty
            if ($("db-from") && !$("db-from").value) {
                const f = new Date(); f.setDate(f.getDate() - 30);
                const t2 = new Date();
                $("db-from").value = f.toISOString().slice(0, 10);
                $("db-to").value = t2.toISOString().slice(0, 10);
            }
            return; // wait for Apply
        }
        if (panel) panel.style.display = "none";
        dailyRange = parseInt(v) || 7;
        renderDailyBreakdown();
    });
});
const dbApplyBtn = $("db-apply");
if (dbApplyBtn) {
    dbApplyBtn.addEventListener("click", () => {
        const f = $("db-from")?.value, tt = $("db-to")?.value;
        if (!f || !tt) { toast && toast(t_("pickBothDates"), "err"); return; }
        dailyRange = "custom"; dailyCustomFrom = f; dailyCustomTo = tt;
        renderDailyBreakdown();
    });
}
// FF v4.4: Custom range Apply for Overview + Comparison
const ovApplyBtn = $("ov-apply");
if (ovApplyBtn) {
    ovApplyBtn.addEventListener("click", () => {
        const f = $("ov-from")?.value, tt = $("ov-to")?.value;
        if (!f || !tt) { toast && toast(t_("pickBothDates"), "err"); return; }
        if (new Date(tt) < new Date(f)) { toast && toast(t_("endDateBeforeStart"), "err"); return; }
        overviewCustomFrom = f; overviewCustomTo = tt;
        $("ov-range-lbl") && ($("ov-range-lbl").textContent = f + " → " + tt);
        renderOverview();
    });
}
const trendApplyBtn = $("trend-apply");
if (trendApplyBtn) {
    trendApplyBtn.addEventListener("click", () => {
        const f = $("trend-from")?.value, tt = $("trend-to")?.value;
        if (!f || !tt) { toast && toast(t_("pickBothDates"), "err"); return; }
        if (new Date(tt) < new Date(f)) { toast && toast(t_("endDateBeforeStart"), "err"); return; }
        trendCustomFrom = f; trendCustomTo = tt;
        renderTrend();
    });
}
let tooltipEl = null;
let mouseX = 0, mouseY = 0;

document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (tooltipEl && tooltipEl.style.display === "block") {
        tooltipEl.style.left = (mouseX + 15) + "px";
        tooltipEl.style.top = (mouseY - 15) + "px";
        const _ttR = tooltipEl.getBoundingClientRect();
        if (_ttR.right > window.innerWidth - 8) tooltipEl.style.left = (mouseX - _ttR.width - 15) + "px";
        if (_ttR.bottom > window.innerHeight - 8) tooltipEl.style.top = (mouseY - _ttR.height) + "px";
    }
});

function hideTooltip() {
    if (tooltipEl) {
        tooltipEl.style.display = "none";
        tooltipEl.style.opacity = "0";
    }
}

function showTooltip(e, t, a) {
    if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.className = "chart-tooltip";
        document.body.appendChild(tooltipEl);
    }
    setSafeHTML(tooltipEl, a);
    tooltipEl.style.display = "block";
    tooltipEl.style.opacity = "1";
    tooltipEl.style.left = (mouseX + 15) + "px";
    tooltipEl.style.top = (mouseY - 15) + "px";
    const _ttR = tooltipEl.getBoundingClientRect();
    if (_ttR.right > window.innerWidth - 8) tooltipEl.style.left = (mouseX - _ttR.width - 15) + "px";
    if (_ttR.bottom > window.innerHeight - 8) tooltipEl.style.top = (mouseY - _ttR.height) + "px";
}

function attachChartWheelScroll(scrollEl) {
    if (!scrollEl || scrollEl._wheelAttached) return;
    scrollEl._wheelAttached = true;
    scrollEl.addEventListener("wheel", (e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

        const delta = e.deltaY;
        if (!delta) return;

        const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
        if (maxScroll <= 0) return;

        const cur = scrollEl.scrollLeft;
        const canScrollRight = delta > 0 && cur < maxScroll - 1;
        const canScrollLeft = delta < 0 && cur > 1;

        if (canScrollRight || canScrollLeft) {
            e.preventDefault();
            scrollEl.scrollLeft += delta;
        }
    }, { passive: false });
}

function renderYAxisLabels(yAxisId, maxVal, topPad, bottomPad, plotH, textColor) {
    const yAxisEl = document.getElementById(yAxisId);
    const rightYAxisId = yAxisId + "-right";
    const yAxisElRight = document.getElementById(rightYAxisId);
    
    if (yAxisEl) {
        yAxisEl.textContent = "";
        yAxisEl.style.display = 'flex';
        yAxisEl.style.position = "absolute";
        yAxisEl.style.left = "0px";
        yAxisEl.style.top = "0px";
        yAxisEl.style.bottom = "35px";
        yAxisEl.style.width = "50px";
        yAxisEl.style.zIndex = "10";
    }
    if (yAxisElRight) {
        yAxisElRight.textContent = "";
        yAxisElRight.style.display = 'flex';
        yAxisElRight.style.position = "absolute";
        yAxisElRight.style.right = "0px";
        yAxisElRight.style.top = "0px";
        yAxisElRight.style.bottom = "35px";
        yAxisElRight.style.width = "50px";
        yAxisElRight.style.zIndex = "10";
    }

    const steps = 4;
    for (let s = 0; s <= steps; s++) {
        const val = (maxVal / steps) * s;
        const yPos = (topPad + plotH) - (s / steps) * plotH;
        const labelText = maxVal > 90 ? (val / 60).toFixed(1) + "h" : Math.round(val) + "m";
        
        if (yAxisEl) {
            const lbl = document.createElement("div");
            lbl.textContent = labelText;
            lbl.style.cssText = `
                position: absolute;
                right: 8px;
                top: ${Math.round(yPos - 6)}px;
                color: ${textColor};
                font-family: 'Manrope', system-ui, sans-serif;
                font-size: 11px;
                font-weight: 700;
                line-height: 1;
            `;
            yAxisEl.appendChild(lbl);
        }
        if (yAxisElRight) {
            const lbl = document.createElement("div");
            lbl.textContent = labelText;
            lbl.style.cssText = `
                position: absolute;
                left: 8px;
                top: ${Math.round(yPos - 6)}px;
                color: ${textColor};
                font-family: 'Manrope', system-ui, sans-serif;
                font-size: 11px;
                font-weight: 700;
                line-height: 1;
            `;
            yAxisElRight.appendChild(lbl);
        }
    }
}

function drawBarChart(canvasId, yAxisId, scrollId, labels, dayKeys, dayStats, selectedCats, daySiteLogs) {
    const scrollEl = document.getElementById(scrollId);
    if (scrollEl) {
        scrollEl.style.paddingLeft = '50px';
        scrollEl.style.paddingRight = '50px';
        attachChartWheelScroll(scrollEl);
    }

    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl || !scrollEl) return;

    const containerWidth = scrollEl.parentElement.clientWidth || 800;
    const chartWidth = Math.max(containerWidth - 100, 80 * labels.length);
    
    let wrapper = canvasEl.parentElement;
    if (wrapper.id !== canvasId + '-wrapper') {
        wrapper = document.createElement('div');
        wrapper.id = canvasId + '-wrapper';
        canvasEl.parentNode.insertBefore(wrapper, canvasEl);
        wrapper.appendChild(canvasEl);
    }
    wrapper.style.width = chartWidth + "px";
    wrapper.style.height = "450px";
    wrapper.style.position = "relative";

    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = chartWidth * dpr;
    canvasEl.height = 450 * dpr;
    canvasEl.style.width = chartWidth + "px";
    canvasEl.style.height = "450px";

    const ctx = canvasEl.getContext("2d");
    ctx.scale(dpr, dpr);

    const isLight = document.documentElement.classList.contains("light");
    const textColor = isLight ? "#0f172a" : "#ffffff";
    const textMuted = isLight ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.6)";
    const gridColor = isLight ? "rgba(15, 23, 42, 0.04)" : "rgba(255, 255, 255, 0.04)";

    const activeCats = selectedCats.length ? selectedCats : ["uncategorized"];
    let maxVal = 0;
    dayKeys.forEach(dayKey => {
        let dayTotal = 0;
        activeCats.forEach(cat => {
            dayTotal += Math.max(0, Math.round((dayStats[dayKey] && dayStats[dayKey][cat] || 0) / 60));
        });
        if (dayTotal > maxVal) maxVal = dayTotal;
    });
    maxVal = Math.max(60, maxVal);

    let totalDailyMins = 0;
    dayKeys.forEach(dayKey => {
        activeCats.forEach(cat => {
            totalDailyMins += Math.max(0, Math.round((dayStats[dayKey] && dayStats[dayKey][cat] || 0) / 60));
        });
    });
    const avgMins = dayKeys.length > 0 ? (totalDailyMins / dayKeys.length) : 0;
    const avgLabel = avgMins >= 60 ? (avgMins / 60).toFixed(1) + "h" : Math.round(avgMins) + "m";

    const topPad = 30;
    const bottomPad = 50;
    const plotH = 450 - topPad - bottomPad;
    const colW = chartWidth / labels.length;

    renderYAxisLabels(yAxisId, maxVal, topPad, bottomPad, plotH, textColor);

    function render(hoveredColIdx = -1, hoveredCat = null) {
        ctx.clearRect(0, 0, chartWidth, 450);

        // 1. Grid lines
        ctx.save();
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        for (let s = 0; s <= 4; s++) {
            const yPos = topPad + plotH - (s / 4) * plotH;
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(chartWidth, yPos);
            ctx.stroke();
        }
        ctx.restore();

        // 2. Average line
        const showAvg = $("tog-trend-avg") && $("tog-trend-avg").checked;
        if (showAvg && avgMins > 0) {
            const avgY = topPad + plotH - Math.min(1, avgMins / maxVal) * plotH;
            ctx.save();
            ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.35)' : 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, avgY);
            ctx.lineTo(chartWidth, avgY);
            ctx.stroke();

            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 11px "Manrope", sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'right';
            ctx.fillText(`AVG: ${avgLabel}`, chartWidth - 8, avgY - 4);
            ctx.restore();
        }

        // 3. Bars & X-axis Labels
        const barW = Math.min(32, colW * 0.7);
        dayKeys.forEach((dayKey, i) => {
            const xCenter = (i + 0.5) * colW;
            const barX = xCenter - barW / 2;
            let curY = topPad + plotH;

            if (i === hoveredColIdx) {
                ctx.save();
                ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.03)' : 'rgba(255, 255, 255, 0.03)';
                ctx.fillRect(i * colW, topPad, colW, plotH);
                ctx.restore();
            }

            activeCats.forEach(cat => {
                const mins = Math.max(0, Math.round((dayStats[dayKey] && dayStats[dayKey][cat] || 0) / 60));
                if (mins <= 0) return;
                const h = (mins / maxVal) * plotH;
                const topY = curY - h;

                ctx.save();
                ctx.fillStyle = catColor(cat);
                if (hoveredColIdx === i && hoveredCat && hoveredCat !== cat) {
                    ctx.globalAlpha = 0.5;
                }
                ctx.fillRect(barX, topY, barW, h);
                ctx.restore();

                curY = topY;
            });

            // X-axis label
            ctx.save();
            ctx.fillStyle = (i === hoveredColIdx) ? textColor : textMuted;
            ctx.font = (i === hoveredColIdx) ? "bold 12px 'Manrope', system-ui, sans-serif" : "600 12px 'Manrope', system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(labels[i] || "", xCenter, topPad + plotH + 12);
            ctx.restore();
        });
    }

    render();

    canvasEl.onmousemove = (ev) => {
        const rect = canvasEl.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;
        const mouseY = ev.clientY - rect.top;
        const colIdx = Math.floor(mouseX / colW);

        if (colIdx >= 0 && colIdx < dayKeys.length && mouseY >= topPad && mouseY <= topPad + plotH) {
            const dayKey = dayKeys[colIdx];
            let curY = topPad + plotH;
            let matchedCat = null;
            let matchedVal = 0;

            activeCats.forEach(cat => {
                const mins = Math.max(0, Math.round((dayStats[dayKey] && dayStats[dayKey][cat] || 0) / 60));
                if (mins <= 0) return;
                const h = (mins / maxVal) * plotH;
                const topY = curY - h;
                if (mouseY >= topY && mouseY <= curY) {
                    matchedCat = cat;
                    matchedVal = mins;
                }
                curY = topY;
            });

            if (!matchedCat && activeCats.length > 0) {
                matchedCat = activeCats.find(cat => (dayStats[dayKey]?.[cat] || 0) > 0) || activeCats[0];
                matchedVal = Math.max(0, Math.round((dayStats[dayKey]?.[matchedCat] || 0) / 60));
            }

            render(colIdx, matchedCat);

            if (matchedCat) {
                let sites = daySiteLogs[dayKey] || {};
                let items = [];
                Object.entries(sites).forEach(([domain, secs]) => {
                    if (getEffectiveCat(domain).cat === matchedCat && secs > 0) {
                        items.push({ domain, mins: Math.round(secs / 60) });
                    }
                });
                items.sort((a, b) => b.mins - a.mins);
                let top5 = items.slice(0, 5);
                let cColor = catColor(matchedCat);
                let labelStr = CAT_META[matchedCat]?.label || catLabel(matchedCat, false);
                let html = `<div style="font-weight:800;margin-bottom:6px;border-bottom:1px solid var(--bd2);padding-bottom:6px;color:${cColor}">${labelStr} · ${fmt(60 * matchedVal)}</div>`;
                if (top5.length === 0) {
                    html += '<div style="font-size:12px;color:var(--tx2)">No specific sites tracked.</div>';
                } else {
                    top5.forEach(e => {
                        html += `<div style="display:flex;justify-content:space-between;gap:16px;font-size:12px;margin-bottom:4px"><span>${e.domain}</span><span class="num" style="color:var(--tx2);font-weight:700">${fmt(60 * e.mins)}</span></div>`;
                    });
                }
                showTooltip(ev.clientX, ev.clientY, html);
            } else {
                hideTooltip();
            }
        } else {
            render(-1, null);
            hideTooltip();
        }
    };

    canvasEl.onmouseleave = () => {
        render(-1, null);
        hideTooltip();
    };

    setTimeout(() => {
        scrollEl.scrollLeft = scrollEl.scrollWidth;
    }, 50);
}

function drawTrendChart(canvasId, yAxisId, scrollId, labels, prod, learn, comm, dist, unc) {
    const scrollEl = document.getElementById(scrollId);
    if (scrollEl) {
        scrollEl.style.paddingLeft = '50px';
        scrollEl.style.paddingRight = '50px';
        attachChartWheelScroll(scrollEl);
    }

    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl || !scrollEl) return;

    const containerWidth = scrollEl.parentElement.clientWidth || 800;
    const chartWidth = Math.max(containerWidth - 100, 80 * labels.length);
    
    let wrapper = canvasEl.parentElement;
    if (wrapper.id !== canvasId + '-wrapper') {
        wrapper = document.createElement('div');
        wrapper.id = canvasId + '-wrapper';
        canvasEl.parentNode.insertBefore(wrapper, canvasEl);
        wrapper.appendChild(canvasEl);
    }
    wrapper.style.width = chartWidth + "px";
    wrapper.style.height = "450px";
    wrapper.style.position = "relative";

    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = chartWidth * dpr;
    canvasEl.height = 450 * dpr;
    canvasEl.style.width = chartWidth + "px";
    canvasEl.style.height = "450px";

    const ctx = canvasEl.getContext("2d");
    ctx.scale(dpr, dpr);

    const isLight = document.documentElement.classList.contains("light");
    const textColor = isLight ? "#0f172a" : "#ffffff";
    const textMuted = isLight ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.6)";
    const gridColor = isLight ? "rgba(15, 23, 42, 0.04)" : "rgba(255, 255, 255, 0.04)";

    const categories = [
        { key: 'productivity', label: catLabel('productivity', !1), data: prod, color: catColor('productivity'), dash: [] },
        { key: 'learning', label: catLabel('learning', !1), data: learn, color: catColor('learning'), dash: [] },
        { key: 'communication', label: catLabel('communication', !1), data: comm, color: catColor('communication'), dash: [2, 2] },
        { key: 'distraction', label: catLabel('distraction', !1), data: dist, color: catColor('distraction'), dash: [6, 4] },
        { key: 'uncategorized', label: catLabel('uncategorized', !1), data: unc, color: catColor('uncategorized'), dash: [4, 4] }
    ].filter(c => c.data && c.data.length);

    let maxVal = 0;
    categories.forEach(c => {
        c.data.forEach(v => { if (v > maxVal) maxVal = v; });
    });
    maxVal = Math.max(60, maxVal);

    const topPad = 30;
    const bottomPad = 50;
    const plotH = 450 - topPad - bottomPad;
    const colW = chartWidth / labels.length;

    renderYAxisLabels(yAxisId, maxVal, topPad, bottomPad, plotH, textColor);

    function getPoints(data) {
        return data.map((v, i) => {
            const x = (i + 0.5) * colW;
            const y = topPad + plotH - Math.max(0, Math.min(1, v / maxVal)) * plotH;
            return { x, y, val: v };
        });
    }

    function render(hoveredIdx = -1) {
        ctx.clearRect(0, 0, chartWidth, 450);

        // 1. Grid lines
        ctx.save();
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        for (let s = 0; s <= 4; s++) {
            const yPos = topPad + plotH - (s / 4) * plotH;
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(chartWidth, yPos);
            ctx.stroke();
        }
        ctx.restore();

        // 2. Vertical guide line if hovered
        if (hoveredIdx >= 0 && hoveredIdx < labels.length) {
            const guideX = (hoveredIdx + 0.5) * colW;
            ctx.save();
            ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.2)' : 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(guideX, topPad);
            ctx.lineTo(guideX, topPad + plotH);
            ctx.stroke();
            ctx.restore();
        }

        // 3. Category Lines & Fills
        categories.forEach(cat => {
            const pts = getPoints(cat.data);
            if (pts.length < 2) return;

            // Area fill gradient
            const grad = ctx.createLinearGradient(0, topPad, 0, topPad + plotH);
            const fadeColor = (typeof hexToRgba === "function") ? hexToRgba(cat.color, 0.15) : 'rgba(5, 213, 129, 0.15)';
            grad.addColorStop(0, fadeColor);
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

            ctx.save();
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, topPad + plotH);
            ctx.lineTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                const prev = pts[i - 1];
                const curr = pts[i];
                const cpX = (prev.x + curr.x) / 2;
                ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y);
            }
            ctx.lineTo(pts[pts.length - 1].x, topPad + plotH);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // Line stroke
            ctx.save();
            ctx.strokeStyle = cat.color;
            ctx.lineWidth = 3;
            ctx.setLineDash(cat.dash || []);
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                const prev = pts[i - 1];
                const curr = pts[i];
                const cpX = (prev.x + curr.x) / 2;
                ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y);
            }
            ctx.stroke();
            ctx.restore();

            // Highlight dot at hovered day index
            if (hoveredIdx >= 0 && hoveredIdx < pts.length && pts[hoveredIdx].val > 0) {
                const pt = pts[hoveredIdx];
                ctx.save();
                ctx.fillStyle = cat.color;
                ctx.strokeStyle = isLight ? '#ffffff' : '#000000';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        });

        // 4. X-axis Labels
        labels.forEach((lbl, i) => {
            const xCenter = (i + 0.5) * colW;
            ctx.save();
            ctx.fillStyle = (i === hoveredIdx) ? textColor : textMuted;
            ctx.font = (i === hoveredIdx) ? "bold 12px 'Manrope', system-ui, sans-serif" : "600 12px 'Manrope', system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(lbl || "", xCenter, topPad + plotH + 12);
            ctx.restore();
        });
    }

    render();

    canvasEl.onmousemove = (ev) => {
        const rect = canvasEl.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;
        const mouseY = ev.clientY - rect.top;
        const colIdx = Math.floor(mouseX / colW);

        if (colIdx >= 0 && colIdx < labels.length && mouseY >= topPad && mouseY <= topPad + plotH + 30) {
            render(colIdx);

            let html = `<div style="font-weight:800;margin-bottom:6px;border-bottom:1px solid var(--bd2);padding-bottom:6px">${labels[colIdx]}</div>`;
            let hasData = false;
            categories.forEach(cat => {
                const val = cat.data[colIdx] || 0;
                if (val > 0) {
                    html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:4px">
                        <div style="display:flex;align-items:center;gap:6px">
                            <span style="color:${cat.color}">●</span> ${cat.label}:
                        </div> 
                        <span class="num" style="color:var(--tx);font-weight:700">${fmt(60 * val)}</span>
                    </div>`;
                    hasData = true;
                }
            });

            if (hasData) {
                showTooltip(ev.clientX, ev.clientY, html);
            } else {
                hideTooltip();
            }
        } else {
            render(-1);
            hideTooltip();
        }
    };

    canvasEl.onmouseleave = () => {
        render(-1);
        hideTooltip();
    };

    setTimeout(() => {
        scrollEl.scrollLeft = scrollEl.scrollWidth;
    }, 50);
}
async function renderOverview() {
    var {
        days: e,
        labels: t
    } = getDays(overviewCustomFrom && overviewCustomTo ? { from: overviewCustomFrom, to: overviewCustomTo } : analyticsRange), a = await msg("STATS_GET_RANGE", {
        days: e
    }), n = a?.data || {};
    recalculateRangeStats(n);
    var i = {
        sites: {}
    }, s = {};
    e.forEach(e => {
        var t = n[e] || {};
        s[e] = t.sites || {}, Object.keys(t).forEach(e => {
            "sites" === e ? Object.entries(t.sites || {}).forEach(([e, t]) => i.sites[e] = (i.sites[e] || 0) + t) : "number" == typeof t[e] && (i[e] = (i[e] || 0) + t[e])
        })
    }), $("an-total") && ($("an-total").textContent = fmt(allCats().reduce((e, t) => e + (i[t] || 0), 0))), $("an-prod") && ($("an-prod").textContent = fmt(i.productivity || 0), $("an-prod").nextElementSibling && ($("an-prod").nextElementSibling.textContent = catLabel("productivity", !1))), $("an-lrn") && ($("an-lrn").textContent = fmt(i.learning || 0), $("an-lrn").nextElementSibling && ($("an-lrn").nextElementSibling.textContent = catLabel("learning", !1))), $("an-comms") && ($("an-comms").textContent = fmt(i.communication || 0), $("an-comms").nextElementSibling && ($("an-comms").nextElementSibling.textContent = catLabel("communication", !1))), $("an-dist") && ($("an-dist").textContent = fmt(i.distraction || 0), $("an-dist").nextElementSibling && ($("an-dist").nextElementSibling.textContent = catLabel("distraction", !1)));
    const totalsResp = await msg("STATS_GET_ALLTIME_TOTALS");
    const totalDaysResp = await msg("STATS_GET_TOTAL_DAYS");
    const totals = totalsResp?.allTimeTotals || {};
    const r = Object.values(totals).reduce((sum, secs) => sum + secs, 0);
    const l = totalDaysResp?.totalDays || 1;
    $("at-total") && ($("at-total").textContent = fmt(r));
    $("at-daily-avg") && ($("at-daily-avg").textContent = fmt(l > 0 ? Math.round(r / l) : 0));
    $("at-days") && ($("at-days").textContent = l);
    var c = await msg("STATS_GET_STREAK"),
        d = c && c.streak || {};
    $("an-bs") && ($("an-bs").textContent = (d.bestStreak || 0) + "d"), $("an-bd") && ($("an-bd").textContent = d.bestDay ? new Date(d.bestDay + "T00:00:00").toLocaleDateString(getLocale(), {
        month: "short",
        day: "numeric"
    }) : "—");
    // 1. Calculate overall category totals
    const prodSecs = i.productivity || 0;
    const learnSecs = i.learning || 0;
    const commSecs = i.communication || 0;
    const distractSecs = i.distraction || 0;
    const uncSecs = i.uncategorized || 0;
    const totalSecs = prodSecs + learnSecs + commSecs + distractSecs + uncSecs;

    // Update Figma Trend Badges & Companion Pills
    if (totalSecs > 0) {
        const prodPct = Math.round((prodSecs / totalSecs) * 100);
        const lrnPct = Math.round((learnSecs / totalSecs) * 100);
        const distPct = Math.round((distractSecs / totalSecs) * 100);
        const commPct = Math.round((commSecs / totalSecs) * 100);

        if ($("trend-total")) {
            $("trend-total").innerHTML = `<span class="trend-icon">↑</span><span class="trend-text">${totalSecs > 3600 ? "Active" : "Today"}</span>`;
        }
        if ($("trend-prod")) {
            $("trend-prod").innerHTML = `<span class="trend-icon">↑</span><span class="trend-text">+${prodPct}%</span>`;
            $("trend-prod").className = `figma-trend-badge ${prodPct >= 40 ? "positive" : ""}`;
        }
        if ($("trend-lrn")) {
            $("trend-lrn").innerHTML = `<span class="trend-icon">↑</span><span class="trend-text">${lrnPct}%</span>`;
            $("trend-lrn").className = `figma-trend-badge ${lrnPct > 0 ? "positive" : ""}`;
        }
        if ($("trend-dist")) {
            $("trend-dist").innerHTML = `<span class="trend-icon">${distPct > 25 ? "↑" : "↓"}</span><span class="trend-text">${distPct}%</span>`;
            $("trend-dist").className = `figma-trend-badge ${distPct > 35 ? "negative" : "neutral"}`;
        }
        if ($("trend-comms")) {
            $("trend-comms").innerHTML = `<span class="trend-icon">↑</span><span class="trend-text">${commPct}%</span>`;
            $("trend-comms").className = "figma-trend-badge";
        }
    } else {
        if ($("trend-total")) $("trend-total").innerHTML = `<span class="trend-icon">—</span><span class="trend-text">0m</span>`;
        if ($("trend-prod")) $("trend-prod").innerHTML = `<span class="trend-icon">—</span><span class="trend-text">0%</span>`;
        if ($("trend-lrn")) $("trend-lrn").innerHTML = `<span class="trend-icon">—</span><span class="trend-text">0%</span>`;
        if ($("trend-dist")) $("trend-dist").innerHTML = `<span class="trend-icon">—</span><span class="trend-text">0%</span>`;
        if ($("trend-comms")) $("trend-comms").innerHTML = `<span class="trend-icon">—</span><span class="trend-text">0%</span>`;
    }

    if ($("trend-streak")) {
        const streakCount = d.bestStreak || 0;
        $("trend-streak").innerHTML = `<span class="trend-icon">🔥</span><span class="trend-text">${streakCount > 0 ? streakCount + "d record" : "Record"}</span>`;
    }
    if ($("trend-avg")) {
        const iconSvg = window.FlowIcons ? window.FlowIcons.get("analytics", { size: 11 }) : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>';
        $("trend-avg").innerHTML = `<span class="trend-icon" style="display:inline-flex; align-items:center;">${iconSvg}</span><span class="trend-text">Pace</span>`;
    }

    // Update donut center label
    if ($("ov-donut-total-lbl")) {
        $("ov-donut-total-lbl").textContent = fmt(totalSecs);
    }

    // Draw circular Donut Chart
    const donutCanvas = document.getElementById("ov-donut-chart");
    if (donutCanvas) {
        const dpr = window.devicePixelRatio || 1;
        const size = 180;
        donutCanvas.width = size * dpr;
        donutCanvas.height = size * dpr;
        donutCanvas.style.width = size + "px";
        donutCanvas.style.height = size + "px";

        const ctx = donutCanvas.getContext("2d");
        ctx.scale(dpr, dpr);

        const dataVals = [
            { cat: "productivity", label: catLabel("productivity", false), secs: prodSecs, color: catColor("productivity") },
            { cat: "learning", label: catLabel("learning", false), secs: learnSecs, color: catColor("learning") },
            { cat: "communication", label: catLabel("communication", false), secs: commSecs, color: catColor("communication") },
            { cat: "distraction", label: catLabel("distraction", false), secs: distractSecs, color: catColor("distraction") },
            { cat: "uncategorized", label: catLabel("uncategorized", false), secs: uncSecs, color: catColor("uncategorized") }
        ];

        const cx = size / 2;
        const cy = size / 2;
        const radius = (size / 2) - 16;
        const lineWidth = 18;
        const total = dataVals.reduce((acc, v) => acc + v.secs, 0);

        function drawDonut(hoveredIndex = -1) {
            ctx.clearRect(0, 0, size, size);

            // Empty state track
            if (total <= 0) {
                const isLight = document.documentElement.classList.contains("light");
                ctx.save();
                ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.08)";
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                return;
            }

            let startAngle = -Math.PI / 2;
            dataVals.forEach((item, idx) => {
                if (item.secs <= 0) return;
                const sliceAngle = (item.secs / total) * Math.PI * 2;
                const endAngle = startAngle + sliceAngle;

                ctx.save();
                ctx.strokeStyle = item.color;
                ctx.lineWidth = (hoveredIndex === idx) ? lineWidth + 4 : lineWidth;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAngle, endAngle);
                ctx.stroke();
                ctx.restore();

                item._startAngle = startAngle;
                item._endAngle = endAngle;
                startAngle = endAngle;
            });
        }

        drawDonut();

        donutCanvas.onmousemove = (ev) => {
            if (total <= 0) return;
            const rect = donutCanvas.getBoundingClientRect();
            const mouseX = ev.clientX - rect.left;
            const mouseY = ev.clientY - rect.top;
            const dx = mouseX - cx;
            const dy = mouseY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist >= radius - lineWidth && dist <= radius + lineWidth) {
                let angle = Math.atan2(dy, dx);
                if (angle < -Math.PI / 2) angle += Math.PI * 2;

                const hoveredIdx = dataVals.findIndex(item => item.secs > 0 && angle >= item._startAngle && angle < item._endAngle);
                if (hoveredIdx >= 0) {
                    donutCanvas.style.cursor = 'pointer';
                    drawDonut(hoveredIdx);
                    const item = dataVals[hoveredIdx];
                    if ($("ov-donut-total-lbl")) $("ov-donut-total-lbl").textContent = fmt(item.secs);
                    if ($("ov-donut-sub-lbl")) $("ov-donut-sub-lbl").textContent = item.label;
                    return;
                }
            }

            donutCanvas.style.cursor = 'default';
            drawDonut(-1);
            if ($("ov-donut-total-lbl")) $("ov-donut-total-lbl").textContent = fmt(totalSecs);
            if ($("ov-donut-sub-lbl")) $("ov-donut-sub-lbl").textContent = t_("tracked") || "tracked";
        };

        donutCanvas.onmouseleave = () => {
            donutCanvas.style.cursor = 'default';
            drawDonut(-1);
            if ($("ov-donut-total-lbl")) $("ov-donut-total-lbl").textContent = fmt(totalSecs);
            if ($("ov-donut-sub-lbl")) $("ov-donut-sub-lbl").textContent = t_("tracked") || "tracked";
        };
    }

    // Render custom donut legend
    const legendEl = $("ov-donut-legend");
    if (legendEl) {
        legendEl.innerHTML = "";
        const catsList = [
            { id: "productivity", color: catColor("productivity"), label: catLabel("productivity", false) },
            { id: "learning", color: catColor("learning"), label: catLabel("learning", false) },
            { id: "communication", color: catColor("communication"), label: catLabel("communication", false) },
            { id: "distraction", color: catColor("distraction"), label: catLabel("distraction", false) },
            { id: "uncategorized", color: catColor("uncategorized"), label: catLabel("uncategorized", false) }
        ];
        catsList.forEach(c => {
            let secs = 0;
            if (c.id === "productivity") secs = prodSecs;
            else if (c.id === "learning") secs = learnSecs;
            else if (c.id === "communication") secs = commSecs;
            else if (c.id === "distraction") secs = distractSecs;
            else if (c.id === "uncategorized") secs = uncSecs;

            if (secs > 0 || totalSecs === 0) {
                const pct = totalSecs > 0 ? Math.round((secs / totalSecs) * 100) : 0;
                const row = document.createElement("div");
                row.className = "ov-legend-row";
                setSafeHTML(row, `
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="width:10px; height:10px; border-radius:50%; background:${c.color}; flex-shrink:0;"></span>
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.label}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
                        <span style="color:var(--tx); font-size:12px;">${fmt(secs)}</span>
                        <span style="color:var(--tx); min-width:32px; text-align:right;">${pct}%</span>
                    </div>
                `);
                row.addEventListener("mouseenter", () => {
                    const dataIndex = ["productivity", "learning", "communication", "distraction", "uncategorized"].indexOf(c.id);
                    if (_donutChartInstance && dataIndex !== -1) {
                        _donutChartInstance.setActiveElements([{ datasetIndex: 0, index: dataIndex }]);
                        _donutChartInstance.update();
                    }
                    if ($("ov-donut-total-lbl")) $("ov-donut-total-lbl").textContent = fmt(secs);
                    if ($("ov-donut-sub-lbl")) $("ov-donut-sub-lbl").textContent = c.label;
                });
                row.addEventListener("mouseleave", () => {
                    if (_donutChartInstance) {
                        _donutChartInstance.setActiveElements([]);
                        _donutChartInstance.update();
                    }
                    if ($("ov-donut-total-lbl")) $("ov-donut-total-lbl").textContent = fmt(totalSecs);
                    if ($("ov-donut-sub-lbl")) $("ov-donut-sub-lbl").textContent = t_("tracked") || "tracked";
                });
                legendEl.appendChild(row);
            }
        });
    }

    // 2. Focus vs Distraction ratio
    const focusSecs = prodSecs + learnSecs;
    const ratioSumSecs = focusSecs + distractSecs;
    let focusPct = 0;
    let distractPct = 0;
    if (ratioSumSecs > 0) {
        focusPct = Math.round((focusSecs / ratioSumSecs) * 100);
        distractPct = 100 - focusPct;
    }
    if ($("ov-ratio-bar-focus-lbl")) $("ov-ratio-bar-focus-lbl").textContent = `Focus: ${focusPct}%`;
    if ($("ov-ratio-bar-dist-lbl")) $("ov-ratio-bar-dist-lbl").textContent = `Distraction: ${distractPct}%`;
    if ($("ov-ratio-bar-focus")) $("ov-ratio-bar-focus").style.width = `${focusPct}%`;
    if ($("ov-ratio-bar-dist")) $("ov-ratio-bar-dist").style.width = `${distractPct}%`;

    // 3. Render Top 6 websites list
    const sortedSites = Object.entries(i.sites || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    const listEl = $("ov-topsites-list");
    if (listEl) {
        listEl.innerHTML = "";
        if (sortedSites.length === 0) {
            listEl.innerHTML = `<div class="empty" style="padding:40px 0;"><p data-i18n="noSitesTracked">No websites tracked for this period.</p></div>`;
        } else {
            const maxSiteSecs = sortedSites[0][1] || 1;
            sortedSites.forEach(([domain, secs]) => {
                const sitePct = Math.round((secs / maxSiteSecs) * 100);
                const row = document.createElement("div");
                row.style.cssText = "display:flex; flex-direction:column; gap:6px; width:100%;";
                setSafeHTML(row, `
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:700;">
                        <span style="display:flex; align-items:center; gap:8px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--tx)">
                            ${getFav(domain)}
                            <span>${domain}</span>
                        </span>
                        <span style="color:var(--tx3); font-size:12px; flex-shrink:0;">${fmt(secs)}</span>
                    </div>
                    <div style="width:100%; height:6px; border-radius:99px; background:var(--bg4); overflow:hidden;">
                        <div style="height:100%; background:var(--purple); width:${sitePct}%; border-radius:99px; transition:width 0.3s ease;"></div>
                    </div>
                `);
                listEl.appendChild(row);
            });
        }
    }

    // 4. Render consistency heatmap at bottom
    await renderInsights();
}
async function renderDailyBreakdown() {
    // FF v4.2: was loading the entire history (STATS_GET_ALL) and slicing 45 days — laggy.
    // Now request only the days we need via STATS_GET_RANGE.
    var t = $("daily-breakdown-list");
    if (!t) return;
    var rangeKeys = [];
    if (dailyRange === "custom" && dailyCustomFrom && dailyCustomTo) {
        const from = new Date(dailyCustomFrom + "T00:00:00");
        const to = new Date(dailyCustomTo + "T00:00:00");
        if (to >= from) {
            const cap = 366; // hard upper bound
            for (let d = new Date(to), i = 0; d >= from && i < cap; d.setDate(d.getDate() - 1), i++) {
                rangeKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
            }
        }
    } else {
        const days = parseInt(dailyRange) || 7;
        for (let i = 0; i < days; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            rangeKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
        }
    }
    const [rangeRes, settingsRes] = await Promise.all([
        msg("STATS_GET_RANGE", { days: rangeKeys }),
        gSync(["settings"])
    ]);
    var e = rangeRes?.data || {};
    recalculateRangeStats(e);
    if (t) {
        t.textContent = "";
        var a = settingsRes?.settings || {},
            n = rangeKeys.filter(k => e[k]); // newest-first already
        
        if (n.length) {
            const fragment = document.createDocumentFragment();
            const catCache = new Map();

            n.forEach(n => {
                var i = e[n] || {},
                    s = i.productivity || 0,
                    o = i.learning || 0,
                    r = i.communication || 0,
                    l = i.distraction || 0,
                    c = i.uncategorized || 0,
                    d = s + o + r + l + c;
                if (d < 60) return;
                var v = document.createElement("div");
                v.className = "db-card";
                var h = "";
                [{
                    c: "productivity",
                    l: catLabel("productivity", false),
                    col: catColor("productivity"),
                    v: s
                }, {
                    c: "learning",
                    l: catLabel("learning", false),
                    col: catColor("learning"),
                    v: o
                }, {
                    c: "communication",
                    l: catLabel("communication", false),
                    col: catColor("communication"),
                    v: r
                }, {
                    c: "distraction",
                    l: catLabel("distraction", false),
                    col: catColor("distraction"),
                    v: l
                }, {
                    c: "uncategorized",
                    l: catLabel("uncategorized", false),
                    col: catColor("uncategorized"),
                    v: c
                }].forEach(item => {
                    item.v > 0 && d && (h += `<div class="db-bar-segment" style="width:${item.v / d * 100}%; background:${item.col};"></div>`)
                });
                var f = "";
                let hasTimeline = i.timeline && i.timeline.length > 0;
                if (hasTimeline) {
                    f = `<div class="db-timeline-container" style="width: 100% !important; margin: 0; position: relative;">
                            <canvas class="db-timeline-canvas" data-day="${n}" style="width: 100%; height: 24px; display: block; border-radius: 6px; background: transparent; border: 1px solid var(--bd); box-sizing: border-box;"></canvas>
                          </div>
                          <div class="db-timeline-labels">
                             <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11:59 PM</span>
                          </div>`;
                }
                var y = '<div class="db-sites-grid">',
                    b = 0;
                Object.entries(i.sites || {}).sort((entry1, entry2) => entry2[1] - entry1[1]).forEach(([dom, secs]) => {
                    if (!(secs < 120)) {
                        b++;
                        if (!catCache.has(dom)) {
                            catCache.set(dom, getEffectiveCat(dom));
                        }
                        const effCat = catCache.get(dom);
                        var pillBorder = catColor(effCat ? effCat.cat : "uncategorized");
                        var safeDom = escHTML(dom);
                        y += `<div class="db-site-pill" style="--border-color:${pillBorder}; align-items:center;">\n        <div class="db-site-left" style="color:var(--tx); font-size:15px; font-weight:800;">${getFav(dom)}<span class="db-site-dom">${safeDom}</span></div>\n        <span class="db-site-time" style="color:var(--tx); font-size:15px; font-weight:800; display:flex; align-items:center;">${fmt(secs)} <button class="scrub-btn" data-day="${n}" data-dom="${safeDom}" data-secs="${secs}" title="Adjust time" style="background:none;border:none;cursor:pointer;opacity:0.6;transition:all 0.2s;margin-left:6px;display:inline-flex;align-items:center;padding:0;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button><button class="daily-site-rule-btn" data-domain="${safeDom}" title="Add or Edit Rule" style="background:none;border:none;cursor:pointer;opacity:0.6;transition:all 0.2s;margin-left:4px;display:inline-flex;align-items:center;padding:0;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg></button></span>\n      </div>`;
                    }
                });
                0 === b && (y += '<span style="font-size:13px;color:var(--tx3);font-weight:600;grid-column:1/-1;">No major site activity tracked.</span>');
                y += "</div>";

                var statsGridHtml = `
                  <div class="db-stats-grid">
                    <!-- Total Tracked -->
                    <div class="db-stat-box" style="--glow-color: rgba(92, 156, 252, 0.15); --glow-border: rgba(92, 156, 252, 0.2); --glow-shadow: rgba(92, 156, 252, 0.1);">
                      <div class="db-stat-info">
                        <span class="db-stat-title">${t_("totalTracked") || "Total Tracked"}</span>
                        <span class="db-stat-value num" style="color: var(--tx);">${fmt(d)}</span>
                      </div>
                    </div>
                    <!-- Productivity -->
                    <div class="db-stat-box" style="--glow-color: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("productivity"), 0.15) : "rgba(5, 213, 129, 0.15)")}; --glow-border: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("productivity"), 0.2) : "rgba(5, 213, 129, 0.2)")}; --glow-shadow: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("productivity"), 0.1) : "rgba(5, 213, 129, 0.1)")}; opacity: ${s > 0 ? "1" : "0.35"};">
                      <div class="db-stat-info">
                        <span class="db-stat-title">${catLabel("productivity", false)}</span>
                        <span class="db-stat-value num" style="color: ${catColor("productivity")};">${fmt(s)}</span>
                      </div>
                    </div>
                    <!-- Learning -->
                    <div class="db-stat-box" style="--glow-color: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("learning"), 0.15) : "rgba(168, 85, 247, 0.15)")}; --glow-border: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("learning"), 0.2) : "rgba(168, 85, 247, 0.2)")}; --glow-shadow: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("learning"), 0.1) : "rgba(168, 85, 247, 0.1)")}; opacity: ${o > 0 ? "1" : "0.35"};">
                      <div class="db-stat-info">
                        <span class="db-stat-title">${catLabel("learning", false)}</span>
                        <span class="db-stat-value num" style="color: ${catColor("learning")};">${fmt(o)}</span>
                      </div>
                    </div>
                    <!-- Communication -->
                    <div class="db-stat-box" style="--glow-color: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("communication"), 0.15) : "rgba(92, 156, 252, 0.15)")}; --glow-border: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("communication"), 0.2) : "rgba(92, 156, 252, 0.2)")}; --glow-shadow: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("communication"), 0.1) : "rgba(92, 156, 252, 0.1)")}; opacity: ${r > 0 ? "1" : "0.35"};">
                      <div class="db-stat-info">
                        <span class="db-stat-title">${catLabel("communication", false)}</span>
                        <span class="db-stat-value num" style="color: ${catColor("communication")};">${fmt(r)}</span>
                      </div>
                    </div>
                    <!-- Distraction -->
                    <div class="db-stat-box" style="--glow-color: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("distraction"), 0.15) : "rgba(244, 107, 122, 0.15)")}; --glow-border: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("distraction"), 0.2) : "rgba(244, 107, 122, 0.2)")}; --glow-shadow: ${(typeof hexToRgba === "function" ? hexToRgba(catColor("distraction"), 0.1) : "rgba(244, 107, 122, 0.1)")}; opacity: ${l > 0 ? "1" : "0.35"};">
                      <div class="db-stat-info">
                        <span class="db-stat-title">${catLabel("distraction", false)}</span>
                        <span class="db-stat-value num" style="color: ${catColor("distraction")};">${fmt(l)}</span>
                      </div>
                    </div>
                  </div>
                `;

                const formattedDateStr = (() => {
                    const parts = n.split("-");
                    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).toLocaleDateString(getLocale(), { weekday: "long", month: "long", day: "numeric" });
                })();

                v.innerHTML = `
                  <div class="db-hero" style="margin-bottom: 24px;">
                    <div class="db-header-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 6px;">
                      <div class="db-card-header-txt">
                        ${formattedDateStr}
                      </div>
                      ${hasTimeline ? `
                        <div class="db-card-header-txt">
                          ${t_("activeTimeline") || "24-Hour Active Timeline"}
                        </div>
                      ` : ''}
                    </div>
                    ${hasTimeline ? `
                      <div class="db-timeline-full-wrap" style="width: 100%; margin-bottom: 20px;">
                        ${f}
                      </div>
                    ` : ''}
                    ${statsGridHtml}
                  </div>
                  <div class="db-bar-container">
                    <div class="db-bar-wrap">${h}</div>
                    <div class="db-bar-legend">
                      <div class="db-bar-legend-item"><span class="db-bar-legend-dot" style="background:${catColor("productivity")}"></span> ${catLabel("productivity", !1)}</div>
                      <div class="db-bar-legend-item"><span class="db-bar-legend-dot" style="background:${catColor("learning")}"></span> ${catLabel("learning", !1)}</div>
                      <div class="db-bar-legend-item"><span class="db-bar-legend-dot" style="background:${catColor("communication")}"></span> ${catLabel("communication", !1)}</div>
                      <div class="db-bar-legend-item"><span class="db-bar-legend-dot" style="background:${catColor("distraction")}"></span> ${catLabel("distraction", !1)}</div>
                      <div class="db-bar-legend-item"><span class="db-bar-legend-dot" style="background:${catColor("uncategorized")}"></span> ${catLabel("uncategorized", !1)}</div>
                    </div>
                  </div>
                  ${y}
                `;
                fragment.appendChild(v);
            });

            t.appendChild(fragment);

            t.querySelectorAll(".db-timeline-canvas").forEach(cv => {
                const dayKey = cv.getAttribute("data-day");
                if (dayKey && e[dayKey] && e[dayKey].timeline) {
                    drawDailyCanvasTimeline(cv, e[dayKey].timeline, dayKey);
                }
            });

            t.querySelectorAll(".scrub-btn").forEach(btn => {
                btn.addEventListener("click", async () => {
                    await promptPinIfEnabled("lockAdjustTime") && openScrubModal(btn.getAttribute("data-day"), btn.getAttribute("data-dom"), parseInt(btn.getAttribute("data-secs")))
                });
            });
            t.querySelectorAll(".daily-site-rule-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    if (window.openAddOrEditModal) {
                        window.openAddOrEditModal(btn.getAttribute("data-domain"));
                    }
                });
            });
        } else {
            t.innerHTML = '<div class="empty">\n      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3; margin-bottom:16px;"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>\n      <p>No activity data available yet.</p>\n    </div>';
        }
    }
}

function drawDailyCanvasTimeline(canvas, timeline, dayKey) {
    if (!canvas || !timeline || !timeline.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = (canvas.clientWidth || canvas.parentElement?.clientWidth || 800) * dpr;
    const height = 24 * dpr;
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    // Gridlines at 25%, 50%, 75%
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1 * dpr;
    [0.25, 0.5, 0.75].forEach(pct => {
        ctx.beginPath();
        ctx.moveTo(width * pct, 0);
        ctx.lineTo(width * pct, height);
        ctx.stroke();
    });

    const dateParts = dayKey.split("-");
    const yr = parseInt(dateParts[0], 10);
    const mo = parseInt(dateParts[1], 10) - 1;
    const dy = parseInt(dateParts[2], 10);
    const midnightStart = new Date(yr, mo, dy, 0, 0, 0, 0).getTime();
    const midnightEnd = midnightStart + 864e5;

    timeline.forEach(aItem => {
        let sTime, eTime;
        if (typeof aItem.start === "number" && aItem.start < 86400) {
            sTime = midnightStart + aItem.start * 1000;
            eTime = sTime + (aItem.dur || 0) * 1000;
        } else {
            sTime = aItem.start;
            eTime = aItem.end || aItem.start;
        }
        sTime = Math.max(midnightStart, sTime);
        eTime = Math.min(midnightEnd, eTime);
        if (eTime > sTime) {
            const blockLeft = ((sTime - midnightStart) / 864e5) * width;
            const blockWidth = Math.max(2 * dpr, ((eTime - sTime) / 864e5) * width);
            ctx.fillStyle = catColor(aItem.cat);
            ctx.fillRect(blockLeft, 0, blockWidth, height);
        }
    });
}
async function renderTopSites() {
    var s = {}, _activeDayCount = 0;
    // FF v6.8: fetch pinned sites from chrome.storage.local
    const storageRes = await new Promise(resolve => {
        chrome.storage.local.get(["pinnedSites"], resolve);
    }) || {};
    const pinnedSites = storageRes.pinnedSites || [];

    if ("all" === siteRange) {
        // FF v6.7: use fast allTimeTotals index instead of loading all daily data
        const _att = (await msg("STATS_GET_ALLTIME_TOTALS"))?.allTimeTotals || {};
        Object.entries(_att).forEach(([dom, secs]) => { s[dom] = secs; });
        _activeDayCount = (await msg("STATS_GET_TOTAL_DAYS"))?.totalDays || 1;
    } else {
        var _rangeDays = [];
        for (var n = parseInt(siteRange) - 1; n >= 0; n--) {
            var i = new Date; i.setDate(i.getDate() - n);
            _rangeDays.push(i.toISOString().split("T")[0]);
        }
        const _rangeData = (await msg("STATS_GET_RANGE", { days: _rangeDays }))?.data || {};
        // Bug #10 fix: compute _activeDayCount in the same loop instead of a separate O(n*m) reduce
        _rangeDays.forEach(d => {
            const entries = Object.entries(_rangeData[d]?.sites || {});
            if (!entries.length) return;
            let dayHasActivity = false;
            entries.forEach(([dom, secs]) => {
                s[dom] = (s[dom] || 0) + secs;
                if (secs > 0) dayHasActivity = true;
            });
            if (dayHasActivity) _activeDayCount++;
        });
        _activeDayCount = Math.max(1, _activeDayCount);
    }
    var t = Object.keys(s);
    // FF v6.8: Sort prioritized pinned sites first, then descending by duration
    var o = Object.entries(s).sort((e, t) => {
        const pinA = pinnedSites.includes(e[0]);
        const pinB = pinnedSites.includes(t[0]);
        if (pinA && !pinB) return -1;
        if (!pinA && pinB) return 1;
        return t[1] - e[1];
    }).slice(0, 50),
        r = $("top-sites");
    if (r)
        if (setSafeHTML(r, ""), o.length) {
            var l = _activeDayCount; // FF v6.7: already computed in range/alltime branch above
            o.forEach(e => {
                var t = getEffectiveCat(e[0]),
                    a = document.createElement("div");
                a.className = "siterow";
                a.style.gridTemplateColumns = "minmax(140px, 1fr) 110px 170px 75px 75px";
                const isPinned = pinnedSites.includes(e[0]);
                var n = buildCustomDropdownHtml(e[0], t.cat);

                setSafeHTML(a, `
      <span class="dom" style="display:flex; align-items:center; gap:8px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">
        ${getFav(e[0])}
        <span style="color:var(--tx); font-weight:800; font-size:15px; margin-left:4px;">${e[0]}</span>
      </span>
      <div style="display:flex; align-items:center; gap:6px; justify-content:center;">
        <button class="top-site-pin-btn pinned-${isPinned}" data-domain="${e[0]}" title="${isPinned ? t_('unpinSite') : t_('pinSiteToTop')}" style="background:none; border:none; cursor:pointer; padding:4px; display:inline-flex; align-items:center; justify-content:center; transition: color 0.2s;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
        </button>
        <a href="https://${e[0]}" class="top-site-visit-btn" target="_blank" title="${t_('visitSite')}" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center; padding:4px; transition: color 0.2s;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
        </a>
        <button class="top-site-rule-btn" data-domain="${e[0]}" title="${t_('addOrEditRule')}" style="background:none; border:none; cursor:pointer; padding:4px; display:inline-flex; align-items:center; justify-content:center; transition: color 0.2s;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        </button>
      </div>
      ${n}
      <span class="stat-pill">${fmt(e[1])}</span>
      <span class="stat-pill">~${fmt(Math.round(e[1] / l))}</span>
    `);
                initCustomDropdowns(a, async (dom, newCat) => {
                    await tagSite(dom, newCat);
                    await loadAnalytics();
                });

                a.querySelector(".top-site-pin-btn")?.addEventListener("click", function () {
                    const dom = this.getAttribute("data-domain");
                    chrome.storage.local.get(["pinnedSites"], function (res) {
                        let list = res.pinnedSites || [];
                        if (list.includes(dom)) {
                            list = list.filter(x => x !== dom);
                        } else {
                            list.push(dom);
                        }
                        chrome.storage.local.set({ pinnedSites: list }, function () {
                            renderTopSites();
                        });
                    });
                });

                a.querySelector(".top-site-rule-btn")?.addEventListener("click", function () {
                    if (window.openAddOrEditModal) {
                        window.openAddOrEditModal(this.getAttribute("data-domain"));
                    }
                });

                r.appendChild(a)
            })
        } else setSafeHTML(r, '<div class="empty">\n      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3; margin-bottom:16px;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1 4-10z"></path></svg>\n      <p>No sites tracked for this period.</p>\n    </div>')
}
async function renderTrend() {
    var _trendCustom = trendCustomFrom && trendCustomTo;
    var _windowDays = _trendCustom
        ? Math.max(1, Math.round((new Date(trendCustomTo) - new Date(trendCustomFrom)) / 86400000) + 1)
        : trendRange;
    var {
        days: e,
        labels: t
    } = getDays(_trendCustom ? { from: trendCustomFrom, to: trendCustomTo } : trendRange);
    var a = await msg("STATS_GET_RANGE", {
        days: e
    });
    var n = a?.data || {};
    recalculateRangeStats(n);
    var i = 0, s = 0;
    var o = e.map(e => {
        var t = (n[e] || {}).productivity || 0;
        return i += t, Math.round(t / 60)
    });
    var r = e.map(e => {
        var t = (n[e] || {}).learning || 0;
        return i += t, Math.round(t / 60)
    });
    var l = e.map(e => {
        var t = (n[e] || {}).communication || 0;
        return Math.round(t / 60)
    });
    var c = e.map(e => {
        var t = (n[e] || {}).distraction || 0;
        return s += t, Math.round(t / 60)
    });
    var d = e.map(e => {
        var t = (n[e] || {}).uncategorized || 0;
        return Math.round(t / 60)
    });

    // Recalculate Category Totals and update toggle labels
    function formatMinsToHours(mins) {
        if (mins >= 60) {
            return (mins / 60).toFixed(1) + "h";
        }
        return mins + "m";
    }

    const prodTotal = o.reduce((a, b) => a + b, 0);
    const lrnTotal = r.reduce((a, b) => a + b, 0);
    const commTotal = l.reduce((a, b) => a + b, 0);
    const distTotal = c.reduce((a, b) => a + b, 0);
    const uncTotal = d.reduce((a, b) => a + b, 0);

    const prodLabel = $("tog-trend-prod-lbl");
    const lrnLabel = $("tog-trend-lrn-lbl");
    const commLabel = $("tog-trend-comm-lbl");
    const distLabel = $("tog-trend-dist-lbl");
    const uncLabel = $("tog-trend-unc-lbl");

    if (prodLabel) {
        prodLabel.textContent = `${catLabel("productivity", !1)} (${formatMinsToHours(prodTotal)})`;
        const dot = $("tog-trend-prod")?.nextElementSibling;
        if (dot) dot.style.background = catColor("productivity");
    }
    if (lrnLabel) {
        lrnLabel.textContent = `${catLabel("learning", !1)} (${formatMinsToHours(lrnTotal)})`;
        const dot = $("tog-trend-lrn")?.nextElementSibling;
        if (dot) dot.style.background = catColor("learning");
    }
    if (commLabel) {
        commLabel.textContent = `${catLabel("communication", !1)} (${formatMinsToHours(commTotal)})`;
        const dot = $("tog-trend-comm")?.nextElementSibling;
        if (dot) dot.style.background = catColor("communication");
    }
    if (distLabel) {
        distLabel.textContent = `${catLabel("distraction", !1)} (${formatMinsToHours(distTotal)})`;
        const dot = $("tog-trend-dist")?.nextElementSibling;
        if (dot) dot.style.background = catColor("distraction");
    }
    if (uncLabel) {
        uncLabel.textContent = `${catLabel("uncategorized", !1)} (${formatMinsToHours(uncTotal)})`;
        const dot = $("tog-trend-unc")?.nextElementSibling;
        if (dot) dot.style.background = catColor("uncategorized");
    }



    // Month-over-Month Comparison Card
    try {
        const nowObj = new Date();
        const thisYear = nowObj.getFullYear();
        const thisMonthVal = nowObj.getMonth();
        const todayDate = nowObj.getDate();

        const thisMonthDays = [];
        for (let d = 1; d <= todayDate; d++) {
            const mStr = String(thisMonthVal + 1).padStart(2, '0');
            const dStr = String(d).padStart(2, '0');
            thisMonthDays.push(`${thisYear}-${mStr}-${dStr}`);
        }

        const lastMonthVal = thisMonthVal === 0 ? 11 : thisMonthVal - 1;
        const lastMonthYear = thisMonthVal === 0 ? thisYear - 1 : thisYear;
        
        const daysInLastMonth = new Date(lastMonthYear, lastMonthVal + 1, 0).getDate();

        const lastMonthDays = [];
        for (let d = 1; d <= daysInLastMonth; d++) {
            const mStr = String(lastMonthVal + 1).padStart(2, '0');
            const dStr = String(d).padStart(2, '0');
            lastMonthDays.push(`${lastMonthYear}-${mStr}-${dStr}`);
        }

        const allRangeDays = [...thisMonthDays, ...lastMonthDays];
        const rangeRes = await msg("STATS_GET_RANGE", { days: allRangeDays });
        const rangeData = rangeRes?.data || {};

        recalculateRangeStats(rangeData);

        const getActiveSecs = (dayKey) => {
            const day = rangeData[dayKey] || {};
            return (day.productivity || 0) + (day.learning || 0) + (day.communication || 0) + (day.distraction || 0) + (day.uncategorized || 0);
        };

        let thisMonthSecs = 0;
        thisMonthDays.forEach(day => thisMonthSecs += getActiveSecs(day));

        let lastMonthSecs = 0;
        lastMonthDays.forEach(day => lastMonthSecs += getActiveSecs(day));

        const momValEl = $("insight-mom-value");
        const momDescEl = $("insight-mom-desc");

        if (momValEl && momDescEl) {
            const thisMonthHrs = (thisMonthSecs / 3600).toFixed(1) + "h";
            const lastMonthHrs = (lastMonthSecs / 3600).toFixed(1) + "h";

            if (thisMonthSecs === 0 && lastMonthSecs === 0) {
                momValEl.textContent = "—";
                momDescEl.textContent = t_("noActiveTimeTracked") || "No active time tracked yet.";
            } else if (lastMonthSecs === 0) {
                momValEl.textContent = t_("activeHrs", [thisMonthHrs]);
                const incSpan = `<span style="color:var(--green); font-weight:700;">↗ ${t_("increase") || "increase"}</span>`;
                momDescEl.innerHTML = t_("vsLastMonth", ["0.0h", incSpan]) || `vs <span style="font-weight:700;">0.0h</span> last month (${incSpan})`;
            } else {
                const diffPct = Math.round(((thisMonthSecs - lastMonthSecs) / lastMonthSecs) * 100);
                if (diffPct > 0) {
                    momValEl.textContent = t_("activeHrs", [thisMonthHrs]);
                    const incSpan = `<span style="color:var(--green); font-weight:700;">↗ ${diffPct}% ${t_("increase") || "increase"}</span>`;
                    momDescEl.innerHTML = t_("vsLastMonth", [lastMonthHrs, incSpan]) || `vs <span style="font-weight:700;">${lastMonthHrs}</span> last month (${incSpan})`;
                } else if (diffPct < 0) {
                    momValEl.textContent = t_("activeHrs", [thisMonthHrs]);
                    const decSpan = `<span style="color:var(--red); font-weight:700;">↘ ${Math.abs(diffPct)}% ${t_("decrease") || "decrease"}</span>`;
                    momDescEl.innerHTML = t_("vsLastMonth", [lastMonthHrs, decSpan]) || `vs <span style="font-weight:700;">${lastMonthHrs}</span> last month (${decSpan})`;
                } else {
                    momValEl.textContent = t_("activeHrs", [thisMonthHrs]);
                    momDescEl.innerHTML = t_("vsLastMonthNoChange", [lastMonthHrs]) || `vs <span style="font-weight:700;">${lastMonthHrs}</span> last month (no change)`;
                }
            }
        }
    } catch (err) {
        console.warn("Failed MoM calculation:", err);
    }


    var u = [];
    for (var p = 2 * _windowDays - 1; p >= _windowDays; p--) {
        // Previous-period window of equal length, ending the day before our window starts.
        var anchor = _trendCustom ? new Date(trendCustomFrom + "T00:00:00") : new Date();
        var g = new Date(anchor);
        if (_trendCustom) {
            g.setDate(anchor.getDate() - (p - _windowDays + 1));
        } else {
            g.setDate(g.getDate() - p);
        }
        u.push(`${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, "0")}-${String(g.getDate()).padStart(2, "0")}`)
    }
    var m = await msg("STATS_GET_RANGE", {
        days: u
    });
    var v = m?.data || {};
    recalculateRangeStats(v);
    var h = 0,
        f = 0;
    u.forEach(e => {
        h += (v[e]?.productivity || 0) + (v[e]?.learning || 0), f += v[e]?.distraction || 0
    });
    var y = h > 0 ? Math.round((i - h) / h * 100) : i > 0 ? 100 : 0,
        b = f > 0 ? Math.round((s - f) / f * 100) : s > 0 ? 100 : 0;



    function buildTrendBadge(percentChange, isProductivity) {
        if (0 === percentChange) {
            return `<span class="stat-trend-badge" style="background:var(--bg4);color:var(--tx3);border:1px solid var(--bd2)">No change</span>`;
        }
        let isGood = isProductivity ? percentChange > 0 : percentChange < 0;
        let badgeClass = isGood ? "stat-trend-badge up-good" : "stat-trend-badge up-bad";
        let arrowSymbol = percentChange > 0 ? "↗" : "↘";
        return `<span class="${badgeClass}">${arrowSymbol} ${Math.abs(percentChange)}%</span> <span class="stat-trend-meta">vs prev ${_windowDays}d</span>`;
    }
    // Calculate Peak Focus Hours
    let hourSeconds = new Array(24).fill(0);
    let hasTimelineData = false;
    Object.values(n).forEach(dayEntry => {
        if (dayEntry && Array.isArray(dayEntry.timeline)) {
            dayEntry.timeline.forEach(session => {
                if (session.cat === "productivity" || session.cat === "learning") {
                    let start = session.start;
                    let end = session.end;
                    let dur = session.dur;
                    let startSecs, endSecs;
                    
                    if (typeof start === "number") {
                        if (start < 86400) {
                            startSecs = start;
                            endSecs = start + (dur || 0);
                        } else if (typeof end === "number") {
                            const date = new Date(start);
                            const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
                            startSecs = Math.max(0, Math.round((start - midnight) / 1000));
                            endSecs = Math.max(0, Math.round((end - midnight) / 1000));
                        }
                    }
                    
                    if (typeof startSecs === "number" && typeof endSecs === "number" && endSecs > startSecs) {
                        hasTimelineData = true;
                        let curr = startSecs;
                        while (curr < endSecs) {
                            let currHour = Math.floor(curr / 3600);
                            if (currHour >= 24) currHour = 23;
                            let nextHourSecs = (currHour + 1) * 3600;
                            let chunkEnd = Math.min(endSecs, nextHourSecs);
                            let chunkSecs = Math.max(0, chunkEnd - curr);
                            hourSeconds[currHour] += chunkSecs;
                            curr = chunkEnd;
                        }
                    }
                }
            });
        }
    });

    let peakHour = -1;
    let maxHourSecs = 0;
    for (let h = 0; h < 24; h++) {
        if (hourSeconds[h] > maxHourSecs) {
            maxHourSecs = hourSeconds[h];
            peakHour = h;
        }
    }

    if (peakHour !== -1 && maxHourSecs > 0) {
        let startHour = peakHour;
        let endHour = (peakHour + 2) % 24;
        function formatHourAMPM(h) {
            let ampm = h >= 12 ? 'PM' : 'AM';
            let displayHour = h % 12;
            displayHour = displayHour ? displayHour : 12;
            return displayHour + ' ' + ampm;
        }
        let timeWindowStr = formatHourAMPM(startHour) + " – " + formatHourAMPM(endHour);
        let peakMins = Math.round(maxHourSecs / 60);
        let peakHoursText = peakMins >= 60 ? (peakMins / 60).toFixed(1) + "h" : peakMins + "m";
        
        $("pop-peak-val") && setSafeHTML($("pop-peak-val"), timeWindowStr);
        $("pop-peak-desc") && setSafeHTML($("pop-peak-desc"), "Your most productive time (total " + peakHoursText + " focus)");
    } else {
        $("pop-peak-val") && setSafeHTML($("pop-peak-val"), "—");
        $("pop-peak-desc") && setSafeHTML($("pop-peak-desc"), "Track focus sessions to see peak hours");
    }

    const btnLine = document.getElementById("btn-trend-view-line");
    const btnBar = document.getElementById("btn-trend-view-bar");
    if (btnLine && btnBar) {
        if (activeTrendView === "line") {
            btnLine.classList.add("act");
            btnBar.classList.remove("act");
        } else {
            btnBar.classList.add("act");
            btnLine.classList.remove("act");
        }
    }

    $("pop-prod-val") && setSafeHTML($("pop-prod-val"), fmt(i));
    $("pop-prod-trend") && setSafeHTML($("pop-prod-trend"), buildTrendBadge(y, true));
    $("pop-dist-val") && setSafeHTML($("pop-dist-val"), fmt(s));
    $("pop-dist-trend") && setSafeHTML($("pop-dist-trend"), buildTrendBadge(b, false));
    var w = !$("tog-trend-prod") || $("tog-trend-prod").checked,
        E = !$("tog-trend-lrn") || $("tog-trend-lrn").checked,
        S = !$("tog-trend-comm") || $("tog-trend-comm").checked,
        L = !$("tog-trend-dist") || $("tog-trend-dist").checked,
        T = !$("tog-trend-unc") || $("tog-trend-unc").checked;

    const lineWrap = $("trend-line-wrapper");
    const barWrap = $("trend-bar-wrapper");

    if (activeTrendView === "line") {
        if (lineWrap) lineWrap.style.display = "";
        if (barWrap) barWrap.style.display = "none";
        "function" == typeof drawTrendChart && $("trend-chart") && drawTrendChart("trend-chart", "trend-y-axis", "trend-scroll", t, w ? o : null, E ? r : null, S ? l : null, L ? c : null, T ? d : null);
    } else {
        if (lineWrap) lineWrap.style.display = "none";
        if (barWrap) barWrap.style.display = "";
        
        let u = [];
        w && u.push("productivity");
        E && u.push("learning");
        L && u.push("distraction");
        S && u.push("communication");
        T && u.push("uncategorized");
        
        let sLogs = {};
        e.forEach(dayKey => {
            sLogs[dayKey] = (n[dayKey] || {}).sites || {};
        });
        
        "function" == typeof drawBarChart && $("trend-bar-chart") && drawBarChart("trend-bar-chart", "trend-bar-y-axis", "trend-bar-scroll", t, e, n, u, sLogs);
    }
}
async function loadDashboardStreak() {
    var t = await msg("STATS_GET_STREAK"),
        s = t && t.streak,
        a = $("streak-badge");
    if (a) {
        if (s && s.currentStreak > 0) {
            a.textContent = "🔥 " + s.currentStreak + "d";
            a.style.display = "inline-flex";
            a.style.background = "var(--amber-bg)";
            a.style.color = "var(--amber)";
            a.style.borderColor = "rgba(246,184,70,.3)";
        } else if (s) {
            a.textContent = "🧊 " + s.currentStreak + "d";
            a.style.display = "inline-flex";
            a.style.background = "var(--bg4)";
            a.style.color = "var(--tx3)";
            a.style.borderColor = "var(--bd2)";
        } else {
            a.style.display = "none";
        }
    }
}
async function loadWeeklyGoalSettings() {
    var e = (await gSync(["settings"])).settings || {};
    $("weekly-goal-input") && ($("weekly-goal-input").value = e.weeklyGoalHours || 0);
    $("streak-min-input") && ($("streak-min-input").value = e.heatmapMinActive || 10);
    $("ratio-threshold-input") && ($("ratio-threshold-input").value = e.heatmapRatioThresh || 50);
    if ($("week-start-select")) {
        $("week-start-select").value = e.weekStartsOn || "mon";
        $("week-start-select").dispatchEvent(new Event("change", { bubbles: true }));
    }
    let t = e.goalCats || ["productivity", "learning"];
    document.querySelectorAll(".goal-cb-cat").forEach(cb => {
        cb.checked = t.includes(cb.value);
        const lbl = cb.closest(".goal-cb-lbl");
        if (lbl) {
            const catKey = cb.value;
            const emoji = catEmoji(catKey);
            const label = catLabel(catKey, false);
            lbl.innerHTML = "";
            lbl.appendChild(cb);
            const txtNode = document.createTextNode(` ${emoji} ${label}`);
            lbl.appendChild(txtNode);
        }
    }), await renderGoalPreview(e.weeklyGoalHours || 0);
    await loadDashboardStreak();
}
async function renderGoalPreview(e) {
    var t = await msg("STATS_GET_WEEK"),
        a = t?.studySecs || 0,
        n = 3600 * e,
        i = Math.min(1, n > 0 ? a / n : 0);
    $("goal-preview-bar") && ($("goal-preview-bar").style.width = Math.round(100 * i) + "%", $("goal-preview-bar").style.background = i >= 1 ? "var(--amber)" : "var(--green)"), $("goal-preview-pct") && ($("goal-preview-pct").textContent = n > 0 ? i >= 1 ? "🏆" : Math.round(100 * i) + "%" : "—", $("goal-preview-pct").style.color = i >= 1 ? "var(--amber)" : "var(--green)"), $("goal-preview-done") && ($("goal-preview-done").textContent = Math.floor(a / 3600) + "h " + Math.floor(a % 3600 / 60) + "m done"), $("goal-preview-left") && ($("goal-preview-left").textContent = n > 0 ? i >= 1 ? "Goal hit! ✓" : fmt(Math.max(0, n - a)) + " remaining" : "No goal")
}

// Storage Usage Indicator Helper
async function updateStorageUsageIndicator() {
    const textEl = $("storage-usage-text");
    if (!textEl) return;

    try {
        let bytes = 0;
        
        // 1. Get chrome.storage.local usage (settings)
        const localBytes = await new Promise((resolve) => {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && typeof chrome.storage.local.getBytesInUse === "function") {
                chrome.storage.local.getBytesInUse(null, (b) => {
                    resolve(b || 0);
                });
            } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                // Fallback for Firefox: stringify storage contents
                chrome.storage.local.get(null, (data) => {
                    try {
                        const str = JSON.stringify(data || {});
                        resolve(str.length);
                    } catch (_) {
                        resolve(0);
                    }
                });
            } else {
                resolve(0);
            }
        });
        bytes += localBytes;

        // 2. Get IndexedDB usage (history database)
        if (navigator.storage && typeof navigator.storage.estimate === "function") {
            try {
                const estimate = await navigator.storage.estimate();
                if (estimate.usage && estimate.usage > 0) {
                    bytes += estimate.usage;
                }
            } catch (_) {}
        }
        
        let formatted = "0.00 KB";
        if (bytes >= 1048576) {
            formatted = (bytes / 1048576).toFixed(2) + " MB";
        } else {
            formatted = (bytes / 1024).toFixed(2) + " KB";
        }

        if (textEl) {
            textEl.textContent = `${formatted} (Unlimited)`;
        }
    } catch (err) {
        console.warn("[FF storage] failed to query storage usage:", err);
    }
}

async function updateDangerCounts() {
    try {
        const totalDaysResp = await msg("STATS_GET_TOTAL_DAYS");
        const days = totalDaysResp?.totalDays || 0;
        if ($("danger-count-data")) {
            $("danger-count-data").textContent = days === 1 ? "1 day recorded" : `${days} days recorded`;
        }

        const syncRes = await gSync(["settings"]);
        const s = syncRes && syncRes.settings ? syncRes.settings : {};
        const blockCount = (s.blockRules || []).length;
        const allowCount = (s.allowRules || []).length;
        const totalRules = blockCount + allowCount;
        if ($("danger-count-rules")) {
            $("danger-count-rules").textContent = totalRules === 1 ? "1 active rule" : `${totalRules} active rules`;
        }

        const locRes = await gLocal(["siteCategories"]);
        const customCats = locRes && locRes.siteCategories ? locRes.siteCategories : {};
        const catKeys = Object.keys(customCats).filter(k => !k.startsWith("www."));
        if ($("danger-count-cats")) {
            $("danger-count-cats").textContent = catKeys.length === 1 ? "1 modified site" : `${catKeys.length} modified sites`;
        }
    } catch (e) {
        console.warn("Failed to update danger counts:", e);
    }
}

// Bug #5 fix: accept pre-loaded settings to avoid double gSync when called alongside loadSettings
async function loadExtendedSettings(preloadedSettings) {
    updateStorageUsageIndicator();
    updateDangerCounts();
    var e = preloadedSettings || (await gSync(["settings"])).settings || {};
    if ($("tog-fun") && ($("tog-fun").checked = !1 !== e.funnyBlocked), 
        $("tab-limit-input") && ($("tab-limit-input").value = e.tabLimit || 0), 
        $("tog-time-warn") && ($("tog-time-warn").checked = !1 !== e.timeWarningEnabled), 
        $("time-warn-secs") && ($("time-warn-secs").value = e.timeWarningSecs || 60), 
        $("tog-badge") && ($("tog-badge").checked = !1 !== e.showBadge), 
        $("tog-idle-badge") && ($("tog-idle-badge").checked = !!e.showIdleBadge), 
        $("idle-timeout-sel") && ($("idle-timeout-sel").value = e.idleTimeout || 30), 
        $("welcome-back-thresh-sel") && ($("welcome-back-thresh-sel").value = e.welcomeBackThresh || 10), 
        $("max-gap-sel") && ($("max-gap-sel").value = e.maxGapSecs !== undefined ? e.maxGapSecs : 300),
        $("tog-media") && ($("tog-media").checked = !1 !== e.trackMedia),
        $("min-visit-sel") && ($("min-visit-sel").value = e.minVisitSecs !== undefined ? e.minVisitSecs : 0),
        $("tog-track-local") && ($("tog-track-local").checked = !!e.trackLocalFiles),
        $("day-rollover-sel") && ($("day-rollover-sel").value = e.dayRolloverHour !== undefined ? e.dayRolloverHour : 0),
        $("data-retention-sel") && ($("data-retention-sel").value = e.dataRetentionDays !== undefined ? e.dataRetentionDays : 365),
        $("lang-sel") && ($("lang-sel").value = e.language || "auto"),
        upgradeAllSettingsSelects(),
        $("pin-status-badge")) {
        const updateIdleBadgeVisibility = () => {
            const idleRow = $("idle-badge-row");
            const badgeChecked = $("tog-badge")?.checked;
            if (idleRow) {
                idleRow.style.opacity = badgeChecked ? "1" : "0.5";
                idleRow.style.pointerEvents = badgeChecked ? "auto" : "none";
            }
        };
        $("tog-badge")?.removeEventListener("change", updateIdleBadgeVisibility);
        $("tog-badge")?.addEventListener("change", updateIdleBadgeVisibility);
        updateIdleBadgeVisibility();

        if (e.passcodeHash) {
            setSafeHTML($("pin-status-badge"), '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>PIN Active');
            $("pin-status-badge").className = "pin-status-badge";
            $("pin-status-badge").style.color = "";
            var t = $("pin-status-wrapper") || $("pin-status-badge").parentElement;
            t.style.display = "flex";
            t.style.justifyContent = "space-between";
            t.style.alignItems = "center";
            t.style.flexWrap = "wrap";
            t.style.gap = "12px";
            a = document.getElementById("pin-actions-div");
            if (a) {
                a.style.display = "flex";
            } else {
                a = document.createElement("div");
                a.id = "pin-actions-div";
                a.style.display = "flex";
                a.style.gap = "12px";
                if ($("btn-change-pin")) a.appendChild($("btn-change-pin"));
                if ($("btn-remove-pin")) a.appendChild($("btn-remove-pin"));
                t.appendChild(a);
            }
            $("granular-locks") && ($("granular-locks").style.display = "block");
            $("granular-locks-overlay") && ($("granular-locks-overlay").style.display = "none");
            $("pin-setup-box").style.display = "none";
            $("pin-manage-box").style.display = "flex";

            $("lock-stop") && ($("lock-stop").checked = !1 !== e.lockStop);
            $("lock-rules") && ($("lock-rules").checked = !1 !== e.lockRules);
            $("lock-freetime") && ($("lock-freetime").checked = !1 !== e.lockFreetime);
            $("lock-focus-presets") && ($("lock-focus-presets").checked = !1 !== e.lockFocusPresets);
            $("lock-focus-scheds") && ($("lock-focus-scheds").checked = !1 !== e.lockFocusScheds);
            $("lock-danger") && ($("lock-danger").checked = !1 !== e.lockDanger);
            $("lock-tweaks") && ($("lock-tweaks").checked = !1 !== e.lockTweaks);
            $("lock-privacy") && ($("lock-privacy").checked = !1 !== e.lockPrivacy);
            $("lock-adjust-time") && ($("lock-adjust-time").checked = !1 !== e.lockAdjustTime);
        } else {
            var a;
            setSafeHTML($("pin-status-badge"), '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>Not Set');
            $("pin-status-badge").className = "pin-status-badge pin-not-set";
            $("pin-status-badge").style.color = "";
            if ($("granular-locks")) $("granular-locks").style.display = "block";
            if ($("granular-locks-overlay")) { $("granular-locks-overlay").style.display = "flex"; }
            (a = document.getElementById("pin-actions-div")) && ($("btn-change-pin") && $("pin-manage-box").insertBefore($("btn-change-pin"), $("pin-manage-box").firstChild), $("btn-remove-pin") && $("pin-manage-box").insertBefore($("btn-remove-pin"), $("pin-manage-box").firstChild), a.remove()), $("pin-setup-box").style.display = "flex", $("pin-manage-box").style.display = "none"
        }
    }
    var n = $("free-hours-list");
    const _DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];
    var isFreeTimeLocked = e.passcodeHash && !1 !== e.lockFreetime && !window.__freeTimeUnlocked;
    if (n) {
        setSafeHTML(n, "");
        const list = e.freeTimeHours || [];
        for (let t = 0; t < 3; t++) {
            const fh = list[t];
            const a = document.createElement("div");
            a.className = "free-hour-card";
            a.style.cssText = `
                flex: 1;
                min-width: 200px;
                background: var(--bg3);
                border-radius: 12px;
                border: 1px solid var(--bd);
                padding: 16px;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                min-height: 120px;
                position: relative;
                transition: all 0.2s ease;
                box-sizing: border-box;
            `;
            if (!fh) {
                // Empty slot: Add card!
                a.style.borderStyle = "dashed";
                a.style.cursor = "pointer";
                a.style.justifyContent = "center";
                a.style.alignItems = "center";
                setSafeHTML(a, `
                    <div style="font-size:24px; color:var(--tx3); margin-bottom:4px;">+</div>
                    <div style="font-size:13px; font-weight:800; color:var(--tx3);">${t_("addFreetime") || "Add Free-time"}</div>
                `);
                a.addEventListener("mouseover", () => {
                    a.style.borderColor = "var(--green)";
                    a.querySelector("div:nth-child(2)").style.color = "var(--green)";
                });
                a.addEventListener("mouseout", () => {
                    a.style.borderColor = "var(--bd)";
                    a.querySelector("div:nth-child(2)").style.color = "var(--tx3)";
                });
                a.addEventListener("click", async () => {
                    if (isFreeTimeLocked) {
                        if (!await promptPinIfEnabled("lockFreetime")) return;
                        window.__freeTimeUnlocked = true;
                    }
                    showFreeTimeEditModal(t, null);
                });
            } else {
                // Configured slot: Show details!
                const start12 = formatTime12(fh.start || "18:00");
                const end12 = formatTime12(fh.end || "22:00");
                const activeDays = fh.days || [0, 1, 2, 3, 4, 5, 6];
                const dayBubbles = _DAY_NAMES.map((name, idx) => {
                    const isActive = activeDays.includes(idx);
                    return `<span style="
                        font-size: 10px;
                        font-weight: 800;
                        width: 18px;
                        height: 18px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 50%;
                        background: ${isActive ? 'var(--green-bg)' : 'var(--bg4)'};
                        color: ${isActive ? 'var(--green)' : 'var(--tx3)'};
                        border: 1px solid ${isActive ? 'var(--green-bd)' : 'var(--bd)'};
                    ">${name}</span>`;
                }).join("");

                setSafeHTML(a, `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <span style="font-size:11px; font-weight:800; color:var(--tx3); text-transform:uppercase; letter-spacing:0.05em;">${t_("freetimeHoursTitle") || "Free-time Hours"}</span>
                            <span style="font-size:14px; font-weight:800; color:var(--tx);">${start12} ${t_("to") || "to"} ${end12}</span>
                        </div>
                        <div class="fh-actions" style="display:flex; gap:6px;">
                            <button class="bic rm-fh-btn" data-idx="${t}" title="Delete" style="background:var(--bg4); border:1px solid var(--bd); border-radius:6px; cursor:pointer; width:26px; height:26px; display:inline-flex; align-items:center; justify-content:center; font-size:11px; color:var(--red); padding: 0;">✕</button>
                            <button class="bic edit-fh-btn" data-idx="${t}" title="Edit" style="background:var(--bg4); border:1px solid var(--bd); border-radius:6px; cursor:pointer; width:26px; height:26px; display:inline-flex; align-items:center; justify-content:center; font-size:11px; color:var(--tx2); padding: 0;">✎</button>
                        </div>
                    </div>
                    <div style="display:flex; gap:3px; margin-top:12px;">
                        ${dayBubbles}
                    </div>
                `);
// Wire edit button
                a.querySelector(".edit-fh-btn").addEventListener("click", async (ev) => {
                    ev.stopPropagation();
                    if (isFreeTimeLocked) {
                        if (!await promptPinIfEnabled("lockFreetime")) return;
                        window.__freeTimeUnlocked = true;
                    }
                    showFreeTimeEditModal(t, fh);
                });

                // Wire delete button
                a.querySelector(".rm-fh-btn").addEventListener("click", async (ev) => {
                    ev.stopPropagation();
                    if (isFreeTimeLocked) {
                        if (!await promptPinIfEnabled("lockFreetime")) return;
                        window.__freeTimeUnlocked = true;
                    }
                    var freeList = e.freeTimeHours || [];
                    freeList.splice(t, 1);
                    await sSync({
                        settings: {
                            ...e,
                            freeTimeHours: freeList
                        }
                    });
                    loadExtendedSettings();
                    await msg("UPDATE_IDLE");
                });
            }
            n.appendChild(a);
        }
    }
    renderLocalBackupsList();

    function showFreeTimeEditModal(slotIdx, fhObj) {
        const modal = $("free-time-modal");
        if (!modal) return;
        $("ft-modal-title").textContent = fhObj ? (t_("editFreeTime") || "Edit Free-time") : (t_("addFreetime") || "Add Free-time");
        $("ft-start").value = fhObj ? (fhObj.start || "18:00") : "18:00";
        $("ft-end").value = fhObj ? (fhObj.end || "22:00") : "22:00";
        const daysList = fhObj ? (fhObj.days || [0, 1, 2, 3, 4, 5, 6]) : [0, 1, 2, 3, 4, 5, 6];
        document.querySelectorAll(".ft-day-cb").forEach(cb => {
            cb.checked = daysList.includes(parseInt(cb.value));
        });
        modal.classList.remove("hide");
        const saveBtn = $("ft-modal-save");
        const cancelBtn = $("ft-modal-cancel");
        const closeBtn = $("ft-modal-close");
        const closeModal = () => { modal.classList.add("hide"); };
        cancelBtn.onclick = closeModal;
        closeBtn.onclick = closeModal;
        saveBtn.onclick = async () => {
            const startVal = $("ft-start").value || "18:00";
            const endVal = $("ft-end").value || "22:00";
            const checkedDays = Array.from(document.querySelectorAll(".ft-day-cb"))
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.value));
            if (!checkedDays.length) {
                toast(t_("selectAtLeastOneDay"), "er");
                return;
            }
            var settingsData = (await gSync(["settings"])).settings || {};
            var freeList = settingsData.freeTimeHours || [];
            const newFh = { start: startVal, end: endVal, days: checkedDays };
            if (slotIdx < freeList.length) {
                freeList[slotIdx] = newFh;
            } else {
                freeList.push(newFh);
            }
            settingsData.freeTimeHours = freeList;
            await sSync({ settings: settingsData });
            closeModal();
            loadExtendedSettings();
            await msg("UPDATE_IDLE");
            toast(t_("freeTimeSaved"), "ok");
        };
    }
}
async function loadFocusHistory() {} 
["tog-ov-prod", "tog-ov-lrn", "tog-ov-dist", "tog-ov-comm", "tog-ov-unc"].forEach(e => {
    $(e) && $(e).addEventListener("change", renderOverview)
}), ["tog-trend-prod", "tog-trend-lrn", "tog-trend-comm", "tog-trend-dist", "tog-trend-unc", "tog-trend-avg"].forEach(e => {
    $(e) && $(e).addEventListener("change", renderTrend)
}), $("weekly-goal-input") && $("weekly-goal-input").addEventListener("input", () => {
    renderGoalPreview(parseInt($("weekly-goal-input").value) || 0)
});

const btnSaveSetEl = document.getElementById("btn-save-set");
if (btnSaveSetEl) {
    const handleSaveSet = async function(evt) {
        if (evt && evt.preventDefault) evt.preventDefault();
        let langChanged = false;
        try {
            var e = (await gSync(["settings"])).settings || {};
            if ($("tog-fun")) e.funnyBlocked = !1 !== $("tog-fun").checked;
            if ($("tab-limit-input")) e.tabLimit = parseInt($("tab-limit-input").value) || 0;
            if ($("tog-time-warn")) e.timeWarningEnabled = !1 !== $("tog-time-warn").checked;
            if ($("time-warn-secs")) e.timeWarningSecs = parseInt($("time-warn-secs").value) || 60;
            if ($("tog-badge")) e.showBadge = !1 !== $("tog-badge").checked;
            if ($("tog-idle-badge")) e.showIdleBadge = !1 !== $("tog-idle-badge").checked;
            if ($("idle-timeout-sel")) e.idleTimeout = parseInt($("idle-timeout-sel").value) || 60;
            if ($("welcome-back-thresh-sel")) e.welcomeBackThresh = parseInt($("welcome-back-thresh-sel").value) || 10;
            if ($("max-gap-sel")) e.maxGapSecs = parseInt($("max-gap-sel").value) || 300;
            if ($("tog-media")) e.trackMedia = $("tog-media").checked;
            if ($("min-visit-sel")) e.minVisitSecs = parseInt($("min-visit-sel").value) || 0;
            if ($("tog-track-local")) e.trackLocalFiles = $("tog-track-local").checked;
            if ($("day-rollover-sel")) e.dayRolloverHour = parseInt($("day-rollover-sel").value) || 0;
            
            if ($("data-retention-sel")) {
                let retentionDays = parseInt($("data-retention-sel").value);
                e.dataRetentionDays = isNaN(retentionDays) ? 365 : retentionDays;
            }

            var oldLang = e.language || "auto";
            var newLang = $("lang-sel") ? $("lang-sel").value : "auto";
            langChanged = oldLang !== newLang;
            e.language = newLang;

            if (e.passcodeHash) {
                if ($("lock-stop")) e.lockStop = !1 !== $("lock-stop").checked;
                if ($("lock-rules")) e.lockRules = !1 !== $("lock-rules").checked;
                if ($("lock-freetime")) e.lockFreetime = !1 !== $("lock-freetime").checked;
                if ($("lock-focus-presets")) e.lockFocusPresets = $("lock-focus-presets").checked;
                if ($("lock-focus-scheds")) e.lockFocusScheds = $("lock-focus-scheds").checked;
                if ($("lock-danger")) e.lockDanger = !1 !== $("lock-danger").checked;
                if ($("lock-tweaks")) e.lockTweaks = !1 !== $("lock-tweaks").checked;
                if ($("lock-privacy")) e.lockPrivacy = !1 !== $("lock-privacy").checked;
                if ($("lock-adjust-time")) e.lockAdjustTime = !1 !== $("lock-adjust-time").checked;
            }
            await sSync({ settings: e });
            if (langChanged) {
                setTimeout(() => window.location.reload(), 1000);
            }
            if (typeof loadExtendedSettings === "function") loadExtendedSettings();
            if (typeof msg === "function") msg("UPDATE_IDLE");
        } catch (err) {
            console.error("[FF] Save settings error:", err);
        } finally {
            toast(t_("settingsSaved") || "Settings saved successfully", "ok");
        }
    };
    btnSaveSetEl.addEventListener("click", handleSaveSet);
}

$("btn-pin") && $("btn-pin").addEventListener("click", async () => {
    var e = $("pin1").value.trim(),
        t = $("pin2").value.trim();
    if (!/^\d{4,6}$/.test(e)) toast(t_("pin4to6Digits") || "PIN must be 4 to 6 digits", "er");
    else if (e !== t) toast(t_("pinsDoNotMatch") || "PINs do not match", "er");
    else {
        var a = (await gSync(["settings"])).settings || {};
        a.passcodeHash = await hashPin(e), a.passcodeEnabled = !0, await sSync({
            settings: a
        }), $("pin1").value = "", $("pin2").value = "", toast(t_("pinSavedActive") || "PIN saved and active", "ok"), loadExtendedSettings()
    }
});

const btnChangePin = $("btn-change-pin") || $("btn-chg-pin");
btnChangePin && btnChangePin.addEventListener("click", async () => {
    if (await promptPinIfEnabled("lockDanger")) {
        if ($("pin-setup-box")) $("pin-setup-box").style.display = "flex";
        if ($("pin-manage-box")) $("pin-manage-box").style.display = "none";
        const actionsDiv = document.getElementById("pin-actions-div");
        if (actionsDiv) actionsDiv.style.display = "none";
        if ($("pin1")) {
            $("pin1").value = "";
            $("pin1").focus();
        }
        if ($("pin2")) $("pin2").value = "";
        toast(t_("enterNewPin") || "Enter your new 4-6 digit PIN", "info");
    }
});

const btnRemovePin = $("btn-remove-pin") || $("btn-rm-pin");
btnRemovePin && btnRemovePin.addEventListener("click", async () => {
    if (await promptPinIfEnabled("lockDanger")) {
        var e = (await gSync(["settings"])).settings || {};
        e.passcodeHash = "";
        e.passcodeEnabled = false;
        await sSync({
            settings: e
        });
        toast(t_("pinRemoved") || "PIN Removed", "ok");
        loadExtendedSettings();
    }
});

($("btn-clr-data") || $("btn-rst-stats")) && ($("btn-clr-data") || $("btn-rst-stats")).addEventListener("click", async () => {
    if (await promptPinIfEnabled("lockDanger") && await showConfirm(t_("resetAllStats"), t_("resetStatsConfirm"), { isDestructive: true, confirmText: t_("resetConfirmBtn") })) {
        await msg("CLEAR_ALL_DATA");
        toast(t_("statsReset"), "ok");
        updateDangerCounts();
        setTimeout(() => location.reload(), 800);
    }
}), $("btn-clr-rules") && $("btn-clr-rules").addEventListener("click", async () => {
    if (await promptPinIfEnabled("lockDanger") && await showConfirm(t_("clearRules"), t_("clearRulesConfirm"), { isDestructive: true, confirmText: t_("clearConfirmBtn") })) {
        var e = (await gSync(["settings"])).settings || {};
        e.blockRules = [], e.allowRules = [], await sSync({
            settings: e
        }), await msg("TRIGGER_DNR_UPDATE"), renderCombined(), updateDangerCounts(), toast(t_("rulesCleared"), "ok")
    }
}), $("btn-clr-cats") && $("btn-clr-cats").addEventListener("click", async () => {
    if (await promptPinIfEnabled("lockDanger") && await showConfirm(t_("clearCategories") || "Reset Categories", t_("clearCategoriesConfirm") || "Are you sure you want to reset all custom categories to default assumptions?", { isDestructive: true, confirmText: t_("clearConfirmBtn") || "Reset" })) {
        siteCategories = {};
        hiddenDefaultSites = [];
        window.siteCategories = siteCategories;
        window.siteCats = siteCategories;
        window.hiddenDefaultSites = hiddenDefaultSites;
        await sLocal({ siteCategories: {}, hiddenDefaultSites: [] });
        await sSync({ customCategories: {} });
        if (typeof applyCustomCategories === "function") applyCustomCategories({});
        await msg("TRIGGER_DNR_UPDATE");
        renderCategories();
        loadAnalytics();
        updateDangerCounts();
        toast(t_("categoriesCleared") || "Categories reset to defaults", "ok");
    }
});

(function () {
    const e = $("data-retention-sel");
    e && (e.addEventListener("change", async () => {
        const t = parseInt(e.value);
        if (!isNaN(t)) {
            const s = (await gSync(["settings"])).settings || {};
            s.dataRetentionDays = t, await sSync({
                settings: s
            }), toast(t_("dataRetentionSaved", [t]), "ok")
        }
    }), gSync(["settings"]).then(t => {
        const s = t.settings || {};
        e.value = String(s.dataRetentionDays ?? 365)
    }));
    const t = $("lang-sel");
    t && gSync(["settings"]).then(e => {
        const s = e.settings || {};
        t.value = s.language || "auto"
    })
})();

(function initFloatingSave() {
    const _fab = document.createElement("button");
    _fab.id = "floating-save-btn";
    _fab.textContent = t_("saveAllSettings") || "Save All Settings";
    _fab.style.cssText = "display:none;position:fixed;bottom:28px;right:28px;z-index:9000;background:var(--green);color:#000;font-weight:800;font-size:16px;padding:12px 22px;border-radius:14px;border:none;cursor:pointer;box-shadow:var(--shadow-md);transition:opacity .2s,transform .2s;font-family:inherit;";
    document.body.appendChild(_fab);
    _fab.addEventListener("click", () => {
        if ($("btn-save-set")) {
            $("btn-save-set").click();
        }
        toast(t_("settingsSaved") || "Settings saved successfully", "ok");
    });
    document.querySelectorAll(".ni[data-tab]").forEach(tab => tab.addEventListener("click", () => {
        _fab.style.display = tab.getAttribute("data-tab") === "settings" ? "block" : "none";
    }));
    if (window.location.hash === "#settings") _fab.style.display = "block";
})();

var _origRF = renderFocus,
    _focusTick = null;

function startSmoothFocusTick(e) {
    if (_focusTick) clearInterval(_focusTick);
    if (!e || !e.active || e.paused || !e.phaseEndsAt) return;
    const i = _favCanvas;
    i.width = 32; i.height = 32;
    const s = i.getContext("2d");
    const tick = () => {
        var t = Math.max(0, Math.round((e.phaseEndsAt - Date.now()) / 1e3)),
            a = "work" === e.phase,
            n = e.fullDuration || (a ? 1500 : "long_break" === e.phase ? 900 : 300);
        $("frf") && $("frf").setAttribute("stroke-dashoffset", (FCIRC * Math.max(0, 1 - t / n)).toFixed(1)), $("ftb") && ($("ftb").textContent = fmtT(t));
        
        let pct = Math.max(0, 1 - t / n);
        let pctRounded = Math.floor(pct * 100);
        if (pctRounded !== _lastFavPct && !_tabHidden) {
            _lastFavPct = pctRounded;
            s.clearRect(0, 0, 32, 32);
            const o = document.documentElement.classList.contains("light");
            s.fillStyle = o ? "#f1f5f9" : "#121212", s.beginPath(), s.arc(16, 16, 16, 0, 2 * Math.PI), s.fill(), s.strokeStyle = "#2E2E2E", s.lineWidth = 4, s.beginPath(), s.arc(16, 16, 12, 0, 2 * Math.PI), s.stroke(), s.strokeStyle = a ? "#05D581" : "#F6B846", s.lineCap = "round", s.beginPath(), s.arc(16, 16, 12, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * pct), s.stroke();
            let r = document.getElementById("dynamic-favicon");
            r && (r.href = i.toDataURL());
        }

        t <= 0 && (clearInterval(_focusTick), _focusTick = null, setTimeout(async () => {
            var e = await msg("FOCUS_GET_STATE");
            renderFocus(e?.focusState, await getActiveWorkMins()), loadFocusHistory()
        }, 1500))
    };
    tick();
    _focusTick = setInterval(tick, 1e3);
}
renderFocus = function (e, t) {
    _currentFocusState = e;
    if (_origRF(e, t), e && e.active && !e.paused && e.phaseEndsAt) {
        if (!_tabHidden) {
            startSmoothFocusTick(e);
        }
    } else {
        _focusTick && (clearInterval(_focusTick), _focusTick = null);
        let e = document.getElementById("dynamic-favicon");
        e && (e.href = "../assets/icons/icon128.png")
    }
}, document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
        _tabHidden = true;
        document.documentElement.classList.add("tab-hidden");
        if (_focusTick) {
            clearInterval(_focusTick);
            _focusTick = null;
        }
    } else {
        _tabHidden = false;
        document.documentElement.classList.remove("tab-hidden");
        _lastFavPct = -1;
        try {
            const state = await msg("FOCUS_GET_STATE");
            renderFocus(state?.focusState, await getActiveWorkMins());
            loadFocusHistory();
        } catch (_) {}
        if (typeof window.updateDashboardPrivacyUI === "function") {
            window.updateDashboardPrivacyUI();
        }
    }
}), async function () {
    await initI18n();
    translatePage();
    hideAnalyticsHeader();
    upgradeAllSettingsSelects();
    const e = await msg("GET_AUTO_CATEGORIES");
    e && e.autoCategories && (AUTO_CATEGORIES = e.autoCategories), await checkGate();
    // Bug #5 fix: fetch settings once and share with loadSettings
    const _sharedSettings = (await gSync(["settings"])).settings || {};
    await loadSettings(_sharedSettings);

    // Find active tab from hash (default to analytics)
    let initialTab = "analytics";
    const rawHash = window.location.hash.replace("#", "");
    const hashParts = rawHash.split("?");
    const hash = hashParts[0];
    const query = hashParts[1] || "";
    if (["analytics", "focus", "sitemanager", "settings"].includes(hash)) {
        initialTab = hash;
    }

    if (query || window.location.search) {
        const params = new URLSearchParams(window.location.search || query);
        window.__glowPresetId = params.get("preset") || params.get("glow") || "";
    }

    document.querySelectorAll(".ni").forEach(b => {
        if (b.getAttribute("data-tab") === initialTab) b.classList.add("act");
        else b.classList.remove("act");
    });
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("act"));
    const initTabEl = $("tab-" + initialTab);
    if (initTabEl) initTabEl.classList.add("act");

    if ("analytics" === initialTab) loadAnalytics();
    else if ("settings" === initialTab) loadExtendedSettings();
    else if ("focus" === initialTab) { loadFocusUI(); loadWeeklyGoalSettings(); loadFocusHistory(); }
    else if ("sitemanager" === initialTab) { (async () => { await Promise.all([loadRules(), loadCategories(), loadVisitedSites(), loadExtendedSettings()]); renderCategories(); renderGranularBlocksUI(); })(); }
    // FF v6.7: Floating "Save All Settings" button that follows the user when on the Settings tab
    (function initFloatingSave() {
        const _fab = document.createElement("button");
        _fab.id = "floating-save-btn";
        _fab.textContent = t_("saveAllSettings");
        _fab.style.cssText = "display:none;position:fixed;bottom:28px;right:28px;z-index:9000;background:var(--green);color:#000;font-weight:800;font-size:16px;padding:12px 22px;border-radius:14px;border:none;cursor:pointer;box-shadow:var(--shadow-md);transition:opacity .2s,transform .2s;font-family:inherit;";
        document.body.appendChild(_fab);
        _fab.addEventListener("click", () => { $("btn-save-set") && $("btn-save-set").click(); });
        // Show only on settings tab
        document.querySelectorAll(".ni[data-tab]").forEach(tab => tab.addEventListener("click", () => {
            _fab.style.display = tab.getAttribute("data-tab") === "settings" ? "block" : "none";
        }));
        if (window.location.hash === "#settings") _fab.style.display = "block";
    })()
}();
// ============================================================
// FF v4.7 — Backup/Restore + Cool-downs wiring
// ============================================================
function switchRuleModalTab(type) {
    document.querySelectorAll(".add-rule-tab").forEach(b => {
        if (b.getAttribute("data-ruletype") === type) b.classList.add("act");
        else b.classList.remove("act");
    });
    document.querySelectorAll(".add-form-pane").forEach(p => p.style.display = "none");
    const pane = document.getElementById(`add-form-${type}`);
    if (pane) pane.style.display = "block";
    if (type === "block") {
        if ($("btn-add-block")) $("btn-add-block").style.display = "block";
        if ($("btn-add-tag-inline")) $("btn-add-tag-inline").style.display = "none";
    } else {
        if ($("btn-add-block")) $("btn-add-block").style.display = "none";
        if ($("btn-add-tag-inline")) $("btn-add-tag-inline").style.display = "block";
    }
}
if ($("btn-export")) $("btn-export").addEventListener("click", async () => {
    const r = await msg("BACKUP_EXPORT");
    if (!r || !r.ok) return toast(t_("exportFailed"), "err");
    const blob = new Blob([JSON.stringify(r.payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "flow-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast(t_("backupDownloaded"), "ok");
});
if ($("file-import")) $("file-import").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!(await showConfirm(t_("restoreBackup"), t_("restoreBackupConfirm"), { isDestructive: true, confirmText: t_("restoreConfirmBtn") }))) {
        e.target.value = "";
        return;
    }
    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const r = await msg("BACKUP_IMPORT", { payload });
        if (r && r.ok) { toast("Restored — reloading…", "ok"); setTimeout(() => location.reload(), 800); }
        else toast(t_("restoreFailed"), "err");
    } catch (err) {
        toast(t_("invalidJsonFile"), "err");
    }
    e.target.value = "";
});

let isMigrationRunning = false;
if ($("file-migrate-watt")) $("file-migrate-watt").addEventListener("change", async (e) => {
    if (isMigrationRunning) return;
    const file = e.target.files?.[0];
    if (!file) return;

    if (!(await showConfirm(t_("importLogs"), t_("importLogsWattConfirm"), { isDestructive: false, confirmText: t_("importConfirmBtn") }))) {
        e.target.value = "";
        return;
    }

    isMigrationRunning = true;
    const statusEl = $("migration-status");
    const statusTextEl = $("migration-status-text");
    const progressBarEl = $("migration-progress-bar");

    if (statusEl) statusEl.style.display = "block";
    if (statusTextEl) statusTextEl.textContent = t_("readingFile");
    if (progressBarEl) progressBarEl.style.width = "0%";

    try {
        const text = await file.text();
        if (statusTextEl) statusTextEl.textContent = t_("parsingCsvData");

        const lines = text.split(/\r?\n/);
        if (lines.length < 2) {
            throw new Error("The file is empty or has no rows.");
        }

        const parseCSVLine = (line) => {
            const result = [];
            let cell = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(cell.trim());
                    cell = '';
                } else {
                    cell += char;
                }
            }
            result.push(cell.trim());
            return result;
        };

        const headers = parseCSVLine(lines[0]);
        let dateIdx = -1;
        let siteIdx = -1;
        let timeIdx = -1;

        for (let i = 0; i < headers.length; i++) {
            const h = headers[i].toLowerCase();
            if (h === 'date' || h === 'day') dateIdx = i;
            else if (h === 'website' || h === 'site' || h === 'domain' || h === 'url') siteIdx = i;
            else if (h === 'time(sec)' || h === 'time' || h === 'seconds' || h.includes('sec')) timeIdx = i;
        }

        if (dateIdx === -1) dateIdx = 0;
        if (siteIdx === -1) siteIdx = 1;
        if (timeIdx === -1) timeIdx = 2;

        const grouped = {};
        let skippedRows = 0;
        let totalRows = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cells = parseCSVLine(line);
            if (cells.length <= Math.max(dateIdx, siteIdx, timeIdx)) {
                skippedRows++;
                continue;
            }

            const rawDate = cells[dateIdx];
            const rawSite = cells[siteIdx];
            const rawTime = cells[timeIdx];

            if (!rawDate) { skippedRows++; continue; }
            let parts = rawDate.split(/[\/\-.]/);
            if (parts.length !== 3) {
                skippedRows++;
                continue;
            }

            let m = parseInt(parts[0], 10);
            let d = parseInt(parts[1], 10);
            let y = parseInt(parts[2], 10);

            if (isNaN(m) || isNaN(d) || isNaN(y)) {
                skippedRows++;
                continue;
            }

            if (m > 12 && d <= 12) {
                const temp = m;
                m = d;
                d = temp;
            }

            if (y < 100) {
                y = 2000 + y;
            }

            const dayKey = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
                skippedRows++;
                continue;
            }

            if (!rawSite) { skippedRows++; continue; }
            let site = rawSite.trim().toLowerCase();

            if (site.startsWith("file:///")) {
                const parts = site.split("/");
                const filename = decodeURIComponent(parts[parts.length - 1] || "local-file");
                site = "local:" + filename.toLowerCase();
            } else {
                site = site.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
            }

            if (!site) {
                skippedRows++;
                continue;
            }

            let secs = parseInt(rawTime, 10);
            if (isNaN(secs) || secs <= 0) {
                skippedRows++;
                continue;
            }

            if (!grouped[dayKey]) grouped[dayKey] = {};
            grouped[dayKey][site] = (grouped[dayKey][site] || 0) + secs;
            totalRows++;
        }

        const dateKeys = Object.keys(grouped);
        if (dateKeys.length === 0) {
            throw new Error("No valid website history rows were found in the file.");
        }

        if (statusTextEl) statusTextEl.textContent = t_("mergingDaysOfHistory", [dateKeys.length]);

        const batchSize = 50;
        let processed = 0;

        const processBatch = async () => {
            if (processed >= dateKeys.length) {
                if (statusTextEl) statusTextEl.textContent = t_("finalizingAndReloading");
                if (progressBarEl) progressBarEl.style.width = "100%";

                await msg("INVALIDATE_CACHES");

                toast(t_("successfullyImportedDays", [dateKeys.length]), "ok");
                setTimeout(() => location.reload(), 1500);
                return;
            }

            const batchKeys = dateKeys.slice(processed, processed + batchSize);
            const currentDB = await FFDB.getDays(batchKeys);
            const writeMap = {};

            for (const day of batchKeys) {
                const importedSites = grouped[day];
                let entry = currentDB[day];

                if (!entry) {
                    entry = {
                        sites: {},
                        timeline: [],
                        productivity: 0,
                        learning: 0,
                        distraction: 0,
                        communication: 0,
                        uncategorized: 0
                    };
                } else {
                    entry.sites = entry.sites || {};
                    entry.timeline = entry.timeline || [];
                }

                for (const [dom, secs] of Object.entries(importedSites)) {
                    entry.sites[dom] = (entry.sites[dom] || 0) + secs;
                }

                entry.productivity = 0;
                entry.learning = 0;
                entry.distraction = 0;
                entry.communication = 0;
                entry.uncategorized = 0;

                for (const [dom, secs] of Object.entries(entry.sites)) {
                    const cat = getEffectiveCat(dom).cat;
                    entry[cat] = (entry[cat] || 0) + secs;
                }

                writeMap[day] = entry;
            }

            await FFDB.bulkSetDays(writeMap);
            processed += batchKeys.length;

            const percent = Math.round((processed / dateKeys.length) * 100);
            if (progressBarEl) progressBarEl.style.width = `${percent}%`;
            if (statusTextEl) statusTextEl.textContent = t_("importingDataDayOf", [processed, dateKeys.length]);

            setTimeout(processBatch, 20);
        };

        if (statusTextEl) statusTextEl.textContent = t_("creatingPreImportBackup");
        try {
            await msg("BACKUP_CREATE_LOCAL", { label: "Pre-Import Backup (Web Activity Time Tracker)" });
        } catch (errBackup) {
            console.warn("Failed to create pre-import backup:", errBackup);
        }

        await processBatch();

    } catch (err) {
        console.error("[Migration] Error importing CSV file", err);
        if (statusTextEl) setSafeHTML(statusTextEl, `<span style="color:var(--red)">Failed: ${sanitizeDomain(err.message || err)}</span>`);
        toast(t_("importFailedErr", [err.message || t_("invalidFile")]), "er");
        isMigrationRunning = false;
    }

    e.target.value = "";
});

if ($("file-migrate-tt")) $("file-migrate-tt").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!(await showConfirm(t_("importLogs"), t_("importLogsTtConfirm"), { isDestructive: false, confirmText: t_("importConfirmBtn") }))) {
        e.target.value = "";
        return;
    }

    if (isMigrationRunning) return;
    isMigrationRunning = true;

    const statusEl = $("migration-status");
    const statusTextEl = $("migration-status-text");
    const progressBarEl = $("migration-progress-bar");

    if (statusEl) statusEl.style.display = "block";
    if (statusTextEl) statusTextEl.textContent = t_("readingFile");
    if (progressBarEl) progressBarEl.style.width = "0%";

    try {
        const text = await file.text();
        if (statusTextEl) statusTextEl.textContent = t_("parsingJsonData");

        const payload = JSON.parse(text);
        if (!payload || !Array.isArray(payload.__stat__)) {
            throw new Error("Invalid format. Missing time-tracker list data (__stat__).");
        }

        const stats = payload.__stat__;
        const grouped = {};
        let skippedRows = 0;
        let newtabFiltered = 0;
        let totalRows = 0;

        for (const item of stats) {
            const host = item.host;
            const dateStr = item.date;
            const focusMs = item.focus;

            if (!host || !dateStr || focusMs === undefined) {
                skippedRows++;
                continue;
            }

            let site = host.trim().toLowerCase();
            if (site === "newtab") {
                newtabFiltered++;
                continue;
            }

            site = site.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
            if (!site) {
                skippedRows++;
                continue;
            }

            if (dateStr.length !== 8) {
                skippedRows++;
                continue;
            }

            const y = dateStr.slice(0, 4);
            const m = dateStr.slice(4, 6);
            const d = dateStr.slice(6, 8);
            const dayKey = `${y}-${m}-${d}`;

            if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
                skippedRows++;
                continue;
            }

            let secs = Math.round(parseInt(focusMs, 10) / 1000);
            if (isNaN(secs) || secs <= 0) {
                skippedRows++;
                continue;
            }

            if (!grouped[dayKey]) grouped[dayKey] = {};
            grouped[dayKey][site] = (grouped[dayKey][site] || 0) + secs;
            totalRows++;
        }

        const dateKeys = Object.keys(grouped);
        if (dateKeys.length === 0) {
            throw new Error("No valid website history entries were found in the file.");
        }

        if (statusTextEl) statusTextEl.textContent = t_("mergingDaysOfHistory", [dateKeys.length]);

        const batchSize = 50;
        let processed = 0;

        const processBatch = async () => {
            if (processed >= dateKeys.length) {
                if (statusTextEl) statusTextEl.textContent = t_("finalizingAndReloading");
                if (progressBarEl) progressBarEl.style.width = "100%";

                await msg("INVALIDATE_CACHES");

                toast(t_("successfullyImportedDays", [dateKeys.length]), "ok");
                setTimeout(() => location.reload(), 1500);
                return;
            }

            const batchKeys = dateKeys.slice(processed, processed + batchSize);
            const currentDB = await FFDB.getDays(batchKeys);
            const writeMap = {};

            for (const day of batchKeys) {
                const importedSites = grouped[day];
                let entry = currentDB[day];

                if (!entry) {
                    entry = {
                        sites: {},
                        timeline: [],
                        productivity: 0,
                        learning: 0,
                        distraction: 0,
                        communication: 0,
                        uncategorized: 0
                    };
                } else {
                    entry.sites = entry.sites || {};
                    entry.timeline = entry.timeline || [];
                }

                for (const [dom, secs] of Object.entries(importedSites)) {
                    entry.sites[dom] = (entry.sites[dom] || 0) + secs;
                }

                entry.productivity = 0;
                entry.learning = 0;
                entry.distraction = 0;
                entry.communication = 0;
                entry.uncategorized = 0;

                for (const [dom, secs] of Object.entries(entry.sites)) {
                    const cat = getEffectiveCat(dom).cat;
                    entry[cat] = (entry[cat] || 0) + secs;
                }

                writeMap[day] = entry;
            }

            await FFDB.bulkSetDays(writeMap);
            processed += batchKeys.length;

            const percent = Math.round((processed / dateKeys.length) * 100);
            if (progressBarEl) progressBarEl.style.width = `${percent}%`;
            if (statusTextEl) statusTextEl.textContent = t_("importingDataDayOf", [processed, dateKeys.length]);

            setTimeout(processBatch, 20);
        };

        if (statusTextEl) statusTextEl.textContent = t_("creatingPreImportBackup");
        try {
            await msg("BACKUP_CREATE_LOCAL", { label: "Pre-Import Backup (Time Tracker - Web Habit Builder)" });
        } catch (errBackup) {
            console.warn("Failed to create pre-import backup:", errBackup);
        }

        await processBatch();

    } catch (err) {
        console.error("[Migration] Error importing JSON file", err);
        if (statusTextEl) setSafeHTML(statusTextEl, `<span style="color:var(--red)">Failed: ${sanitizeDomain(err.message || err)}</span>`);
        toast(t_("importFailedErr", [err.message || t_("invalidFile")]), "er");
        isMigrationRunning = false;
    }

    e.target.value = "";
});

if ($("file-migrate-wt")) $("file-migrate-wt").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!(await showConfirm(t_("importLogs"), t_("importLogsWtConfirm"), { isDestructive: false, confirmText: t_("importConfirmBtn") }))) {
        e.target.value = "";
        return;
    }

    if (isMigrationRunning) return;
    isMigrationRunning = true;

    const statusEl = $("migration-status");
    const statusTextEl = $("migration-status-text");
    const progressBarEl = $("migration-progress-bar");

    if (statusEl) statusEl.style.display = "block";
    if (statusTextEl) statusTextEl.textContent = t_("readingFile");
    if (progressBarEl) progressBarEl.style.width = "0%";

    try {
        const text = await file.text();
        if (statusTextEl) statusTextEl.textContent = t_("parsingCsvData");

        const lines = text.split(/\r?\n/);
        if (lines.length < 2) {
            throw new Error("The file is empty or has no rows.");
        }

        const parseCSVLine = (line) => {
            const result = [];
            let cell = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(cell.trim());
                    cell = '';
                } else {
                    cell += char;
                }
            }
            result.push(cell.trim());
            return result;
        };

        const headers = parseCSVLine(lines[0]);
        if (headers.length < 2) {
            throw new Error("Invalid CSV format. Missing columns.");
        }

        if (headers[0].toLowerCase() !== "domain") {
            throw new Error("Invalid CSV format. First column must be 'Domain'.");
        }

        // Extract dates and check which column they are in
        const dates = [];
        for (let i = 1; i < headers.length; i++) {
            const rawDate = headers[i].trim();
            if (!rawDate) continue;

            // Check if date is YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
                dates.push({ colIndex: i, dayKey: rawDate });
            } else {
                let parts = rawDate.split(/[\/\-.]/);
                if (parts.length === 3) {
                    let m = parseInt(parts[0], 10);
                    let d = parseInt(parts[1], 10);
                    let y = parseInt(parts[2], 10);
                    if (!isNaN(m) && !isNaN(d) && !isNaN(y)) {
                        if (m > 12 && d <= 12) {
                            const temp = m; m = d; d = temp;
                        }
                        if (y < 100) y = 2000 + y;
                        const dayKey = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                        if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
                            dates.push({ colIndex: i, dayKey });
                        }
                    }
                }
            }
        }

        if (dates.length === 0) {
            throw new Error("No valid date columns were found in the header row.");
        }

        const grouped = {};
        let skippedRows = 0;
        let totalRows = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cells = parseCSVLine(line);
            if (cells.length < 2) {
                skippedRows++;
                continue;
            }

            const rawSite = cells[0];
            if (!rawSite) {
                skippedRows++;
                continue;
            }

            let site = rawSite.trim().toLowerCase();
            if (site.startsWith("file:///")) {
                const parts = site.split("/");
                const filename = decodeURIComponent(parts[parts.length - 1] || "local-file");
                site = "local:" + filename.toLowerCase();
            } else {
                site = site.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
            }

            if (!site) {
                skippedRows++;
                continue;
            }

            // Loop over dates
            for (const dateObj of dates) {
                const colIndex = dateObj.colIndex;
                const dayKey = dateObj.dayKey;

                if (colIndex >= cells.length) continue;

                const rawTime = cells[colIndex];
                if (!rawTime) continue;

                const secs = parseInt(rawTime, 10);
                if (isNaN(secs) || secs <= 0) continue;

                if (!grouped[dayKey]) grouped[dayKey] = {};
                grouped[dayKey][site] = (grouped[dayKey][site] || 0) + secs;
                totalRows++;
            }
        }

        const dateKeys = Object.keys(grouped);
        if (dateKeys.length === 0) {
            throw new Error("No valid website history entries were found in the CSV file.");
        }

        if (statusTextEl) statusTextEl.textContent = t_("mergingDaysOfHistory", [dateKeys.length]);

        const batchSize = 50;
        let processed = 0;

        const processBatch = async () => {
            if (processed >= dateKeys.length) {
                if (statusTextEl) statusTextEl.textContent = t_("finalizingAndReloading");
                if (progressBarEl) progressBarEl.style.width = "100%";

                await msg("INVALIDATE_CACHES");

                toast(t_("successfullyImportedDays", [dateKeys.length]), "ok");
                setTimeout(() => location.reload(), 1500);
                return;
            }

            const batchKeys = dateKeys.slice(processed, processed + batchSize);
            const currentDB = await FFDB.getDays(batchKeys);
            const writeMap = {};

            for (const day of batchKeys) {
                const importedSites = grouped[day];
                let entry = currentDB[day];

                if (!entry) {
                    entry = {
                        sites: {},
                        timeline: [],
                        productivity: 0,
                        learning: 0,
                        distraction: 0,
                        communication: 0,
                        uncategorized: 0
                    };
                } else {
                    entry.sites = entry.sites || {};
                    entry.timeline = entry.timeline || [];
                }

                for (const [dom, secs] of Object.entries(importedSites)) {
                    entry.sites[dom] = (entry.sites[dom] || 0) + secs;
                }

                entry.productivity = 0;
                entry.learning = 0;
                entry.distraction = 0;
                entry.communication = 0;
                entry.uncategorized = 0;

                for (const [dom, secs] of Object.entries(entry.sites)) {
                    const cat = getEffectiveCat(dom).cat;
                    entry[cat] = (entry[cat] || 0) + secs;
                }

                writeMap[day] = entry;
            }

            await FFDB.bulkSetDays(writeMap);
            processed += batchKeys.length;

            const percent = Math.round((processed / dateKeys.length) * 100);
            if (progressBarEl) progressBarEl.style.width = `${percent}%`;
            if (statusTextEl) statusTextEl.textContent = t_("importingDataDayOf", [processed, dateKeys.length]);

            setTimeout(processBatch, 20);
        };

        if (statusTextEl) statusTextEl.textContent = t_("creatingPreImportBackup");
        try {
            await msg("BACKUP_CREATE_LOCAL", { label: "Pre-Import Backup (Webtime Tracker)" });
        } catch (errBackup) {
            console.warn("Failed to create pre-import backup:", errBackup);
        }

        await processBatch();

    } catch (err) {
        console.error("[Migration] Error importing Webtime Tracker CSV file", err);
        if (statusTextEl) setSafeHTML(statusTextEl, `<span style="color:var(--red)">Failed: ${sanitizeDomain(err.message || err)}</span>`);
        toast(t_("importFailedErr", [err.message || t_("invalidFile")]), "er");
        isMigrationRunning = false;
    }

    e.target.value = "";
});

// =====================================================================
// FocusFlow v6.12 — Structural UI patch (additive, runs after main init)
//   1. Preset Builder card replaces legacy Work/Break/Long/Cycles inputs
//      in the Focus Mode panel. Inputs arranged 2x2:
//         [ Work Time | Break Time ]
//         [ Long Break | Cycles    ]
//   2. Site Manager split into 3 pill tabs:
//         Smart Presets & Categories | Site List | Advanced Tweaks
//   3. Mid-flight lockdown: Preset Builder is disabled when a focus
//      session is active (focusState.active === true).
//   4. Study Goals card relocated from right column → bottom of left
//      column (under Start Focus card).
// =====================================================================
(function ffV612() {
    "use strict";
    if (window.__ffV612Loaded) return;
    window.__ffV612Loaded = true;

    const $$ = (id) => document.getElementById(id);

    const DEFAULT_PRESETS = [
        { id: "pomodoro", emoji: "🍅", name: "Pomodoro", work: 25, brk: 5, long: 15, longBrk: 15, cycles: 4, strict: false, cats: [], blockCats: [], notify: true, autoStart: true },
        { id: "deep-work", emoji: "🧠", name: "Deep Work", work: 90, brk: 15, long: 30, longBrk: 30, cycles: 2, strict: false, cats: [], blockCats: [], notify: true, autoStart: true },
        { id: "short-sprint", emoji: "⚡", name: "Short Sprint", work: 15, brk: 3, long: 10, longBrk: 10, cycles: 4, strict: false, cats: [], blockCats: [], notify: true, autoStart: true },
        { id: "custom", emoji: "🌊", name: "Flow", work: 25, brk: 5, long: 15, longBrk: 15, cycles: 4, strict: false, cats: [], blockCats: [], notify: true, autoStart: true },
    ];
    const getCatsList = () => [
        { v: "distraction", l: `${catEmoji("distraction")} ${catLabel("distraction", false)}` },
        { v: "communication", l: `${catEmoji("communication")} ${catLabel("communication", false)}` },
        { v: "uncategorized", l: `${catEmoji("uncategorized")} ${catLabel("uncategorized", false)}` },
        { v: "productivity", l: `${catEmoji("productivity")} ${catLabel("productivity", false)}` },
        { v: "learning", l: `${catEmoji("learning")} ${catLabel("learning", false)}` },
    ];

    async function loadStore() {
        try {
            const localRes = await gSync(["focusPresets"]);
            const syncRes = await gSync(["settings"]);
            const presetsList = localRes.focusPresets;
            const activeId = (syncRes.settings && syncRes.settings.activePresetId) || "pomodoro";
            
            if (Array.isArray(presetsList) && presetsList.length) {
                presetsList.forEach(item => {
                    if (item.autoStart === undefined) item.autoStart = true;
                    if (item.long !== undefined && item.longBrk === undefined) item.longBrk = item.long;
                    if (item.longBrk !== undefined && item.long === undefined) item.long = item.longBrk;
                    if (item.cats !== undefined && item.blockCats === undefined) item.blockCats = item.cats;
                    if (item.blockCats !== undefined && item.cats === undefined) item.cats = item.blockCats;
                    if (item.cats === undefined && item.blockCats === undefined) {
                        item.cats = [];
                        item.blockCats = [];
                    }
                });
                if (!presetsList.some(x => x.id === "custom")) {
                    presetsList.push({ id: "custom", emoji: "🌊", name: "Flow", work: 25, brk: 5, long: 15, longBrk: 15, cycles: 4, strict: false, cats: [], blockCats: [] });
                }
                return { list: presetsList, activeId, editingId: "pomodoro" };
            }
        } catch (_) { }
        return { list: DEFAULT_PRESETS.map((p) => ({ ...p })), activeId: "pomodoro", editingId: "pomodoro" };
    }
    function saveStore(s) {
        syncPresetsToSW(s);
    }

    async function syncPresetsToSW(s) {
        if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
            await new Promise(r => chrome.runtime.sendMessage({ type: "PRESETS_SAVE", presets: s.list }, r));
            await new Promise(r => chrome.runtime.sendMessage({ type: "PRESETS_SET_ACTIVE", id: s.activeId }, r));
        }
    }

    // ---------- Preset Builder Redesign ------------------------------
    async function buildPresetBuilder() {
        const store = await loadStore();
        let state = store;



        function renderCards() {
            const switchesEl = $$("preset-quick-switches");
            if (!switchesEl) return;
            setSafeHTML(switchesEl, "");

            state.list.forEach((p) => {
                const isActive = p.id === state.activeId;

                const card = document.createElement("div");
                card.className = "preset-card" + (isActive ? " is-active" : "");
                card.style.cssText = `
          padding: 14px 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          cursor: pointer;
          text-align: center;
        `;

                const emojiOrIcon = `<div style="font-size: 24px; margin-bottom: 6px;">${sanitizeDomain(p.emoji || '')}</div>`;

                setSafeHTML(card, `
          ${emojiOrIcon}
          <div style="font-size: 13px; font-weight: 800; color: var(--tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${sanitizeDomain(getPresetName(p.id, p.name) || '')}</div>
          <div style="font-size: 11px; font-weight: 700; color: var(--tx2); margin-top: 2px; display: flex; align-items: center; gap: 4px;">${p.work}m · ${p.brk}m · ${p.cycles || 4} <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg></div>
          
          <div class="preset-card-actions" style="display: flex; gap: 8px; margin-top: 10px; width: 100%; justify-content: center;">
            <button class="preset-play-btn" title="Quick Start" style="
              background: var(--green-bg);
              border: 1px solid var(--green-bd);
              color: var(--green);
              width: 28px;
              height: 28px;
              border-radius: 8px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 11px;
              transition: all 0.2s;
            ">▶</button>
            <button class="preset-edit-btn" title="Edit Settings" style="
              background: var(--bg4);
              border: 1px solid var(--bd2);
              color: var(--tx2);
              width: 28px;
              height: 28px;
              border-radius: 8px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 11px;
              transition: all 0.2s;
            ">✎</button>
          </div>
        `);

                // Click main card to select
                card.addEventListener("click", (e) => {
                    if (e.target.closest(".preset-card-actions")) return;
                    if (window.__ffV612Locked) return;

                    state.activeId = p.id;
                    saveStore(state);
                    window.__glowPresetId = "";
                    renderAll();

                    syncPresetsToSW(state).then(() => {
                        msg("TRIGGER_DNR_UPDATE");
                        if (typeof loadFocusUI === "function") loadFocusUI();
                        if (typeof toast === "function") toast(t_("activatedPreset", [p.name]), "ok");
                    });
                });

                // Click play button to select and start focus
                const playBtn = card.querySelector(".preset-play-btn");
                playBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (window.__ffV612Locked) return;

                    state.activeId = p.id;
                    saveStore(state);
                    window.__glowPresetId = "";
                    renderAll();

                    syncPresetsToSW(state).then(() => {
                        msg("TRIGGER_DNR_UPDATE");

                        if (typeof loadFocusUI === "function") loadFocusUI();

                        const fsBtn = document.getElementById("btn-fs");
                        if (fsBtn) fsBtn.click();
                    });
                });

                // Click edit button to open modal with PIN prompt if enabled
                const editBtn = card.querySelector(".preset-edit-btn");
                if (p.id === window.__glowPresetId) {
                    editBtn.classList.add("glowing-edit-btn");
                }
                editBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (window.__ffV612Locked) return;

                    editBtn.classList.remove("glowing-edit-btn");
                    window.__glowPresetId = "";

                    const ok = await promptPinIfEnabled("lockFocusPresets");
                    if (ok) showEditPresetModal(p.id);
                });

                switchesEl.appendChild(card);
            });
        }

        function showEditPresetModal(presetId) {
            showEditPresetModalModule(presetId, state, {
                getCatsList: getCatsList,
                onSave: async (p) => {
                    saveStore(state);
                    renderAll();
                    await syncPresetsToSW(state);
                    if (p.id === state.activeId) {
                        msg("TRIGGER_DNR_UPDATE");
                        if (typeof loadFocusUI === "function") loadFocusUI();
                    }
                    if (typeof toast === "function") toast(t_("presetSavedSuccessfully"), "ok");
                }
            });
        }

        function renderAll() {
            renderCards();
            applyLockUI();
        }

        function applyLockUI() {
            const locked = !!window.__ffV612Locked;
            const switches = $$("preset-quick-switches");
            if (switches) {
                switches.style.opacity = locked ? "0.4" : "";
                switches.style.pointerEvents = locked ? "none" : "";
            }
        }

        window.__ffV612ApplyLock = applyLockUI;
        renderAll();
    }

    // ---------- Move Study Goals to bottom of Start Focus panel -------

    // ---------- Site Manager → 3 pill tabs ---------------------------
    function buildSiteManagerTabs() {
        const sm = $$("tab-sitemanager");
        if (!sm || sm.dataset.ffV612 === "1") return;
        sm.dataset.ffV612 = "1";

        const cards = Array.from(sm.querySelectorAll(":scope > .card"));
        if (cards.length < 2) return;

        const ruleCard = cards[0]; // Rule manager (block/allow)
        const filterCard = cards[1]; // Smart presets + categories

        // Build tab nav
        const nav = document.createElement("div");
        nav.className = "sm-tabs";
        setSafeHTML(nav, `
      <button type="button" class="sm-tab is-active" data-pane="sites" data-i18n="siteList">${t_("siteList") || "Site List"}</button>
      <button type="button" class="sm-tab" data-pane="presets" data-i18n="smartPresetsAndCategories">${t_("smartPresetsAndCategories") || "Smart Presets & Categories"}</button>
      <button type="button" class="sm-tab" data-pane="tweaks" data-i18n="advancedTweaks">${t_("advancedTweaks") || "Advanced Tweaks"}</button>
    `);
        const ph = sm.querySelector(".ph");
        ph.parentNode.insertBefore(nav, ph.nextSibling);

        // Build panes
        const paneS = document.createElement("div"); paneS.className = "sm-pane is-active"; paneS.id = "sm-pane-sites";
        const paneP = document.createElement("div"); paneP.className = "sm-pane"; paneP.id = "sm-pane-presets";
        const paneT = document.createElement("div"); paneT.className = "sm-pane"; paneT.id = "sm-pane-tweaks";
        sm.appendChild(paneP); sm.appendChild(paneS); sm.appendChild(paneT);

        // Move existing cards: Smart Presets card → presets pane, Rule Manager → sites pane.
        paneP.appendChild(filterCard);
        paneS.appendChild(ruleCard);

        // Tweaks pane gets a host for the granular blocks UI (existing
        // renderGranularBlocksUI() targets #tab-sitemanager — give it a hook).
        setSafeHTML(paneT, `
      <div class="card">
        <div class="ctit" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle;flex-shrink:0;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg><span data-i18n="advancedSiteTweaksTitle">${t_("advancedSiteTweaksTitle") || "Advanced Site Tweaks"}</span>
          </div>
          <a href="https://docs.google.com/forms/d/e/1FAIpQLScyRCRzsfjyENSWmHfn8oo6gLbvi3mKi5TRv0Z27lFOtnDb-Q/viewform?usp=dialog" target="_blank" class="bs report-issue-btn" title="Report Issue" style="display:inline-flex; align-items:center; gap:6px; padding:6px 12px; font-size:12px; text-decoration:none; white-space:nowrap; flex-shrink:0;">
            <span class="report-btn-text">Report Issue</span>
          </a>
        </div>
        <p style="font-size:13px;color:var(--tx2);margin:-12px 0 16px" data-i18n="advancedSiteTweaksDesc">${t_("advancedSiteTweaksDesc") || "Hide distracting UI elements on supported sites (YouTube Shorts, Reddit feed, X timeline, etc.)."}</p>
        <div id="ff-granular-host"></div>
      </div>
    `);

        // Wire tab switching
        nav.querySelectorAll(".sm-tab").forEach((b) => {
            b.addEventListener("click", () => {
                nav.querySelectorAll(".sm-tab").forEach((x) => x.classList.remove("is-active"));
                b.classList.add("is-active");
                sm.querySelectorAll(".sm-pane").forEach((p) => p.classList.remove("is-active"));
                const pane = sm.querySelector("#sm-pane-" + b.dataset.pane);
                if (pane) pane.classList.add("is-active");
                if (b.dataset.pane === "tweaks") {
                    renderGranularBlocksUI();
                }
            });
        });

        // Re-target existing granular UI: monkey-patch the host.
        if (typeof renderGranularBlocksUI === "function") {
            const orig = renderGranularBlocksUI;
            window.renderGranularBlocksUI = async function () {
                const host = document.getElementById("ff-granular-host");
                if (host && !document.getElementById("granular-ui-wrapper")) {
                    // Trick the original function by giving it a target inside our pane.
                    // Easiest: temporarily move tab-sitemanager's id pointer.
                }
                return orig.apply(this, arguments);
            };
        }
    }

    // ---------- Mid-flight lockdown polling --------------------------
    let _pollInterval = null;
    async function pollFocusState() {
        try {
            const r = await new Promise((res) => {
                try { chrome.runtime.sendMessage({ type: "FOCUS_GET_STATE" }, (x) => { void chrome.runtime.lastError; res(x || null); }); }
                catch (_) { res(null); }
            });
            const active = !!(r && r.focusState && r.focusState.active);
            if (active !== window.__ffV612Locked) {
                window.__ffV612Locked = active;
                if (typeof window.__ffV612ApplyLock === "function") window.__ffV612ApplyLock();
            }
        } catch (_) { }
    }




    function init() {
        // CSP-compliant global fallback for broken favicon images
        document.addEventListener("error", function (e) {
            if (e.target && e.target.tagName === "IMG") {
                if (e.target.dataset.domain || e.target.src.includes("icons.duckduckgo.com") || e.target.src.includes("google.com/s2/favicons")) {
                    if (e.target.src !== window.FALLBACK_ICON) {
                        e.target.src = window.FALLBACK_ICON;
                    }
                }
            }
        }, true);

        buildPresetBuilder();
        buildSiteManagerTabs();

        const startFocusPolling = () => {
            if (_pollInterval) clearInterval(_pollInterval);
            if (document.hidden) return;
            pollFocusState();
            _pollInterval = setInterval(pollFocusState, 2000);
        };
        const stopFocusPolling = () => {
            if (_pollInterval) {
                clearInterval(_pollInterval);
                _pollInterval = null;
            }
        };

        startFocusPolling();
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) stopFocusPolling();
            else startFocusPolling();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        // dashboard.js itself runs after DOMContentLoaded; defer one tick so the
        // main init() finishes wiring legacy listeners first.
        setTimeout(init, 0);
    }
})();

// =====================================================================
// FF v6.16 — formerly dashboard/v613-patch.js, merged in to drop the
// extra <script> file. Original v6.13 notes:
//   1. Site Manager: Advanced Tweaks UI ONLY shows inside its own pane.
//   2. Site Manager: Move "Cool-down Sites" cards
//      from Settings → Site List pane.
//   3. Focus Mode: Clean 2-column responsive grid.
//   4. Preset Builder polish.
// =====================================================================
(function ffV613Inline() {
    "use strict";
    if (window.__ffV613Loaded) return;
    window.__ffV613Loaded = true;

    const css = `
    #tab-focus .focus-layout {
      display: grid !important;
      grid-template-columns: 1.8fr 1fr !important;
      gap: 24px !important;
      align-items: stretch !important;
    }
    #tab-focus .focus-layout > .ff-col {
      display: flex; flex-direction: column; gap: 24px; min-width: 0; height: 100%;
    }
    #tab-focus .focus-layout .card { margin: 0 !important; }
    #tab-focus .focus-layout #focus-allowlist-container {
      max-height: 280px !important; overflow-y: auto; padding-right: 6px;
    }
    #tab-focus .focus-layout #focus-allowlist-container::-webkit-scrollbar { width: 6px; }
    #tab-focus .focus-layout #focus-allowlist-container::-webkit-scrollbar-track { background: transparent; }
    #tab-focus .focus-layout #focus-allowlist-container::-webkit-scrollbar-thumb { background: var(--bd2); border-radius: 10px; }
    @media (max-width: 1024px) {
      #tab-focus .focus-layout { grid-template-columns: 1fr !important; }
    }
    #pb-cards { gap: 14px !important; margin-bottom: 24px !important; }
    .pb-card {
      padding: 18px 16px !important;
      gap: 6px !important;
      border-radius: 8px !important;
      border: 1px solid var(--bd2) !important;
      background: var(--bg3) !important;
      box-shadow: var(--shadow-sm) !important;
    }
    .pb-card:hover:not(:disabled) {
      transform: translateY(-2px) !important;
      border-color: var(--bd3) !important;
      background: var(--bg4) !important;
    }
    .pb-card.is-active {
      border-color: var(--green) !important;
      background: var(--green-bg) !important;
      box-shadow: none !important;
    }
    .pb-card.is-editing {
      box-shadow: 0 0 0 2px var(--blue) !important;
      border-color: var(--blue) !important;
    }
    .pb-card-emoji { font-size: 26px !important; line-height: 1 !important; margin-bottom: 2px !important; }
    .pb-card-name {
      font-family: 'Manrope', system-ui, sans-serif !important;
      font-weight: 800 !important;
      font-size: 16px !important;
      letter-spacing: -0.02em !important;
      color: var(--tx) !important;
    }
    .pb-card-meta {
      font-family: 'Manrope', system-ui, sans-serif !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      color: var(--tx2) !important;
      letter-spacing: -0.01em !important;
    }
    .pb-badge {
      padding: 3px 8px !important;
      border-radius: 99px !important;
      font-size: 9px !important;
      font-weight: 800 !important;
      letter-spacing: 0.06em !important;
      text-transform: uppercase !important;
    }
    .pb-badge-active {
      background: var(--green-bg) !important;
      color: var(--green) !important;
      border: 1px solid var(--green-bd) !important;
    }
    .pb-badge-strict {
      background: var(--amber-bg) !important;
      color: var(--amber) !important;
      border: 1px solid var(--amber-bd) !important;
    }
    .pb-editor {
      background: rgba(22, 22, 24, 0.45) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      border: 1px solid var(--bd) !important;
      border-radius: 8px !important;
      padding: 24px !important;
      gap: 20px !important;
      box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.02) !important;
    }
    .pb-grid { grid-template-columns: 1fr 1fr !important; gap: 16px !important; }
    .pb-field label {
      font-family: 'Manrope', system-ui, sans-serif !important;
      font-size: 11px !important;
      font-weight: 800 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
      color: var(--tx3) !important;
      margin-bottom: 6px !important;
    }
    .pb-field .num {
      width: 100% !important;
      background: var(--bg3) !important;
      border: 1px solid var(--bd2) !important;
      border-radius: 12px !important;
      padding: 12px 16px !important;
      color: var(--tx) !important;
      font-size: 16px !important;
      font-weight: 700 !important;
      text-align: center !important;
      font-family: inherit !important;
      transition: var(--trans) !important;
    }
    .pb-field .num:focus {
      border-color: var(--green) !important;
      box-shadow: 0 0 0 3px var(--green-bg) !important;
      background: var(--bg4) !important;
    }
    .pb-strict-row {
      padding-top: 18px !important;
      border-top: 1px solid var(--bd) !important;
    }
    .pb-strict-row .tlbl {
      font-size: 14px !important;
      font-weight: 700 !important;
      color: var(--tx) !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    .pb-strict-row .tdesc {
      font-size: 12px !important;
      color: var(--tx2) !important;
      line-height: 1.5 !important;
      margin-top: 4px !important;
    }
    .pb-cats-title {
      font-family: 'Manrope', system-ui, sans-serif !important;
      font-size: 11px !important;
      font-weight: 800 !important;
      letter-spacing: 0.08em !important;
      text-transform: uppercase !important;
      color: var(--tx3) !important;
      margin-bottom: 10px !important;
    }
    .pb-cats { gap: 10px !important; }
    .pb-cat-row {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 12px 16px !important;
      border: 1px solid var(--bd) !important;
      background: var(--bg3) !important;
      border-radius: 12px !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      color: var(--tx) !important;
      cursor: pointer !important;
      transition: var(--trans) !important;
    }
    .pb-cat-row:hover:not(.is-disabled) {
      border-color: var(--bd3) !important;
      background: var(--bg4) !important;
      transform: translateY(-1px) !important;
    }
    .pb-cat-row:has(input:checked) {
      background: var(--green-bg) !important;
      border-color: var(--green-bd) !important;
      color: var(--green) !important;
    }
    .pb-cat-row input[type="checkbox"] {
      width: 16px !important;
      height: 16px !important;
      accent-color: var(--green) !important;
      cursor: pointer !important;
    }
    .pb-actions { display: flex !important; gap: 12px !important; padding-top: 8px !important; }
    .pb-actions .bp {
      background: var(--green) !important;
      color: #0a0a0a !important;
      font-weight: 800 !important;
      border-radius: 14px !important;
      padding: 14px 20px !important;
      font-size: 14px !important;
      box-shadow: none !important;
      transition: var(--trans) !important;
    }
    .pb-actions .bp:hover {
      transform: translateY(-2px) !important;
      box-shadow: none !important;
    }
    .pb-actions .bs {
      background: var(--bg3) !important;
      color: var(--tx) !important;
      border: 1px solid var(--bd2) !important;
      font-weight: 700 !important;
      border-radius: 14px !important;
      padding: 14px 20px !important;
      font-size: 14px !important;
      transition: var(--trans) !important;
    }
    .pb-actions .bs:hover {
      background: var(--bg4) !important;
      border-color: var(--bd3) !important;
      transform: translateY(-2px) !important;
    }
    #tab-sitemanager .sm-pane { display: none !important; }
    #tab-sitemanager .sm-pane.is-active { display: block !important; }
    #tab-sitemanager > #granular-ui-wrapper { display: none !important; }
    #ff-granular-host #granular-blocks-grid {
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)) !important;
    }
    #ff-granular-host > #granular-ui-wrapper > div:first-child { display: none !important; }
    #sm-pane-sites .ff-moved-settings-card { margin-top: 24px; }
    html.light .pb-editor {
      background: rgba(255, 255, 255, 0.75) !important;
      border: 1px solid rgba(0, 0, 0, 0.05) !important;
      box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.6) !important;
    }
  `;
    const style = document.createElement("style");
    style.id = "ff-v613-style";
    style.textContent = css;
    document.head.appendChild(style);

    function fixGranularPlacement() {
        if (typeof window.renderGranularBlocksUI !== "function") return;
        if (window.renderGranularBlocksUI.__ffV613Wrapped) return;
        const orig = window.renderGranularBlocksUI;
        const wrapped = async function () {
            const sm = document.getElementById("tab-sitemanager");
            const host = document.getElementById("ff-granular-host");
            if (!sm || !host) return orig.apply(this, arguments);
            // Temporarily swap ids so the legacy renderer's `insertBefore` lands in our host.
            sm.id = "tab-sitemanager-swap";
            host.id = "tab-sitemanager";
            try {
                await orig.apply(this, arguments);
            } finally {
                const swapBack = document.getElementById("tab-sitemanager");
                if (swapBack) swapBack.id = "ff-granular-host";
                const orig2 = document.getElementById("tab-sitemanager-swap");
                if (orig2) orig2.id = "tab-sitemanager";
            }
            const stray = document.querySelector("#tab-sitemanager > #granular-ui-wrapper");
            if (stray) stray.remove();
        };
        wrapped.__ffV613Wrapped = true;
        window.renderGranularBlocksUI = wrapped;

        const stray = document.querySelector("#tab-sitemanager > #granular-ui-wrapper");
        const host = document.getElementById("ff-granular-host");
        if (stray && host) host.appendChild(stray);
    }

    function moveSettingsCardsToSiteManager() {
        const sitesPane = document.getElementById("sm-pane-sites");
        if (!sitesPane) return;
        if (sitesPane.dataset.ffV613Moved === "1") return;
        const settingsTab = document.getElementById("tab-settings");
        if (!settingsTab) return;
        const allCards = Array.from(settingsTab.querySelectorAll(".card"));
        const cdCard = allCards.find((c) => c.querySelector("#cd-list"));
        [cdCard].forEach((c) => {
            if (!c) return;
            c.classList.add("ff-moved-settings-card");
            sitesPane.appendChild(c);
        });
        sitesPane.dataset.ffV613Moved = "1";
    }

    function runAll() {
        fixGranularPlacement();
        if (typeof renderGranularBlocksUI === "function") {
            renderGranularBlocksUI();
        }
        moveSettingsCardsToSiteManager();
    }

    function init() {
        let tries = 0;
        const t = setInterval(() => {
            tries++;
            runAll();
            const done =
                document.querySelector("#tab-focus .focus-layout")?.dataset.ffV613 === "1" &&
                document.getElementById("sm-pane-sites")?.dataset.ffV613Moved === "1";
            if (done || tries > 30) clearInterval(t);
        }, 100);
        document.querySelectorAll('.ni[data-tab="sitemanager"]').forEach((b) => {
            b.addEventListener("click", () => setTimeout(runAll, 50));
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        setTimeout(init, 100);
    }
})();

// =====================================================================
// FF v6.7 — Scheduled Focus Mode
// Each schedule: { id, label, days: [0-6], startTime, endTime, enabled }
// Stored in sync settings.focusSchedules[].
// The service worker checks schedules in tracker_heartbeat and auto-starts
// focus mode when the current time matches an enabled schedule.
// =====================================================================
(function initFocusSchedules() {
    "use strict";
    const DAY_LABELS = [t_("sun"), t_("mon"), t_("tue"), t_("wed"), t_("thu"), t_("fri"), t_("sat")];

    function renderSchedules(schedules) {
        const list = document.getElementById("focus-schedules-list");
        if (!list) return;
        list.textContent = "";
        const schedList = schedules || [];
        for (let t = 0; t < 3; t++) {
            const sched = schedList[t];
            const a = document.createElement("div");
            a.className = "free-hour-card";
            a.style.cssText = `
                width: 100%;
                background: var(--bg3);
                border-radius: 12px;
                border: 1px solid var(--bd);
                padding: 0 16px;
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                height: 54px;
                position: relative;
                transition: all 0.2s ease;
                box-sizing: border-box;
            `;
            if (!sched) {
                // Empty slot: Add card!
                a.style.borderStyle = "dashed";
                a.style.cursor = "pointer";
                a.style.justifyContent = "center";
                setSafeHTML(a, `
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="font-size:18px; color:var(--tx3); font-weight:800;">+</div>
                        <div style="font-size:13px; font-weight:800; color:var(--tx3);">${t_("addSchedule")}</div>
                    </div>
                `);
                a.addEventListener("mouseover", () => {
                    a.style.borderColor = "var(--green)";
                    a.querySelector("div > div:nth-child(2)").style.color = "var(--green)";
                });
                a.addEventListener("mouseout", () => {
                    a.style.borderColor = "var(--bd)";
                    a.querySelector("div > div:nth-child(2)").style.color = "var(--tx3)";
                });
                a.addEventListener("click", async () => {
                    if (!(await promptPinIfEnabled("lockFocusScheds"))) return;
                    if (typeof openScheduleModal === "function") openScheduleModal(schedList || []);
                });
            } else {
                // Configured slot: Show details!
                const activeDays = sched.days || [];
                const isEveryday = DAY_LABELS.every((d, i) => activeDays.includes(i));
                const isWeekdays = [1,2,3,4,5].every(i => activeDays.includes(i)) && !activeDays.includes(0) && !activeDays.includes(6);
                let daysText = "";
                if (isEveryday) daysText = t_("everyday");
                else if (isWeekdays) daysText = t_("weekdays");
                else {
                    const DAY_LETTERS = [t_("daySundayLetter"), t_("dayMondayLetter"), t_("dayTuesdayLetter"), t_("dayWednesdayLetter"), t_("dayThursdayLetter"), t_("dayFridayLetter"), t_("daySaturdayLetter")];
                    daysText = [0,1,2,3,4,5,6].filter(i => activeDays.includes(i)).map(i => DAY_LETTERS[i]).join(", ");
                }

                setSafeHTML(a, `
                    <div style="display:flex; flex-direction:column; justify-content:center;">
                        <div style="font-size:13px; font-weight:800; color:var(--tx);">${sanitizeDomain(sched.label || t_("focusSession"))}</div>
                        <div style="font-size:10px; font-weight:700; color:var(--tx2); margin-top:2px; display:flex; gap:6px; align-items:center;">
                            <span>${formatTime12(sched.startTime || "09:00")} - ${formatTime12(sched.endTime || "10:00")}</span>
                            <span style="opacity:0.5">•</span>
                            <span>${daysText}</span>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <label class="tog" style="transform:scale(0.85); transform-origin:right center; margin:0;"><input type="checkbox" class="sched-enabled-cb" data-idx="${t}" ${sched.enabled !== false ? "checked" : ""}><span class="ttrack"></span></label>
                        <button class="preset-edit-btn edit-sched" data-idx="${t}" style="width:24px;height:24px;font-size:11px;background:var(--bg4);border:1px solid var(--bd2);color:var(--tx2);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" title="Edit">${FlowIcons.get("edit", { size: 12 })}</button>
                        <button class="preset-edit-btn rm-sched" data-idx="${t}" style="width:24px;height:24px;font-size:11px;background:var(--bg4);border:1px solid var(--bd2);color:var(--tx2);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" title="Delete">${FlowIcons.get("close", { size: 12 })}</button>
                    </div>
                `);
            }
            list.appendChild(a);
        }

        list.querySelectorAll(".sched-enabled-cb").forEach(cb => {
            cb.addEventListener("change", async () => {
                if (!(await promptPinIfEnabled("lockFocusScheds"))) {
                    cb.checked = !cb.checked;
                    return;
                }
                const sv = (await gSync(["settings"])).settings || {};
                const scheds = sv.focusSchedules || [];
                const i = parseInt(cb.getAttribute("data-idx"));
                if (scheds[i]) {
                    scheds[i].enabled = cb.checked;
                    await sSync({ settings: { ...sv, focusSchedules: scheds } });
                }
            });
        });
        list.querySelectorAll(".edit-sched").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!(await promptPinIfEnabled("lockFocusScheds"))) return;
                const sv = (await gSync(["settings"])).settings || {};
                openScheduleModal(sv.focusSchedules || [], parseInt(btn.getAttribute("data-idx")));
            });
        });
        list.querySelectorAll(".rm-sched").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!(await promptPinIfEnabled("lockFocusScheds"))) return;
                const sv = (await gSync(["settings"])).settings || {};
                const scheds = sv.focusSchedules || [];
                scheds.splice(parseInt(btn.getAttribute("data-idx")), 1);
                await sSync({ settings: { ...sv, focusSchedules: scheds } });
                renderSchedules(scheds);
                if (typeof toast === "function") toast(t_("scheduleDeleted"), "ok");
            });
        });
    }

    function openScheduleModal(schedules, editIdx = -1) {
        const isEdit = editIdx >= 0;
        const sched = isEdit ? schedules[editIdx] : {};

        const overlay = document.createElement("div");
        overlay.className = "overlay";
        overlay.style.zIndex = "9999";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "nsched-title");
        const schedDays = sched.days || [1, 2, 3, 4, 5];
        const currentDayLabels = [t_("sun"), t_("mon"), t_("tue"), t_("wed"), t_("thu"), t_("fri"), t_("sat")];
        const DAY_CBS = currentDayLabels.map((d, i) =>
            `<label class="nsched-day-lbl" style="display:flex;align-items:center;gap:4px;font-size:13px;font-weight:600;cursor:pointer;padding:6px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg3)"><input type="checkbox" class="nsched-day" value="${i}" ${schedDays.includes(i) ? "checked" : ""}> ${d}</label>`
        ).join("");
        setSafeHTML(overlay, `
      <div class="card" style="width:100%;max-width:480px;padding:0;display:flex;flex-direction:column;max-height:85vh;overflow:hidden;">
        <div style="padding:24px 32px 16px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
          <div style="font-size:20px;font-weight:800;color:var(--tx);display:flex;align-items:center;gap:10px;">
            <span>⏰</span>
            <span id="nsched-title">${isEdit ? t_("editFocusSchedule") : t_("addFocusSchedule")}</span>
          </div>
          <button id="nsched-close" aria-label="Close Schedule Modal" style="background:none;border:none;color:var(--tx3);cursor:pointer;padding:4px;display:inline-flex;align-items:center;justify-content:center;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div style="padding:24px 32px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:20px;">
          <div><label for="nsched-label" class="slbl" style="margin-bottom:6px;display:block" data-i18n="label">Label</label><input type="text" id="nsched-label" class="inp" placeholder="e.g. Morning Focus" value="${sanitizeDomain(sched.label || "")}" style="width:100%"/></div>
          <div style="display:flex;gap:12px;align-items:center;">
            <div style="flex:1"><label for="nsched-start" class="slbl" style="margin-bottom:6px;display:block" data-i18n="start">Start</label><input type="time" id="nsched-start" class="inp" value="${sched.startTime || "09:00"}"/></div>
            <div style="flex:1"><label for="nsched-end" class="slbl" style="margin-bottom:6px;display:block" data-i18n="end">End</label><input type="time" id="nsched-end" class="inp" value="${sched.endTime || "10:00"}"/></div>
          </div>
          <div>
            <label class="slbl" style="margin-bottom:8px;display:block" data-i18n="activeDays">Active Days</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${DAY_CBS}</div>
          </div>

          <div class="pb-cats-section" id="nsched-cats-sec">
            <div class="pb-cats-title" style="font-size:13px;font-weight:800;color:var(--tx2);text-transform:uppercase;margin-bottom:12px;" data-i18n="categoriesToBlock">Categories to Block</div>
            <div class="pb-cats c-checkbox-group" id="nsched-cats" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              ${["distraction", "communication", "uncategorized", "productivity", "learning"].map(c => `
                <label class="c-checkbox-lbl" style="padding:10px;font-size:13px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;cursor:pointer;border:1px solid var(--bd);border-radius:10px;background:var(--bg3);">
                  <input type="checkbox" value="${c}" ${(!sched.blockCats || sched.blockCats.includes(c)) ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--green);cursor:pointer;"/>
                  <span>${catEmoji(c)} ${catLabel(c, false)}</span>
                </label>
              `).join("")}
            </div>
          </div>
          <div class="pb-strict-row" style="padding-top:16px;border-top:1px solid var(--bd)">
            <div>
              <label for="nsched-notify-time" class="tlbl" style="font-size:14px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--amber); vertical-align:middle; display:inline-block;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg><span data-i18n="preScheduleNotification">Pre-Schedule Notification</span></label>
              <div class="tdesc" data-i18n="preScheduleNotificationDesc">Get notified before the session starts.</div>
            </div>
            <select id="nsched-notify-time" class="sel" style="width:140px;">
              <option value="0" ${sched.notifyMinsBefore === 0 ? "selected" : ""} data-i18n="disabled">Disabled</option>
              <option value="1" ${sched.notifyMinsBefore === 1 ? "selected" : ""} data-i18n="oneMinBefore">1 min before</option>
              <option value="5" ${(sched.notifyMinsBefore === undefined || sched.notifyMinsBefore === 5) ? "selected" : ""} data-i18n="fiveMinsBefore">5 mins before</option>
              <option value="10" ${sched.notifyMinsBefore === 10 ? "selected" : ""} data-i18n="tenMinsBefore">10 mins before</option>
              <option value="15" ${sched.notifyMinsBefore === 15 ? "selected" : ""} data-i18n="fifteenMinsBefore">15 mins before</option>
            </select>
          </div>
        </div>
        <div style="padding:16px 32px 24px;border-top:1px solid var(--bd);display:flex;gap:12px;justify-content:flex-end;flex-shrink:0;">
          <button class="bs" id="nsched-cancel" data-i18n="cancel">Cancel</button>
          <button class="bp" id="nsched-save">${isEdit ? t_("saveChanges") : t_("addSchedule")}</button>
        </div>
      </div>
    `);
document.body.appendChild(overlay);
        if (typeof translatePage === "function") translatePage();
        const notifySel = overlay.querySelector("#nsched-notify-time");
        if (notifySel) {
            upgradeSelectToCustomDropdown(notifySel);
        }

        const catsSec = overlay.querySelector("#nsched-cats-sec");
        const catsInputs = catsSec.querySelectorAll("input");

        document.getElementById("nsched-cancel").addEventListener("click", () => overlay.remove());
        document.getElementById("nsched-close").addEventListener("click", () => overlay.remove());
        document.getElementById("nsched-save").addEventListener("click", async () => {
            const label = document.getElementById("nsched-label").value.trim() || "Focus Session";
            const startTime = document.getElementById("nsched-start").value;
            const endTime = document.getElementById("nsched-end").value;
            const days = Array.from(overlay.querySelectorAll(".nsched-day:checked")).map(cb => parseInt(cb.value));
            if (!days.length) { if (typeof toast === "function") toast(t_("selectAtLeastOneDay"), "er"); return; }
            const strict = false;
            const cats = Array.from(overlay.querySelectorAll("#nsched-cats input:checked")).map(cb => cb.value);
            const notify = parseInt(document.getElementById("nsched-notify-time").value) || 0;
            const sv = (await gSync(["settings"])).settings || {};
            const scheds = sv.focusSchedules || [];
            if (isEdit) {
                scheds[editIdx] = { ...scheds[editIdx], label, days, startTime, endTime, strict, blockCats: cats, notifyMinsBefore: notify };
            } else {
                scheds.push({ id: uid(), label, days, startTime, endTime, enabled: true, strict, blockCats: cats, notifyMinsBefore: notify });
            }

            await sSync({ settings: { ...sv, focusSchedules: scheds } });
            overlay.remove();
            renderSchedules(scheds);
            if (typeof toast === "function") toast(isEdit ? t_("scheduleUpdated") : t_("scheduleAdded"), "ok");
        });

    }

    async function init() {
        const sv = (await gSync(["settings"])).settings || {};
        renderSchedules(sv.focusSchedules || []);



    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        setTimeout(init, 200);
    }

    // --- Unified Modal Logic ---
    const addRuleModal = document.getElementById("add-rule-modal");
    const btnOpenAddModal = document.getElementById("btn-open-add-modal");
    const btnOpenTagModal = document.getElementById("btn-open-tag-modal");
    const btnCloseAddModal = document.getElementById("btn-close-add-modal");

    if (addRuleModal && btnOpenAddModal) {
        btnOpenAddModal.addEventListener("click", async () => {
            if (!await promptPinIfEnabled("lockRules")) return;
            const qDomain = $("quick-domain") ? $("quick-domain").value.trim() : "";
            const qRedir = $("quick-redir") ? $("quick-redir").value.trim() : "";
            if ($("m-id")) $("m-id").value = "";
            if ($("cat-inp")) $("cat-inp").value = qDomain;
            if ($("cat-redir")) $("cat-redir").value = qRedir;
            if ($("mon-inp-domain")) $("mon-inp-domain").value = qDomain;
            if ($("btn-add-block")) $("btn-add-block").textContent = t_("addBlockRule");
            if ($("add-rule-modal-title")) $("add-rule-modal-title").textContent = t_("addBlockRule");
            if (typeof switchRuleModalTab === "function") switchRuleModalTab("block");
            addRuleModal.classList.remove("hide");

            if ($("quick-domain")) $("quick-domain").value = "";
            if ($("quick-redir")) $("quick-redir").value = "";
        });
    }
    if (addRuleModal && btnOpenTagModal) {
        btnOpenTagModal.addEventListener("click", async () => {
            if (!await promptPinIfEnabled("lockRules")) return;
            if ($("m-id")) $("m-id").value = "";
            if ($("cat-inp")) $("cat-inp").value = "";
            if ($("cat-redir")) $("cat-redir").value = "";
            if ($("mon-inp-domain")) $("mon-inp-domain").value = "";
            if ($("add-rule-modal-title")) $("add-rule-modal-title").textContent = t_("trackLabelSite");
            if (typeof switchRuleModalTab === "function") switchRuleModalTab("monitor");
            addRuleModal.classList.remove("hide");
        });
    }
    if (addRuleModal) {
        if (btnCloseAddModal) btnCloseAddModal.addEventListener("click", () => addRuleModal.classList.add("hide"));
        const btnCancelRule = document.getElementById("btn-cancel-rule");
        if (btnCancelRule) btnCancelRule.addEventListener("click", () => addRuleModal.classList.add("hide"));
    }

    document.querySelectorAll(".add-rule-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".add-rule-tab").forEach(b => b.classList.remove("act"));
            document.querySelectorAll(".add-form-pane").forEach(p => p.style.display = "none");
            btn.classList.add("act");
            const type = btn.getAttribute("data-ruletype");
            const pane = document.getElementById(`add-form-${type}`);
            if (pane) pane.style.display = "block";
            if (type === "block") {
                if ($("btn-add-block")) $("btn-add-block").style.display = "block";
                if ($("btn-add-tag-inline")) $("btn-add-tag-inline").style.display = "none";
            } else {
                if ($("btn-add-block")) $("btn-add-block").style.display = "none";
                if ($("btn-add-tag-inline")) $("btn-add-tag-inline").style.display = "block";
            }
        });
    });

    window.openAddOrEditModal = async function(domain) {
        if (await promptPinIfEnabled("lockRules")) {
            const rule = rules.find(r => r.domain === domain);
            if (rule) {
                openModal(rule.id);
            } else {
                if ($("m-id")) $("m-id").value = "";
                if ($("cat-inp")) $("cat-inp").value = domain;
                if ($("btn-add-block")) $("btn-add-block").textContent = t_("addBlockRule");
                if ($("add-rule-modal-title")) $("add-rule-modal-title").textContent = t_("addBlockRule");
                if (typeof switchRuleModalTab === "function") switchRuleModalTab("block");
                const modal = $("add-rule-modal");
                if (modal) modal.classList.remove("hide");
            }
        }
    };

    // FF v6.7.0: Search wiring for Rules list (Problem 19)
    const _rulesSearchEl = document.getElementById("rules-search");
    if (_rulesSearchEl) {
        let _rsDebounce = null;
        _rulesSearchEl.addEventListener("input", () => {
            clearTimeout(_rsDebounce);
            _rsDebounce = setTimeout(() => {
                const q = _rulesSearchEl.value.toLowerCase().trim();
                const list = document.getElementById("combined-list");
                if (!list) return;
                list.querySelectorAll(".brow").forEach(row => {
                    const dom = row.querySelector(".dom");
                    const text = (dom ? dom.textContent : "").toLowerCase();
                    row.style.display = (!q || text.includes(q)) ? "" : "none";
                });
            }, 150);
        });
    }

    // FF v6.7.0: Search wiring for Top Sites (Problem 19)
    const _tsSearchEl = document.getElementById("top-sites-search");
    if (_tsSearchEl) {
        let _tsDebounce = null;
        _tsSearchEl.addEventListener("input", () => {
            clearTimeout(_tsDebounce);
            _tsDebounce = setTimeout(() => {
                const q = _tsSearchEl.value.toLowerCase().trim();
                const container = document.getElementById("top-sites");
                if (!container) return;
                container.querySelectorAll(".siterow").forEach(row => {
                    const dom = row.querySelector(".dom, .sitedom");
                    const text = (dom ? dom.textContent : "").toLowerCase();
                    row.style.display = (!q || text.includes(q)) ? "" : "none";
                });
            }, 150);
        });
    }

    // Search wiring for Category sites
    const _catSearchEl = document.getElementById("cat-sites-search");
    if (_catSearchEl) {
        let _csDebounce = null;
        _catSearchEl.addEventListener("input", () => {
            clearTimeout(_csDebounce);
            _csDebounce = setTimeout(() => {
                renderCategories();
            }, 150);
        });
    }

    // ---------- Rule Manager Sub-Tabs Wiring ----------
    window.activeRuleTab = "block";
    document.querySelectorAll(".rule-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".rule-tab").forEach(b => b.classList.remove("act"));
            btn.classList.add("act");
            window.activeRuleTab = btn.getAttribute("data-ruletab");
            
            // Toggle form views
            if ($("rule-form-block")) $("rule-form-block").style.display = window.activeRuleTab === "block" ? "flex" : "none";
            if ($("rule-form-allow")) $("rule-form-allow").style.display = window.activeRuleTab === "allow" ? "flex" : "none";
            if ($("rule-form-never")) $("rule-form-never").style.display = window.activeRuleTab === "never" ? "flex" : "none";
            
            // Toggle tip visibility
            const sm = $("tab-sitemanager");
            if (sm) {
                const tipEl = sm.querySelector(".card p[style*='font-weight:600']");
                if (tipEl) {
                    tipEl.style.display = window.activeRuleTab === "block" ? "block" : "none";
                }
            }
            
            // Clear search input and trigger search filter
            const rulesSearchEl = $("rules-search");
            if (rulesSearchEl) {
                rulesSearchEl.value = "";
                rulesSearchEl.placeholder = window.activeRuleTab === "block" ? (t_("searchBlockedSites") || "Search blocked sites...") : (window.activeRuleTab === "allow" ? (t_("searchAllowedSites") || "Search allowed sites...") : (t_("searchIgnoredSites") || "Search ignored sites..."));
            }
            
            renderCombined();
        });
    });

    // --- Bulk Edit Shared wiring ---
    const triggerBulkEdit = async () => {
        await promptPinIfEnabled("lockRules") && (isBulkMode = !0, bulkSelected.clear(), document.querySelectorAll("#btn-bulk-edit, .btn-bulk-edit-shared").forEach(btn => btn.style.display = "none"), $("bulk-actions").style.display = "flex", renderCombined());
    };
    document.querySelectorAll(".btn-bulk-edit-shared").forEach(btn => btn.addEventListener("click", triggerBulkEdit));

    // --- Allowlist Quick Add ---
    $("btn-add-allow-rule") && $("btn-add-allow-rule").addEventListener("click", async () => {
        if (!await promptPinIfEnabled("lockRules")) return;
        const input = $("allow-domain-input");
        const val = input.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
        if (!val) {
            toast(t_("enterDomain"), "warn");
            return;
        }
        if (!val.includes(".") || val.length < 4) {
            toast(t_("enterValidDomain"), "warn");
            return;
        }
        
        let t = await gLocal(["allowList"]);
        let list = t.allowList || [];
        if (list.includes(val)) {
            toast(t_("domainAlreadyAllowed"), "warn");
            return;
        }
        list.push(val);
        allowList = list;
        await sLocal({ allowList });
        input.value = "";
        renderCombined();
        toast(t_("addedToAllowlist"), "ok");
    });

    // --- Never Track Quick Add ---
    $("never-track-add-btn") && $("never-track-add-btn").addEventListener("click", async () => {
        const input = $("never-track-input");
        const val = input.value.trim();
        if (!val) {
            toast(t_("enterDomain"), "warn");
            return;
        }
        
        // Split on commas or whitespace/newlines
        const domains = val.split(/[,\s]+/)
            .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
            .filter(d => d && d.includes(".") && d.length > 3);
            
        if (domains.length === 0) {
            toast(t_("enterValidDomains"), "warn");
            return;
        }
        
        let t = await gLocal(["neverTrackDomains"]);
        let list = t.neverTrackDomains || [];
        let addedCount = 0;
        domains.forEach(d => {
            if (!list.includes(d)) {
                list.push(d);
                addedCount++;
            }
        });
        
        if (addedCount > 0) {
            neverTrackDomains = list;
            await sLocal({ neverTrackDomains: list });
            input.value = "";
            renderCombined();
            toast(t_("addedDomainsToNeverTrack", [addedCount]), "ok");
        } else {
            toast(t_("domainsAlreadyInList"), "warn");
        }
    });

    // --- Privacy Mode Dashboard Integration ---
    var _dashboardPrivacyCountdownTick = null;

    window.updateDashboardPrivacyUI = async function() {
        const btnPrivacy = $("btn-dashboard-privacy");
        const statusPrivacy = $("dashboard-privacy-status");
        if (!btnPrivacy) return;

        const state = await msg("GET_PRIVACY_STATE");
        const fs = await msg("FOCUS_GET_STATE");
        const focusActive = !!(fs && fs.focusState && fs.focusState.active);

        if (focusActive) {
            btnPrivacy.style.opacity = "0.3";
            btnPrivacy.style.cursor = "not-allowed";
            btnPrivacy.title = t_("privacyDisabledDuringFocus");
        } else {
            btnPrivacy.style.opacity = "";
            btnPrivacy.style.cursor = "";
            btnPrivacy.title = t_("privacyModeTitle");
        }

        if (state && state.active) {
            btnPrivacy.classList.add("active");
            if (statusPrivacy) {
                statusPrivacy.classList.remove("hide");
            }
            
            if (state.until > 0) {
                if (_dashboardPrivacyCountdownTick) clearInterval(_dashboardPrivacyCountdownTick);
                const tick = () => {
                    const diff = state.until - Date.now();
                    if (diff <= 0) {
                        clearInterval(_dashboardPrivacyCountdownTick);
                        _dashboardPrivacyCountdownTick = null;
                        window.updateDashboardPrivacyUI();
                    } else {
                        const m = Math.floor(diff / 60000);
                        const s = Math.floor((diff % 60000) / 1000);
                        if (statusPrivacy) {
                            statusPrivacy.textContent = t_("pausedTime", [`${m}m ${String(s).padStart(2, '0')}s`]);
                        }
                    }
                };
                tick();
                _dashboardPrivacyCountdownTick = setInterval(tick, 1000);
            } else {
                if (_dashboardPrivacyCountdownTick) {
                    clearInterval(_dashboardPrivacyCountdownTick);
                    _dashboardPrivacyCountdownTick = null;
                }
                if (statusPrivacy) {
                    statusPrivacy.textContent = t_("pausedAlways");
                }
            }
        } else {
            btnPrivacy.classList.remove("active");
            if (statusPrivacy) {
                statusPrivacy.classList.add("hide");
            }
            if (_dashboardPrivacyCountdownTick) {
                clearInterval(_dashboardPrivacyCountdownTick);
                _dashboardPrivacyCountdownTick = null;
            }
        }
    };

    async function initDashboardPrivacy() {
        const btnPrivacy = $("btn-dashboard-privacy");
        const modal = $("privacy-modal");
        const modalClose = $("privacy-modal-close");
        const modalCancel = $("btn-dash-privacy-cancel");

        if (btnPrivacy) {
            btnPrivacy.addEventListener("click", async () => {
                const fs = await msg("FOCUS_GET_STATE");
                if (fs && fs.focusState && fs.focusState.active) {
                    toast(t_("privacyDisabledDuringFocus"), "er");
                    return;
                }

                const state = await msg("GET_PRIVACY_STATE");
                if (state && state.active) {
                    if (!await promptPinIfEnabled("lockPrivacy")) return;
                    await msg("STOP_PRIVACY_MODE");
                    window.updateDashboardPrivacyUI();
                    toast(t_("trackingResumed"), "ok");
                } else {
                    if (!await promptPinIfEnabled("lockPrivacy")) return;
                    modal && modal.classList.remove("hide");
                }
            });
        }

        if (modalClose) {
            modalClose.addEventListener("click", () => {
                modal && modal.classList.add("hide");
            });
        }

        if (modalCancel) {
            modalCancel.addEventListener("click", () => {
                modal && modal.classList.add("hide");
            });
        }

        const startPrivacy = async (mins) => {
            await msg("START_PRIVACY_MODE", { duration: mins });
            modal && modal.classList.add("hide");
            window.updateDashboardPrivacyUI();
            toast(t_("privacyModeEnabled"), "ok");
        };

        $("btn-dash-privacy-30") && $("btn-dash-privacy-30").addEventListener("click", () => startPrivacy(30));
        $("btn-dash-privacy-60") && $("btn-dash-privacy-60").addEventListener("click", () => startPrivacy(60));
        $("btn-dash-privacy-always") && $("btn-dash-privacy-always").addEventListener("click", () => startPrivacy(0));

        window.updateDashboardPrivacyUI();
    }

    async function renderLocalBackupsList() {
        const listContainer = $("local-backups-list");
        if (!listContainer) return;
        
        const res = await msg("BACKUP_LIST_GET");
        if (!res || !res.list) {
            setSafeHTML(listContainer, '<div style="font-size:13px;color:var(--tx3);text-align:center;padding:12px 0;">Failed to load backup list.</div>');
            return;
        }
        
        if (res.list.length === 0) {
            setSafeHTML(listContainer, '<div style="font-size:13px;color:var(--tx3);text-align:center;padding:24px 0;">No backups created yet.</div>');
            return;
        }
        
        const sorted = res.list.sort((a, b) => b.timestamp - a.timestamp);
        listContainer.textContent = "";
        
        sorted.forEach(backup => {
            const row = document.createElement("div");
            row.className = "trow";
            row.style.cssText = "display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-top:1px solid var(--bd); gap:16px;";
            
            let sizeStr = "0 B";
            if (backup.size > 1024 * 1024) {
                sizeStr = (backup.size / (1024 * 1024)).toFixed(2) + " MB";
            } else if (backup.size > 1024) {
                sizeStr = (backup.size / 1024).toFixed(2) + " KB";
            } else {
                sizeStr = backup.size + " B";
            }
            
            const dateStr = new Date(backup.timestamp).toLocaleString(undefined, {
                month: "short", day: "numeric", year: "numeric",
                hour: "numeric", minute: "2-digit"
            });
            
            setSafeHTML(row, `
                <div style="display:flex; align-items:center; gap:12px;">
                    ${FlowIcons.get("lock", { size: 20, style: "color:var(--green); flex-shrink:0;" })}
                    <div>
                        <div style="font-size:14px; font-weight:700; color:var(--tx);">${backup.label}</div>
                        <div style="font-size:12px; color:var(--tx3); margin-top:2px;">${dateStr} &bull; ${sizeStr}</div>
                    </div>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="bs btn-restore-backup" data-id="${backup.id}" title="Restore this backup" aria-label="Restore this backup" style="padding:6px 12px; font-size:12px; display:inline-flex; align-items:center; gap:4px;">
                        ${FlowIcons.get("refresh", { size: 12 })}
                        Restore
                    </button>
                    <button class="bs btn-download-backup" data-id="${backup.id}" title="Download JSON file" aria-label="Download JSON file" style="padding:6px; display:inline-flex; align-items:center; justify-content:center;">
                        ${FlowIcons.get("download", { size: 12 })}
                    </button>
                    <button class="bs-danger btn-delete-backup" data-id="${backup.id}" title="Delete this backup" aria-label="Delete this backup" style="padding:6px; display:inline-flex; align-items:center; justify-content:center;">
                        ${FlowIcons.get("trash", { size: 12 })}
                    </button>
                </div>
            `);
listContainer.appendChild(row);
        });
        
        listContainer.querySelectorAll(".btn-restore-backup").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                if (await showConfirm(t_("restoreBackup"), t_("restoreBackupConfirm"), { isDestructive: true, confirmText: t_("restoreConfirmBtn") })) {
                    const res = await msg("BACKUP_RESTORE_LOCAL", { id });
                    if (res && res.ok) {
                        toast(t_("backupRestoredReloading"), "ok");
                        setTimeout(() => location.reload(), 1000);
                    } else {
                        toast(t_("restoreFailed"), "er");
                    }
                }
            });
        });
        
        listContainer.querySelectorAll(".btn-download-backup").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const payload = await FFDB.getLocalBackupData(id);
                if (payload) {
                    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `FocusFlow_Backup_${id}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast(t_("downloadStarted"), "ok");
                } else {
                    toast(t_("failedDownloadData"), "er");
                }
            });
        });
        
        listContainer.querySelectorAll(".btn-delete-backup").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                if (await showConfirm(t_("deleteBackup"), t_("deleteBackupConfirm"), { isDestructive: true, confirmText: t_("deleteConfirmBtn") })) {
                    const res = await msg("BACKUP_DELETE_LOCAL", { id });
                    if (res && res.ok) {
                        toast(t_("backupDeleted"), "ok");
                        renderLocalBackupsList();
                    } else {
                        toast(t_("deleteFailed"), "er");
                    }
                }
            });
        });
    }

    window.renderLocalBackupsList = renderLocalBackupsList;

    const btnCreateLocalBackup = $("btn-create-local-backup");
    if (btnCreateLocalBackup) {
        btnCreateLocalBackup.addEventListener("click", async () => {
            btnCreateLocalBackup.disabled = true;
            btnCreateLocalBackup.textContent = t_("creating");
            const res = await msg("BACKUP_CREATE_LOCAL", { label: "Manual Backup" });
            btnCreateLocalBackup.disabled = false;
            btnCreateLocalBackup.textContent = t_("btnCreateLocalBackup");
            if (res && res.ok) {
                toast(t_("localBackupCreated"), "ok");
                renderLocalBackupsList();
            } else {
                toast(t_("backupCreationFailed"), "er");
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initDashboardPrivacy);
    } else {
        setTimeout(initDashboardPrivacy, 300);
    }

})();

(function initBlockPresets() {
    "use strict";

    const $ = (id) => document.getElementById(id);

    // --- Block Presets Code ---
    let blockPresetsList = [];

    async function loadAndRenderPresets() {
        const local = await gLocal(["blockPresets"]);
        blockPresetsList = local.blockPresets || [];
        renderPresetsList();
        populateApplyDropdown();
    }

    function renderPresetsList() {
        const container = $("quick-presets-container");
        if (!container) return;
        setSafeHTML(container, "");

        for (let i = 0; i < 3; i++) {
            const p = blockPresetsList[i];
            const slot = document.createElement("div");
            if (!p) {
                // Empty slot: render dashed button
                slot.className = "quick-preset-slot empty";
                slot.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    height: 38px;
                    min-width: 140px;
                    background: none;
                    border: 1px dashed var(--bd);
                    border-radius: 8px;
                    padding: 0 12px;
                    font-size: 12px;
                    font-weight: 700;
                    color: var(--tx3);
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                    box-sizing: border-box;
                `;
                setSafeHTML(slot, `<span data-i18n="addPreset">${t_("addPreset") || "+ Preset"}</span>`);
// Add hover style changes
                slot.addEventListener("mouseover", () => {
                    slot.style.borderColor = "var(--green)";
                    slot.style.color = "var(--green)";
                });
                slot.addEventListener("mouseout", () => {
                    slot.style.borderColor = "var(--bd)";
                    slot.style.color = "var(--tx3)";
                });
                
                slot.addEventListener("click", () => {
                    window.__editingSlotIdx = i;
                    openPresetModal(null);
                });
            } else {
                // Filled slot: render preset name, edit and delete buttons
                slot.className = "quick-preset-slot filled";
                slot.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    height: 38px;
                    background: var(--bg3);
                    border: 1px solid var(--bd);
                    border-radius: 8px;
                    padding: 0 10px 0 12px;
                    font-size: 12px;
                    font-weight: 700;
                    color: var(--tx);
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                    position: relative;
                    min-width: 140px;
                    box-sizing: border-box;
                `;
                setSafeHTML(slot, `
                    <span class="preset-name-text" style="max-width: 95px; overflow: hidden; text-overflow: ellipsis; display: inline-block;">${escHTML(p.name)}</span>
                    <div class="preset-slot-actions" style="display: flex; gap: 4px; align-items: center;">
                        <button class="edit-preset-slot-btn" title="Edit" aria-label="Edit block preset slot" style="background: none; border: none; color: var(--tx2); cursor: pointer; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; padding: 2px;">✎</button>
                        <button class="delete-preset-slot-btn" title="Delete" aria-label="Delete block preset slot" style="background: none; border: none; color: var(--red); cursor: pointer; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; padding: 2px;">✕</button>
                    </div>
                `);
// Add hover style changes
                slot.addEventListener("mouseover", () => {
                    slot.style.borderColor = "var(--tx2)";
                });
                slot.addEventListener("mouseout", () => {
                    slot.style.borderColor = "var(--bd)";
                });
                
                // Click the slot itself -> Instant Block if Domain input is filled!
                slot.addEventListener("click", async (e) => {
                    if (e.target.closest(".edit-preset-slot-btn") || e.target.closest(".delete-preset-slot-btn")) {
                        return;
                    }
                    
                    const domInput = $("quick-domain");
                    const domainVal = domInput ? domInput.value.trim() : "";
                    if (!domainVal) {
                        toast(t_("enterDomainFirstToBlockInstantly"), "er");
                        return;
                    }
                    
                    if (await promptPinIfEnabled("lockRules")) {
                        let { allowList = [] } = await gLocal(["allowList"]);
                        const sanitizedDom = sanitizeDomain(domainVal);
                        if (allowList.includes(sanitizedDom)) {
                            allowList = allowList.filter(x => x !== sanitizedDom);
                            await sLocal({ allowList });
                        }
                        
                        const c = p.config || {};
                        const newRule = {
                            id: Math.random().toString(36).substring(2, 9),
                            domain: sanitizedDom,
                            category: getEffectiveCat(sanitizedDom).cat || "distraction",
                            redirectUrl: c.redirectUrl || null,
                            instantBlock: !!c.instantBlock,
                            focusOnly: !!c.focusOnly,
                            timeLimitEnabled: !!c.timeLimitEnabled,
                            dailyLimitSecs: Number(c.dailyLimitSecs) || 0,
                            scheduleEnabled: !!c.scheduleEnabled,
                            schedules: c.schedules || [],
                            sessionLimitEnabled: !!c.sessionLimitEnabled,
                            sessionLimitSecs: Number(c.sessionLimitSecs) || 300,
                            sessionCooldownSecs: Number(c.sessionCooldownSecs) || 600,
                            cooldownEnabled: !!c.cooldownEnabled,
                            cooldownTimer: Number(c.cooldownTimer) || 10,
                            cooldownFrequency: c.cooldownFrequency || "always",
                            activeDays: c.activeDays !== undefined ? c.activeDays : [0, 1, 2, 3, 4, 5, 6]
                        };
                        
                        let { blockRules = [] } = await gLocal(["blockRules"]);
                        blockRules.push(newRule);
                        await sLocal({ blockRules });
                        await msg("TRIGGER_DNR_UPDATE");
                        
                        domInput.value = "";
                        const redirInput = $("quick-redir");
                        if (redirInput) redirInput.value = "";
                        
                        await loadRules();
                        await renderCombined();
                        toast(t_("siteBlockedUnderPreset", [p.name]), "ok");
                    }
                });
                
                // Wire Edit button
                slot.querySelector(".edit-preset-slot-btn").addEventListener("click", (e) => {
                    e.stopPropagation();
                    window.__editingSlotIdx = i;
                    openPresetModal(p.id);
                });
                
                // Wire Delete button
                slot.querySelector(".delete-preset-slot-btn").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (await showConfirm(t_("deletePreset"), t_("deletePresetConfirm", [p.name]), { isDestructive: true, confirmText: t_("deleteConfirmBtn") })) {
                        blockPresetsList[i] = null;
                        blockPresetsList = blockPresetsList.filter(x => x !== null);
                        await sLocal({ blockPresets: blockPresetsList });
                        await loadAndRenderPresets();
                        toast(t_("presetDeleted"), "ok");
                    }
                });
            }
            container.appendChild(slot);
        }
    }

    function populateApplyDropdown() {
        const select = $("m-apply-preset");
        if (!select) return;
        
        const val = select.value;
        setSafeHTML(select, `<option value="">${t_("selectPresetToApply") || "-- Select a Preset to Apply --"}</option>`);
        blockPresetsList.forEach(p => {
            if (p) {
                const opt = document.createElement("option");
                opt.value = p.id;
                opt.textContent = p.name;
                select.appendChild(opt);
            }
        });
        select.value = val;
    }

    // Modal Helpers
    function openPresetModal(id) {
        const modal = $("add-preset-modal");
        if (!modal) return;

        const p = blockPresetsList.find(x => x.id === id);
        if (p) {
            $("p-id").value = p.id;
            $("p-preset-name").value = p.name;
            $("p-preset-name").disabled = false;
            
            const c = p.config || {};
            $("p-mode-focus").checked = !!c.focusOnly;
            $("p-mode-limit").checked = !!c.timeLimitEnabled || !!c.instantBlock;
            $("p-lim").value = c.instantBlock ? 0 : Math.round((c.dailyLimitSecs || 1800)/60);
            $("p-mode-schedule").checked = !!c.scheduleEnabled;
            $("p-mode-cooldown").checked = !!c.cooldownEnabled;
            $("p-cd-wait").value = c.cooldownTimer || 10;
            $("p-cd-freq").value = normalizeCdFreq(c.cooldownFrequency);
            
            $("p-mode-session").checked = !!c.sessionLimitEnabled;
            $("p-session-limit").value = c.sessionLimitSecs ? Math.round(c.sessionLimitSecs / 60) : 5;
            $("p-session-cooldown").value = c.sessionCooldownSecs ? Math.round(c.sessionCooldownSecs / 60) : 10;
            
            $("p-redir").value = c.redirectUrl || "";

            // Render schedule windows
            renderPresetSchedules(c.schedules || []);

            // Active days
            const daysGrid = $("p-days-grid");
            const activeDays = Array.isArray(c.activeDays) ? c.activeDays : [0,1,2,3,4,5,6];
            daysGrid.querySelectorAll(".p-day-cb").forEach(cb => {
                cb.checked = activeDays.includes(parseInt(cb.value));
                updateCheckboxLabelStyle(cb);
            });

            $("add-preset-modal-title").textContent = t_("editBlockPreset");
        } else {
            // New preset
            $("p-id").value = "";
            $("p-preset-name").value = "";
            $("p-preset-name").disabled = false;
            $("p-mode-focus").checked = false;
            $("p-mode-limit").checked = false;
            $("p-lim").value = 30;
            $("p-mode-schedule").checked = false;
            $("p-mode-cooldown").checked = false;
            $("p-cd-wait").value = 10;
            $("p-cd-freq").value = "everyVisit";
            $("p-mode-session").checked = false;
            $("p-session-limit").value = 5;
            $("p-session-cooldown").value = 10;
            $("p-redir").value = "";

            renderPresetSchedules([]);

            const daysGrid = $("p-days-grid");
            daysGrid.querySelectorAll(".p-day-cb").forEach(cb => {
                cb.checked = true;
                updateCheckboxLabelStyle(cb);
            });

            $("add-preset-modal-title").textContent = t_("createBlockPreset");
        }

        // Trigger styles/displays
        triggerModalSubSections();
        modal.classList.remove("hide");
    }

    function updateCheckboxLabelStyle(cb) {
        const lbl = cb.closest('label') || cb.parentElement;
        if (lbl) {
            lbl.style.background = cb.checked ? 'var(--green-bg)' : '';
            lbl.style.borderColor = cb.checked ? 'var(--green-bd)' : '';
            lbl.style.color = cb.checked ? 'var(--green)' : '';
        }
    }

    function triggerModalSubSections() {
        $("pf-tl").style.display = $("p-mode-limit").checked ? "block" : "none";
        $("pf-sc").style.display = $("p-mode-schedule").checked ? "block" : "none";
        $("pf-cd").style.display = $("p-mode-cooldown").checked ? "block" : "none";
        $("pf-session").style.display = $("p-mode-session").checked ? "block" : "none";
    }

    function getPresetSchedules() {
        const slots = [];
        const container = $("p-schedule-slots");
        if (container) {
            container.querySelectorAll(".sched-slot").forEach(slot => {
                const start = slot.querySelector(".sched-start")?.value;
                const end = slot.querySelector(".sched-end")?.value;
                if (start && end) {
                    slots.push({ start, end });
                }
            });
        }
        return slots;
    }

    function renderPresetSchedules(schedules) {
        const container = $("p-schedule-slots");
        if (!container) return;
        setSafeHTML(container, "");

        const items = schedules.length ? schedules : [{ start: "09:00", end: "21:00" }];
        items.forEach((s, idx) => {
            const slot = document.createElement("div");
            slot.className = "sched-slot";
            slot.style.cssText = "display:flex; align-items:center; gap:8px; margin-top:8px;";
            setSafeHTML(slot, `
                <input type="time" class="inp sched-start" value="${s.start}" style="flex:1; padding:8px;" />
                <span style="color:var(--tx3)">to</span>
                <input type="time" class="inp sched-end" value="${s.end}" style="flex:1; padding:8px;" />
                <button class="bs btn-del-p-sched" style="padding:8px 12px; font-size:13px; color:var(--red); font-weight:bold;" aria-label="Delete time window">✕</button>
            `);
slot.querySelector(".btn-del-p-sched").addEventListener("click", () => {
                slot.remove();
            });
            container.appendChild(slot);
        });
    }



    // Modal save action
    async function savePreset() {
        const id = $("p-id").value;
        const name = $("p-preset-name").value.trim();
        if (!name) {
            toast(t_("presetNameRequired"), "er");
            return;
        }

        const isNew = !id;
        
        // Count custom presets (max 3 custom presets allowed)
        const customPresetsCount = blockPresetsList.filter(p => p.id !== id).length;
        if (isNew && customPresetsCount >= 3) {
            toast(t_("maxCustomPresetsLimit"), "er");
            return;
        }

        const schedules = getPresetSchedules();
        const activeDays = Array.from(document.querySelectorAll('.p-day-cb')).filter(cb => cb.checked).map(cb => parseInt(cb.value));
        
        const limVal = parseInt($("p-lim").value, 10);
        const dailyLimitSecs = $("p-mode-limit").checked ? limVal * 60 : 0;
        const instantBlock = $("p-mode-limit").checked && dailyLimitSecs === 0;

        const config = {
            instantBlock,
            focusOnly: $("p-mode-focus").checked,
            timeLimitEnabled: $("p-mode-limit").checked && dailyLimitSecs > 0,
            dailyLimitSecs,
            scheduleEnabled: $("p-mode-schedule").checked,
            schedules,
            cooldownEnabled: $("p-mode-cooldown").checked,
            cooldownTimer: parseInt($("p-cd-wait").value, 10) || 10,
            cooldownFrequency: $("p-cd-freq").value || "everyVisit",
            sessionLimitEnabled: $("p-mode-session").checked,
            sessionLimitSecs: ($("p-mode-session").checked ? parseInt($("p-session-limit").value, 10) : 5) * 60,
            sessionCooldownSecs: ($("p-mode-session").checked ? parseInt($("p-session-cooldown").value, 10) : 10) * 60,
            activeDays: activeDays.length === 7 ? [0,1,2,3,4,5,6] : activeDays,
            redirectUrl: $("p-redir").value.trim() || null
        };

        if (isNew) {
            const newPreset = {
                id: "preset_" + Date.now(),
                name,
                isDefault: false,
                config
            };
            if (window.__editingSlotIdx !== undefined && window.__editingSlotIdx >= 0 && window.__editingSlotIdx < 3) {
                blockPresetsList[window.__editingSlotIdx] = newPreset;
            } else {
                blockPresetsList.push(newPreset);
            }
        } else {
            const pIdx = blockPresetsList.findIndex(x => x.id === id);
            if (pIdx !== -1) {
                blockPresetsList[pIdx].name = name;
                blockPresetsList[pIdx].config = config;
            }
        }

        window.__editingSlotIdx = undefined;
        blockPresetsList = blockPresetsList.filter(x => x !== null);

        await sLocal({ blockPresets: blockPresetsList });
        loadAndRenderPresets();
        $("add-preset-modal").classList.add("hide");
        toast(isNew ? t_("presetCreated") : t_("presetUpdated"), "ok");
    }

    // Modal events
    function wirePresetEvents() {
        $("add-preset-modal-close")?.addEventListener("click", () => {
            window.__editingSlotIdx = undefined;
            $("add-preset-modal").classList.add("hide");
        });

        $("btn-cancel-preset")?.addEventListener("click", () => {
            window.__editingSlotIdx = undefined;
            $("add-preset-modal").classList.add("hide");
        });

        $("btn-save-preset")?.addEventListener("click", savePreset);

        // Checkbox events
        ["p-mode-focus", "p-mode-limit", "p-mode-schedule", "p-mode-cooldown", "p-mode-session"].forEach(id => {
            $(id)?.addEventListener("change", triggerModalSubSections);
        });

        // Add window button
        $("add-p-sched-slot")?.addEventListener("click", () => {
            const container = $("p-schedule-slots");
            if (!container) return;
            const slot = document.createElement("div");
            slot.className = "sched-slot";
            slot.style.cssText = "display:flex; align-items:center; gap:8px; margin-top:8px;";
            setSafeHTML(slot, `
                <input type="time" class="inp sched-start" value="09:00" style="flex:1; padding:8px;" />
                <span style="color:var(--tx3)">to</span>
                <input type="time" class="inp sched-end" value="17:00" style="flex:1; padding:8px;" />
                <button class="bs btn-del-p-sched" style="padding:8px 12px; font-size:13px; color:var(--red); font-weight:bold;" aria-label="Delete time window">✕</button>
            `);
slot.querySelector(".btn-del-p-sched").addEventListener("click", () => {
                slot.remove();
            });
            container.appendChild(slot);
        });

        // Active day grid change styling
        document.querySelectorAll('.p-day-cb').forEach(cb => {
            cb.addEventListener('change', function () {
                updateCheckboxLabelStyle(this);
            });
        });

        // Apply dropdown selection in Rule Editor Modal
        const applyPresetSelect = $("m-apply-preset");
        if (applyPresetSelect) {
            applyPresetSelect.addEventListener("change", () => {
                const presetId = applyPresetSelect.value;
                if (!presetId) return;

                const p = blockPresetsList.find(x => x.id === presetId);
                if (!p) return;

                const c = p.config || {};
                $("m-mode-focus").checked = !!c.focusOnly;
                
                let isTimeLimit = !!c.timeLimitEnabled || !!c.instantBlock;
                $("m-mode-limit").checked = isTimeLimit;
                $("m-lim").value = c.instantBlock ? 0 : Math.round((c.dailyLimitSecs || 1800)/60);
                
                $("m-mode-schedule").checked = !!c.scheduleEnabled;
                $("m-mode-cooldown").checked = !!c.cooldownEnabled;
                $("m-cd-wait").value = c.cooldownTimer || 10;
                $("m-cd-freq").value = normalizeCdFreq(c.cooldownFrequency);

                $("m-mode-session").checked = !!c.sessionLimitEnabled;
                $("m-session-limit").value = c.sessionLimitSecs ? Math.round(c.sessionLimitSecs / 60) : 5;
                $("m-session-cooldown").value = c.sessionCooldownSecs ? Math.round(c.sessionCooldownSecs / 60) : 10;
                
                $("cat-redir").value = c.redirectUrl || "";

                // Populate schedules in the main rule modal
                if (typeof renderScheduleSlots === "function") {
                    renderScheduleSlots(c.schedules || []);
                }

                // Populate active days in the main rule modal
                const activeDays = Array.isArray(c.activeDays) ? c.activeDays : [0,1,2,3,4,5,6];
                document.querySelectorAll('.m-day-cb').forEach(cb => {
                    cb.checked = activeDays.includes(parseInt(cb.value));
                    const lbl = cb.closest('label') || cb.parentElement;
                    if (lbl) {
                        lbl.style.background = cb.checked ? 'var(--green-bg)' : '';
                        lbl.style.borderColor = cb.checked ? 'var(--green-bd)' : '';
                        lbl.style.color = cb.checked ? 'var(--green)' : '';
                    }
                });

                // Update visibility of collapsible rule settings
                $("mf-tl").style.display = isTimeLimit ? "block" : "none";
                $("mf-sc").style.display = c.scheduleEnabled ? "block" : "none";
                $("mf-cd").style.display = c.cooldownEnabled ? "block" : "none";
                $("mf-session").style.display = c.sessionLimitEnabled ? "block" : "none";

                toast(t_("appliedPreset", [p.name]), "ok");
            });
        }
    }



    // --- Init ---
    function init() {
        wirePresetEvents();
        loadAndRenderPresets();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        setTimeout(init, 300);
    }
})();
