"use strict";
(() => {
  // src/shared/constants.ts
  var DECAY_INTERVAL = 5 * 60 * 1e3;
  var PROACTIVE_SPEAK_INTERVAL = 30 * 60 * 1e3;
  var IDLE_THRESHOLD = 2 * 60 * 60 * 1e3;
  var STAGE_NAMES = {
    egg: { zh: "\u86CB", en: "Egg" },
    baby: { zh: "\u5E7C\u5E74", en: "Baby" },
    young: { zh: "\u5C11\u5E74", en: "Young" },
    teen: { zh: "\u9752\u5E74", en: "Teen" },
    adult: { zh: "\u6210\u5E74", en: "Adult" }
  };

  // src/popup/index.ts
  var $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`[PetClaw] Missing element #${id}`);
    return el;
  };
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      $(`tab-${target}`).classList.add("active");
    });
  });
  function send(msg) {
    return chrome.runtime.sendMessage(msg);
  }
  async function loadState() {
    try {
      let res = await send({ type: "GET_STATE" });
      if (!res.ok || !res.state) {
        res = await send({ type: "INIT" });
      }
      if (res.ok && res.state) renderState(res.state);
    } catch (err) {
      console.error("[PetClaw] Failed to load state:", err);
    }
  }
  function renderState(s) {
    $("pet-name").textContent = s.name;
    $("pet-stage").textContent = `${STAGE_NAMES[s.stage].en}`;
    const days = Math.max(1, Math.ceil((Date.now() - s.birthday) / 864e5));
    $("pet-days").textContent = `Day ${days}`;
    setBar("hunger", s.hunger);
    setBar("happiness", s.happiness);
    setBar("energy", s.energy);
    setPersonality("p-ie", s.personality.introvert_extrovert);
    setPersonality("p-sp", s.personality.serious_playful);
    setPersonality("p-cb", s.personality.cautious_bold);
    setPersonality("p-fc", s.personality.formal_casual);
    $("xp-value").textContent = String(s.experience);
    $("msg-count").textContent = String(s.totalMessages);
    $("interact-count").textContent = String(s.totalInteractions);
    $("feed-count").textContent = String(s.totalFeedings);
  }
  function setBar(name, value) {
    const bar = $(`bar-${name}`);
    const val = $(`val-${name}`);
    bar.style.width = `${Math.min(100, Math.max(0, value))}%`;
    val.textContent = String(Math.round(value));
  }
  function setPersonality(id, value) {
    const el = $(id);
    const pct = (value + 1) / 2 * 100;
    const left = Math.max(0, Math.min(90, pct - 5));
    el.style.left = `${left}%`;
    el.style.width = "10%";
  }
  async function loadSettings() {
    try {
      const res = await send({ type: "GET_SETTINGS" });
      if (!res.ok || !res.settings) return;
      const s = res.settings;
      $("input-name").value = s.petName;
      $("input-language").value = s.language;
      $("input-provider").value = s.provider;
      $("input-baseurl").value = s.apiBaseUrl;
      $("input-apikey").value = s.apiKey;
      $("input-model").value = s.model;
      $("input-tracking").checked = s.enableBrowsingTracker;
      $("input-visible").checked = s.petVisible;
    } catch (err) {
      console.error("[PetClaw] Failed to load settings:", err);
    }
  }
  function readFormSettings() {
    return {
      petName: $("input-name").value.trim() || "Clawdy",
      language: $("input-language").value,
      provider: $("input-provider").value,
      apiBaseUrl: $("input-baseurl").value.trim(),
      apiKey: $("input-apikey").value.trim(),
      model: $("input-model").value.trim(),
      enableBrowsingTracker: $("input-tracking").checked,
      petVisible: $("input-visible").checked
    };
  }
  $("btn-save").addEventListener("click", async () => {
    const settings = readFormSettings();
    const res = await send({ type: "SAVE_SETTINGS", settings });
    const status = $("save-status");
    if (res.ok) {
      status.textContent = "Saved!";
      status.style.color = "#4ade80";
    } else {
      status.textContent = "Save failed";
      status.style.color = "#ef4444";
    }
    setTimeout(() => {
      status.textContent = "";
    }, 2e3);
  });
  $("btn-test-api").addEventListener("click", async () => {
    const statusEl = $("test-status");
    statusEl.textContent = "Testing...";
    statusEl.className = "test-status";
    const form = readFormSettings();
    const provider = form.provider || "minimax";
    const apiKey = form.apiKey || "";
    const model = form.model || "";
    let apiBaseUrl = (form.apiBaseUrl || "").replace(/\/+$/, "");
    if (!apiKey) {
      statusEl.textContent = "Please enter an API key first.";
      statusEl.className = "test-status error";
      return;
    }
    try {
      let url;
      let headers;
      let body;
      if (provider === "claude") {
        url = "https://api.anthropic.com/v1/messages";
        headers = {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json"
        };
        body = JSON.stringify({
          model: model || "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }]
        });
      } else {
        url = apiBaseUrl.endsWith("/chat/completions") ? apiBaseUrl : `${apiBaseUrl}/chat/completions`;
        headers = {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        };
        body = JSON.stringify({
          model: model || "MiniMax-M2.5-Lightning",
          max_tokens: 10,
          messages: [
            { role: "system", content: "Reply with OK" },
            { role: "user", content: "test" }
          ]
        });
      }
      statusEl.textContent = `POST ${url}
Auth: ${provider === "claude" ? "x-api-key" : "Bearer"} ${apiKey.slice(0, 4)}****`;
      const response = await fetch(url, { method: "POST", headers, body });
      const text = await response.text();
      if (response.ok) {
        let preview = "";
        try {
          const json = JSON.parse(text);
          if (provider === "claude") {
            preview = json.content?.[0]?.text || "OK";
          } else {
            preview = json.choices?.[0]?.message?.content || "OK";
          }
        } catch {
          preview = text.slice(0, 100);
        }
        statusEl.textContent = `Connected! Response: "${preview}"`;
        statusEl.className = "test-status success";
      } else {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const json = JSON.parse(text);
          errorMsg += `: ${json.error?.message || json.base_resp?.status_msg || text.slice(0, 200)}`;
        } catch {
          errorMsg += `: ${text.slice(0, 200)}`;
        }
        statusEl.textContent = errorMsg;
        statusEl.className = "test-status error";
      }
    } catch (err) {
      statusEl.textContent = `Network error: ${err instanceof Error ? err.message : String(err)}`;
      statusEl.className = "test-status error";
    }
  });
  $("btn-export").addEventListener("click", async () => {
    const res = await send({ type: "EXPORT" });
    if (!res.ok || !res.exportData) return;
    const data = res.exportData;
    downloadFile("SOUL.md", data.soul);
    downloadFile("MEMORY.md", data.memory);
    downloadFile("USER.md", data.user);
    downloadFile("IDENTITY.md", data.id);
  });
  var currentPreview = "soul";
  var previewFiles = [
    { key: "soul", label: "SOUL.md" },
    { key: "memory", label: "MEMORY.md" },
    { key: "user", label: "USER.md" },
    { key: "id", label: "IDENTITY.md" }
  ];
  $("btn-preview").addEventListener("click", async () => {
    const box = $("preview-box");
    const tabs = $("preview-tabs");
    if (box.classList.contains("visible")) {
      box.classList.remove("visible");
      tabs.classList.remove("visible");
      return;
    }
    const res = await send({ type: "EXPORT" });
    if (!res.ok || !res.exportData) {
      box.textContent = "No data yet. Interact with your pet first.";
      box.classList.add("visible");
      return;
    }
    tabs.innerHTML = previewFiles.map(
      (f) => `<button class="preview-tab${f.key === currentPreview ? " active" : ""}" data-key="${f.key}">${f.label}</button>`
    ).join("");
    tabs.classList.add("visible");
    box.textContent = res.exportData[currentPreview];
    box.classList.add("visible");
    tabs.querySelectorAll(".preview-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentPreview = btn.dataset.key;
        tabs.querySelectorAll(".preview-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        box.textContent = res.exportData[currentPreview];
      });
    });
  });
  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  loadState();
  loadSettings();
})();
//# sourceMappingURL=popup.js.map
