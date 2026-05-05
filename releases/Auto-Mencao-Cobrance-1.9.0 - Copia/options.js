const SETTINGS_KEY = "automention_settings";

const DEFAULTS = {
  enabled: true,
  autoAddRecipient: true,
  recipientMode: "to",
  maxSuggestions: 10,
  triggerChar: "@",
  showOnEmptyQuery: true,
  showRecentContacts: true,
  showActiveBadge: false,
  appendFooter: false, 
  toastEnabled: true,
  preferSameDomain: true,
  preferRecentRecipients: true,
  highlightMentions: true,
  mentionColor: "#228B22",
};

function $(id) {
  return document.getElementById(id);
}

function sanitizeSettings(settings) {
  const merged = { ...DEFAULTS, ...(settings || {}) };

  merged.enabled = merged.enabled !== false;
  merged.autoAddRecipient = merged.autoAddRecipient !== false;
  merged.recipientMode = ["to", "cc", "bcc"].includes(String(merged.recipientMode).toLowerCase())
    ? String(merged.recipientMode).toLowerCase()
    : "to";
  
  merged.maxSuggestions = Math.max(1, Number(merged.maxSuggestions) || 10);
  merged.triggerChar = String(merged.triggerChar || "@").slice(0, 1) || "@";
  merged.showOnEmptyQuery = !!merged.showOnEmptyQuery;
  merged.showRecentContacts = !!merged.showRecentContacts;
  merged.showActiveBadge = !!merged.showActiveBadge;
  merged.appendFooter = !!merged.appendFooter;
  merged.toastEnabled = !!merged.toastEnabled;
  merged.preferSameDomain = !!merged.preferSameDomain;
  merged.preferRecentRecipients = !!merged.preferRecentRecipients;
  merged.highlightMentions = !!merged.highlightMentions;
  merged.mentionColor = "#228B22";

  return merged;
}

async function getSettings() {
  const obj = await browser.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(obj[SETTINGS_KEY] || {});
}

async function saveSettings(settings) {
  const sanitized = sanitizeSettings(settings);
  await browser.storage.local.set({ [SETTINGS_KEY]: sanitized });
}

function collectSettingsFromUI() {
  return {
    enabled: $("enabled").checked,
    autoAddRecipient: $("autoAddRecipient").checked,
    recipientMode: $("recipientMode").value,
    maxSuggestions: parseInt($("maxSuggestions").value, 10) || 10,
    triggerChar: ($("triggerChar").value || "@").slice(0, 1),
    showOnEmptyQuery: $("showOnEmptyQuery").checked,
    showRecentContacts: $("showRecentContacts").checked,
    showActiveBadge: $("showActiveBadge").checked,
    appendFooter: $("appendFooter").checked,
    toastEnabled: $("toastEnabled").checked,
    preferSameDomain: $("preferSameDomain").checked,
    preferRecentRecipients: $("preferRecentRecipients").checked,
    highlightMentions: $("highlightMentions").checked,
    mentionColor: "#228B22",
  };
}

function applySettingsToUI(settings) {
  $("enabled").checked = !!settings.enabled;
  $("autoAddRecipient").checked = !!settings.autoAddRecipient;
  $("recipientMode").value = settings.recipientMode || "to";
  $("maxSuggestions").value = String(settings.maxSuggestions || 10);
  $("triggerChar").value = settings.triggerChar || "@";
  $("showOnEmptyQuery").checked = !!settings.showOnEmptyQuery;
  $("showRecentContacts").checked = !!settings.showRecentContacts;
  $("showActiveBadge").checked = !!settings.showActiveBadge;
  $("appendFooter").checked = !!settings.appendFooter;
  $("toastEnabled").checked = !!settings.toastEnabled;
  $("preferSameDomain").checked = !!settings.preferSameDomain;
  $("preferRecentRecipients").checked = !!settings.preferRecentRecipients;
  $("highlightMentions").checked = !!settings.highlightMentions;
}

async function refreshWholeUI() {
  const settings = await getSettings();
  applySettingsToUI(settings);
}

async function saveAll() {
  const settings = collectSettingsFromUI();
  await saveSettings(settings);

  const effective = sanitizeSettings(settings);
  applySettingsToUI(effective);

  $("status").textContent = "Saved.";
  setTimeout(() => {
    $("status").textContent = "";
  }, 1200);
}

async function resetAll() {
  await saveSettings(DEFAULTS);
  const effective = sanitizeSettings(DEFAULTS);
  applySettingsToUI(effective);

  $("status").textContent = "Reset to defaults.";
  setTimeout(() => {
    $("status").textContent = "";
  }, 1200);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const manifest = browser.runtime.getManifest();
    const versionEl = document.getElementById("version");
    if (versionEl) versionEl.textContent = manifest.version;
  } catch (e) {}

  await refreshWholeUI();

  if ($("save")) $("save").addEventListener("click", saveAll);
  if ($("reset")) $("reset").addEventListener("click", resetAll);
});
