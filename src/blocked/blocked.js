// Flow v6.5 — Blocked Page
// New: show rule that fired, "unblock for 5 min" (PIN-gated), last productive site, rotating quotes.
(async function () {

if (typeof initI18n === "function") {
  await initI18n();
}
if (typeof translatePage === "function") {
  translatePage();
}
if (typeof applyTheme === "function") {
  applyTheme();
}

const MSGS = [];
for (var i = 1; i <= 8; i++) {
  MSGS.push({
    e: t_("blockedMsg" + i + "Emoji"),
    h: t_("blockedMsg" + i + "Head"),
    s: t_("blockedMsg" + i + "Sub")
  });
}

const RULE_LABELS = {
  instant: t_("ruleInstantBlock"),
  schedule: t_("ruleScheduleBlock"),
  time_limit: t_("ruleTimeLimitReached"),
  session_limit: t_("ruleSessionLimitReached"),
  manual: t_("ruleManuallyBlocked"),
  tweak: t_("ruleTweakBlocked"),
};

const RULE_DETAIL = {
  instant: t_("ruleDetailInstant"),
  schedule: t_("ruleDetailSchedule"),
  time_limit: t_("ruleDetailTimeLimit"),
  session_limit: t_("ruleDetailSessionLimit"),
  manual: t_("ruleDetailManual"),
  tweak: t_("ruleDetailTweak"),
};

// ── Parse params ──────────────────────────────────────────────────────────────
function safeAtob(str) {
  try {
    return atob(str);
  } catch (e) {
    return str;
  }
}
var qs = new URLSearchParams(window.location.search || "");
var hs = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
function P(k1, k2) { return qs.get(k1) || qs.get(k2) || hs.get(k1) || hs.get(k2) || ""; }
var rawDomain = P("domain", "d") || "";
var blockedDomain = "";
if (rawDomain) {
  var decoded = safeAtob(rawDomain);
  if (decoded && decoded.includes(".")) {
    blockedDomain = decoded;
  }
}
var reason = P("reason", "r") || "rule";
var limit = Number(P("limit", "l") || 0);

// ── Randomise message (Funny vs. Neutral) ─────────────────────────────────────
gSync(["settings"]).then(function (res) {
  var settings = res.settings || {};
  var funnyBlocked = settings.funnyBlocked !== false;
  if (funnyBlocked) {
    var m = MSGS[Math.floor(Math.random() * MSGS.length)];
    document.getElementById("emoji").textContent = m.e;
    document.getElementById("headline").textContent = m.h;
    document.getElementById("sub").textContent = m.s;
  } else {
    document.getElementById("emoji").textContent = "⛔";
    setSafeHTML(document.getElementById("headline"), t_("neutralBlockHead"));
    document.getElementById("sub").textContent = t_("neutralBlockSub");
  }
});

const quoteIndex = Math.floor(Math.random() * 11) + 1;
const quoteText = t_("quote" + quoteIndex);
document.querySelector(".quote").textContent = quoteText && quoteText !== ("quote" + quoteIndex) ? quoteText : (QUOTES[quoteIndex - 1] || QUOTES[0]);

// ── Domain pill & bar reason ──────────────────────────────────────────────────
document.getElementById("domain-pill").textContent = blockedDomain || t_("thisSite");
document.getElementById("bar-reason").textContent = RULE_LABELS[reason] || t_("blockRuleActive");

// ── Badge — shows which rule fired + any detail ───────────────────────────────
function formatTime12(timeStr) {
  if (!timeStr) return "";
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return displayH + ":" + mStr + " " + ampm;
}

var badge = document.getElementById("badge");
var schedEnd = P("sched_end");
var cooldownEnds = Number(P("cooldown_ends") || 0);

if (reason === "time_limit" && limit > 0) {
  badge.textContent = t_("dailyLimitBadge", [String(Math.round(limit / 60))]);
} else if (reason === "schedule" && schedEnd) {
  badge.textContent = t_("blockedUntil", [formatTime12(schedEnd)]);
} else if (reason === "session_limit" && cooldownEnds > 0) {
  function tickCooldown() {
    var diff = Math.max(0, Math.round((cooldownEnds - Date.now()) / 1000));
    if (diff <= 0) {
      badge.textContent = t_("cooldownOver");
      badge.style.color = "var(--green)";
    } else {
      var m = Math.floor(diff / 60);
      var s = diff % 60;
      badge.textContent = t_("takeABreak", [m + "m " + String(s).padStart(2, "0") + "s"]);
      setTimeout(tickCooldown, 1000);
    }
  }
  tickCooldown();
} else {
  badge.textContent = RULE_LABELS[reason] || t_("blockedByFlow");
}
badge.className = "badge " + (RULE_LABELS[reason] ? reason : "");

// ── Rule detail ───────────────────────────────────────────────────────────────
var ruleDetail = document.getElementById("rule-detail");
if (ruleDetail) {
  if (reason === "schedule" && schedEnd) {
    ruleDetail.textContent = t_("blockedUntilSchedule", [formatTime12(schedEnd)]);
  } else {
    ruleDetail.textContent = RULE_DETAIL[reason] || t_("defaultRuleDetail");
  }
}

// ── Last productive site suggestion ──────────────────────────────────────────
try {
  msg("GET_LAST_PRODUCTIVE").then(function (res) {
    if (!res || !res.domain) return;
    var el = document.getElementById("productive-suggestion");
    if (!el) return;
    var safeDom = escHTML(res.domain);
    setSafeHTML(el, t_("goDoSomethingUseful") + ' <a href="https://' + safeDom + '" class="prod-link">' + safeDom + ' →</a>');
    el.style.display = "block";
  });
} catch (_) { }

// ── Back button ───────────────────────────────────────────────────────────────
document.getElementById("btn-back").addEventListener("click", async function () {
  if (window.history.length > 2) {
      window.history.back();
      return;
  }
  try {
      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
          const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (currentTab && currentTab.id) {
              await chrome.tabs.remove(currentTab.id);
              return;
          }
      }
  } catch (_) {}
  window.location.href = "https://www.google.com";
});

document.getElementById("btn-set").addEventListener("click", function () {
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ url: chrome.runtime.getURL("dashboard/index.html*") }, function (tabs) {
      if (tabs && tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url: chrome.runtime.getURL("dashboard/index.html#sitemanager"), active: true });
        if (tabs[0].windowId) {
          chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html#sitemanager") });
      }
    });
  } else {
    chrome.runtime.openOptionsPage();
  }
});

})();


