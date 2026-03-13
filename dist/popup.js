"use strict";
(() => {
  // src/shared/constants.ts
  var DECAY_INTERVAL = 5 * 60 * 1e3;
  var PROACTIVE_SPEAK_INTERVAL = 30 * 60 * 1e3;
  var IDLE_THRESHOLD = 2 * 60 * 60 * 1e3;
  var STAGE_NAMES = {
    egg: "Egg",
    baby: "Baby",
    young: "Young",
    teen: "Teen",
    adult: "Adult"
  };
  var PROVIDER_PRESETS = {
    minimax: {
      label: "MiniMax",
      baseUrl: "https://api.minimax.io/v1",
      model: "MiniMax-M2.5-Lightning"
    },
    claude: {
      label: "Claude (Anthropic)",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-20250514"
    },
    openai: {
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini"
    },
    deepseek: {
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat"
    },
    gemini: {
      label: "Gemini (Google)",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.0-flash"
    },
    groq: {
      label: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile"
    },
    openrouter: {
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4"
    },
    ollama: {
      label: "Ollama (Local)",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2"
    },
    "openai-compatible": {
      label: "OpenAI Compatible",
      baseUrl: "",
      model: ""
    }
  };
  var DEFAULT_SLEEP_TIMEOUT = 30 * 60 * 1e3;

  // src/shared/zip.ts
  function crc32(data) {
    let crc = 4294967295;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
      }
    }
    return (crc ^ 4294967295) >>> 0;
  }
  function writeU16(buf, offset, value) {
    buf[offset] = value & 255;
    buf[offset + 1] = value >>> 8 & 255;
  }
  function writeU32(buf, offset, value) {
    buf[offset] = value & 255;
    buf[offset + 1] = value >>> 8 & 255;
    buf[offset + 2] = value >>> 16 & 255;
    buf[offset + 3] = value >>> 24 & 255;
  }
  function createZip(files) {
    const encoder = new TextEncoder();
    const entries = files.map((f) => ({
      name: f.name,
      data: encoder.encode(f.content)
    }));
    const parts = [];
    const centralHeaders = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const crc = crc32(entry.data);
      const local = new Uint8Array(30 + nameBytes.length);
      writeU32(local, 0, 67324752);
      writeU16(local, 4, 20);
      writeU16(local, 6, 0);
      writeU16(local, 8, 0);
      writeU16(local, 10, 0);
      writeU16(local, 12, 0);
      writeU32(local, 14, crc);
      writeU32(local, 18, entry.data.length);
      writeU32(local, 22, entry.data.length);
      writeU16(local, 26, nameBytes.length);
      writeU16(local, 28, 0);
      local.set(nameBytes, 30);
      const central = new Uint8Array(46 + nameBytes.length);
      writeU32(central, 0, 33639248);
      writeU16(central, 4, 20);
      writeU16(central, 6, 20);
      writeU16(central, 8, 0);
      writeU16(central, 10, 0);
      writeU16(central, 12, 0);
      writeU16(central, 14, 0);
      writeU32(central, 16, crc);
      writeU32(central, 20, entry.data.length);
      writeU32(central, 24, entry.data.length);
      writeU16(central, 28, nameBytes.length);
      writeU16(central, 30, 0);
      writeU16(central, 32, 0);
      writeU16(central, 34, 0);
      writeU16(central, 36, 0);
      writeU32(central, 38, 0);
      writeU32(central, 42, offset);
      central.set(nameBytes, 46);
      parts.push(local);
      parts.push(entry.data);
      centralHeaders.push(central);
      offset += local.length + entry.data.length;
    }
    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const ch of centralHeaders) {
      parts.push(ch);
      centralDirSize += ch.length;
    }
    const eocd = new Uint8Array(22);
    writeU32(eocd, 0, 101010256);
    writeU16(eocd, 4, 0);
    writeU16(eocd, 6, 0);
    writeU16(eocd, 8, entries.length);
    writeU16(eocd, 10, entries.length);
    writeU32(eocd, 12, centralDirSize);
    writeU32(eocd, 16, centralDirOffset);
    writeU16(eocd, 20, 0);
    parts.push(eocd);
    return new Blob(parts, { type: "application/zip" });
  }

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
    $("pet-stage").textContent = STAGE_NAMES[s.stage] || s.stage;
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
  var providerSelect = $("input-provider");
  providerSelect.addEventListener("change", () => {
    const key = providerSelect.value;
    const preset = PROVIDER_PRESETS[key];
    if (preset) {
      ;
      $("input-baseurl").value = preset.baseUrl;
      $("input-model").value = preset.model;
      $("input-baseurl").placeholder = preset.baseUrl || "https://your-api-base-url";
      $("input-model").placeholder = preset.model || "model-name";
    }
  });
  async function loadSettings() {
    try {
      const res = await send({ type: "GET_SETTINGS" });
      if (!res.ok || !res.settings) return;
      const s = res.settings;
      $("input-name").value = s.petName;
      $("input-provider").value = s.provider;
      $("input-baseurl").value = s.apiBaseUrl;
      $("input-apikey").value = s.apiKey;
      $("input-model").value = s.model;
      $("input-sleep-timeout").value = String(s.sleepTimeoutMinutes ?? 30);
      $("input-dream-analysis").checked = s.enableDreamAnalysis !== false;
      $("input-tracking").checked = s.enableBrowsingTracker;
      $("input-visible").checked = s.petVisible;
    } catch (err) {
      console.error("[PetClaw] Failed to load settings:", err);
    }
  }
  function readFormSettings() {
    return {
      petName: $("input-name").value.trim() || "Clawfish",
      provider: $("input-provider").value,
      apiBaseUrl: $("input-baseurl").value.trim(),
      apiKey: $("input-apikey").value.trim(),
      model: $("input-model").value.trim(),
      sleepTimeoutMinutes: parseInt($("input-sleep-timeout").value) || 30,
      enableDreamAnalysis: $("input-dream-analysis").checked,
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
          model: model || "gpt-4o-mini",
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
    const zip = createZip([
      { name: "SOUL.md", content: data.soul },
      { name: "MEMORY.md", content: data.memory },
      { name: "USER.md", content: data.user },
      { name: "IDENTITY.md", content: data.id }
    ]);
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = "petclaw-export.zip";
    a.click();
    URL.revokeObjectURL(url);
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
  loadState();
  loadSettings();
})();
//# sourceMappingURL=popup.js.map
