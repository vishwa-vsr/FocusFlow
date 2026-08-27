<div align="center">
  <img src="src/assets/icons/icon128.png" width="96" height="96" alt="Flow Logo">
  <h1>Flow</h1>
  <p><b>Open-source browser extension for website blocking, screen time tracking, and Pomodoro focus sessions — 100% offline, no account required.</b></p>

  <p>
    <a href="https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/206x58-chrome-web-bcb82d15b2486.png" alt="Available in the Chrome Web Store" height="38"></a>
    <a href="https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic"><img src="https://developer.microsoft.com/store/badges/images/English_get-it-from-MS.png" alt="Get it from Microsoft" height="38"></a>
    <a href="https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="Get the add-on" height="38"></a>
  </p>

  <p>
    <a href="https://github.com/vishwa-vsr/Flow/actions"><img src="https://img.shields.io/github/actions/workflow/status/vishwa-vsr/Flow/build.yml?branch=main&style=flat-square&color=success" alt="Build Status"></a>
    <a href="https://github.com/vishwa-vsr/Flow"><img src="https://img.shields.io/codefactor/grade/github/vishwa-vsr/Flow?style=flat-square&color=blue" alt="Code Quality"></a>
    <a href="https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp"><img src="https://img.shields.io/chrome-web-store/users/heinimoclnopjnkpicmonhgichbjejcp?style=flat-square&color=blue&label=users" alt="Active Users"></a>
    <a href="https://github.com/vishwa-vsr/Flow/stargazers"><img src="https://img.shields.io/github/stars/vishwa-vsr/Flow?style=flat-square&color=yellow" alt="GitHub Stars"></a>
    <a href="https://github.com/vishwa-vsr/Flow/issues"><img src="https://img.shields.io/github/issues/vishwa-vsr/Flow?style=flat-square&color=blue" alt="Open Issues"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square" alt="License"></a>
  </p>

  <p align="center">
    <a href="#-overview">Overview</a> •
    <a href="#-key-features">Key Features</a> •
    <a href="#-comparison-with-alternatives">Comparison</a> •
    <a href="#-screenshots">Screenshots</a> •
    <a href="#-store-downloads">Store Downloads</a> •
    <a href="#️-manual-installation-developer-mode">Manual Install</a> •
    <a href="#-built-with--tech-stack">Tech Stack</a> •
    <a href="#-frequently-asked-questions">FAQ</a>
  </p>

  <br>
  <img src="media/flow_preview6.jpg" width="100%" alt="Flow Overview Banner" style="border-radius: 10px;">
  <br><br>
  <p>🌐 <b>Live preview & website:</b> <a href="https://vishwa-vsr.github.io/flow-website/"><b>https://vishwa-vsr.github.io/flow-website/</b></a></p>
</div>

---

## 📌 Overview

Flow is a free, local-first browser extension that blocks distracting websites, tracks your screen time, and runs Pomodoro focus sessions — all without sending a single byte to any server.

* **Local Storage Only:** All browsing data, rules, and history stay on your device in `chrome.storage.local`, `chrome.storage.sync` (for syncing settings across your browsers), and IndexedDB.
* **No Telemetry:** No analytics, no tracking pixels, no mandatory accounts.
* **Zero Cost:** No paid tiers, no feature gates, no ads.

---

## 🚀 Key Features

| Feature | Details |
| :--- | :--- |
| ⏱️ **Pomodoro Focus Timer** | 4 built-in presets — Pomodoro (25/5), Deep Work (90/15), Short Sprint (15/2), and a fully custom slot. Automatically blocks distracting sites during active work cycles. |
| 🚫 **Network-Level Website Blocker** | Blocks domains using Chrome's `declarativeNetRequest` API — blocked pages never load or consume bandwidth. SSO login pages (Google, Microsoft, Apple) are automatically excluded so you never get locked out. |
| 📊 **Screen Time Tracking** | Tracks active tab time using visibility heartbeats and idle detection. Visualizes daily usage by domain and category with Chart.js charts. Detects media playback so timers don't pause while you watch a video or lecture. |
| 🧹 **Feed & Distraction Hiding** | Per-site CSS tweaks to hide distracting elements on **YouTube** (Shorts, home feed, related videos, comments), **Reddit** (feed, popular, comments, communities), **Instagram** (Reels, explore, home feed, suggested), **X / Twitter** (timeline, trending, who-to-follow, promoted posts), **LinkedIn** (feed, news, promoted), and **Netflix** (autoplay previews, recommendations, billboard). |
| 🎨 **Black & White Mode** | Converts any supported site (YouTube, Reddit, Instagram, X, LinkedIn, Netflix) to grayscale to reduce visual dopamine triggers. |
| ⏳ **Cooldown & Nudge Warnings** | Optional "Take a breath" full-screen countdown before opening distracting sites (configurable: every visit, every 10 min, or once per day). Warning banner slides in when your daily time limit on a site is nearly exhausted. |
| 🔒 **PIN Lock Security** | Optional 4–6 digit PIN (hashed with SHA-256) to prevent impulsively changing block rules, stopping timers, or editing settings. |
| 📅 **365-Day Consistency Heatmap** | GitHub-style annual heatmap showing productive days versus distraction-heavy days over the course of the year. |
| 🏷️ **Domain Categorization** | Automatically and manually groups websites into Productivity, Learning, Communication, Distraction, or Uncategorized. Supports custom categories with user-defined colors and emoji. |
| 🌐 **11 Languages (i18n)** | Fully localized UI supporting English, Spanish, Simplified Chinese, Traditional Chinese (HK/TW), Japanese, German, Brazilian Portuguese, French, Korean, and Russian. |
| 💾 **Data Backup & Migration** | Full JSON data export/import with one-click migration from legacy extensions (Webtime Tracker, Web Activity Time Tracker). |
| 🌙 **Dark & Light Theme** | OLED-friendly dark mode and light mode, switchable from the popup. |

---

## 📊 Comparison with Alternatives

| Feature | Flow | BlockSite | StayFocusd | Freedom | Forest |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Open Source** | ✅ (GPLv3) | ❌ | ❌ | ❌ | ❌ |
| **100% Free** | ✅ | ❌ Paid Tier | ⚠️ Partial | ❌ Subscription | ❌ Paid App |
| **Local-Only (No Cloud Sync)** | ✅ | ❌ Cloud | ✅ | ❌ Cloud | ❌ Cloud |
| **No Account Needed** | ✅ | ❌ Required | ✅ | ❌ Required | ❌ Required |
| **Screen Time Tracking** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Pomodoro Focus Timer** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Distraction Element Hiding** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **365-Day Habit Heatmap** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **PIN Lock Protection** | ✅ | ❌ Paid Tier | ❌ | ✅ | ❌ |
| **Cross-Browser (Chrome/Edge/Firefox)** | ✅ | ✅ | ❌ Chrome only | ✅ | ✅ |

---

## 📸 Screenshots

<div align="center">
  <h3>Popup Focus Timer & Quick Controls</h3>
  <img src="media/flow_preview2.png" width="85%" alt="Flow Popup Overview">
  <br><br>
  <h3>Smart Rule Manager & Site Limits</h3>
  <img src="media/flow_preview3.png" width="85%" alt="Flow Block Rules">
  <br><br>
  <h3>Domain Categorization</h3>
  <img src="media/flow_preview4.png" width="85%" alt="Flow Website Categories">
  <br><br>
  <h3>Usage Analytics & Trend Dashboard</h3>
  <img src="media/flow_preview5.png" width="85%" alt="Flow Analytics Dashboard">
</div>

---

## 📥 Store Downloads

| Store | Release | User Rating | Active Users |
| :--- | :---: | :---: | :---: |
| **[Chrome Web Store](https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp)** | [![](https://img.shields.io/chrome-web-store/v/heinimoclnopjnkpicmonhgichbjejcp?style=flat-square&color=blue)](https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp) | [![](https://img.shields.io/chrome-web-store/rating/heinimoclnopjnkpicmonhgichbjejcp?style=flat-square&color=blue)](https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp) | [![](https://img.shields.io/chrome-web-store/users/heinimoclnopjnkpicmonhgichbjejcp?style=flat-square&color=blue)](https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp) |
| **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic)** | [![](https://img.shields.io/badge/dynamic/json?label=edge&prefix=v&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fjlcdkibfogehgkbhkkkglifbanenkmic&style=flat-square&color=blue)](https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic) | [![](https://img.shields.io/badge/dynamic/json?label=rating&suffix=/5&query=%24.averageRating&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fjlcdkibfogehgkbhkkkglifbanenkmic&style=flat-square&color=blue)](https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic) | [![](https://img.shields.io/badge/dynamic/json?label=users&query=%24.activeInstallCount&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fjlcdkibfogehgkbhkkkglifbanenkmic&style=flat-square&color=blue)](https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic) |
| **[Firefox Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/)** | [![](https://img.shields.io/amo/v/flow-website-blocker?style=flat-square&color=orange)](https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/) | [![](https://img.shields.io/amo/rating/flow-website-blocker?style=flat-square&color=orange)](https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/) | [![](https://img.shields.io/amo/users/flow-website-blocker?style=flat-square&color=orange)](https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/) |

---

## 🛠️ Manual Installation (Developer Mode)

You can clone the repository with Git, or download the latest source code as a ZIP:

<p>
  <a href="https://github.com/vishwa-vsr/Flow/archive/refs/heads/main.zip"><img src="https://img.shields.io/badge/Download-Latest_Source_ZIP-blue.svg?style=flat-square" alt="Download Source ZIP"></a>
</p>

### Chrome / Brave / Edge / Chromium:
1. Clone or download this repository.
2. Navigate to `chrome://extensions` (or `edge://extensions` in Microsoft Edge).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** (top-left).
5. Select the **`src/`** directory (for raw source code) or **`dist/chrome/`** (for compiled code).

### Mozilla Firefox:
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select the `manifest.json` file inside the **`src/`** directory or the compiled **`dist/firefox/`** directory.

---

## 💻 Building from Source

### Prerequisites
* **Node.js** (v18.0.0 or higher)
* **npm**

### Build Commands
```bash
# 1. Install dependencies
npm install

# 2. Build for Chrome, Edge, and Firefox → outputs to dist/
npm run build

# 3. Build + create store-ready .zip archives → outputs to release/
npm run zip

# 4. Re-bundle Chart.js into src/lib/chart.min.js (only needed if upgrading Chart.js)
npm run bundle-chart
```

> **Windows PowerShell Note:** If script execution is restricted on your system, run the build script directly with Node:
> ```powershell
> node tools/build.js --yes
> ```

---

## 🛠️ Built With / Tech Stack

* **Frontend & Logic:** Vanilla JavaScript (ES2022) with native DOM APIs.
* **Extension Standard:** WebExtensions API (Manifest V3) — `declarativeNetRequest`, `alarms`, `idle`, `storage`, `notifications`, `scripting`.
* **Data Visualization:** [Chart.js 4.5](https://www.chartjs.org/) (bundled locally in `src/lib/chart.min.js`, zero external CDN requests).
* **Storage Engine:** `chrome.storage.local` for block rules and local config, `chrome.storage.sync` for user settings and presets, and **IndexedDB** (`FocusFlowDB`) for daily and monthly browsing history.
* **Styling:** Pure CSS with custom design tokens, responsive layouts, and OLED dark mode.
* **Build Pipeline:** Node.js + `esbuild` for minification, with a multi-stage i18n parity validator that checks key coverage, case-insensitive duplicates, placeholder syntax, and untranslated strings across all 11 locales.

---

## 📂 Repository Structure

```text
Flow/
├── src/                         ← Extension source code (Manifest V3)
│    ├── manifest.json           ← Permissions, content scripts, service worker config
│    ├── _locales/               ← 11 localized translation directories (en, es, de, fr, ja, ko, ru, zh_CN, zh_HK, zh_TW, pt_BR)
│    ├── assets/                 ← Manrope font files and extension icons
│    ├── background/             ← Service worker (tab tracking, DNR rules, alarms, idle)
│    ├── blocked/                ← Block overlay page shown when a domain is blocked
│    ├── content/                ← Content script (active heartbeats, nudges, site tweaks)
│    ├── dashboard/              ← Full-page analytics, settings, PIN security, heatmap, migration
│    │    └── modules/           ← Dashboard sub-modules (categories, PIN, presets, utils)
│    ├── lib/                    ← Shared modules
│    │    ├── constants.js       ← Default categories, site tweak maps, auto-categorization
│    │    ├── db.js              ← IndexedDB wrapper (FocusFlowDB)
│    │    ├── storage.js         ← chrome.storage helpers (local, sync, session)
│    │    ├── icons.js           ← FlowIcons SVG icon engine (44 icons)
│    │    ├── i18n.js            ← Localization helper and dynamic language switching
│    │    ├── utils.js           ← Shared utility functions
│    │    └── chart.min.js       ← Bundled Chart.js 4.5 (local, no CDN)
│    ├── popup/                  ← Toolbar popup (timer UI, quick controls, theme toggle)
│    └── styles/                 ← Global CSS variables & design tokens
├── tools/                       ← Build compiler (build.js) and Chart.js bundler
├── dist/                        ← Production build outputs (chrome/, edge/, firefox/)
├── release/                     ← Store-ready .zip archives (generated by npm run zip)
├── media/                       ← Store screenshots & preview images
├── docs/                        ← Additional documentation
├── .github/                     ← Issue templates (bug report, feature request) & PR template
├── package.json                 ← npm scripts and build dependencies
├── CONTRIBUTING.md              ← Contributor guide & architecture notes
├── TRANSLATING.md               ← Translation guide for i18n contributors
├── PRIVACY.md                   ← Privacy policy
├── CHANGELOG.md                 ← Release history
└── LICENSE                      ← GNU General Public License v3.0
```

---

## 🔒 Permissions

Flow requests only the permissions it needs. Here's what each one does:

| Permission | Why |
| :--- | :--- |
| `storage` | Save your settings, block lists, and timer presets locally in the browser. |
| `unlimitedStorage` | Store long-term browsing history in IndexedDB without hitting Chrome's storage caps. |
| `alarms` | Schedule Pomodoro timer phases, periodic heartbeats, and privacy mode timeouts. |
| `idle` | Detect when you step away so screen time tracking pauses automatically. |
| `notifications` | Show desktop alerts when a focus session or break ends. |
| `declarativeNetRequest` | Block websites at the network level (pages never download). |
| `scripting` | Inject per-site CSS tweaks (element hiding, Black & White mode) dynamically. |
| `favicon` | Display website favicons in the dashboard and popup (Chromium only). |
| `<all_urls>` (host) | Required for the content script to track active tab time and inject nudge overlays on any website. |

All data stays on your device. Read the full [Privacy Policy](PRIVACY.md).

---

## ❓ Frequently Asked Questions

<details>
  <summary><b>Does Flow send any data to external servers?</b></summary>
  <br>
  No. All browsing data, categories, blocking rules, and timer logs are stored locally on your device via <code>chrome.storage.local</code> and IndexedDB. Flow makes zero network requests.
  <br><br>
  <b>Note:</b> Flow stores user settings (like timer presets and category tags) in <code>chrome.storage.sync</code>. If you have Chrome Sync enabled in your browser, Chrome may sync these settings across your signed-in devices. This is standard Chrome behavior, not something Flow controls. Your browsing history and screen time data are never synced — they stay in local-only storage.
</details>

<details>
  <summary><b>Why does Flow request host permissions (<code>&lt;all_urls&gt;</code>)?</b></summary>
  <br>
  Host permissions allow the content script (<code>src/content/site-tracker.js</code>) to track active engagement on any website, show cooldown overlays and time-limit warnings, and inject per-site distraction element hiders (like hiding YouTube Shorts or Reddit sidebars).
</details>

<details>
  <summary><b>Will Flow block my login pages?</b></summary>
  <br>
  No. Flow automatically excludes Single Sign-On (SSO) domains — Google Accounts, Microsoft Login, Apple ID, and YouTube authentication pages are never blocked, even during active focus sessions.
</details>

<details>
  <summary><b>How can I transfer my data to another computer?</b></summary>
  <br>
  Open the Flow Dashboard, go to <b>Migration & Imports</b>, and click <b>Export Backup (JSON)</b>. Import that file on any other computer running Flow.
</details>

<details>
  <summary><b>The extension won't load in Developer Mode</b></summary>
  <br>
  <ul>
    <li>Make sure <b>Developer mode</b> is enabled in <code>chrome://extensions</code>.</li>
    <li>Select the <code>src/</code> folder (not a parent folder or a single file).</li>
    <li>Check the Extensions page for red error banners — click them for details.</li>
    <li>If you built from source, make sure <code>npm run build</code> completed without errors before loading <code>dist/chrome/</code>.</li>
  </ul>
</details>

---

## 👥 Contributors

Thanks to everyone who has contributed code or translations:

<a href="https://github.com/vishwa-vsr/Flow/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=vishwa-vsr/Flow" alt="Flow Contributors" />
</a>

Want to contribute? See our [Contributing Guide](CONTRIBUTING.md).
Want to help translate? See our [Translation Guide](TRANSLATING.md).

---

## 📄 License & Credits

* **Code:** Licensed under the [GNU General Public License v3.0 (GPLv3)](./LICENSE).
* **[Chart.js](https://www.chartjs.org/):** Used under the [MIT License](https://github.com/chartjs/Chart.js/blob/master/LICENSE.md) for data visualizations.
* **[Manrope Font](https://github.com/sharanda/manrope):** Designed by Mikhail Sharanda, used under the [SIL Open Font License 1.1](./src/assets/fonts/LICENSE.txt).
