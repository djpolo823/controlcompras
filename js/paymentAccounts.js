/* ═══════════════════════════════════════════════════════════════
   paymentAccounts.js — Módulo de cuentas de pago
   Self-contained IIFE. Exposes window.PaymentAccounts.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────────────────────
     CONSTANTS
  ───────────────────────────────────────── */
  const STORAGE_KEY   = 'gastos_ia_payment_accounts';
  const LAST_USED_KEY = 'gastos_ia_last_payment_account';
  const SCHEMA_VERSION = 1;

  const TYPE_LABELS = {
    bank:        'Banco',
    credit_card: 'Tarjeta de crédito',
    wallet:      'Billetera digital',
    cash:        'Efectivo',
  };

  const TYPE_GROUPS = [
    { type: 'bank',        label: '🏦 Bancos' },
    { type: 'credit_card', label: '💳 Tarjetas' },
    { type: 'wallet',      label: '📱 Billeteras' },
    { type: 'cash',        label: '💵 Efectivo' },
  ];

  const COLOR_PALETTE = [
    { id: 'green',  hex: '#10b981', label: 'Verde' },
    { id: 'yellow', hex: '#f59e0b', label: 'Amarillo' },
    { id: 'blue',   hex: '#3b82f6', label: 'Azul' },
    { id: 'purple', hex: '#8b5cf6', label: 'Púrpura' },
    { id: 'red',    hex: '#ef4444', label: 'Rojo' },
    { id: 'gold',   hex: '#d97706', label: 'Dorado' },
    { id: 'gray',   hex: '#6b7280', label: 'Gris' },
    { id: 'black',  hex: '#1f2937', label: 'Negro' },
  ];

  const ICON_GALLERY = ['🏦', '💳', '📱', '📲', '💵', '💰', '🏛️', '🪙', '💼', '🏧'];

  /* ─────────────────────────────────────────
     INSTITUTION RECOGNITION
  ───────────────────────────────────────── */
  const RECOGNITION_RULES = [
    { pattern: /nequi/i,           color: 'green',  icon: '📱' },
    { pattern: /daviplata/i,       color: 'red',    icon: '📲' },
    { pattern: /bancolombia/i,     color: 'yellow', icon: '🏦' },
    { pattern: /caja\s*social/i,   color: 'blue',   icon: '🏦' },
    { pattern: /efectivo|cash/i,   color: 'green',  icon: '💵' },
    { pattern: /visa\s*gold/i,     color: 'gold',   icon: '💳' },
    { pattern: /visa/i,            color: 'blue',   icon: '💳' },
    { pattern: /amex|american\s*express/i, color: 'blue', icon: '💳' },
    { pattern: /cmr|falabella/i,   color: 'purple', icon: '💳' },
    { pattern: /mastercard/i,      color: 'red',    icon: '💳' },
    { pattern: /nu\b|nubank/i,     color: 'purple', icon: '💳' },
  ];

  function recognizeAccount(name) {
    for (const rule of RECOGNITION_RULES) {
      if (rule.pattern.test(name)) {
        return { color: rule.color, icon: rule.icon };
      }
    }
    return { color: 'gray', icon: '🏦' };
  }

  /* ─────────────────────────────────────────
     DEFAULT ACCOUNTS SEED
  ───────────────────────────────────────── */
  const DEFAULT_ACCOUNTS_SEED = [
    { name: 'Bancolombia John', type: 'bank' },
    { name: 'Bancolombia Rosita', type: 'bank' },
    { name: 'Caja Social',      type: 'bank' },
    { name: 'Efectivo',         type: 'cash' },
    { name: 'Daviplata',        type: 'wallet' },
    { name: 'Nequi',            type: 'wallet' },
    { name: 'Visa Gold',        type: 'credit_card' },
    { name: 'American Express', type: 'credit_card' },
    { name: 'CMR Falabella',    type: 'credit_card' },
  ];

  function createAccount(name, type, overrides = {}) {
    const now = new Date().toISOString();
    const { color, icon } = recognizeAccount(name);
    return {
      version:         SCHEMA_VERSION,
      id:              'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name,
      type,
      description:     overrides.description || '',
      archived:        false,
      isDefault:       overrides.isDefault || false,
      displayOrder:    overrides.displayOrder !== undefined ? overrides.displayOrder : 999,
      usageCount:      0,
      lastUsed:        null,
      color,
      icon,
      autoColor:       true,
      autoIcon:        true,
      currency:        'COP',
      institution:     null,
      lastFour:        null,
      creditLimit:     null,
      currentBalance:  null,
      createdAt:       now,
      updatedAt:       now,
    };
  }

  /* ─────────────────────────────────────────
     STORAGE
  ───────────────────────────────────────── */
  const Store = {
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch { return null; }
    },

    save(accounts) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    },

    /* Migrate v0 (no version field) to v1 */
    migrate(accounts) {
      const now = new Date().toISOString();
      return accounts.map((acc, i) => {
        // If already v1, keep as-is but fill any new optional fields
        if (acc.version === SCHEMA_VERSION) {
          return {
            currency:       'COP',
            institution:    null,
            lastFour:       null,
            creditLimit:    null,
            currentBalance: null,
            displayOrder:   i,
            usageCount:     acc.usageCount ?? acc.usages ?? 0,
            archived:       acc.archived ?? (acc.active === false),
            ...acc,
            version: SCHEMA_VERSION,
          };
        }
        // v0 → v1 upgrade
        const { color: autoC, icon: autoI } = recognizeAccount(acc.name || '');
        return {
          version:         SCHEMA_VERSION,
          id:              acc.id || ('acc_migrated_' + i),
          name:            acc.name || 'Cuenta sin nombre',
          type:            acc.type || 'bank',
          description:     acc.description || '',
          archived:        acc.archived ?? (acc.active === false),
          isDefault:       acc.isDefault || false,
          displayOrder:    i,
          usageCount:      acc.usageCount ?? acc.usages ?? 0,
          lastUsed:        acc.lastUsed || null,
          color:           acc.color || autoC,
          icon:            acc.icon  || autoI,
          autoColor:       acc.autoColor !== false,
          autoIcon:        acc.autoIcon  !== false,
          currency:        'COP',
          institution:     null,
          lastFour:        null,
          creditLimit:     null,
          currentBalance:  null,
          createdAt:       acc.createdAt || now,
          updatedAt:       acc.updatedAt || now,
        };
      });
    },

    /* Lazy-seed: only called on first open */
    ensureSeeded() {
      const existing = this.load();
      if (existing !== null) return this.migrate(existing);

      // First ever open: seed defaults
      const accounts = DEFAULT_ACCOUNTS_SEED.map((seed, i) =>
        createAccount(seed.name, seed.type, { displayOrder: i, isDefault: i === 0 })
      );
      this.save(accounts);
      return accounts;
    },

    getAll() {
      const raw = this.load();
      if (raw === null) return [];         // not yet seeded = no accounts shown
      return this.migrate(raw).sort((a, b) => a.displayOrder - b.displayOrder);
    },

    getActive() {
      return this.getAll().filter(a => !a.archived);
    },

    getById(id) {
      return this.getAll().find(a => a.id === id) || null;
    },

    upsert(account) {
      const all = this.getAll();
      const idx = all.findIndex(a => a.id === account.id);
      if (idx >= 0) {
        all[idx] = { ...account, updatedAt: new Date().toISOString() };
      } else {
        all.push({ ...account, updatedAt: new Date().toISOString() });
      }
      this.save(all);
    },

    updateDisplayOrders(orderedIds) {
      const all = this.getAll();
      orderedIds.forEach((id, i) => {
        const acc = all.find(a => a.id === id);
        if (acc) {
          acc.displayOrder = i;
          acc.updatedAt = new Date().toISOString();
        }
      });
      this.save(all);
    },

    getLastUsed() {
      try {
        return JSON.parse(localStorage.getItem(LAST_USED_KEY));
      } catch { return null; }
    },

    setLastUsed(account) {
      localStorage.setItem(LAST_USED_KEY, JSON.stringify({ id: account.id, name: account.name }));
    },

    recordUsage(id) {
      const all = this.getAll();
      const acc = all.find(a => a.id === id);
      if (!acc) return;
      acc.usageCount  = (acc.usageCount || 0) + 1;
      acc.lastUsed    = new Date().toISOString();
      acc.updatedAt   = new Date().toISOString();
      this.save(all);
    },
  };

  /* ─────────────────────────────────────────
     SELECTION STATE
  ───────────────────────────────────────── */
  let _selectedAccountId = null;

  function resolveInitialSelection() {
    const accounts = Store.getActive();
    if (accounts.length === 0) return null;

    const def = accounts.find(a => a.isDefault);
    if (def) return def.id;

    const lastUsed = Store.getLastUsed();
    if (lastUsed && lastUsed.id) {
      const found = accounts.find(a => a.id === lastUsed.id);
      if (found) return found.id;
    }

    return accounts[0].id;
  }

  /* ─────────────────────────────────────────
     RELATIVE TIME
  ───────────────────────────────────────── */
  function relativeTime(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    if (isNaN(date)) return null;
    const diffDays = Math.floor((Date.now() - date) / 86400000);
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7)  return `Hace ${diffDays} días`;
    if (diffDays < 30) return 'La semana pasada';
    return 'Hace más de un mes';
  }

  /* ─────────────────────────────────────────
     COLOR HELPERS
  ───────────────────────────────────────── */
  function colorHex(colorId) {
    const found = COLOR_PALETTE.find(c => c.id === colorId);
    return found ? found.hex : '#6b7280';
  }

  /* ─────────────────────────────────────────
     TOAST HELPER (uses global Toast if available)
  ───────────────────────────────────────── */
  function showToast(msg, type = 'success') {
    if (window.Toast && typeof window.Toast.show === 'function') {
      window.Toast.show(msg, type);
    }
  }

  /* ─────────────────────────────────────────
     DOM HELPERS
  ───────────────────────────────────────── */
  function el(id) { return document.getElementById(id); }
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }

  /* ─────────────────────────────────────────
     REVIEW SCREEN — PAYMENT SELECTOR TRIGGER
  ───────────────────────────────────────── */
  function renderSelectorTrigger() {
    const trigger = el('pa-selector-trigger');
    if (!trigger) return;

    const raw = Store.getAll();
    if (raw.length === 0) {
      // not yet seeded: hide the section
      const section = el('pa-review-section');
      if (section) section.style.display = 'none';
      return;
    }

    const section = el('pa-review-section');
    if (section) section.style.display = '';

    const acc = _selectedAccountId ? Store.getById(_selectedAccountId) : null;
    const displayAcc = acc && !acc.archived ? acc : null;

    if (displayAcc) {
      trigger.innerHTML = `
        <span class="pa-trigger-icon" style="background:${colorHex(displayAcc.color)}20; color:${colorHex(displayAcc.color)}">${displayAcc.icon}</span>
        <span class="pa-trigger-name">${escHtml(displayAcc.name)}</span>
        <span class="pa-trigger-arrow">›</span>
      `;
    } else {
      trigger.innerHTML = `
        <span class="pa-trigger-icon" style="background:#374151; color:#9ca3af">🏦</span>
        <span class="pa-trigger-name" style="color:#9ca3af">Seleccionar cuenta…</span>
        <span class="pa-trigger-arrow">›</span>
      `;
    }
  }

  /* ─────────────────────────────────────────
     SELECTOR MODAL
  ───────────────────────────────────────── */
  function openSelectorModal() {
    // Lazy-seed on first open of selector
    const accounts = Store.ensureSeeded();
    if (!_selectedAccountId) {
      _selectedAccountId = resolveInitialSelection();
    }

    const modal = el('pa-selector-modal');
    if (!modal) return;

    const body = el('pa-selector-body');
    if (!body) return;

    const active = accounts.filter(a => !a.archived);

    if (active.length === 0) {
      body.innerHTML = `<p class="pa-empty-msg">No hay cuentas activas. Agrega una en Configuración → Cuentas de pago.</p>`;
    } else {
      let html = '';
      TYPE_GROUPS.forEach(group => {
        const items = active.filter(a => a.type === group.type);
        if (items.length === 0) return;
        html += `<div class="pa-group-label">${group.label}</div>`;
        items.forEach(acc => {
          const isSelected = acc.id === _selectedAccountId;
          const lastDef    = acc.isDefault ? '<span class="pa-badge pa-badge-default">⭐ Predeterminada</span>' : '';
          const lastUsedStr = relativeTime(acc.lastUsed);
          const lastUsedBadge = lastUsedStr ? `<span class="pa-badge pa-badge-last">${lastUsedStr}</span>` : '';
          const usageLine   = acc.usageCount > 0 ? `${TYPE_LABELS[acc.type] || acc.type} · Usada ${acc.usageCount} veces` : TYPE_LABELS[acc.type] || acc.type;

          html += `
            <button class="pa-account-card ${isSelected ? 'pa-card-selected' : ''}"
                    data-id="${acc.id}" type="button">
              <span class="pa-card-icon" style="background:${colorHex(acc.color)}20; color:${colorHex(acc.color)}">${acc.icon}</span>
              <span class="pa-card-info">
                <span class="pa-card-name">${escHtml(acc.name)}</span>
                <span class="pa-card-meta">${escHtml(usageLine)}</span>
              </span>
              <span class="pa-card-badges">${lastDef}${lastUsedBadge}</span>
              ${isSelected ? '<span class="pa-card-check">✓</span>' : ''}
            </button>
          `;
        });
      });
      body.innerHTML = html;

      // Attach click handlers
      body.querySelectorAll('.pa-account-card').forEach(btn => {
        btn.addEventListener('click', () => {
          _selectedAccountId = btn.dataset.id;
          closeSelectorModal();
          renderSelectorTrigger();
        });
      });
    }

    modal.classList.add('pa-modal-open');
    document.body.classList.add('pa-no-scroll');
  }

  function closeSelectorModal() {
    const modal = el('pa-selector-modal');
    if (modal) modal.classList.remove('pa-modal-open');
    document.body.classList.remove('pa-no-scroll');
  }

  /* ─────────────────────────────────────────
     SUCCESS OVERLAY
  ───────────────────────────────────────── */
  function showSuccessOverlay(accountName, onDone) {
    const overlay = el('pa-success-overlay');
    if (!overlay) { if (onDone) onDone(); return; }

    const nameEl = qs('.pa-success-account', overlay);
    if (nameEl) {
      const acc = accountName ? Store.getAll().find(a => a.name === accountName) : null;
      nameEl.innerHTML = acc
        ? `<span style="color:${colorHex(acc.color)}">${acc.icon}</span> ${escHtml(acc.name)}`
        : (accountName ? escHtml(accountName) : '');
    }

    overlay.classList.add('pa-overlay-visible');

    setTimeout(() => {
      overlay.classList.remove('pa-overlay-visible');
      if (onDone) onDone();
    }, 1100);
  }

  /* ─────────────────────────────────────────
     ARCHIVE CONFIRMATION DIALOG
  ───────────────────────────────────────── */
  let _archiveTargetId = null;

  function openArchiveDialog(accId) {
    const acc = Store.getById(accId);
    if (!acc) return;
    _archiveTargetId = accId;

    const dialog = el('pa-archive-dialog');
    if (!dialog) return;

    const nameEl = qs('.pa-dialog-account-name', dialog);
    if (nameEl) nameEl.textContent = acc.name;

    dialog.classList.add('pa-modal-open');
    document.body.classList.add('pa-no-scroll');
  }

  function closeArchiveDialog() {
    _archiveTargetId = null;
    const dialog = el('pa-archive-dialog');
    if (dialog) dialog.classList.remove('pa-modal-open');
    document.body.classList.remove('pa-no-scroll');
  }

  function confirmArchive() {
    if (!_archiveTargetId) return;
    const all = Store.getAll();
    const acc = all.find(a => a.id === _archiveTargetId);
    if (!acc) { closeArchiveDialog(); return; }

    const wasDefault = acc.isDefault;
    acc.archived  = true;
    acc.isDefault = false;
    acc.updatedAt = new Date().toISOString();
    Store.save(all);

    // Transfer default to first remaining active account
    if (wasDefault) {
      const nextActive = all.filter(a => !a.archived && a.id !== acc.id)
        .sort((a, b) => a.displayOrder - b.displayOrder)[0];
      if (nextActive) {
        nextActive.isDefault = true;
        nextActive.updatedAt = new Date().toISOString();
        Store.save(all);
      }
    }

    closeArchiveDialog();
    showToast('✓ Cuenta archivada');
    renderSettingsView();
  }

  /* ─────────────────────────────────────────
     ACCOUNT EDITOR
  ───────────────────────────────────────── */
  let _editingId = null;

  function openEditor(accId) {
    const dialog = el('pa-editor-dialog');
    if (!dialog) return;

    if (accId) {
      const acc = Store.getById(accId);
      if (!acc) return;
      _editingId = accId;

      el('pa-editor-title').textContent    = 'Editar cuenta';
      el('pa-editor-name').value           = acc.name;
      el('pa-editor-type').value           = acc.type;
      el('pa-editor-description').value    = acc.description || '';
      el('pa-editor-is-default').checked   = acc.isDefault;

      renderColorPicker(acc.color, acc.autoColor);
      renderIconPicker(acc.icon, acc.autoIcon);
    } else {
      _editingId = null;
      el('pa-editor-title').textContent    = 'Nueva cuenta';
      el('pa-editor-name').value           = '';
      el('pa-editor-type').value           = 'bank';
      el('pa-editor-description').value    = '';
      el('pa-editor-is-default').checked   = false;
      renderColorPicker('gray', true);
      renderIconPicker('🏦', true);
    }

    dialog.classList.add('pa-modal-open');
    document.body.classList.add('pa-no-scroll');
  }

  function closeEditor() {
    _editingId = null;
    const dialog = el('pa-editor-dialog');
    if (dialog) dialog.classList.remove('pa-modal-open');
    document.body.classList.remove('pa-no-scroll');
  }

  function renderColorPicker(selected, isAuto) {
    const container = el('pa-color-picker');
    if (!container) return;
    container.innerHTML = COLOR_PALETTE.map(c => `
      <button type="button" class="pa-color-swatch ${selected === c.id ? 'pa-swatch-selected' : ''}"
              data-color="${c.id}" title="${c.label}"
              style="background:${c.hex}">
        ${selected === c.id ? '✓' : ''}
      </button>
    `).join('');

    container.querySelectorAll('.pa-color-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.pa-color-swatch').forEach(b => { b.classList.remove('pa-swatch-selected'); b.innerHTML = ''; });
        btn.classList.add('pa-swatch-selected');
        btn.innerHTML = '✓';
      });
    });
  }

  function renderIconPicker(selected, isAuto) {
    const container = el('pa-icon-picker');
    if (!container) return;
    container.innerHTML = ICON_GALLERY.map(icon => `
      <button type="button" class="pa-icon-btn ${icon === selected ? 'pa-icon-selected' : ''}"
              data-icon="${icon}">${icon}</button>
    `).join('');

    container.querySelectorAll('.pa-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.pa-icon-btn').forEach(b => b.classList.remove('pa-icon-selected'));
        btn.classList.add('pa-icon-selected');
      });
    });
  }

  function saveEditor() {
    const name = el('pa-editor-name').value.trim();
    const type = el('pa-editor-type').value;

    if (!name) {
      showToast('El nombre no puede estar vacío', 'error');
      return;
    }

    const selectedColorBtn = qs('.pa-color-swatch.pa-swatch-selected', el('pa-color-picker'));
    const selectedIconBtn  = qs('.pa-icon-btn.pa-icon-selected', el('pa-icon-picker'));

    const chosenColor = selectedColorBtn ? selectedColorBtn.dataset.color : 'gray';
    const chosenIcon  = selectedIconBtn  ? selectedIconBtn.dataset.icon   : '🏦';
    const isDefault   = el('pa-editor-is-default').checked;
    const description = el('pa-editor-description').value.trim();

    if (_editingId) {
      const all = Store.getAll();
      const acc = all.find(a => a.id === _editingId);
      if (!acc) { closeEditor(); return; }

      // Detect if color/icon were manually changed
      const wasAutoColor = acc.autoColor;
      const wasAutoIcon  = acc.autoIcon;
      const autoC = wasAutoColor ? recognizeAccount(name).color : null;
      const autoI = wasAutoIcon  ? recognizeAccount(name).icon  : null;

      acc.name         = name;
      acc.type         = type;
      acc.description  = description;
      acc.color        = chosenColor;
      acc.icon         = chosenIcon;
      acc.autoColor    = (wasAutoColor && autoC === chosenColor);  // still auto only if unchanged
      acc.autoIcon     = (wasAutoIcon  && autoI === chosenIcon);
      acc.updatedAt    = new Date().toISOString();

      if (isDefault && !acc.isDefault) {
        all.forEach(a => { a.isDefault = false; });
        acc.isDefault = true;
      } else if (!isDefault && acc.isDefault) {
        // Removing default from this — assign to first other active
        acc.isDefault = false;
        const first = all.find(a => !a.archived && a.id !== acc.id);
        if (first) first.isDefault = true;
      }

      Store.save(all);
      showToast('✓ Cuenta actualizada');
    } else {
      // New account
      const all = Store.getAll();
      if (isDefault) all.forEach(a => { a.isDefault = false; });

      const newAcc = createAccount(name, type, {
        isDefault,
        displayOrder: all.length,
      });
      newAcc.color       = chosenColor;
      newAcc.icon        = chosenIcon;
      newAcc.autoColor   = false;
      newAcc.autoIcon    = false;
      newAcc.description = description;

      all.push(newAcc);
      Store.save(all);
      showToast('✓ Cuenta creada');
    }

    closeEditor();
    renderSettingsView();
  }

  /* ─────────────────────────────────────────
     SETTINGS VIEW RENDER
  ───────────────────────────────────────── */
  function renderSettingsView() {
    renderDashboardCard();
    renderActiveList();
    renderArchivedList();
  }

  function renderDashboardCard() {
    const card = el('pa-dashboard-card');
    if (!card) return;

    const all     = Store.getAll();
    const active  = all.filter(a => !a.archived);
    const archived = all.filter(a => a.archived);
    const def     = active.find(a => a.isDefault);
    const lastUsedInfo = Store.getLastUsed();
    const lastUsedAcc  = lastUsedInfo ? all.find(a => a.id === lastUsedInfo.id) : null;

    card.innerHTML = `
      <div class="pa-dash-row">
        <span class="pa-dash-item"><strong>${active.length}</strong> activas</span>
        <span class="pa-dash-sep">·</span>
        <span class="pa-dash-item"><strong>${archived.length}</strong> archivadas</span>
      </div>
      ${def ? `<div class="pa-dash-row pa-dash-main"><span>Predeterminada:</span> <span style="color:${colorHex(def.color)}">${def.icon} ${escHtml(def.name)}</span></div>` : ''}
      ${lastUsedAcc ? `<div class="pa-dash-row"><span>Último método:</span> <span style="color:${colorHex(lastUsedAcc.color)}">${lastUsedAcc.icon} ${escHtml(lastUsedAcc.name)}</span></div>` : ''}
    `;
  }

  function renderActiveList() {
    const list = el('pa-active-list');
    if (!list) return;

    const active = Store.getActive().sort((a, b) => a.displayOrder - b.displayOrder);

    if (active.length === 0) {
      list.innerHTML = '<p class="pa-empty-msg">No hay cuentas activas.</p>';
      return;
    }

    list.innerHTML = active.map(acc => {
      const defaultBadge = acc.isDefault ? '<span class="pa-list-badge pa-badge-default">⭐</span>' : '';
      const lastStr      = relativeTime(acc.lastUsed);
      const metaLine     = lastStr ? `${TYPE_LABELS[acc.type] || acc.type} · ${lastStr}` : TYPE_LABELS[acc.type] || acc.type;

      return `
        <div class="pa-list-item" data-id="${acc.id}" draggable="true">
          <span class="pa-drag-handle" title="Arrastrar para reordenar">⠿</span>
          <span class="pa-list-icon" style="background:${colorHex(acc.color)}20; color:${colorHex(acc.color)}">${acc.icon}</span>
          <span class="pa-list-info">
            <span class="pa-list-name">${escHtml(acc.name)}${defaultBadge}</span>
            <span class="pa-list-meta">${escHtml(metaLine)}</span>
          </span>
          <span class="pa-list-actions">
            <button type="button" class="pa-btn-edit" data-id="${acc.id}" title="Editar">✏️</button>
            <button type="button" class="pa-btn-archive" data-id="${acc.id}" title="Archivar">📥</button>
          </span>
        </div>
      `;
    }).join('');

    // Edit buttons
    list.querySelectorAll('.pa-btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openEditor(btn.dataset.id));
    });

    // Archive buttons
    list.querySelectorAll('.pa-btn-archive').forEach(btn => {
      btn.addEventListener('click', () => openArchiveDialog(btn.dataset.id));
    });

    // Drag & drop
    initDragAndDrop(list);
  }

  function renderArchivedList() {
    const list = el('pa-archived-list');
    if (!list) return;

    const archived = Store.getAll().filter(a => a.archived).sort((a, b) => a.displayOrder - b.displayOrder);

    if (archived.length === 0) {
      list.innerHTML = '';
      const section = el('pa-archived-section');
      if (section) section.style.display = 'none';
      return;
    }

    const section = el('pa-archived-section');
    if (section) section.style.display = '';

    list.innerHTML = archived.map(acc => `
      <div class="pa-list-item pa-list-archived" data-id="${acc.id}">
        <span class="pa-list-icon" style="background:${colorHex(acc.color)}15; color:#6b7280">${acc.icon}</span>
        <span class="pa-list-info">
          <span class="pa-list-name">${escHtml(acc.name)}</span>
          <span class="pa-list-meta">${TYPE_LABELS[acc.type] || acc.type}</span>
        </span>
        <span class="pa-list-actions">
          <button type="button" class="pa-btn-restore" data-id="${acc.id}" title="Restaurar">↩️</button>
        </span>
      </div>
    `).join('');

    list.querySelectorAll('.pa-btn-restore').forEach(btn => {
      btn.addEventListener('click', () => {
        const all = Store.getAll();
        const acc = all.find(a => a.id === btn.dataset.id);
        if (!acc) return;
        acc.archived  = false;
        acc.updatedAt = new Date().toISOString();
        // Ensure at least one default exists
        if (!all.some(a => a.isDefault && !a.archived)) {
          acc.isDefault = true;
        }
        Store.save(all);
        showToast('✓ Cuenta restaurada');
        renderSettingsView();
      });
    });
  }

  /* ─────────────────────────────────────────
     DRAG & DROP (Pointer Events)
  ───────────────────────────────────────── */
  function initDragAndDrop(list) {
    let dragSrc = null;

    list.querySelectorAll('.pa-list-item[draggable="true"]').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        dragSrc = item;
        item.classList.add('pa-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('pa-dragging');
        list.querySelectorAll('.pa-list-item').forEach(i => i.classList.remove('pa-drag-over'));
        const orderedIds = [...list.querySelectorAll('.pa-list-item')].map(i => i.dataset.id);
        Store.updateDisplayOrders(orderedIds);
        showToast('✓ Orden actualizado');
        renderSettingsView();
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragSrc || item === dragSrc) return;
        e.dataTransfer.dropEffect = 'move';
        list.querySelectorAll('.pa-list-item').forEach(i => i.classList.remove('pa-drag-over'));
        item.classList.add('pa-drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragSrc || item === dragSrc) return;
        const allItems = [...list.querySelectorAll('.pa-list-item')];
        const srcIdx  = allItems.indexOf(dragSrc);
        const tgtIdx  = allItems.indexOf(item);
        if (srcIdx < tgtIdx) {
          item.after(dragSrc);
        } else {
          item.before(dragSrc);
        }
      });
    });
  }

  /* ─────────────────────────────────────────
     HTML ESCAPING
  ───────────────────────────────────────── */
  function escHtml(str) {
    if (typeof str !== 'string') str = String(str || '');
    return str
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#039;');
  }

  /* ─────────────────────────────────────────
     INIT — wire up all static event listeners
  ───────────────────────────────────────── */
  function init() {
    /* ── Selector trigger (review screen) ── */
    const trigger = el('pa-selector-trigger');
    if (trigger) {
      trigger.addEventListener('click', () => {
        Store.ensureSeeded();
        if (!_selectedAccountId) _selectedAccountId = resolveInitialSelection();
        openSelectorModal();
      });
    }

    /* ── Selector modal close ── */
    const selectorModal = el('pa-selector-modal');
    if (selectorModal) {
      selectorModal.addEventListener('click', (e) => {
        if (e.target === selectorModal) closeSelectorModal();
      });
      const closeBtn = el('pa-selector-close');
      if (closeBtn) closeBtn.addEventListener('click', closeSelectorModal);
    }

    /* ── Archive dialog ── */
    const archiveDialog = el('pa-archive-dialog');
    if (archiveDialog) {
      el('pa-archive-cancel')?.addEventListener('click', closeArchiveDialog);
      el('pa-archive-confirm')?.addEventListener('click', confirmArchive);
      archiveDialog.addEventListener('click', (e) => {
        if (e.target === archiveDialog) closeArchiveDialog();
      });
    }

    /* ── Editor dialog ── */
    const editorDialog = el('pa-editor-dialog');
    if (editorDialog) {
      el('pa-editor-cancel')?.addEventListener('click', closeEditor);
      el('pa-editor-save')?.addEventListener('click', saveEditor);
      el('pa-editor-add-btn')?.addEventListener('click', () => openEditor(null));
      editorDialog.addEventListener('click', (e) => {
        if (e.target === editorDialog) closeEditor();
      });

      // Auto-recognize name while typing (only when autoColor/autoIcon still apply)
      const nameInput = el('pa-editor-name');
      if (nameInput) {
        nameInput.addEventListener('input', () => {
          const { color, icon } = recognizeAccount(nameInput.value);
          const selectedColorBtn = qs('.pa-color-swatch.pa-swatch-selected', el('pa-color-picker'));
          const selectedIconBtn  = qs('.pa-icon-btn.pa-icon-selected',       el('pa-icon-picker'));
          // Only auto-update if user hasn't manually picked anything yet
          if (!_editingId) {
            renderColorPicker(color, true);
            renderIconPicker(icon, true);
          }
        });
      }
    }

    /* ── Settings: Add account button ── */
    const addBtn = el('pa-settings-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => openEditor(null));
  }

  /* ─────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────── */
  window.PaymentAccounts = {
    init,

    /* Called when settings view opens (lazy seed + render) */
    onSettingsOpen() {
      Store.ensureSeeded();
      renderSettingsView();
    },

    /* Called just before sending to Sheets. Returns account name or '' */
    getSelectedName() {
      if (!_selectedAccountId) return '';
      const acc = Store.getById(_selectedAccountId);
      return (acc && !acc.archived) ? acc.name : '';
    },

    /* Called after a successful submission */
    onSubmitSuccess(accountName, callback) {
      if (accountName) {
        const acc = Store.getAll().find(a => a.name === accountName);
        if (acc) Store.recordUsage(acc.id);
        Store.setLastUsed({ id: acc ? acc.id : null, name: accountName });
      }
      // Re-resolve selection for next scan
      _selectedAccountId = resolveInitialSelection();
      renderSelectorTrigger();
      showSuccessOverlay(accountName, callback);
    },

    /* Called when review screen is shown (reset + render trigger) */
    onReviewOpen() {
      Store.ensureSeeded();
      if (!_selectedAccountId) _selectedAccountId = resolveInitialSelection();
      renderSelectorTrigger();
    },
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
