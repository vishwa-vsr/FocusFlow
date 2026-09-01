// FF v6.16: gSync/sSync/gLocal/sLocal/todayKey live in src/lib/storage.js (loaded first).
// This file now only carries DOM/UI helpers used by popup + dashboard.

window.savedFavicons = {};
try {
    chrome.storage.local.get(["favicons"], (data) => {
        if (data && data.favicons) {
            window.savedFavicons = data.favicons;
        }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.favicons) {
            window.savedFavicons = changes.favicons.newValue || {};
        }
    });
} catch (_) {}

function $(e) {
    return document.getElementById(e)
}

function escHTML(e) {
    return String(e).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));
}

function sanitizeDomain(d) {
    if (!d) return "";
    return String(d).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

const _htmlTemplate = (typeof document !== "undefined") ? document.createElement("template") : null;

function setSafeHTML(el, html) {
    if (!el) return;
    el.textContent = "";
    
    // Fast path: standard HTML elements using native template cloning
    if (el.namespaceURI !== "http://www.w3.org/2000/svg" && el.tagName.toLowerCase() !== "svg") {
        if (_htmlTemplate) {
            _htmlTemplate.innerHTML = html;
            el.appendChild(_htmlTemplate.content.cloneNode(true));
            return;
        }
    }

    // Isolated path for SVG elements requiring SVG XML namespace
    const isSVG = el.namespaceURI === "http://www.w3.org/2000/svg" || el.tagName.toLowerCase() === "svg";
    const parser = new DOMParser();
    const doc = isSVG 
        ? parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${html}</svg>`, "image/svg+xml")
        : parser.parseFromString(html, "text/html");
    const container = isSVG ? doc.documentElement : doc.body;
    while (container && container.firstChild) {
        el.appendChild(container.firstChild);
    }
}

function fmt(e) {
    if (!e || e <= 0) return "0m";
    const m = Math.floor(e / 60);
    if (m < 60) return m + "m";
    const h = m / 60;
    if (h < 24) return (h === Math.floor(h) ? h : h.toFixed(1)) + "h";
    const d = Math.floor(h / 24), rh = Math.floor(h % 24);
    return rh > 0 ? d + "d " + rh + "h" : d + "d";
}



function fmtTimer(e) {
    return e = Math.max(0, e || 0), Math.floor(e / 60) + ":" + String(e % 60).padStart(2, "0")
}

async function hashPinStretched(pin, salt, iterations = 100000) {
    let current = pin + salt;
    for (let i = 0; i < iterations; i++) {
        const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(current));
        current = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return current;
}

async function hashPinPBKDF2(pin, saltHex, iterations = 10000) {
    const pinBytes = new TextEncoder().encode(pin);
    const saltBytes = new Uint8Array((saltHex.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16)));
    const baseKey = await crypto.subtle.importKey(
        "raw",
        pinBytes,
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: iterations,
            hash: "SHA-256"
        },
        baseKey,
        256
    );
    return Array.from(new Uint8Array(derivedBits))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

function generateRandomSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPinOld(e) {
    var t = await crypto.subtle.digest("SHA-256", (new TextEncoder).encode(e));
    return Array.from(new Uint8Array(t)).map(e => e.toString(16).padStart(2, "0")).join("")
}

async function hashPin(e) {
    const salt = generateRandomSalt();
    const stretched = await hashPinPBKDF2(e, salt, 10000);
    return `v3:10000:${salt}:${stretched}`;
}

async function verifyAndMigratePin(pin, storedHash) {
    if (!storedHash) return { success: false };
    if (storedHash.startsWith("v3:")) {
        const parts = storedHash.split(":");
        let iterations = 100000;
        let salt = "";
        let target = "";
        if (parts.length === 4) {
            iterations = parseInt(parts[1], 10);
            salt = parts[2];
            target = parts[3];
        } else {
            salt = parts[1];
            target = parts[2];
        }
        const computed = await hashPinPBKDF2(pin, salt, iterations);
        if (computed === target) {
            if (iterations !== 10000) {
                const newSalt = generateRandomSalt();
                const newHash = await hashPinPBKDF2(pin, newSalt, 10000);
                const migratedHash = `v3:10000:${newSalt}:${newHash}`;
                return { success: true, migratedHash: migratedHash };
            }
            return { success: true, migratedHash: null };
        }
        return { success: false };
    }
    if (storedHash.startsWith("v2:")) {
        const parts = storedHash.split(":");
        const salt = parts[1];
        const target = parts[2];
        const computed = await hashPinStretched(pin, salt, 100000);
        if (computed === target) {
            const newSalt = generateRandomSalt();
            const newHash = await hashPinPBKDF2(pin, newSalt, 10000);
            const migratedHash = `v3:10000:${newSalt}:${newHash}`;
            return { success: true, migratedHash: migratedHash };
        }
        return { success: false };
    }
    if (storedHash.startsWith("v1:")) {
        const parts = storedHash.split(":");
        const salt = parts[1];
        const target = parts[2];
        const computed = await hashPinStretched(pin, salt, 1000);
        if (computed === target) {
            const newSalt = generateRandomSalt();
            const newHash = await hashPinPBKDF2(pin, newSalt, 10000);
            const migratedHash = `v3:10000:${newSalt}:${newHash}`;
            return { success: true, migratedHash: migratedHash };
        }
        return { success: false };
    }
    const oldComputed = await hashPinOld(pin);
    if (oldComputed === storedHash) {
        const newSalt = generateRandomSalt();
        const newHash = await hashPinPBKDF2(pin, newSalt, 10000);
        const migratedHash = `v3:10000:${newSalt}:${newHash}`;
        return { success: true, migratedHash: migratedHash };
    }
    return { success: false };
}

function shouldFetchFavicon(domain) {
    if (!domain) return false;
    const isLocal = !domain.includes(".") || 
                    domain === "localhost" || 
                    domain === "newtab" || 
                    domain.endsWith(".local") || 
                    domain.endsWith(".localhost") || 
                    domain.endsWith(".test") || 
                    domain.startsWith("127.") || 
                    domain.startsWith("192.168.") || 
                    domain.startsWith("10.");
    if (isLocal) return false;
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) return false;
    const host = domain.toLowerCase();
    const nonFavPatterns = [
        "doubleclick.net", "googlesyndication.com", "googleusercontent.com", 
        "ggpht.com", "redditstatic.com", "cloudfront.net", "fastly.net", 
        "akamaihd.net", "gvt1.com", "ytimg.com", "wp.com", "githubusercontent.com",
        "onclickprediction.com", "webtracker.online", "laobi.icu", 
        "adsmediaextensions.com", "ojrq.net", "gntd.us", "google-analytics.com", 
        "googletagmanager.com", "scorecardresearch.com", "hotjar.com",
        "adnxs.com", "adsystem.com", "adservice.google", "analytics.google",
        "microsoftonline.com"
    ];
    if (nonFavPatterns.some(p => host === p || host.endsWith("." + p))) {
        return false;
    }
    return true;
}

const ccTLDs = ["co", "com", "net", "org", "gov", "edu", "in", "ac", "ad", "ae", "af", "ag", "ai", "al", "am", "ao", "ar", "as", "at", "au", "aw", "ax", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bm", "bn", "bo", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cd", "cf", "cg", "ch", "ci", "ck", "cl", "cm", "cn", "cr", "cu", "cv", "cw", "cx", "cy", "cz", "de", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "eu", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gb", "gd", "ge", "gf", "gg", "gh", "gi", "gl", "gm", "gn", "gp", "gq", "gr", "gs", "gt", "gu", "gw", "gy", "hk", "hm", "hn", "hr", "ht", "hu", "id", "ie", "il", "im", "io", "iq", "ir", "is", "it", "je", "jm", "jo", "jp", "ke", "kg", "kh", "ki", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me", "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz", "na", "nc", "ne", "nf", "ng", "ni", "nl", "no", "np", "nr", "nu", "nz", "om", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pm", "pn", "pr", "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd", "se", "sg", "sh", "si", "sj", "sk", "sl", "sm", "sn", "so", "sr", "ss", "st", "su", "sv", "sx", "sy", "sz", "tc", "td", "tf", "tg", "th", "tj", "tk", "tl", "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "uk", "us", "uy", "uz", "va", "vc", "ve", "vg", "vi", "vn", "vu", "wf", "ws", "ye", "yt", "za", "zm", "zw"];

function getApexDomain(domainStr) {
    if (!domainStr) return "";
    const parts = domainStr.split(".");
    if (parts.length > 2) {
        const len = parts.length;
        const prev = parts[len - 2];
        if (ccTLDs.includes(prev) && len > 2) {
            return parts.slice(len - 3).join(".");
        } else {
            return parts.slice(len - 2).join(".");
        }
    }
    return domainStr;
}

function getFav(domain) {
    const escDom = domain ? escHTML(domain) : "";
    if (!domain || domain.startsWith("local:") || domain.startsWith("file:") || !shouldFetchFavicon(domain)) {
        return `<img src="${FALLBACK_ICON}" data-domain="${escDom}" class="ff-favicon" style="width:20px;height:20px;border-radius:4px;flex-shrink:0" />`;
    }
    const apex = getApexDomain(domain);
    let url = window.savedFavicons ? (window.savedFavicons[domain] || window.savedFavicons[apex]) : null;
    if (!url) {
        const isFirefox = chrome.runtime.getURL("").startsWith("moz-extension://");
        url = isFirefox ? FALLBACK_ICON : chrome.runtime.getURL(`_favicon/?pageUrl=http://${apex}&size=32`);
    }
    return `<img src="${escHTML(url)}" data-domain="${escDom}" class="ff-favicon" style="width:20px;height:20px;border-radius:4px;flex-shrink:0" />`;
}

// FF v6.7.0: merged improved error handling from dashboard.js — only retry
// on transient errors, not permanent ones like "Extension context invalidated".
function msg(e, t, retries = 3) {
    return new Promise(n => {
        try {
            chrome.runtime.sendMessage(Object.assign({
                type: e
            }, t || {}), res => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message || "";
                    console.warn("[FF msg]", e, errMsg);
                    // Only retry on transient errors; permanent invalidation should not loop
                    const isTransient = !errMsg.includes("Extension context invalidated") &&
                                       !errMsg.includes("The message port closed");
                    if (retries > 0 && isTransient) setTimeout(() => msg(e, t, retries - 1).then(n), 100);
                    else n(null);
                } else {
                    n(res);
                }
            });
        } catch (err) {
            const errMsg = (err && err.message) || "";
            const isTransient = !errMsg.includes("Extension context invalidated") &&
                               !errMsg.includes("The message port closed");
            if (retries > 0 && isTransient) setTimeout(() => msg(e, t, retries - 1).then(n), 100);
            else n(null);
        }
    });
}
async function applyTheme(e) {
    const t = await gLocal(["theme"]);
    let currentTheme = t ? t.theme : "dark";
    if (currentTheme === "custom" || currentTheme === "rain" || currentTheme === "mountain" || currentTheme === "cinematic") {
        currentTheme = "dark";
        await sLocal({ theme: "dark" });
    }
    const n = "light" === currentTheme;
    document.documentElement.classList.toggle("light", n);
    document.documentElement.classList.remove("cinematic", "custom");
    document.documentElement.setAttribute("data-os-theme", "nothing");

    const btn = e ? $(e) : $("btn-theme");
    if (btn) {
        btn.setAttribute("data-icon", n ? "sun" : "moon");
        if (typeof FlowIcons !== "undefined" && FlowIcons.get) {
            btn.innerHTML = FlowIcons.get(n ? "sun" : "moon", { size: 16 });
        }
    }
}
document.addEventListener("error", e => {
    if (e.target.tagName === "IMG") {
        const dom = e.target.dataset.domain;
        if (dom && (dom.startsWith("local:") || dom.startsWith("file:"))) {
            if (e.target.src !== FALLBACK_ICON) {
                e.target.src = FALLBACK_ICON;
            }
            return;
        }
        if (e.target.src !== FALLBACK_ICON) {
            e.target.src = FALLBACK_ICON;
        }
    }
}, !0);
