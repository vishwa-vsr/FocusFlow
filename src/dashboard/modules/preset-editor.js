/**
 * Preset Edit Modal Manager for Flow Dashboard
 * Controls the popup window for editing timer preset settings.
 */

import { sanitizeDomain } from "./utils-helpers.js";
import { getPresetName } from "./category-helpers.js";

export function showEditPresetModal(presetId, state, options = {}) {
    const old = document.getElementById("ff-preset-edit-modal");
    if (old) old.remove();

    const p = state.list.find((x) => x.id === presetId);
    if (!p) return;

    const t = (typeof t_ === "function") ? t_ : (k => k);

    const modalHeaderIcon = `<span style="font-size:24px;">${sanitizeDomain(p.emoji || '')}</span>`;

    const overlay = document.createElement("div");
    overlay.id = "ff-preset-edit-modal";
    overlay.className = "overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ep-title");
    
    if (typeof setSafeHTML === "function") {
        setSafeHTML(overlay, `
        <div class="card" style="width:100%; max-width:460px; padding:0; display:flex; flex-direction:column; max-height:85vh; overflow:hidden;">
          <div style="padding:24px 32px 16px; border-bottom:1px solid var(--bd); display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
            <div style="font-size:20px; font-weight:800; color:var(--tx); display:flex; align-items:center; gap:10px;">
              ${modalHeaderIcon}
              <span id="ep-title">${t("editPreset") || "Edit Preset"}</span>
            </div>
            <button id="ep-close" aria-label="Close Edit Preset Modal" style="background:none; border:none; color:var(--tx3); cursor:pointer; padding:4px; display:inline-flex; align-items:center; justify-content:center;">
              ${FlowIcons.get("close", { size: 18 })}
            </button>
          </div>
          
          <div style="padding:24px 32px; display:flex; flex-direction:column; gap:20px; overflow-y:auto; flex:1;">
            <div class="srow">
              <label for="ep-name" class="slbl">${t("presetName") || "Preset Name"}</label>
              <input type="text" id="ep-name" class="inp" style="width:100%" value="${sanitizeDomain(getPresetName(p.id, p.name) || '')}"/>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              <div class="srow">
                <label for="ep-work" class="slbl">${t("workTimeMin") || "Work Time (min)"}</label>
                <input type="number" id="ep-work" class="num inp" min="1" max="180" style="width:100%" value="${p.work}"/>
              </div>
              <div class="srow">
                <label for="ep-brk" class="slbl">${t("breakTimeMin") || "Break Time (min)"}</label>
                <input type="number" id="ep-brk" class="num inp" min="0" max="60" style="width:100%" value="${p.brk}"/>
              </div>
              <div class="srow">
                <label for="ep-long" class="slbl">${t("longBreakMin") || "Long Break (min)"}</label>
                <input type="number" id="ep-long" class="num inp" min="0" max="120" style="width:100%" value="${p.long}"/>
              </div>
              <div class="srow">
                <label for="ep-cyc" class="slbl">${t("cycles") || "Cycles"}</label>
                <input type="number" id="ep-cyc" class="num inp" min="1" max="12" style="width:100%" value="${p.cycles}"/>
              </div>
            </div>

            <div class="trow" style="padding:16px 0; border-top:none; border-bottom:1px solid var(--bd); margin-top:-10px;">
              <div style="flex:1;">
                <label for="ep-notify" class="tlbl" style="font-size:14px; font-weight:700; display:flex; align-items:center; gap:6px; cursor:pointer;">
                  ${FlowIcons.get("bell", { size: 16 })}
                  ${t("enableNotifications") || "Enable Notifications"}
                </label>
                <div class="tdesc" style="font-size:12px; color:var(--tx2); margin-top:2px;">${t("epNotifyDesc") || "Receive push alerts when focus periods or breaks end."}</div>
              </div>
              <label class="tog">
                <input type="checkbox" id="ep-notify" ${p.notify !== false ? 'checked' : ''}/>
                <span class="ttrack"></span>
              </label>
            </div>

            <div class="trow" style="padding:16px 0; border-top:none; border-bottom:1px solid var(--bd); margin-top:-10px;">
              <div style="flex:1;">
                <label for="ep-autostart" class="tlbl" style="font-size:14px; font-weight:700; display:flex; align-items:center; gap:6px; cursor:pointer;">
                  ${FlowIcons.get("repeat", { size: 16 })}
                  ${t("autoStartNextCycle") || "Auto-Start Next Cycle"}
                </label>
                <div class="tdesc" style="font-size:12px; color:var(--tx2); margin-top:2px;">${t("epAutoStartDesc") || "Automatically transition to the next work cycle or break."}</div>
              </div>
              <label class="tog">
                <input type="checkbox" id="ep-autostart" ${p.autoStart ? 'checked' : ''}/>
                <span class="ttrack"></span>
              </label>
            </div>
          </div>

          <div style="padding: 16px 32px 24px; border-top: 1px solid var(--bd); display: flex; gap: 12px; justify-content: flex-end; flex-shrink: 0;">
            <button class="bs" id="ep-cancel" style="padding: 10px 20px;">${t("cancel") || "Cancel"}</button>
            <button class="bp" id="ep-save" style="padding: 10px 20px; font-size: 13px; font-weight: 700;">${t("saveChanges") || "Save Changes"}</button>
          </div>
        </div>
        `);
    }
    document.body.appendChild(overlay);

    overlay.querySelector("#ep-close")?.addEventListener("click", () => overlay.remove());
    overlay.querySelector("#ep-cancel")?.addEventListener("click", () => overlay.remove());

    overlay.querySelector("#ep-save")?.addEventListener("click", async () => {
        const rawName = overlay.querySelector("#ep-name").value.trim();
        let nameVal = rawName;
        if (!nameVal) {
            if (p.id === "pomodoro") nameVal = "Pomodoro";
            else if (p.id === "deep-work") nameVal = "Deep Work";
            else if (p.id === "short-sprint") nameVal = "Short Sprint";
            else if (p.id === "custom") nameVal = "Flow";
            else nameVal = p.name || "Custom";
        }
        const workVal = Math.max(1, Math.min(180, parseInt(overlay.querySelector("#ep-work").value, 10) || 25));
        const brkInputVal = parseInt(overlay.querySelector("#ep-brk").value, 10);
        const brkVal = Math.max(0, Math.min(60, isNaN(brkInputVal) ? 5 : brkInputVal));
        const longInputVal = parseInt(overlay.querySelector("#ep-long").value, 10);
        const longVal = Math.max(0, Math.min(120, isNaN(longInputVal) ? 15 : longInputVal));
        const cycVal = Math.max(1, Math.min(12, parseInt(overlay.querySelector("#ep-cyc").value, 10) || 4));
        const notifyVal = overlay.querySelector("#ep-notify").checked;
        const autoStartVal = overlay.querySelector("#ep-autostart").checked;

        p.name = nameVal;
        p.work = workVal;
        p.brk = brkVal;
        p.long = longVal;
        p.longBrk = longVal;
        p.cycles = cycVal;
        p.notify = notifyVal;
        p.autoStart = autoStartVal;
        delete p.cats;
        delete p.blockCats;

        if (options.onSave) {
            await options.onSave(p);
        }
        overlay.remove();
    });
}
