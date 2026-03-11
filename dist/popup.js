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
  var $ = (id) => document.getElementById(id);
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
    const res = await send({ type: "GET_STATE" });
    if (res.ok && res.state) renderState(res.state);
  }
  function renderState(s) {
    $("pet-name").textContent = s.name;
    $("pet-stage").textContent = STAGE_NAMES[s.stage].zh;
    const days = Math.max(1, Math.ceil((Date.now() - s.birthday) / 864e5));
    $("pet-days").textContent = `\u7B2C ${days} \u5929`;
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
    const res = await send({ type: "GET_SETTINGS" });
    if (!res.ok || !res.settings) return;
    const s = res.settings;
    $("input-name").value = s.petName;
    $("input-apikey").value = s.apiKey;
    $("input-model").value = s.model;
    $("input-tracking").checked = s.enableBrowsingTracker;
    $("input-visible").checked = s.petVisible;
  }
  $("btn-save").addEventListener("click", async () => {
    const settings = {
      petName: $("input-name").value.trim() || "\u5C0F\u722A",
      apiKey: $("input-apikey").value.trim(),
      model: $("input-model").value,
      enableBrowsingTracker: $("input-tracking").checked,
      petVisible: $("input-visible").checked
    };
    const res = await send({ type: "SAVE_SETTINGS", settings });
    const status = $("save-status");
    if (res.ok) {
      status.textContent = "\u5DF2\u4FDD\u5B58";
      status.style.color = "#4ade80";
    } else {
      status.textContent = "\u4FDD\u5B58\u5931\u8D25";
      status.style.color = "#ef4444";
    }
    setTimeout(() => {
      status.textContent = "";
    }, 2e3);
  });
  $("btn-export").addEventListener("click", async () => {
    const res = await send({ type: "EXPORT" });
    if (!res.ok || !res.exportData) return;
    const data = res.exportData;
    downloadFile("SOUL.md", data.soul);
    downloadFile("MEMORY.md", data.memory);
    downloadFile("USER.md", data.user);
    downloadFile("ID.md", data.id);
  });
  $("btn-preview").addEventListener("click", async () => {
    const box = $("preview-box");
    if (box.classList.contains("visible")) {
      box.classList.remove("visible");
      return;
    }
    const res = await send({ type: "EXPORT" });
    if (!res.ok || !res.exportData) {
      box.textContent = "\u65E0\u6CD5\u751F\u6210\u9884\u89C8\uFF0C\u8BF7\u5148\u4E0E\u5BA0\u7269\u4E92\u52A8\u3002";
      box.classList.add("visible");
      return;
    }
    box.textContent = res.exportData.soul;
    box.classList.add("visible");
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
