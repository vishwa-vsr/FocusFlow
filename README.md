<div align="center">
  <img src="src/assets/icons/icon128.png" width="96" height="96" alt="Flow Logo">
  <h1>Flow</h1>
  <p><b>An open-source, privacy-first browser extension for website blocking, screen time tracking, and Pomodoro focus sessions — 100% offline.</b></p>

  <p>
    <a href="https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/206x58-chrome-web-bcb82d15b2486.png" alt="Available in the Chrome Web Store" height="38"></a>
    <a href="https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic"><img src="https://developer.microsoft.com/store/badges/images/English_get-it-from-MS.png" alt="Get it from Microsoft" height="38"></a>
    <a href="https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="Get the add-on" height="38"></a>
  </p>

  <p>
    <a href="https://github.com/vishwa-vsr/Flow/stargazers"><img src="https://img.shields.io/github/stars/vishwa-vsr/Flow?style=flat-square&color=yellow" alt="GitHub Stars"></a>
    <a href="https://github.com/vishwa-vsr/Flow/issues"><img src="https://img.shields.io/github/issues/vishwa-vsr/Flow?style=flat-square&color=blue" alt="Open Issues"></a>
    <a href="https://github.com/vishwa-vsr/Flow/releases"><img src="https://img.shields.io/github/v/release/vishwa-vsr/Flow?style=flat-square&color=green" alt="Latest Release"></a>
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
  <p>🌐 <b>Try the live website & interactive preview:</b> <a href="https://vishwa-vsr.github.io/flow-website/"><b>https://vishwa-vsr.github.io/flow-website/</b></a></p>
</div>

---

## 📌 Overview

Flow is a free, local-first browser extension designed to help you stay focused, eliminate doomscrolling, and understand your digital habits without giving up your privacy.

* **100% Local Storage:** All usage statistics, history, and rules remain on your machine in `chrome.storage.local` and IndexedDB.
* **No Telemetry:** Zero external servers, analytics beacons, tracking cookies, or mandatory user accounts.
* **Zero Cost:** No paid tiers, no gated features, and no ads.

---

## 🚀 Key Features

| Feature | Details |
| :--- | :--- |
| ⏱️ **Pomodoro Focus Timer** | Configurable work and break intervals, custom presets (*Deep Work*, *Sprint*), and automatic distraction blocking during active focus cycles. |
| 🚫 **Network-Level Blocker** | Blocks domains via Chrome's native `declarativeNetRequest` API so blocked sites never download or consume bandwidth. |
| 📊 **Time & Activity Tracking** | Logs active tab usage and system idle states. Visualizes time spent by domain, category, and daily totals using Chart.js. |
| 🧹 **Feed & Distraction Hiding** | Content-script tweaks to hide YouTube Shorts/comments, Reddit feeds/popular bars, Instagram Reels/explore, LinkedIn news, and Netflix autoplay. |
| 🔒 **PIN Lock Security** | Optional 6-digit PIN to prevent modifying blocking rules, stopping timers early, or changing settings impulsively. |
| 📅 **365-Day Consistency Heatmap** | GitHub-style habit heatmap showing productive days versus distraction-heavy days over the course of the year. |
| 🏷️ **Domain Categorization** | Automatically and manually groups websites into *Productivity*, *Learning*, *Communication*, *Distraction*, or *Uncategorized*. |
| 🌐 **11 Languages (i18n)** | Fully localized UI supporting English, Spanish, Simplified Chinese, Traditional Chinese (HK/TW), Japanese, German, Brazilian Portuguese, French, Korean, and Russian. |
| 💾 **Data Backup & Migration** | Offline JSON data export/import, with one-click migration from legacy extensions (*Webtime Tracker*, *Web Activity Time Tracker*). |

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

| Store | Release | User Rating |
| :--- | :---: | :---: |
| **[Chrome Web Store](https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp)** | [![](https://img.shields.io/chrome-web-store/v/heinimoclnopjnkpicmonhgichbjejcp?style=flat-square&color=blue)](https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp) | [![](https://img.shields.io/chrome-web-store/rating/heinimoclnopjnkpicmonhgichbjejcp?style=flat-square&color=blue)](https://chromewebstore.google.com/detail/flow-website-blocker-habi/heinimoclnopjnkpicmonhgichbjejcp) |
| **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic)** | [![](https://img.shields.io/badge/dynamic/json?label=edge&prefix=v&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fjlcdkibfogehgkbhkkkglifbanenkmic&style=flat-square&color=blue)](https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic) | [![](https://img.shields.io/badge/dynamic/json?label=rating&suffix=/5&query=%24.averageRating&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fjlcdkibfogehgkbhkkkglifbanenkmic&style=flat-square&color=blue)](https://microsoftedge.microsoft.com/addons/detail/jlcdkibfogehgkbhkkkglifbanenkmic) |
| **[Firefox Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/)** | [![](https://img.shields.io/amo/v/flow-website-blocker?style=flat-square&color=orange)](https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/) | [![](https://img.shields.io/amo/rating/flow-website-blocker?style=flat-square&color=orange)](https://addons.mozilla.org/en-US/firefox/addon/flow-website-blocker/) |

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
* **Node.js** (v18.0.0 or higher recommended)
* **npm**

### Setup & Build Commands
```bash
# 1. Install developer dependencies
npm install

# 2. Build production packages for Chrome, Edge, and Firefox
npm run build

# 3. Build and package store-ready .zip files into release/
npm run zip
```

> **Windows PowerShell Note:** If script execution is restricted on your system, run the build script directly with Node:
> ```powershell
> node tools/build.js --yes
> ```

---

## 🛠️ Built With / Tech Stack

Flow is built with a zero-bloat, client-side philosophy:

* **Frontend & Logic:** Vanilla JavaScript (ES2022) with native DOM APIs.
* **Extension Standard:** WebExtensions API (Manifest V3) using `declarativeNetRequest`, `alarms`, `idle`, and `storage`.
* **Data Visualization:** [Chart.js 4.5](https://www.chartjs.org/) (bundled locally, zero external CDN requests).
* **Storage Engine:** `chrome.storage.local` for settings and rules + **IndexedDB** for high-volume daily historical metrics.
* **Styling & Tokens:** Pure CSS variables with custom design tokens, responsive cards, and OLED Dark Mode.
* **Build Compiler:** Lightweight Node.js build pipeline powered by `esbuild` and an automatic 3-stage i18n parity validator.

---

## 📂 Repository Structure

```text
flow-source/
  ├── src/                         <-- Extension source code (Manifest V3)
  │    ├── manifest.json           <-- Manifest permissions & config
  │    ├── _locales/               <-- 11 localized translation directories
  │    ├── assets/                 <-- Manrope typography & icons
  │    ├── background/             <-- Service worker (tab tracking, DNR rules, alarms)
  │    ├── blocked/                <-- Block overlay page
  │    ├── content/                <-- Content script (active heartbeats, site tweaks)
  │    ├── dashboard/              <-- Full-page analytics dashboard and settings
  │    ├── lib/                    <-- Core modules (constants.js, db.js, storage.js, icons.js)
  │    ├── popup/                  <-- Toolbar dropdown timer UI
  │    └── styles/                 <-- Global CSS variables & design tokens
  ├── dist/                        <-- Production build outputs (chrome, edge, firefox)
  ├── release/                     <-- Packaged .zip archives for store submissions
  ├── tools/                       <-- Build compiler (build.js) & localization scripts
  ├── media/                       <-- Store screenshots & preview assets
  ├── package.json                 <-- Build dependencies & npm scripts
  ├── CONTRIBUTING.md              <-- Contributor guide & architecture notes
  └── LICENSE                      <-- GNU General Public License v3.0
```

---

## ❓ Frequently Asked Questions

<details>
  <summary><b>Does Flow send any data to external servers?</b></summary>
  <br>
  No. Flow is strictly local-first. All browsing statistics, categories, blocking rules, and timer logs are stored locally on your device via <code>chrome.storage.local</code> and IndexedDB.
</details>

<details>
  <summary><b>Why does Flow request host permissions (<code>&lt;all_urls&gt;</code>)?</b></summary>
  <br>
  Host permissions allow the lightweight content script (<code>src/content/site-tracker.js</code>) to track active engagement on websites, calculate screen time accurately, display remaining time warnings, and inject site-specific distraction element hiders (such as hiding YouTube Shorts or Reddit sidebars).
</details>

<details>
  <summary><b>How can I transfer my data to another computer?</b></summary>
  <br>
  Open the Flow Dashboard, go to <b>Migration & Imports</b>, and click <b>Export Backup (JSON)</b>. You can import this file on any computer running Flow.
</details>

---

## 👥 Contributors

Thanks to everyone who has contributed code or translations:

<a href="https://github.com/vishwa-vsr/Flow/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=vishwa-vsr/Flow" alt="Flow Contributors" />
</a>

Want to contribute? See our [Contributing Guide](CONTRIBUTING.md).

---

## 📄 License & Credits

* **Code:** Licensed under the [GNU General Public License v3.0 (GPLv3)](./LICENSE).
* **[Chart.js](https://www.chartjs.org/):** Used under the [MIT License](https://github.com/chartjs/Chart.js/blob/master/LICENSE.md) for data visualizations.
* **[Manrope Font](https://github.com/sharanda/manrope):** Designed by Mikhail Sharanda, used under the [SIL Open Font License 1.1](./src/assets/fonts/LICENSE.txt).
