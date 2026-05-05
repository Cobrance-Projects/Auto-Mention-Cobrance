(() => {
  console.log("AutoMention compose script loaded (v1.9.0 - FIXED)");

  if (window.__automentionLoaded) return;
  window.__automentionLoaded = true;

  let popup = null;
  let tabsContainer = null;
  let contentContainer = null;
  let currentTab = 1;
  let mentionStartRange = null;
  let currentQuery = "";
  let currentResults = [];
  let selectedIndex = 0;
  let searchDebounce = null;
  let currentSettings = null;
  let badgeEl = null;
  let toastEl = null;
  let toastTimer = null;

  // ── Estado do popup ──────────────────────────────────────────────────────────
  // CORREÇÃO BUG 1: Controle de foco mais preciso.
  // Em vez de uma flag booleana simples, verificamos se o foco está DENTRO do popup.
  function isInsidePopup(el) {
    return popup && el && popup.contains(el);
  }

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
      const response = await browser.runtime.sendMessage({ type: "automention-get-settings" });
      if (response?.ok) {
        currentSettings = { ...DEFAULTS, ...(response.settings || {}) };
      } else {
        currentSettings = { ...DEFAULTS };
      }
    } catch (error) {
      console.error("AutoMention refreshSettings error:", error);
      currentSettings = { ...DEFAULTS };
    }
    applyVisualState();
  }

  // ── Destinatários via API ────────────────────────────────────────────────────

  async function addRecipientViaAPI(email, name) {
    if (!currentSettings?.autoAddRecipient) return false;
    try {
      const response = await browser.runtime.sendMessage({
        type: "automention-add-recipient",
        contact: { email, name: name || email.split("@")[0] },
      });
      return !!response?.ok;
    } catch (error) {
      console.error("Erro na chamada addRecipient:", error);
      return false;
    }
  }

  // CORREÇÃO BUG 3: Remoção real via API do Thunderbird.
  async function removeRecipientViaAPI(email) {
    if (!email) return;
    try {
      await browser.runtime.sendMessage({
        type: "automention-remove-recipient",
        email,
      });
    } catch (error) {
      console.error("Erro na chamada removeRecipient:", error);
    }
  }

  // ── Popup ────────────────────────────────────────────────────────────────────

  function ensurePopup() {
    if (popup) return;

    popup = document.createElement("div");
    popup.id = "automention-popup";
    popup.hidden = true;
    popup.setAttribute("data-automention-ui", "true");
    popup.setAttribute("contenteditable", "false");
    popup.style.position = "fixed";
    popup.style.zIndex = "2147483647";

    tabsContainer = document.createElement("div");
    tabsContainer.className = "automention-tabs";

    const tab1 = document.createElement("button");
    tab1.className = "automention-tab active";
    tab1.setAttribute("data-tab", "1");
    tab1.textContent = "📇 Contatos";
    tab1.addEventListener("mousedown", (e) => { e.preventDefault(); switchTab(1); });

    const tab2 = document.createElement("button");
    tab2.className = "automention-tab";
    tab2.setAttribute("data-tab", "2");
    tab2.textContent = "💼 @cobrance.com.br";
    tab2.addEventListener("mousedown", (e) => { e.preventDefault(); switchTab(2); });

    const tab3 = document.createElement("button");
    tab3.className = "automention-tab";
    tab3.setAttribute("data-tab", "3");
    tab3.textContent = "✉️ Externo";
    tab3.addEventListener("mousedown", (e) => { e.preventDefault(); switchTab(3); });

    tabsContainer.appendChild(tab1);
    tabsContainer.appendChild(tab2);
    tabsContainer.appendChild(tab3);

    contentContainer = document.createElement("div");
    contentContainer.className = "automention-content-container";

    popup.appendChild(tabsContainer);
    popup.appendChild(contentContainer);

    document.documentElement.appendChild(popup);
  }

  function switchTab(tabNumber) {
    currentTab = tabNumber;
    selectedIndex = 0; // Reset ao trocar de aba

    const tabs = document.querySelectorAll(".automention-tab");
    tabs.forEach((tab) => {
      tab.classList.remove("active");
      if (parseInt(tab.getAttribute("data-tab")) === tabNumber) {
        tab.classList.add("active");
      }
    });

    renderTabContent();
    
    // Foco automático nos inputs das abas 2 e 3
    setTimeout(() => {
      const input = contentContainer.querySelector("input");
      if (input) {
        input.focus();
        // Move o cursor para o final do texto
        const val = input.value;
        input.value = "";
        input.value = val;
      }
    }, 10);
  }

  function renderTabContent() {
    if (!contentContainer) return;
    contentContainer.innerHTML = "";

    if (currentTab === 1) renderContactsList();
    else if (currentTab === 2) renderCobranceDomainInput();
    else if (currentTab === 3) renderExternalEmailInput();
  }

  function renderContactsList() {
    const listEl = document.createElement("div");
    listEl.className = "automention-list";

    // Filtra externos da aba de contatos
    const contactResults = currentResults.filter((item) => !item.isExternal);
    
    // Garante que o selectedIndex não ultrapasse o limite da lista filtrada
    if (selectedIndex >= contactResults.length) {
      selectedIndex = Math.max(0, contactResults.length - 1);
    }

    if (contactResults.length === 0) {
      const empty = document.createElement("div");
      empty.className = "automention-empty";
      empty.textContent = "Nenhum contato encontrado";
      listEl.appendChild(empty);
    } else {
      contactResults.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "automention-item" + (index === selectedIndex ? " selected" : "");

        const avatar = document.createElement("div");
        avatar.className = "automention-avatar";
        const initials = (item.name || "").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
        avatar.textContent = initials || "?";
        avatar.style.backgroundColor = currentSettings?.mentionColor || "#228B22";

        const content = document.createElement("div");
        content.className = "automention-content";

        const name = document.createElement("div");
        name.className = "automention-name";
        name.textContent = item.name;

        const email = document.createElement("div");
        email.className = "automention-email";
        email.textContent = item.email;

        content.appendChild(name);
        content.appendChild(email);
        row.appendChild(avatar);
        row.appendChild(content);

        row.addEventListener("mousedown", async (ev) => {
          ev.preventDefault();
          // Atualiza o selectedIndex para o item clicado antes de selecionar
          const originalIndex = currentResults.indexOf(item);
          selectedIndex = originalIndex;
          await selectResult(originalIndex);
        });

        listEl.appendChild(row);
      });
    }

    contentContainer.appendChild(listEl);
  }

  function renderCobranceDomainInput() {
    const container = document.createElement("div");
    container.className = "automention-input-container";

    const label = document.createElement("label");
    label.className = "automention-label";
    label.textContent = "Digite o nome de usuário:";

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "automention-input-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "automention-input";
    input.placeholder = "ex: bernardo";
    // Pré-preenche com a query atual (sem @ se houver)
    input.value = currentQuery.replace(/@.*$/, "");

    const domain = document.createElement("span");
    domain.className = "automention-domain";
    domain.textContent = "@cobrance.com.br";

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(domain);

    const button = document.createElement("button");
    button.className = "automention-btn-primary";
    button.textContent = "Adicionar";

    const doAdd = async () => {
      const username = input.value.trim();
      if (!username) return;
      
      // Garante que o foco volte para o editor antes de inserir a menção
      const editor = getEditorRoot();
      if (editor) editor.focus();
      
      await selectResult(-1, {
        name: username,
        email: `${username}@cobrance.com.br`,
        isExternal: true,
      });
    };

    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => { e.preventDefault(); doAdd(); });
    input.addEventListener("keydown", (e) => { 
      if (e.key === "Enter") { 
        e.preventDefault(); 
        e.stopPropagation();
        doAdd(); 
      } else if (e.key === "Tab") {
        // Permite que o Tab mude de aba mesmo dentro do input
        e.preventDefault();
        e.stopPropagation();
        switchTab(currentTab === 3 ? 1 : currentTab + 1);
      }
    });

    container.appendChild(label);
    container.appendChild(inputWrapper);
    container.appendChild(button);
    contentContainer.appendChild(container);

    // Foca no input após render
    requestAnimationFrame(() => input.focus());
  }

  function renderExternalEmailInput() {
    const container = document.createElement("div");
    container.className = "automention-input-container";

    const label = document.createElement("label");
    label.className = "automention-label";
    label.textContent = "Digite o email externo:";

    const input = document.createElement("input");
    input.type = "email";
    input.className = "automention-input";
    input.placeholder = "ex: contato@empresa.com";
    // Pré-preenche se a query já tem @
    input.value = currentQuery.includes("@") ? currentQuery : "";

    const button = document.createElement("button");
    button.className = "automention-btn-primary";
    button.textContent = "Adicionar";

    const doAdd = async () => {
      const email = input.value.trim();
      if (!email || !email.includes("@")) return;
      
      // Garante que o foco volte para o editor antes de inserir a menção
      const editor = getEditorRoot();
      if (editor) editor.focus();
      
      await selectResult(-1, {
        name: email.split("@")[0],
        email,
        isExternal: true,
      });
    };

    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => { e.preventDefault(); doAdd(); });
    input.addEventListener("keydown", (e) => { 
      if (e.key === "Enter") { 
        e.preventDefault(); 
        e.stopPropagation();
        doAdd(); 
      } else if (e.key === "Tab") {
        // Permite que o Tab mude de aba mesmo dentro do input
        e.preventDefault();
        e.stopPropagation();
        switchTab(currentTab === 3 ? 1 : currentTab + 1);
      }
    });

    container.appendChild(label);
    container.appendChild(input);
    container.appendChild(button);
    contentContainer.appendChild(container);

    requestAnimationFrame(() => input.focus());
  }

  // CORREÇÃO BUG 1: hidePopup agora limpa tudo de forma confiável.
  function hidePopup() {
    if (!popup) return;
    popup.hidden = true;
    popup.style.display = "none"; // Força o desaparecimento visual
    if (contentContainer) contentContainer.innerHTML = "";
    currentResults = [];
    selectedIndex = 0;
    currentTab = 1;
    // Reseta os tabs visualmente
    if (tabsContainer) {
      tabsContainer.querySelectorAll(".automention-tab").forEach((t, i) => {
        t.classList.toggle("active", i === 0);
      });
    }
  }

  function showPopup(rect) {
    ensurePopup();

    // Posiciona logo abaixo do cursor
    const left = rect ? Math.max(8, rect.left + window.scrollX) : 20;
    const top = rect ? rect.bottom + window.scrollY + 6 : 20;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.display = "flex"; // Restaura o display
    popup.hidden = false;
  }

  // ── Badge & Toast ────────────────────────────────────────────────────────────

  function ensureBadge() {
    if (badgeEl) return badgeEl;
    badgeEl = document.createElement("div");
    badgeEl.id = "automention-live-badge";
    badgeEl.textContent = "AutoMention ATIVO";
    Object.assign(badgeEl.style, {
      position: "fixed", right: "16px", bottom: "16px",
      zIndex: "2147483647", padding: "7px 12px", borderRadius: "999px",
      background: "#1d4ed8", color: "#fff", fontSize: "12px",
      fontWeight: "700", fontFamily: "Arial, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)", pointerEvents: "none", display: "none",
    });
    badgeEl.setAttribute("data-automention-ui", "true");
    badgeEl.setAttribute("contenteditable", "false");
    document.documentElement.appendChild(badgeEl);
    return badgeEl;
  }

  function setBadgeVisible(visible) {
    ensureBadge().style.display = visible ? "block" : "none";
  }

  function showToast(message) {
    if (!currentSettings?.toastEnabled) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "automention-toast";
      toastEl.setAttribute("data-automention-ui", "true");
      toastEl.setAttribute("contenteditable", "false");
      Object.assign(toastEl.style, {
        position: "fixed", left: "50%", bottom: "28px",
        transform: "translateX(-50%)", zIndex: "2147483647",
        background: "#111", color: "#fff", padding: "8px 14px",
        borderRadius: "8px", fontSize: "13px", fontWeight: "500",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        opacity: "0", transition: "opacity 120ms ease", pointerEvents: "none",
      });
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.style.opacity = "1";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) { toastEl.style.opacity = "0"; }
    }, 1800);
  }

  // ── Helpers DOM ──────────────────────────────────────────────────────────────

  function getEditorRoot() {
    return document.querySelector('[contenteditable="true"]') || document.body;
  }

  function ensureFooter() {
    const editor = getEditorRoot();
    if (!editor || editor.querySelector('[data-automention-footer="1"]')) return;
    const footer = document.createElement("div");
    footer.setAttribute("data-automention-footer", "1");
    footer.style.cssText = "margin-top:18px;padding-top:10px;border-top:1px solid rgba(120,120,120,0.35);font-size:12px;color:#666;";
    footer.textContent = "Enviado com AutoMention";
    editor.appendChild(footer);
  }

  function removeFooter() {
    document.querySelectorAll('[data-automention-footer="1"]').forEach((el) => el.remove());
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
      if (!(el instanceof HTMLElement)) return;
      if (currentSettings?.highlightMentions) {
        el.style.cssText = `display:inline-block;padding:1px 6px;margin:0 1px;border-radius:999px;background:${hexToRgba(color, 0.14)};color:${color};border:1px solid ${hexToRgba(color, 0.28)};font-weight:600;white-space:nowrap;`;
      } else {
        el.style.cssText = "";
      }
    });
  }

  function applyVisualState() {
    const enabled = !!currentSettings?.enabled;
    const showBadge = !!currentSettings?.showActiveBadge;
    const addFooter = !!currentSettings?.appendFooter;
    setBadgeVisible(enabled && showBadge);
    if (enabled && addFooter) ensureFooter(); else removeFooter();
    if (!enabled) hidePopup();
    refreshMentionHighlightStyles();
  }

  // ── Seleção & Busca ──────────────────────────────────────────────────────────

  function getSelectionRange() {
    const sel = window.getSelection();
    return (sel && sel.rangeCount > 0) ? sel.getRangeAt(0) : null;
  }

  function cloneRange(range) {
    return range ? range.cloneRange() : null;
  }

  function findTextNodeNearCaret(range) {
    let node = range.startContainer;
    let offset = range.startOffset;
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) return { node, offset };
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (offset > 0 && node.childNodes[offset - 1]) {
        let candidate = node.childNodes[offset - 1];
        while (candidate?.lastChild) candidate = candidate.lastChild;
        if (candidate?.nodeType === Node.TEXT_NODE) return { node: candidate, offset: candidate.textContent.length };
      }
      if (node.childNodes[offset]) {
        let candidate = node.childNodes[offset];
        while (candidate?.firstChild) candidate = candidate.firstChild;
        if (candidate?.nodeType === Node.TEXT_NODE) return { node: candidate, offset: 0 };
      }
    }
    return null;
  }

  function findMentionQuery() {
    const range = getSelectionRange();
    if (!range || !range.collapsed) return null;

    const resolved = findTextNodeNearCaret(range);
    if (!resolved) return null;

    const { node, offset } = resolved;
    const text = node.textContent || "";
    const before = text.slice(0, offset);

    const trigger = currentSettings?.triggerChar || "@";
    const safeTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(^|\\s)${safeTrigger}([a-zA-Z0-9.@+_-]*)$`);
    const match = before.match(regex);
    if (!match) return null;

    const query = match[2] || "";
    const fullMatch = match[0];
    const triggerIndex = before.length - fullMatch.length + (match[1] ? match[1].length : 0);
    if (triggerIndex < 0) return null;
    if (!query && !currentSettings?.showOnEmptyQuery) return null;

    const startRange = document.createRange();
    startRange.setStart(node, triggerIndex);
    startRange.setEnd(node, offset);

    return { query, range: startRange, caretRect: range.getBoundingClientRect() };
  }

  // ── Nó de menção ────────────────────────────────────────────────────────────

  function formatDisplayName(rawName) {
    if (!rawName) return "";
    return rawName.replace(/[._-]/g, " ")
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  function createMentionNode(item) {
    const trigger = currentSettings?.triggerChar || "@";
    const color = currentSettings?.mentionColor || "#228B22";

    let displayName = item.name;
    if (item.isExternal || item.name === item.email) {
      displayName = formatDisplayName(item.email.split("@")[0]);
    }

    if (!currentSettings?.highlightMentions) {
      return document.createTextNode(`${trigger}${displayName}`);
    }

    const span = document.createElement("span");
    span.setAttribute("data-automention-mention", "1");
    span.setAttribute("data-email", item.email || "");
    span.setAttribute("contenteditable", "false");
    span.style.cssText = `display:inline-block;padding:1px 6px;margin:0 1px;border-radius:999px;background:${hexToRgba(color, 0.14)};color:${color};border:1px solid ${hexToRgba(color, 0.28)};font-weight:600;white-space:nowrap;cursor:pointer;`;
    span.title = `Clique para enviar e-mail para ${item.email}`;
    span.textContent = `${trigger}${displayName}`;

    // Funcionalidade mailto: abre nova tela de e-mail ao clicar
    span.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`mailto:${item.email}`, "_blank");
    });

    return span;
  }

  // ── Encontrar e deletar menção no caret ─────────────────────────────────────

  function findMentionAtCaret() {
    const range = getSelectionRange();
    if (!range || !range.collapsed) return null;

    const node = range.startContainer;
    const offset = range.startOffset;

    if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
      const prev = node.childNodes[offset - 1];
      if (prev?.getAttribute?.("data-automention-mention") === "1") return prev;
    }

    if (node.nodeType === Node.TEXT_NODE && offset === 0) {
      const prev = node.previousSibling;
      if (prev?.getAttribute?.("data-automention-mention") === "1") return prev;
    }

    return null;
  }

  async function deleteMentionNode(mentionNode) {
    if (!mentionNode) return;

    const email = mentionNode.getAttribute("data-email");

    // Remove espaço-no-break seguinte se existir
    const next = mentionNode.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && next.textContent === "\u00A0") next.remove();

    // Posiciona cursor antes de remover o nó
    const range = document.createRange();
    const sel = window.getSelection();
    const prev = mentionNode.previousSibling;
    if (prev?.nodeType === Node.TEXT_NODE) {
      range.setStart(prev, prev.textContent.length);
    } else if (mentionNode.parentNode) {
      range.setStartBefore(mentionNode);
    }
    range.collapse(true);

    mentionNode.remove();

    sel.removeAllRanges();
    sel.addRange(range);

    // CORREÇÃO BUG 3: Remove o destinatário via API
    if (email) {
      await removeRecipientViaAPI(email);
      showToast(`Menção removida`);
    }
  }

  // ── selectResult ─────────────────────────────────────────────────────────────

  async function selectResult(index, customItem = null) {
    if (!currentSettings?.enabled) { hidePopup(); return; }

    const item = customItem || currentResults[index];
    if (!item) return;

    // CORREÇÃO BUG 1: Se não há mentionStartRange (veio de input nas abas),
    // tenta recuperar da posição atual do cursor.
    let range = mentionStartRange;
    if (!range) {
      range = getSelectionRange();
    }
    if (!range) { hidePopup(); return; }

    const sel = window.getSelection();
    if (!sel) { hidePopup(); return; }

    sel.removeAllRanges();
    sel.addRange(range);

    const mentionNode = createMentionNode(item);
    range.deleteContents();
    range.insertNode(mentionNode);

    // Insere espaço após a menção
    const spacer = document.createTextNode("\u00A0");
    if (mentionNode.parentNode) {
      mentionNode.parentNode.insertBefore(spacer, mentionNode.nextSibling);
    }

    const afterRange = document.createRange();
    afterRange.setStart(spacer, 1);
    afterRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(afterRange);

    // CORREÇÃO BUG 1: Esconde popup ANTES de qualquer await
    hidePopup();
    mentionStartRange = null;
    currentQuery = "";
    
    // Força o fechamento novamente após um pequeno delay para garantir
    setTimeout(hidePopup, 50);

    // Adiciona destinatário
    const success = await addRecipientViaAPI(item.email, item.name);
    showToast(success ? `${item.name || item.email} adicionado` : `Erro ao adicionar ${item.email}`);
  }

  // ── Busca ────────────────────────────────────────────────────────────────────

  async function doSearch(query, rect) {
    if (!currentSettings?.enabled) { hidePopup(); return; }

    const response = await browser.runtime.sendMessage({ type: "automention-search", query });
    if (!response?.ok) { hidePopup(); return; }

    currentResults = response.results || [];
    selectedIndex = 0; // Reset ao fazer nova busca

    if (!currentResults.length) {
      hidePopup();
      showToast("Nenhum contato encontrado");
      return;
    }

    renderTabContent();
    showPopup(rect);
  }

  function moveSelection(delta) {
    // Filtra conforme a aba atual para mover corretamente
    const visibleResults = currentTab === 1 
      ? currentResults.filter(item => !item.isExternal)
      : [];
      
    if (!visibleResults.length) return;
    
    selectedIndex = (selectedIndex + delta + visibleResults.length) % visibleResults.length;
    renderTabContent();
    
    // Scroll automático para o item selecionado
    const selectedEl = contentContainer.querySelector(".automention-item.selected");
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }

  // ── handleEditorInput ────────────────────────────────────────────────────────

  function handleEditorInput() {
    if (!currentSettings?.enabled) { hidePopup(); return; }
    applyVisualState();

    // CORREÇÃO BUG 1: Não interrompe se o foco está dentro do popup
    // (o usuário pode estar digitando nos inputs das abas 2 e 3)
    if (document.activeElement && isInsidePopup(document.activeElement)) {
      return;
    }

    const mention = findMentionQuery();
    if (!mention) {
      // Só fecha se o popup não está exibindo inputs das abas 2/3
      if (currentTab === 1) hidePopup();
      mentionStartRange = null;
      currentQuery = "";
      return;
    }

    currentQuery = mention.query;
    // Sempre atualiza o range se estivermos na aba 1 ou se o range for novo
    if (currentTab === 1 || !mentionStartRange) {
      mentionStartRange = cloneRange(mention.range);
    }

    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      doSearch(currentQuery, mention.caretRect);
    }, 80);
  }

  function scheduleMentionRefresh() {
    setTimeout(handleEditorInput, 0);
    setTimeout(handleEditorInput, 60);
  }

  function getCaretRectFallback() {
    const range = getSelectionRange();
    if (!range) return { left: 20, bottom: 20 };
    const rect = range.getBoundingClientRect();
    return (rect && (rect.left || rect.top || rect.bottom)) ? rect : { left: 20, bottom: 20 };
  }

  async function maybeOpenRecentContactsImmediately(ev) {
    const trigger = currentSettings?.triggerChar || "@";
    if (ev.key !== trigger || !currentSettings?.enabled || !currentSettings?.showOnEmptyQuery || !currentSettings?.showRecentContacts) return;
    setTimeout(async () => {
      const rect = getCaretRectFallback();
      await doSearch("", rect);
    }, 0);
  }

  function warmupComposer() {
    setTimeout(handleEditorInput, 0);
    setTimeout(handleEditorInput, 80);
    setTimeout(handleEditorInput, 200);
  }

  // ── Event Listeners ──────────────────────────────────────────────────────────

  document.addEventListener("keydown", async (ev) => {
    await maybeOpenRecentContactsImmediately(ev);

    if (ev.key === "Backspace") {
      const mentionNode = findMentionAtCaret();
      if (mentionNode) {
        ev.preventDefault();
        await deleteMentionNode(mentionNode);
        scheduleMentionRefresh();
        return;
      }
    }

    if (ev.key.length === 1 || ev.key === "Backspace" || ev.key === "Delete") {
      setTimeout(handleEditorInput, 0);
    }

    if (!popup || popup.hidden) return;

    if (ev.key === "Tab") {
      ev.preventDefault();
      // Navegação cíclica entre abas: 1 -> 2 -> 3 -> 1
      const nextTab = currentTab === 3 ? 1 : currentTab + 1;
      switchTab(nextTab);
      return;
    }

    switch (ev.key) {
      case "ArrowDown": ev.preventDefault(); moveSelection(1); break;
      case "ArrowUp":   ev.preventDefault(); moveSelection(-1); break;
      case "Enter":
        // Intercepta Enter se o popup estiver visível
        ev.preventDefault();
        ev.stopPropagation();
        
        if (currentTab === 1) {
          // Na aba de contatos, usa o item selecionado pelas setas
          const contactResults = currentResults.filter(item => !item.isExternal);
          const item = contactResults[selectedIndex];
          if (item) {
            const originalIndex = currentResults.indexOf(item);
            await selectResult(originalIndex);
          }
        } else {
          // Nas abas de input, tenta encontrar o botão de adicionar e clica nele
          const btn = contentContainer.querySelector(".automention-btn-primary");
          if (btn) btn.click();
        }
        break;
      case "Escape":
        ev.preventDefault();
        hidePopup();
        break;
    }
  }, true);

  document.addEventListener("mousedown", (ev) => {
    // Se o popup está visível e o clique foi fora dele
    if (popup && !popup.hidden && !popup.contains(ev.target)) {
      hidePopup();
      // Pequeno delay para evitar que o clique dispare uma nova busca imediatamente
      setTimeout(handleEditorInput, 10);
    }
  }, true);

  document.addEventListener("selectionchange", () => {
    // CORREÇÃO BUG 1: não atualiza se foco está no popup
    if (isInsidePopup(document.activeElement)) return;
    scheduleMentionRefresh();
  }, true);

  document.addEventListener("focusin", (ev) => {
    // CORREÇÃO BUG 1: se foco entrou no popup, não faz nada com handleEditorInput
    if (isInsidePopup(ev.target)) return;
    warmupComposer();
  }, true);

  document.addEventListener("mouseup", () => {
    if (isInsidePopup(document.activeElement)) return;
    warmupComposer();
  }, true);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "automention-toast") showToast(msg.message || "Ok");
    if (msg?.type === "automention-clean-ui") {
      document.querySelectorAll('[data-automention-ui="true"]').forEach((el) => el.remove());
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────────────
  refreshSettings();
  setTimeout(warmupComposer, 300);
  setInterval(refreshSettings, 30000); // Reduzido de 1s para não spammar mensagens
})();