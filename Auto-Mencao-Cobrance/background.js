const MAX_RESULTS = 100;
const SETTINGS_KEY = "automention_settings";
const RECENT_CONTACTS_KEY = "automention_recent_contacts";

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

let composeScriptRegistered = false;

function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULTS, ...settings };

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
  return normalizeSettings(obj[SETTINGS_KEY] || {});
}

async function getRecentContacts() {
  const obj = await browser.storage.local.get(RECENT_CONTACTS_KEY);
  return Array.isArray(obj[RECENT_CONTACTS_KEY]) ? obj[RECENT_CONTACTS_KEY] : [];
}

async function getRecentContactsMap() {
  const items = await getRecentContacts();
  const map = new Map();

  items.forEach((item, index) => {
    const key = (item.email || "").toLowerCase();
    if (key) {
      map.set(key, {
        index,
        ts: item.ts || 0,
      });
    }
  });

  return map;
}

async function saveRecentContact(contact) {
  if (!contact?.email) {
    return;
  }

  const items = await getRecentContacts();
  const key = `${(contact.email || "").toLowerCase()}|${(contact.name || "").toLowerCase()}`;

  const filtered = items.filter((item) => {
    const itemKey = `${(item.email || "").toLowerCase()}|${(item.name || "").toLowerCase()}`;
    return itemKey !== key;
  });

  filtered.unshift({
    name: contact.name || contact.email,
    email: contact.email,
    ts: Date.now(),
  });

  await browser.storage.local.set({
    [RECENT_CONTACTS_KEY]: filtered.slice(0, 20),
  });
}

async function registerComposeScripts() {
  if (composeScriptRegistered) {
    return;
  }

  try {
    await browser.composeScripts.register({
      js: [{ file: "compose_script.js" }],
      css: [{ file: "composer.css" }],
    });
    composeScriptRegistered = true;
    console.log("AutoMention compose script registered");
  } catch (error) {
    console.error("AutoMention registerComposeScripts error:", error);
  }
}

async function startup() {
  await registerComposeScripts();
}

browser.runtime.onInstalled.addListener(startup);
browser.runtime.onStartup.addListener(startup);
startup();

async function getAllAddressBookContacts() {
  const books = await browser.addressBooks.list(true);
  const contacts = [];

  function visitBook(book) {
    if (book.contacts && Array.isArray(book.contacts)) {
      for (const c of book.contacts) {
        const props = c.properties || {};
        const displayName =
          props.DisplayName ||
          [props.FirstName, props.LastName].filter(Boolean).join(" ") ||
          props.NickName ||
          props.PrimaryEmail ||
          "";

        const primaryEmail = props.PrimaryEmail || "";
        const secondEmail = props.SecondEmail || "";

        if (primaryEmail) {
          contacts.push({
            id: c.id,
            name: displayName.trim() || primaryEmail,
            email: primaryEmail.trim(),
          });
        }

        if (secondEmail) {
          contacts.push({
            id: `${c.id}-secondary`,
            name: displayName.trim() || secondEmail,
            email: secondEmail.trim(),
          });
        }
      }
    }

    if (book.mailingLists && Array.isArray(book.mailingLists)) {
      for (const list of book.mailingLists) {
        visitBook(list);
      }
    }
  }

  for (const book of books) {
    visitBook(book);
  }

  return contacts;
}

function scoreContact(query, contact, options = {}) {
  const q = (query || "").toLowerCase().trim();
  const name = (contact.name || "").toLowerCase();
  const email = (contact.email || "").toLowerCase();

  if (!q) {
    return 0;
  }

  let score = 0;

  if (name.startsWith(q)) score += 100;
  if (email.startsWith(q)) score += 90;
  if (name.includes(q)) score += 50;
  if (email.includes(q)) score += 40;

  const tokens = name.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith(q)) {
      score += 25;
    }
  }

  if (options.preferRecentRecipients && options.recentMap?.has(email)) {
    const recentInfo = options.recentMap.get(email);
    const recentBonus = Math.max(0, 40 - (recentInfo.index * 3));
    score += recentBonus;
  }

  if (options.preferSameDomain && options.senderDomain) {
    const emailDomain = email.split("@")[1] || "";
    if (emailDomain && emailDomain === options.senderDomain) {
      score += 35;
    }
  }

  return score;
}

async function getComposeSenderDomain(tabId) {
  try {
    if (!tabId) {
      return "";
    }

    const details = await browser.compose.getComposeDetails(tabId);
    const identityId = details.identityId;

    if (!identityId) {
      return "";
    }

    const accounts = await browser.accounts.list();

    for (const account of accounts) {
      for (const identity of account.identities || []) {
        if (identity.id === identityId) {
          const email = identity.email || "";
          return email.split("@")[1] || "";
        }
      }
    }
  } catch (e) {
    console.error("AutoMention getComposeSenderDomain error:", e);
  }
  return "";
}

async function searchContacts(query, tabId = null) {
  const settings = await getSettings();
  const all = await getAllAddressBookContacts();
  const recentMap = await getRecentContactsMap();
  const senderDomain = tabId ? await getComposeSenderDomain(tabId) : "";

  const scored = all.map((c) => ({
    ...c,
    score: scoreContact(query, c, {
      preferRecentRecipients: settings.preferRecentRecipients,
      preferSameDomain: settings.preferSameDomain,
      recentMap,
      senderDomain,
    }),
  }));

  const filtered = scored.filter((c) => c.score > 0);

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  const unique = [];
  const seen = new Set();
  for (const c of filtered) {
    const key = c.email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  // Adicionar sugestão baseada no domínio @cobrance.com.br ou email completo
  // Removida a restrição de comprimento mínimo para permitir buscas rápidas
  if (query) {
    const q = query.toLowerCase().trim();
    
    // 1. Se for um email completo (contém @ e .) e não estiver nos resultados da agenda
    if (q.includes("@") && q.includes(".") && !seen.has(q)) {
      unique.push({
        id: `external-${q}`,
        name: q.split("@")[0],
        email: q,
        isExternal: true
      });
    } 
    
    // 2. Sugestão proativa para domínios
    if (q.includes("@")) {
      // Se o usuário digitou algo como "usuario@dominio"
      const parts = q.split("@");
      const userPart = parts[0];
      const domainPart = parts.slice(1).join("@"); // Lida com múltiplos @ se houver
      
      if (userPart) {
        // Se já tem um domínio completo ou parcial (ex: @gmail.com ou @gmail)
        // Adicionamos como a primeira opção para que o usuário possa selecionar o que digitou
        unique.unshift({
          id: `dynamic-${q}`,
          name: userPart,
          email: q,
          isExternal: true
        });
      }
    } else {
      // Se não tem @ na query (ex: digitou apenas "bernardo")
      // Sugerimos o padrão @cobrance.com.br
      const cobranceEmail = `${q}@cobrance.com.br`;
      if (!seen.has(cobranceEmail)) {
        unique.unshift({
          id: `cobrance-${q}`,
          name: q,
          email: cobranceEmail,
          isExternal: true
        });
      }
    }
  }

  return unique.slice(0, settings.maxSuggestions || 10);
}

async function addRecipient(tabId, contact) {
  const settings = await getSettings();
  const mode = settings.recipientMode || "to";

  const details = await browser.compose.getComposeDetails(tabId);
  const current = details[mode] || [];

  const exists = current.some((r) => {
    const email = typeof r === "string" ? r : r.email || "";
    return email.toLowerCase() === contact.email.toLowerCase();
  });

  if (!exists) {
    current.push(`${contact.name} <${contact.email}>`);
    const update = { [mode]: current };
    await browser.compose.setComposeDetails(tabId, update);
    await saveRecentContact(contact);
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "automention-get-settings") {
    return getSettings().then((settings) => ({
      ok: true,
      settings,
      licenseValid: true,
    }));
  }

  if (message.type === "automention-save-settings") {
    const newSettings = normalizeSettings(message.settings || {});
    return browser.storage.local.set({ [SETTINGS_KEY]: newSettings }).then(() => ({
      ok: true,
      settings: newSettings,
    }));
  }

  if (message.type === "automention-search") {
    const tabId = sender?.tab?.id || null;

    return searchContacts(message.query || "", tabId)
      .then((results) => ({ ok: true, results }))
      .catch((error) => {
        console.error("AutoMention search error:", error);
        return { ok: false, error: error?.message || String(error) };
      });
  }

  if (message.type === "automention-add-recipient") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      return Promise.resolve({ ok: false, error: "No compose tab detected." });
    }

    return addRecipient(tabId, message.contact)
      .then(() => ({ ok: true }))
      .catch((error) => {
        console.error("AutoMention add recipient error:", error);
        return { ok: false, error: error?.message || String(error) };
      });
  }

  return false;
});

browser.compose.onBeforeSend.addListener(async (tab, details) => {
  try {
    await browser.tabs.sendMessage(tab.id, {
      type: "automention-clean-ui"
    });
  } catch (e) {
    console.error("AutoMention clean-ui error:", e);
  }
});
