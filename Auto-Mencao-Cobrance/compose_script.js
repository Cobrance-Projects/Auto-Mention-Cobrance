(() => {
  console.log("AutoMention compose script loaded (UNLOCKED)");

  if (window.__automentionLoaded) {
    return;
  }
  window.__automentionLoaded = true;

  let popup = null;
  let listEl = null;
  let mentionStartRange = null;
  let currentQuery = "";
  let currentResults = [];
  let selectedIndex = 0;
  let searchDebounce = null;
  let currentSettings = null;
  let currentLicenseValid = true; // Forçado para true
  let badgeEl = null;
  let toastEl = null;
  let toastTimer = null;

  const DEFAULTS = {
    enabled: true,
    autoAddRecipient: true,
    recipientMode: "to",
    maxSuggestions: 10,
    triggerChar: "@",
    showOnEmptyQuery: true,
    showRecentContacts: true,
    showActiveBadge: true,
    appendFooter: false, 
    toastEnabled: true,
    preferSameDomain: true,
    preferRecentRecipients: true,
    highlightMentions: true,
    mentionColor: "#228B22",
  };

  async function refreshSettings() {
    try {
      const response = await browser.runtime.sendMessage({
        type: "automention-get-settings",
      });

      if (response?.ok) {
        currentSettings = { ...DEFAULTS, ...(response.settings || {}) };
        currentLicenseValid = true; // Sempre true para teste interno
      } else {
        currentSettings = { ...DEFAULTS };
        currentLicenseValid = true;
      }
    } catch (error) {
      console.error("AutoMention refreshSettings error:", error);
      currentSettings = { ...DEFAULTS };
      currentLicenseValid = true;
    }

    applyVisualState();
  }

  function ensurePopup() {
    if (popup) return;

    popup = document.createElement("div");
    popup.id = "automention-popup";
    popup.hidden = true;
    popup.setAttribute("data-automention-ui", "true");
    popup.setAttribute("contenteditable", "false");
    popup.style.position = "fixed";
    popup.style.zIndex = "2147483647";


    listEl = document.createElement("div");
    listEl.className = "automention-list";
    popup.appendChild(listEl);

    document.documentElement.appendChild(popup);
  }

	function hidePopup() {
	  if (!popup) return;
	  popup.hidden = true;
	  if (listEl) {
		listEl.innerHTML = "";
	  }
	  currentResults = [];
	  selectedIndex = 0;
	}

  function showPopup(rect) {
    ensurePopup();

    let left = 20;
    let top = 20;

    if (rect) {
      left = Math.max(8, rect.left + window.scrollX);
      top = rect.bottom + window.scrollY + 6;
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.hidden = false;
  }

  function ensureBadge() {
    if (badgeEl) {
      return badgeEl;
    }

    badgeEl = document.createElement("div");
    badgeEl.id = "automention-live-badge";
    badgeEl.textContent = "AutoMention UNLOCKED"; // Texto alterado para indicar desbloqueio
    badgeEl.style.position = "fixed";
    badgeEl.style.right = "16px";
    badgeEl.style.bottom = "16px";
    badgeEl.style.zIndex = "2147483647";
    badgeEl.style.padding = "7px 12px";
    badgeEl.style.borderRadius = "999px";
    badgeEl.style.background = "#1d4ed8"; // Azul para diferenciar
    badgeEl.style.color = "#fff";
    badgeEl.style.fontSize = "12px";
    badgeEl.style.fontWeight = "700";
    badgeEl.style.fontFamily = "Arial, sans-serif";
    badgeEl.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
    badgeEl.style.pointerEvents = "none";
    badgeEl.style.display = "none";
	badgeEl.setAttribute("data-automention-ui", "true");
	badgeEl.setAttribute("contenteditable", "false");

    document.documentElement.appendChild(badgeEl);
    return badgeEl;
  }

  function setBadgeVisible(visible) {
    const badge = ensureBadge();
    badge.style.display = visible ? "block" : "none";
  }

  function showToast(message) {
    if (!currentSettings?.toastEnabled) {
      return;
    }

    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "automention-toast";
	  toastEl.setAttribute("data-automention-ui", "true");
	  toastEl.setAttribute("contenteditable", "false");
      toastEl.style.position = "fixed";
      toastEl.style.left = "50%";
      toastEl.style.bottom = "28px";
      toastEl.style.transform = "translateX(-50%)";
      toastEl.style.zIndex = "2147483647";
      toastEl.style.background = "#111";
      toastEl.style.color = "#fff";
      toastEl.style.padding = "8px 14px";
      toastEl.style.borderRadius = "8px";
      toastEl.style.fontSize = "13px";
      toastEl.style.fontWeight = "500";
      toastEl.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
      toastEl.style.opacity = "0";
      toastEl.style.transition = "opacity 120ms ease";
      toastEl.style.pointerEvents = "none";

      document.documentElement.appendChild(toastEl);
    }

    toastEl.textContent = message;
    toastEl.style.opacity = "1";

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

	toastTimer = setTimeout(() => {
	  if (toastEl) {
		toastEl.remove();
		toastEl = null;
	  }
	}, 1500);
  }

  function getEditorRoot() {
    const editable = document.querySelector('[contenteditable="true"]');
    if (editable) {
      return editable;
    }

    for (const body of [...document.querySelectorAll("body")]) {
      if (body && body.isContentEditable) {
        return body;
      }
    }

    return document.body;
  }

  function ensureFooter() {
    const editor = getEditorRoot();
    if (!editor) return;

    const existing = editor.querySelector?.('[data-automention-footer="1"]');
    if (existing) return;

    const footer = document.createElement("div");
    footer.setAttribute("data-automention-footer", "1");
    footer.style.marginTop = "18px";
    footer.style.paddingTop = "10px";
    footer.style.borderTop = "1px solid rgba(120,120,120,0.35)";
    footer.style.fontSize = "12px";
    footer.style.color = "#666";
    footer.textContent = "Sent with AutoMention (Internal Test)";

    editor.appendChild(footer);
  }

  function removeFooter() {
    document
      .querySelectorAll('[data-automention-footer="1"]')
      .forEach((el) => el.remove());
  }

  function hexToRgba(hex, alpha) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
      r = parseInt(hex[1] + hex[2], 16);
      g = parseInt(hex[3] + hex[4], 16);
      b = parseInt(hex[5] + hex[6], 16);
    }
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function refreshMentionHighlightStyles() {
    const mentions = document.querySelectorAll('[data-automention-mention="1"]');
    const color = currentSettings?.mentionColor || "#228B22";

    mentions.forEach((el) => {
      if (!(el instanceof HTMLElement)) {
        return;
      }

      if (currentSettings?.highlightMentions) {
        el.style.display = "inline-block";
        el.style.padding = "1px 6px";
        el.style.margin = "0 1px";
        el.style.borderRadius = "999px";
        el.style.background = hexToRgba(color, 0.14);
        el.style.color = color;
        el.style.border = `1px solid ${hexToRgba(color, 0.28)}`;
        el.style.fontWeight = "600";
        el.style.whiteSpace = "nowrap";
      } else {
        el.style.display = "";
        el.style.padding = "";
        el.style.margin = "";
        el.style.borderRadius = "";
        el.style.background = "";
        el.style.color = "";
        el.style.border = "";
        el.style.fontWeight = "";
        el.style.whiteSpace = "";
      }
    });
  }

  function applyVisualState() {
    const enabled = !!currentSettings?.enabled;
    const showBadge = !!currentSettings?.showActiveBadge;
    const addFooter = !!currentSettings?.appendFooter;

    setBadgeVisible(enabled && showBadge);

    if (enabled && addFooter) {
      ensureFooter();
    } else {
      removeFooter();
    }

    if (!enabled) {
      hidePopup();
    }

    refreshMentionHighlightStyles();
  }

  function getSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return null;
    }
    return sel.getRangeAt(0);
  }

  function cloneRange(range) {
    return range ? range.cloneRange() : null;
  }

  function findTextNodeNearCaret(range) {
    let node = range.startContainer;
    let offset = range.startOffset;

    if (!node) {
      return null;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return { node, offset };
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      if (offset > 0 && node.childNodes[offset - 1]) {
        let candidate = node.childNodes[offset - 1];
        while (candidate && candidate.lastChild) {
          candidate = candidate.lastChild;
        }
        if (candidate && candidate.nodeType === Node.TEXT_NODE) {
          return { node: candidate, offset: candidate.textContent.length };
        }
      }

      if (node.childNodes[offset]) {
        let candidate = node.childNodes[offset];
        while (candidate && candidate.firstChild) {
          candidate = candidate.firstChild;
        }
        if (candidate && candidate.nodeType === Node.TEXT_NODE) {
          return { node: candidate, offset: 0 };
        }
      }
    }

    return null;
  }

  function findMentionQuery() {
    const range = getSelectionRange();
    if (!range || !range.collapsed) {
      return null;
    }

    const resolved = findTextNodeNearCaret(range);
    if (!resolved) {
      return null;
    }

    const node = resolved.node;
    const offset = resolved.offset;
    const text = node.textContent || "";
    const before = text.slice(0, offset);

    const trigger = currentSettings?.triggerChar || "@";
    const safeTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Regex: permite @ interno para emails completos, mas garante que comece com o trigger após espaço ou início de linha
    const regex = new RegExp(`(^|\\s)${safeTrigger}([a-zA-Z0-9.@+_-]*)$`);
    const match = before.match(regex);

    if (!match) {
      return null;
    }

    const query = match[2] || "";
    
    // Em vez de pegar o último @, pegamos o @ que corresponde ao início da captura do regex
    // match[1] é o prefixo (espaço ou vazio), match[0] é a string inteira capturada
    const fullMatch = match[0];
    const triggerIndex = before.length - fullMatch.length + (match[1] ? match[1].length : 0);
    if (triggerIndex < 0) {
      return null;
    }

    if (!query && !currentSettings?.showOnEmptyQuery) {
      return null;
    }

    const startRange = document.createRange();
    startRange.setStart(node, triggerIndex);
    startRange.setEnd(node, offset);

    return {
      query,
      range: startRange,
      caretRect: range.getBoundingClientRect(),
    };
  }

  function renderResults() {
    if (!listEl) return;
    listEl.innerHTML = "";

    currentResults.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "automention-item" + (index === selectedIndex ? " selected" : "");

      const avatar = document.createElement("div");
      avatar.className = "automention-avatar";
      const initials = (item.name || "").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
      avatar.textContent = initials || "?";
      avatar.style.backgroundColor = currentSettings?.mentionColor || "#228B22";

      const content = document.createElement("div");
      content.className = "automention-content";

      const name = document.createElement("div");
      name.className = "automention-name";
      
      let displayName = item.name;
      if (item.isExternal || (item.email && item.name === item.email)) {
        const username = item.email.split("@")[0];
        displayName = formatDisplayName(username);
      }

      if (currentQuery) {
        // Escapa caracteres especiais da query para o regex
        const escapedQuery = currentQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(${escapedQuery})`, "gi");
        name.innerHTML = displayName.replace(regex, "<strong>$1</strong>");
      } else {
        name.textContent = displayName;
      }

      const email = document.createElement("div");
      email.className = "automention-email";
      email.textContent = item.email;

      content.appendChild(name);
      content.appendChild(email);
      row.appendChild(avatar);
      row.appendChild(content);

      row.addEventListener("mousedown", async (ev) => {
        ev.preventDefault();
        await selectResult(index);
      });

      listEl.appendChild(row);
    });
  }

  async function doSearch(query, rect) {
    if (!currentSettings?.enabled) {
      hidePopup();
      return;
    }

    const response = await browser.runtime.sendMessage({
      type: "automention-search",
      query,
    });

    if (!response?.ok) {
      hidePopup();
      return;
    }

    currentResults = response.results || [];
    selectedIndex = 0;

    if (!currentResults.length) {
      hidePopup();
      showToast("No contacts found");
      return;
    }

    renderResults();
    showPopup(rect);
  }

  function formatDisplayName(rawName) {
    if (!rawName) return "";
    // Substitui pontos, sublinhados e hifens por espaços
    let formatted = rawName.replace(/[._-]/g, " ");
    // Capitaliza a primeira letra de cada palavra
    return formatted
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  function createMentionNode(item) {
    const trigger = currentSettings?.triggerChar || "@";
    const color = currentSettings?.mentionColor || "#228B22";

    // Se for um contato externo (não está na agenda), usar apenas o antecessor do @ formatado
    let displayName = item.name;
    if (item.isExternal || (item.email && item.name === item.email)) {
      const username = item.email.split("@")[0];
      displayName = formatDisplayName(username);
    }

    if (!currentSettings?.highlightMentions) {
      return document.createTextNode(`${trigger}${displayName}`);
    }

    const span = document.createElement("span");
    span.setAttribute("data-automention-mention", "1");
    span.setAttribute("data-email", item.email || "");
    span.setAttribute("contenteditable", "false");
    span.style.display = "inline-block";
    span.style.padding = "1px 6px";
    span.style.margin = "0 1px";
    span.style.borderRadius = "999px";
    span.style.background = hexToRgba(color, 0.14);
    span.style.color = color;
    span.style.border = `1px solid ${hexToRgba(color, 0.28)}`;
    span.style.fontWeight = "600";
    span.style.whiteSpace = "nowrap";
    span.style.cursor = "pointer";
    span.title = `mailto:${item.email}`;
    
    const link = document.createElement("a");
    link.href = `mailto:${item.email}`;
    link.style.color = "inherit";
    link.style.textDecoration = "none";
    link.textContent = `${trigger}${displayName}`;
    link.onclick = (e) => {
      e.preventDefault();
      window.open(`mailto:${item.email}`, "_blank");
    };
    
    span.appendChild(link);

    return span;
  }

  async function selectResult(index) {
    if (!currentSettings?.enabled) {
      hidePopup();
      return;
    }

    const item = currentResults[index];
    if (!item || !mentionStartRange) {
      return;
    }

    const sel = window.getSelection();
    if (!sel) {
      return;
    }

    sel.removeAllRanges();
    sel.addRange(mentionStartRange);

    const mentionNode = createMentionNode(item);
    mentionStartRange.deleteContents();
    mentionStartRange.insertNode(mentionNode);

    const spacer = document.createTextNode("\u00A0");
    if (mentionNode.parentNode) {
      mentionNode.parentNode.insertBefore(spacer, mentionNode.nextSibling);
    }

    const afterRange = document.createRange();
    afterRange.setStart(spacer, 1);
    afterRange.collapse(true);

    sel.removeAllRanges();
    sel.addRange(afterRange);

    hidePopup();

    if (currentSettings?.autoAddRecipient) {
      const addResp = await browser.runtime.sendMessage({
        type: "automention-add-recipient",
        contact: item,
      });

      console.log("AutoMention add recipient response:", addResp);
      showToast(`${item.name} added to recipients`);
    } else {
      showToast(`${item.name} mentioned`);
    }
  }

  function moveSelection(delta) {
    if (!currentResults.length) return;
    selectedIndex = (selectedIndex + delta + currentResults.length) % currentResults.length;
    renderResults();
  }

  function handleEditorInput() {
    if (!currentSettings?.enabled) {
      hidePopup();
      return;
    }

    applyVisualState();

    const mention = findMentionQuery();
    if (!mention) {
      hidePopup();
      mentionStartRange = null;
      currentQuery = "";
      return;
    }

    currentQuery = mention.query;
    mentionStartRange = cloneRange(mention.range);

    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      // Forçamos a busca mesmo que a query seja curta para mostrar a sugestão @cobrance.com.br
      doSearch(currentQuery, mention.caretRect);
    }, 50); // Reduzido para 50ms para resposta instantânea
  }

  function scheduleMentionRefresh() {
    setTimeout(() => {
      handleEditorInput();
    }, 0);

    setTimeout(() => {
      handleEditorInput();
    }, 60);
  }

  function getCaretRectFallback() {
    const range = getSelectionRange();
    if (!range) {
      return { left: 20, bottom: 20 };
    }

    const rect = range.getBoundingClientRect();
    if (rect && (rect.left || rect.top || rect.bottom)) {
      return rect;
    }

    return { left: 20, bottom: 20 };
  }

  async function maybeOpenRecentContactsImmediately(ev) {
    const trigger = currentSettings?.triggerChar || "@";

    if (
      ev.key !== trigger ||
      !currentSettings?.enabled ||
      !currentSettings?.showOnEmptyQuery ||
      !currentSettings?.showRecentContacts
    ) {
      return;
    }

    setTimeout(async () => {
      const rect = getCaretRectFallback();
      await doSearch("", rect);
    }, 0);
  }

  function warmupComposer() {
    setTimeout(() => {
      handleEditorInput();
    }, 0);

    setTimeout(() => {
      handleEditorInput();
    }, 80);

    setTimeout(() => {
      handleEditorInput();
    }, 180);
  }

  document.addEventListener(
    "keydown",
    async (ev) => {
      await maybeOpenRecentContactsImmediately(ev);

      const trigger = currentSettings?.triggerChar || "@";
      if (
        ev.key === trigger ||
        ev.key.length === 1 ||
        ev.key === "Backspace" ||
        ev.key === "Delete"
      ) {
        setTimeout(() => {
          handleEditorInput();
        }, 0);
      }

      if (!popup || popup.hidden) {
        return;
      }

      switch (ev.key) {
        case "ArrowDown":
          ev.preventDefault();
          moveSelection(1);
          break;
        case "ArrowUp":
          ev.preventDefault();
          moveSelection(-1);
          break;
        case "Enter":
        case "Tab":
          ev.preventDefault();
          await selectResult(selectedIndex);
          break;
        case "Escape":
          ev.preventDefault();
          hidePopup();
          break;
      }
    },
    true
  );

  document.addEventListener(
    "click",
    () => {
      setTimeout(() => {
        applyVisualState();
        handleEditorInput();
      }, 0);
    },
    true
  );

  document.addEventListener(
    "selectionchange",
    () => {
      if (currentSettings?.showOnEmptyQuery) {
        scheduleMentionRefresh();
      }
    },
    true
  );

  document.addEventListener(
    "focusin",
    () => {
      warmupComposer();
    },
    true
  );

  document.addEventListener(
    "mouseup",
    () => {
      warmupComposer();
    },
    true
  );

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "automention-toast") {
      showToast(msg.message || "Done");
    }
  });
  
	browser.runtime.onMessage.addListener((msg) => {
	  if (msg.type === "automention-clean-ui") {
		document
		  .querySelectorAll('[data-automention-ui="true"]')
		  .forEach(el => el.remove());
	  }
	});  

  refreshSettings();
  setTimeout(() => {
    warmupComposer();
  }, 300);
  setInterval(refreshSettings, 1000);
})();
