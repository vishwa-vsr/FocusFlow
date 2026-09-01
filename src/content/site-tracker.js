// FocusFlow — Site Tracker & Cool-down (content script)
// Runs at document_start. Responsibilities:
//   1) If domain is on the cool-down list → show a configurable overlay before allowing access.
//   2) Send active interaction heartbeats and listen for 1-minute warning nudges.
(async () => {
  if (!chrome?.runtime?.id) return;
  const href = location.href;
  if (!/^https?:/.test(href)) return;
  if (href.startsWith(chrome.runtime.getURL(""))) return;
  const host = location.hostname.replace(/^www\./, "");

  const safeBtoa = (str) => {
    try {
      return btoa(str);
    } catch (e) {
      return str;
    }
  };

// Bug 1 fix: guard against double-injection on fast refresh in SPAs
  if (window.__ffCooldownActive) return;
  window.__ffCooldownActive = true;

  // Fast check: is this current website actually tracked or governed by any rules?
  const fastCfg = await new Promise((res) =>
    chrome.storage.local.get(["ruleDomainsCache", "neverTrackDomains", "privacyModeActive", "allowList"], (r) => res(r || {}))
  );

  const allowList = fastCfg.allowList || [];
  const isAllowListed = allowList.some((d) => {
    const lowerD = String(d).toLowerCase().trim();
    return host === lowerD || host.endsWith("." + lowerD);
  });

  if (fastCfg.privacyModeActive === true || isAllowListed) {
    window.__ffCooldownActive = false;
    return;
  }

  // FF v6.18: Notify the SW when the browser is minimized/restored (only for active tracked pages).
  const _sendVisibility = (state) => {
    try {
      if (chrome?.runtime?.id) {
        chrome.runtime.sendMessage({ type: state === "visible" ? "TRACKING_VISIBILITY_VISIBLE" : "TRACKING_VISIBILITY_HIDDEN", domain: host }).catch(() => {});
      }
    } catch (_) {}
  };
  document.addEventListener("visibilitychange", () => {
    _sendVisibility(document.visibilityState);
  });
  // Fire once to establish correct visibility state on load for this tracked page.
  _sendVisibility(document.visibilityState);

  let hasRules = true;
  if (fastCfg.ruleDomainsCache !== undefined) {
    const ruleDomains = fastCfg.ruleDomainsCache || [];
    const hostLower = host.toLowerCase().trim();
    hasRules = ruleDomains.some((d) => hostLower === d || hostLower.endsWith("." + d));
  }

  if (!hasRules) {
    window.__ffCooldownActive = false;
    return;
  }

  // Lazy-load detailed rules only for rule-governed domains (or if cache is uninitialized)
  const ruleDetails = await new Promise((res) =>
    chrome.storage.local.get(["cooldownConfig", "blockRules", "granularRules"], (r) => res(r || {}))
  );
  Object.assign(fastCfg, ruleDetails);

  const cdConf1 = fastCfg.cooldownConfig || {};
  const cooldowns = (cdConf1.activeDomains || []).map((d) => String(d).toLowerCase().trim()).filter(Boolean);
  const blockRules = fastCfg.blockRules || [];

  // Check if this domain is tracked or matches any cooldowns or block rules
  const isCooldown = cooldowns.some((d) => host === d || host.endsWith("." + d));
  const isBlocked = blockRules.some((r) => r.domain && (host === r.domain.toLowerCase() || host.endsWith("." + r.domain.toLowerCase())));


  // ---- Advanced Reddit Shadow DOM Hiding ----
  if (host === "reddit.com") {
    let rdRules = (fastCfg.granularRules && fastCfg.granularRules["reddit.com"]) || {};

    const findInShadows = (selector) => {
      const found = [];
      // Optimization: Instead of searching every element on the page with '*',
      // we only look inside custom elements that are known to host shadow roots.
      const targetTags = [
        'shreddit-app', 'reddit-sidebar-nav', 'left-nav-top-section', 
        'reddit-recent-pages', 'faceplate-tracker'
      ];
      const search = (root) => {
        if (!root) return;
        try {
          const matched = root.querySelectorAll(selector);
          matched.forEach(el => {
            if (!found.includes(el)) found.push(el);
          });
        } catch (e) {}
        try {
          targetTags.forEach(tag => {
            const elements = root.querySelectorAll(tag);
            elements.forEach(el => {
              if (el.shadowRoot) {
                search(el.shadowRoot);
              }
            });
          });
        } catch (e) {}
      };
      search(document);
      return found;
    };

    const isSidebarRoot = (el) => {
      if (!el) return false;
      const tag = el.tagName.toUpperCase();
      const id = (el.id || "").toLowerCase();
      return tag === 'REDDIT-SIDEBAR-NAV' || 
             tag === 'LEFT-NAV-TOP-SECTION' || 
             tag === 'NAV' || 
             id.includes('sidebar') || 
             id === 'left-sidebar';
    };

    const showRedditElements = () => {
      const recents = findInShadows('reddit-recent-pages, #recent-communities-section');
      recents.forEach(recent => {
        recent.style.removeProperty('display');
        if (recent.parentElement && recent.parentElement.parentElement) {
          recent.parentElement.parentElement.style.removeProperty('display');
          recent.parentElement.style.removeProperty('display');
        }
      });

      const comms = findInShadows('#communities_section');
      comms.forEach(comm => {
        comm.style.removeProperty('display');
        if (comm.parentElement && comm.parentElement.parentElement) {
          comm.parentElement.parentElement.style.removeProperty('display');
          comm.parentElement.style.removeProperty('display');
        }
      });

      const pops = findInShadows('#popular-posts');
      pops.forEach(pop => pop.style.removeProperty('display'));

      const exps = findInShadows('#explore-communities');
      exps.forEach(exp => exp.style.removeProperty('display'));

      const leftTops = findInShadows('left-nav-top-section');
      leftTops.forEach(host => {
        if (host.shadowRoot) {
          const items = host.shadowRoot.querySelectorAll('faceplate-tracker');
          items.forEach(item => item.style.removeProperty('display'));
        }
      });
    };

    const hideRedditTweaks = () => {
      if (rdRules["rd-recent-communities"]) {
        const recents = findInShadows('reddit-recent-pages, #recent-communities-section');
        recents.forEach(recent => {
          recent.style.setProperty('display', 'none', 'important');
          if (recent.parentElement && recent.parentElement.parentElement) {
            if (!isSidebarRoot(recent.parentElement.parentElement)) {
              recent.parentElement.parentElement.style.setProperty('display', 'none', 'important');
            } else if (!isSidebarRoot(recent.parentElement)) {
              recent.parentElement.style.setProperty('display', 'none', 'important');
            }
          }
        });

        const comms = findInShadows('#communities_section');
        comms.forEach(comm => {
          if (comm.parentElement && comm.parentElement.parentElement) {
            if (!isSidebarRoot(comm.parentElement.parentElement)) {
              comm.parentElement.parentElement.style.setProperty('display', 'none', 'important');
            } else if (!isSidebarRoot(comm.parentElement)) {
              comm.parentElement.style.setProperty('display', 'none', 'important');
            }
          } else {
            comm.style.setProperty('display', 'none', 'important');
          }
        });
      }

      if (rdRules["rd-popular"]) {
        const pops = findInShadows('#popular-posts');
        pops.forEach(pop => {
          pop.style.setProperty('display', 'none', 'important');
        });

        const exps = findInShadows('#explore-communities');
        exps.forEach(exp => {
          exp.style.setProperty('display', 'none', 'important');
        });

        const leftTops = findInShadows('left-nav-top-section');
        leftTops.forEach(host => {
          if (host.shadowRoot) {
            const items = host.shadowRoot.querySelectorAll('faceplate-tracker');
            items.forEach((item, index) => {
              if (index >= 1 && index <= 3) {
                item.style.setProperty('display', 'none', 'important');
              }
            });
          }
        });
      }
    };

    let hideTimeout = null;
    const triggerHide = () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = setTimeout(hideRedditTweaks, 200);
    };

    let observer = null;
    const startObserving = () => {
      if (observer) return;
      observer = new MutationObserver(() => triggerHide());
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true
      });
    };

    const stopObserving = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const updateState = () => {
      const anyActive = rdRules["rd-recent-communities"] || rdRules["rd-popular"];
      if (anyActive) {
        startObserving();
        triggerHide();
      } else {
        stopObserving();
        showRedditElements();
      }
    };

    // Initialize
    updateState();
    document.addEventListener("DOMContentLoaded", () => updateState());

    // Listen for rule changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.granularRules) {
        const newRules = changes.granularRules.newValue || {};
        rdRules = newRules["reddit.com"] || {};
        updateState();
      }
    });
  }

  // ---- Active Interaction Heartbeats & Nudge Listeners (Always enabled if rules exist) ----
  const showNudgePopup = (seconds) => {
    if (document.getElementById("ff-nudge")) return;
    if (!document.body || !document.head) return;
    const t = document.createElement("div");
    t.id = "ff-nudge";
    t.style.cssText = "position:fixed;top:0;left:0;width:100%;background:#121212;color:#f8fafc;text-align:center;padding:12px;font-family:system-ui,-apple-system,sans-serif;font-weight:600;font-size:14px;z-index:2147483647;border-bottom:2px solid #F46B7A;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:ff-slide 0.5s ease;";
    const e = document.createElement("span");
    
    let timeText = seconds >= 60 ? `${Math.round(seconds / 60)} minute${Math.round(seconds / 60) > 1 ? "s" : ""}` : `${seconds} seconds`;
    e.textContent = `Flow: ${timeText} remaining for this site. Wrap it up!`;
    
    const a = document.createElement("button");
    a.id = "ff-nudge-x";
    a.textContent = "✕";
    a.style.cssText = "margin-left:16px;background:none;border:none;color:#94a3b8;cursor:pointer;font-weight:bold;";
    a.addEventListener("click", () => t.remove());
    t.appendChild(e);
    t.appendChild(a);
    document.body.appendChild(t);
    const s = document.createElement("style");
    s.textContent = "@keyframes ff-slide { from { transform: translateY(-100%); } to { transform: translateY(0); } }";
    document.head.appendChild(s);
    setTimeout(() => t.remove(), 1e4);
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SHOW_NUDGE") {
      showNudgePopup(msg.seconds || 60);
    }
  });

  const neverTrack = fastCfg.neverTrackDomains || [];
  let isNeverTracked = neverTrack.some((d) => host === d.toLowerCase() || host.endsWith("." + d.toLowerCase()));
  let isPrivacyActive = fastCfg.privacyModeActive === true;

  chrome.storage.onChanged.addListener((changes, area) => {
    let changed = false;
    if (area === "local") {
      if (changes.neverTrackDomains) {
        const newNever = changes.neverTrackDomains.newValue || [];
        isNeverTracked = newNever.some((d) => host === d.toLowerCase() || host.endsWith("." + d.toLowerCase()));
        changed = true;
      }
      if (changes.privacyModeActive) {
        isPrivacyActive = changes.privacyModeActive.newValue === true;
        changed = true;
      }
      if (changed) {
        if (isNeverTracked || isPrivacyActive) {
          stopHeartbeat();
        } else if (document.visibilityState === "visible") {
          startHeartbeat();
        }
      }
    }
  });

  let lastHeartbeat = Date.now();
  let lastInteract = Date.now();

  const pingInteractions = () => {
    const now = Date.now();
    // Throttled to at most once per second to prevent high event listener CPU usage
    if (now - lastInteract >= 1000) {
      lastInteract = now;
    }
  };
  window.addEventListener("mousemove", pingInteractions, { passive: true });
  window.addEventListener("scroll", pingInteractions, { passive: true });
  window.addEventListener("keydown", pingInteractions, { passive: true });
  window.addEventListener("touchstart", pingInteractions, { passive: true });

  let heartbeatTimer = null;
  const startHeartbeat = () => {
    if (isNeverTracked || isPrivacyActive) return;
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (isNeverTracked || isPrivacyActive) {
        stopHeartbeat();
        return;
      }
      const now = Date.now();
      if (document.visibilityState === "visible" && (now - lastInteract < 30000)) {
        const elapsed = Math.round((now - lastHeartbeat) / 1000);
        if (elapsed > 0 && elapsed <= 15) {
          try {
            chrome.runtime.sendMessage({
              type: "TRACKING_HEARTBEAT",
              domain: host,
              elapsed: elapsed
            }).catch(() => {});
          } catch (e) {
            stopHeartbeat();
          }
        }
      }
      lastHeartbeat = now;
    }, 10000);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  // Start heartbeat only if the tab is visible initially
  if (document.visibilityState === "visible") {
    startHeartbeat();
  }

  document.addEventListener("visibilitychange", () => {
    if (isNeverTracked) return;
    if (document.visibilityState === "visible") {
      lastHeartbeat = Date.now();
      startHeartbeat();
    } else {
      stopHeartbeat();
    }
  });

  // ---- Media Playback Detection (Passive Tab Tracking) ----
  let lastMediaPingTime = 0;
  const sendMediaPing = () => {
    if (isNeverTracked) return;
    try {
      if (chrome?.runtime?.id) {
        chrome.runtime.sendMessage({ type: "MEDIA_PING" }).catch(() => {});
      }
    } catch (_) {}
  };
  document.addEventListener("play", (e) => {
    if (e.target instanceof HTMLMediaElement) {
      sendMediaPing();
    }
  }, { capture: true, passive: true });
  document.addEventListener("timeupdate", (e) => {
    if (e.target instanceof HTMLMediaElement && !e.target.paused) {
      const now = Date.now();
      if (now - lastMediaPingTime >= 10000) {
        lastMediaPingTime = now;
        sendMediaPing();
      }
    }
  }, { capture: true, passive: true });

  // ---- 2. Cool-down overlay (Isolated check) ----
  const matchedBlockDomain = Object.keys(cdConf1.blockActive || {}).find(d => host === d || host.endsWith("." + d));
  if (matchedBlockDomain) {
    let blockTarget = cdConf1.blockActive[matchedBlockDomain];
    if (blockTarget) {
      if (blockTarget.startsWith("/blocked/")) {
        const [path, query] = blockTarget.split("?");
        const relativePath = path.startsWith("/") ? path.slice(1) : path;
        const separator = query ? "&" : "?";
        blockTarget = chrome.runtime.getURL(relativePath) + (query ? "?" + query : "") + separator + "d=" + safeBtoa(host);
      } else if (!blockTarget.startsWith("http")) {
        blockTarget = "https://" + blockTarget;
      }
      location.replace(blockTarget);
      return;
    }
  }

  const matchedDomain = cooldowns.find((d) => host === d || host.endsWith("." + d));
  if (!matchedDomain) return;

  const cdCfg = await new Promise((res) =>
    chrome.storage.local.get(["cooldownPassedAt", "cooldownConfig"], (r) => res(r || {}))
  );
  const passed = cdCfg.cooldownPassedAt || {};
  const cdConf2 = cdCfg.cooldownConfig || {};
  const allSettings = cdConf2.settings || {};
  const allReasons = cdConf2.reasons || {};
  const blockActive = cdConf2.blockActive || {};

  const siteCfg   = allSettings[matchedDomain] || {};
  const timerSecs = Math.max(1, Math.min(120, Number(siteCfg.timer) || 10));
  let frequency = siteCfg.frequency || "every10min";
  if (frequency === "always") frequency = "everyVisit";
  if (frequency === "daily") frequency = "oncePerDay";
  if (frequency === "session") frequency = "every10min";
  if (!["everyVisit", "every10min", "oncePerDay"].includes(frequency)) {
    frequency = "every10min";
  }

  const lastPassed = passed[host] || 0;
  const now = Date.now();
  let showOverlayNow = true;
  if (frequency === "every10min" || frequency === "session") {
    if (now - lastPassed < 10 * 60 * 1000) showOverlayNow = false;
  } else if (frequency === "oncePerDay" || frequency === "daily") {
    if (new Date(lastPassed).toDateString() === new Date().toDateString()) showOverlayNow = false;
  }

  if (!showOverlayNow) {
    let blockTarget = blockActive[matchedDomain];
    if (blockTarget) {
      if (blockTarget.startsWith("/blocked/")) {
        const [path, query] = blockTarget.split("?");
        const relativePath = path.startsWith("/") ? path.slice(1) : path;
        const separator = query ? "&" : "?";
        blockTarget = chrome.runtime.getURL(relativePath) + (query ? "?" + query : "") + separator + "d=" + safeBtoa(host);
      } else if (!blockTarget.startsWith("http")) {
        blockTarget = "https://" + blockTarget;
      }
      location.replace(blockTarget);
      return;
    }
    return;
  }

  const showOverlay = () => {
    if (document.getElementById("ff-cooldown")) return;

    const wrap = document.createElement("div");
    wrap.id = "ff-cooldown";
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(8,8,12,0.96);" +
      "backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "font-family:system-ui,-apple-system,sans-serif;color:#fff;text-align:center;padding:24px;";

    const htmlString =
      '<div style="font-size:64px;margin-bottom:16px;">⏳</div>' +
      '<div style="font-size:28px;font-weight:800;margin-bottom:12px;">Take a breath…</div>' +
      '<div style="font-size:16px;color:#a1a1aa;margin-bottom:20px;max-width:420px;line-height:1.5;">' +
        'You set a cool-down on <strong style="color:#fff" id="ff-cd-host"></strong>. Still want to continue?' +
      '</div>' +
      '<div id="ff-cd-num" style="font-size:88px;font-weight:900;color:#F46B7A;line-height:1;' +
        'margin-bottom:24px;font-variant-numeric:tabular-nums;"></div>' +
      '<div style="display:flex;gap:12px;box-sizing:border-box !important;">' +
        '<div id="ff-cd-back" role="button" tabindex="0" style="' +
          'all:initial !important;box-sizing:border-box !important;font-family:system-ui,-apple-system,sans-serif !important;' +
          'background:#282828 !important;color:#fff !important;border:1px solid rgba(255,255,255,0.1) !important;' +
          'padding:14px 28px !important;border-radius:12px !important;font-size:15px !important;font-weight:700 !important;' +
          'cursor:pointer !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;' +
          'line-height:1.2 !important;height:auto !important;min-height:unset !important;user-select:none !important;">← Go back</div>' +
        '<div id="ff-cd-go" role="button" tabindex="0" style="' +
          'all:initial !important;box-sizing:border-box !important;font-family:system-ui,-apple-system,sans-serif !important;' +
          'background:rgba(244,107,122,0.15) !important;color:#F46B7A !important;border:1px solid rgba(244,107,122,0.3) !important;' +
          'padding:14px 28px !important;border-radius:12px !important;font-size:15px !important;font-weight:700 !important;' +
          'cursor:not-allowed !important;opacity:0.4 !important;display:inline-flex !important;align-items:center !important;' +
          'justify-content:center !important;line-height:1.2 !important;height:auto !important;min-height:unset !important;user-select:none !important;">Continue anyway</div>' +
      '</div>';

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");
    while (doc.body.firstChild) {
      wrap.appendChild(doc.body.firstChild);
    }

    const hostEl = wrap.querySelector("#ff-cd-host");
    if (hostEl) hostEl.textContent = host;

    const numEl = wrap.querySelector("#ff-cd-num");
    if (numEl) numEl.textContent = timerSecs;

    (document.body || document.documentElement).appendChild(wrap);

    const num         = document.getElementById("ff-cd-num");
    const go          = document.getElementById("ff-cd-go");

    document.getElementById("ff-cd-back").onclick = () => {
      if (history.length > 1) {
        history.back();
      } else {
        try {
          if (chrome?.runtime?.id) {
            chrome.runtime.sendMessage({ type: "CLOSE_CURRENT_TAB" }).catch(() => {});
          }
        } catch (_) {}
      }
    };

    let n = timerSecs;
    const tick = setInterval(() => {
      n--;
      num.textContent = n;
      if (n <= 0) {
        clearInterval(tick);
        num.textContent = "✓";
        num.style.color = "#05D581";
        go.style.setProperty("cursor", "pointer", "important");
        go.style.setProperty("opacity", "1", "important");
        go.style.setProperty("background", "rgba(5,213,129,0.15)", "important");
        go.style.setProperty("color", "#05D581", "important");
        go.style.setProperty("border-color", "rgba(5,213,129,0.3)", "important");
      }
    }, 1000);

    go.onclick = async () => {
      if (n > 0) return;
      if (!chrome?.runtime?.id) {
        location.reload();
        return;
      }
      try {
        const currentData = await new Promise((res) => chrome.storage.local.get(["cooldownPassedAt"], r => res(r || {})));
        const latestPassed = currentData.cooldownPassedAt || {};
        const updates = {
          cooldownPassedAt: { ...latestPassed, [host]: Date.now() },
        };
        chrome.storage.local.set(updates, () => {
          wrap.remove();
          let blockTarget = blockActive[matchedDomain];
          if (blockTarget) {
            if (blockTarget.startsWith("/blocked/")) {
              const [path, query] = blockTarget.split("?");
              const relativePath = path.startsWith("/") ? path.slice(1) : path;
              const separator = query ? "&" : "?";
              blockTarget = chrome.runtime.getURL(relativePath) + (query ? "?" + query : "") + separator + "d=" + safeBtoa(host);
            } else if (!blockTarget.startsWith("http")) {
              blockTarget = "https://" + blockTarget;
            }
            location.replace(blockTarget);
          }
        });
      } catch (err) {
        location.reload();
      }
    };
  };

  if (document.body) showOverlay();
  else document.addEventListener("DOMContentLoaded", showOverlay, { once: true });
})();
