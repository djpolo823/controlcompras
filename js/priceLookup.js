// js/priceLookup.js – Independent price lookup module
// Provides UI for searching past purchase history and comparing prices.
// Self‑contained; does not modify other app parts.

(() => {
  // ----- Configuration -----
  const HISTORY_ENDPOINT = '?action=getHistory';
  const LEARN_KEY        = 'priceLookupLearnCounts';
  const PREFS_KEY        = 'priceLookupPrefs';
  const FAMILIES_KEY     = 'PRICE_LOOKUP_FAMILIES';
  const SAVED_COMPARISONS_KEY = 'PRICE_LOOKUP_SAVED_COMPARISONS';
  const SAVED_COMPARISONS_MIGRATED = 'PRICE_LOOKUP_SAVED_COMPARISONS_MIGRATED';
  const DEBOUNCE_MS      = 150;
  const DEFAULT_DAYS     = 90;
  const DEFAULT_STOP_WORDS = new Set([
    'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'en', 'con', 'un', 'una', 'por', 'para', 'al'
  ]);

  const DEFAULT_NORMALIZATION = {
    'mz': 'mozarella',
    'muzzarella': 'mozarella',
    'mozzarella': 'mozarella',
    'bloq': 'bloque',
    'bloque': 'bloque',
    'lt': 'l',
    'litro': 'l',
    'lts': 'l',
    'gr': 'g',
    'gramo': 'g',
    'gramos': 'g',
    'kg': 'kg',
    'kilo': 'kg',
    'kilogramo': 'kg'
  };

  // ----- Runtime State -----
  let purchaseHistory = [];   // in-memory only, never persisted
  let productIndex    = {};   // key → { entries: [], originalNames: Set, familyBase: string, variantLabel: string }
  let savedComparisons = {}; // id → { name, members: [], createdAt, updatedAt }
  let debounceTimer   = null;
  let comparisonSelection = new Set();
  let lastSuggestionGroups = [];
  let lastSearchQuery = '';
  let lastQueryTokens = [];
  let expandedGroups = new Set();
  let normalizationRules = { ...DEFAULT_NORMALIZATION };
  let ANALYSIS_DAYS   = DEFAULT_DAYS;
  let STOP_WORDS      = new Set(DEFAULT_STOP_WORDS);
  let USER_SYNONYMS   = {};   // dynamically parsed from settings
  let EXCLUSIONS      = new Set();
  const CONSTANT_SYNONYMS = {};

  // ----- Safe wrapper for Toast -----
  const toast = (msg, type = 'info') => {
    if (typeof Toast !== 'undefined' && Toast && typeof Toast.show === 'function') {
      Toast.show(msg, type);
    } else {
      console.warn('[priceLookup]', type, msg);
    }
  };

  // ----- Preferences -----
  const loadPrefs = () => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const p = raw ? JSON.parse(raw) : {};
      
      // Load configurations
      ANALYSIS_DAYS = p.analysisDays || DEFAULT_DAYS;
      if (p.exclusions) {
        EXCLUSIONS = new Set(p.exclusions);
      }

      // Populate settings UI
      const daysEl = document.getElementById('settings-analysis-days');
      if (daysEl) daysEl.value = ANALYSIS_DAYS;

      const filterDaysEl = document.getElementById('filter-days');
      if (filterDaysEl) filterDaysEl.value = ANALYSIS_DAYS;

      // Load synonyms textarea
      if (p.synonymsRaw) {
        const synEl = document.getElementById('settings-synonyms');
        if (synEl) synEl.value = p.synonymsRaw;
        parseUserSynonyms(p.synonymsRaw);
      }

      // Load normalization rules textarea
      if (p.normalizationRaw) {
        const normEl = document.getElementById('settings-normalization-rules');
        if (normEl) normEl.value = p.normalizationRaw;
        parseNormalizationRules(p.normalizationRaw);
      }

      // Load saved comparison storage
      migrateSavedComparisons();
      loadSavedComparisonsFromStorage();
      renderSavedComparisonsSettings();

      // Checkboxes in settings
      const learnEl = document.getElementById('settings-learn-toggle');
      if (learnEl) learnEl.checked = p.learnEnabled !== false;
    } catch (_) { /* ignore */ }
  };

  const savePrefs = () => {
    const daysEl = document.getElementById('settings-analysis-days');
    const synEl  = document.getElementById('settings-synonyms');
    const learnEl = document.getElementById('settings-learn-toggle');
    const normEl = document.getElementById('settings-normalization-rules');
    
    const prefs = {
      analysisDays: daysEl ? parseInt(daysEl.value, 10) || DEFAULT_DAYS : DEFAULT_DAYS,
      synonymsRaw:  synEl  ? synEl.value : '',
      normalizationRaw: normEl ? normEl.value : '',
      learnEnabled: learnEl ? learnEl.checked : true,
      exclusions: Array.from(EXCLUSIONS)
    };
    
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    ANALYSIS_DAYS = prefs.analysisDays;
    parseUserSynonyms(prefs.synonymsRaw);
    parseNormalizationRules(prefs.normalizationRaw);
    renderSavedComparisonsSettings();
    renderSavedComparisonsPanel();
    
    const filterDaysEl = document.getElementById('filter-days');
    if (filterDaysEl) filterDaysEl.value = ANALYSIS_DAYS;
    
    toast('Configuración de precio guardada', 'success');
  };

  const parseUserSynonyms = raw => {
    USER_SYNONYMS = {};
    if (!raw) return;
    raw.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length === 2) {
        const lhs = parts[0].trim().toLowerCase();
        const rhs = parts[1].trim().toLowerCase();
        if (lhs && rhs) {
          USER_SYNONYMS[lhs] = rhs;
        }
      }
    });
  };

  const parseNormalizationRules = raw => {
    normalizationRules = { ...DEFAULT_NORMALIZATION };
    if (!raw) return;
    raw.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length === 2) {
        const lhs = parts[0].trim().toLowerCase();
        const rhs = parts[1].trim().toLowerCase();
        if (lhs && rhs) {
          normalizationRules[lhs] = rhs;
        }
      }
    });
  };

  const loadSavedComparisonsFromStorage = () => {
    try {
      const raw = localStorage.getItem(SAVED_COMPARISONS_KEY);
      savedComparisons = raw ? JSON.parse(raw) : {};
    } catch (e) {
      savedComparisons = {};
    }
  };

  const saveSavedComparisonsToStorage = () => {
    localStorage.setItem(SAVED_COMPARISONS_KEY, JSON.stringify(savedComparisons));
  };


  const migrateSavedComparisons = () => {
    if (localStorage.getItem(SAVED_COMPARISONS_MIGRATED)) return;
    let migrated = false;
    try {
      const raw = localStorage.getItem(FAMILIES_KEY);
      if (raw) {
        const families = JSON.parse(raw);
        if (families && typeof families === 'object') {
          Object.entries(families).forEach(([familyKey, family]) => {
            if (family && family.members && family.familyName) {
              savedComparisons[familyKey] = {
                name: family.familyName,
                members: family.members,
                createdAt: family.createdAt || new Date().toISOString(),
                updatedAt: family.updatedAt || new Date().toISOString()
              };
              migrated = true;
            }
          });
        }
      }
    } catch (e) {
      console.warn('Migration failed', e);
    }
    if (migrated) saveSavedComparisonsToStorage();
    localStorage.setItem(SAVED_COMPARISONS_MIGRATED, '1');
  };

  const renderSavedComparisonsSettings = () => {
    const list = document.getElementById('pl-family-settings-list');
    if (!list) return;

    const comparisons = Object.entries(savedComparisons);
    if (!comparisons.length) {
      list.innerHTML = '<div class="pl-family-settings-empty">No hay comparaciones guardadas aún.</div>';
      return;
    }

    list.innerHTML = comparisons.map(([key, comparison]) => {
      const memberCount = comparison.members.length;
      const updatedAt = comparison.updatedAt ? new Date(comparison.updatedAt).toLocaleDateString('es-ES') : 'n/a';
      return `
        <div class="pl-family-settings-item" data-family="${key}">
          <div class="pl-family-settings-info">
            <strong>${escapeHtml(comparison.name)}</strong>
            <span>${memberCount} producto${memberCount === 1 ? '' : 's'}</span>
            <span class="pl-family-settings-meta">Actualizada: ${updatedAt}</span>
          </div>
          <div class="pl-family-settings-actions">
            <button type="button" class="secondary-btn pl-saved-comparison-select" data-family="${key}">Seleccionar</button>
            <button type="button" class="secondary-btn pl-saved-comparison-edit" data-family="${key}">Editar</button>
            <button type="button" class="secondary-btn pl-saved-comparison-delete" data-family="${key}">Eliminar</button>
          </div>
        </div>
      `;
    }).join('');
  };

  const renderSavedComparisonsPanel = () => {
    const panel = document.getElementById('pl-saved-comparisons-panel');
    if (!panel) return;
    const comparisons = Object.entries(savedComparisons);
    const selectedCount = comparisonSelection.size;

    const savedHtml = comparisons.length
      ? comparisons.map(([key, comparison]) => {
          const count = comparison.members.length;
          return `
            <div class="pl-saved-comparison-item" data-family="${key}">
              <div>
                <strong>${escapeHtml(comparison.name)}</strong>
                <div class="pl-saved-comparison-meta">${count} producto${count === 1 ? '' : 's'}</div>
              </div>
              <div class="pl-saved-comparison-actions">
                <button type="button" class="secondary-btn pl-saved-comparison-load" data-family="${key}">Cargar</button>
                <button type="button" class="secondary-btn pl-saved-comparison-delete" data-family="${key}">Eliminar</button>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="pl-saved-comparisons-empty">No hay comparaciones guardadas aún.</div>';

    panel.innerHTML = `
      <div class="pl-saved-comparisons-header">
        <div>
          <strong>Comparaciones guardadas</strong>
          <div class="pl-saved-comparisons-sub">Carga un conjunto para comparar varios productos a la vez.</div>
        </div>
        <button type="button" class="secondary-btn pl-saved-comparison-create">Guardar selección</button>
      </div>
      ${selectedCount ? `<div class="pl-saved-comparison-selected">${selectedCount} producto${selectedCount === 1 ? '' : 's'} seleccionado${selectedCount === 1 ? '' : 's'}</div>` : ''}
      <div class="pl-saved-comparisons-list">${savedHtml}</div>
    `;
    panel.classList.remove('hidden');
  };

  const createSavedComparison = () => {
    const selectedKeys = getSelectedProductKeys();
    if (!selectedKeys.length) {
      toast('Selecciona al menos un producto para guardar.', 'warning');
      return;
    }
    const name = prompt('Nombre de la comparación');
    if (!name || !name.trim()) return;
    const key = normalize(name) + '-' + Date.now();
    savedComparisons[key] = {
      name: name.trim(),
      members: selectedKeys,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveSavedComparisonsToStorage();
    renderSavedComparisonsSettings();
    renderSavedComparisonsPanel();
    toast('Comparación guardada', 'success');
  };

  const handleSavedComparisonsPanelAction = ev => {
    const loadBtn = ev.target.closest('.pl-saved-comparison-load');
    if (loadBtn) {
      const key = loadBtn.dataset.family;
      const comparison = savedComparisons[key];
      if (!comparison) return;
      comparisonSelection = new Set(comparison.members.filter(member => productIndex[member]));
      recalcAndRender();
      renderSuggestions(lastSuggestionGroups, lastSearchQuery, lastQueryTokens);
      renderSavedComparisonsPanel();
      return;
    }

    const deleteBtn = ev.target.closest('.pl-saved-comparison-delete');
    if (deleteBtn) {
      const key = deleteBtn.dataset.family;
      if (!key || !savedComparisons[key]) return;
      if (!confirm('¿Eliminar esta comparación guardada?')) return;
      delete savedComparisons[key];
      saveSavedComparisonsToStorage();
      renderSavedComparisonsSettings();
      renderSavedComparisonsPanel();
      toast('Comparación eliminada', 'success');
      return;
    }

    const createBtn = ev.target.closest('.pl-saved-comparison-create');
    if (createBtn) {
      createSavedComparison();
      return;
    }
  };

  const handleSavedComparisonSettingsAction = ev => {
    const selectBtn = ev.target.closest('.pl-saved-comparison-select');
    if (selectBtn) {
      const key = selectBtn.dataset.family;
      if (!key || !savedComparisons[key]) return;
      savedComparisons[key].members.forEach(productKey => comparisonSelection.add(productKey));
      recalcAndRender();
      renderSuggestions(lastSuggestionGroups, lastSearchQuery, lastQueryTokens);
      return;
    }

    const editBtn = ev.target.closest('.pl-saved-comparison-edit');
    if (editBtn) {
      const key = editBtn.dataset.family;
      const comparison = savedComparisons[key];
      if (!comparison) return;
      const newName = prompt('Nombre de la comparación', comparison.name);
      if (!newName) return;
      const newMembersRaw = prompt('Productos (separados por coma)', comparison.members.join(', '));
      if (newMembersRaw === null) return;
      const newMembers = newMembersRaw.split(',').map(s => normalize(s.trim())).filter(Boolean);
      if (!newMembers.length) {
        alert('Necesitas al menos un producto.');
        return;
      }
      comparison.name = newName.trim();
      comparison.members = [...new Set(newMembers)];
      comparison.updatedAt = new Date().toISOString();
      saveSavedComparisonsToStorage();
      renderSavedComparisonsSettings();
      toast('Comparación actualizada', 'success');
      return;
    }

    const deleteBtn = ev.target.closest('.pl-saved-comparison-delete');
    if (!deleteBtn) return;
    const key = deleteBtn.dataset.family;
    if (!key || !savedComparisons[key]) return;

    if (!confirm('¿Eliminar esta comparación guardada?')) return;
    delete savedComparisons[key];
    saveSavedComparisonsToStorage();
    renderSavedComparisonsSettings();
    toast('Comparación eliminada', 'success');
  };

  const applySynonyms = token => {
    // 1. Check user-defined synonyms
    if (USER_SYNONYMS[token]) return USER_SYNONYMS[token];
    // 2. Check constant dictionary mapping
    if (CONSTANT_SYNONYMS[token]) return CONSTANT_SYNONYMS[token];
    return token;
  };

  const applyNormalization = token => {
    return normalizationRules[token] || token;
  };

  const tokenizeProduct = text => {
    return normalize(text)
      .split(/\s+/)
      .filter(Boolean)
      .map(token => applyNormalization(applySynonyms(token)));
  };

  const isSizeToken = token => /^(\d+([.,]\d+)?(g|kg|l|ml|lt|lts)?)$/.test(token) || /^(g|kg|l|ml|lt|lts)$/.test(token);
  const isVariantToken = token => {
    return [
      'bloque','barra','tajado','rallado','bolsa','caja','paquete','botella','unidad','unidad','carton',
      'entera','light','deslactosada','natural','premium','fresa','chocolate','alpina','colanta','alqueria',
      'diana','elite','decorada','gran','pequena','pequeña'
    ].includes(token) || isSizeToken(token);
  };

  const parseProductMetadata = product => {
    const tokens = tokenizeProduct(product);
    const baseTokens = [];
    const variantTokens = [];
    let foundVariant = false;

    tokens.forEach(token => {
      if (!foundVariant && !isVariantToken(token) && baseTokens.length < 2) {
        baseTokens.push(token);
        return;
      }
      foundVariant = true;
      variantTokens.push(token);
    });

    if (!baseTokens.length && tokens.length) {
      baseTokens.push(tokens[0]);
      variantTokens.push(...tokens.slice(1));
    }

    const familyBase = baseTokens.join(' ');
    const variantLabel = variantTokens.length ? variantTokens.join(' ') : 'Original';

    return {
      originalName: product,
      normalizedKey: tokens.join(' '),
      tokens,
      familyBase,
      variantLabel
    };
  };

  // ----- Helpers -----
  const debounce = (fn, delay) => (...args) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fn(...args), delay);
  };

  const normalize = str => (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // ----- Safe recursive-descent arithmetic parser (no eval) -----
  const evaluateExpression = expr => {
    if (!expr || !String(expr).trim()) return 1;
    let i = 0;
    const s = String(expr).replace(/\s+/g, '');

    const peek    = () => s[i];
    const consume = () => s[i++];

    const parseNumber = () => {
      let start = i;
      while (i < s.length && /[0-9.]/.test(peek())) consume();
      const numStr = s.slice(start, i);
      if (!numStr) throw new Error('Número esperado');
      return parseFloat(numStr);
    };

    const parseFactor = () => {
      if (peek() === '(') {
        consume();
        const val = parseExpr();
        if (consume() !== ')') throw new Error('Paréntesis no balanceados');
        return val;
      }
      if (peek() === '-') { consume(); return -parseFactor(); }
      return parseNumber();
    };

    const parseTerm = () => {
      let val = parseFactor();
      while (i < s.length) {
        const op = peek();
        if (op === '*' || op === '/') {
          consume();
          const right = parseFactor();
          val = op === '*' ? val * right : val / right;
        } else break;
      }
      return val;
    };

    const parseExpr = () => {
      let val = parseTerm();
      while (i < s.length) {
        const op = peek();
        if (op === '+' || op === '-') {
          consume();
          const right = parseTerm();
          val = op === '+' ? val + right : val - right;
        } else break;
      }
      return val;
    };

    const result = parseExpr();
    if (i < s.length) throw new Error('Expresión inválida');
    return result;
  };

  const parseSafeDate = (dateVal) => {
    if (!dateVal) return new Date(NaN);
    if (dateVal instanceof Date) return dateVal;
    
    const str = dateVal.toString().trim();
    
    // Check for DD/MM/YYYY format
    const slashParts = str.split('/');
    if (slashParts.length === 3) {
      const day = parseInt(slashParts[0], 10);
      const month = parseInt(slashParts[1], 10) - 1; // 0-indexed in JS
      const year = parseInt(slashParts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        // Adjust for 2-digit years if any
        const fullYear = year < 100 ? (year + 2000) : year;
        return new Date(fullYear, month, day);
      }
    }
    
    // Check for standard parsing
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed;
    
    // Check for Timestamp format or ISO
    const isoParsed = new Date(str.replace(/-/g, '/'));
    return isoParsed;
  };

  // ----- Fetch history -----
  const fetchHistory = async () => {
    const scriptUrl = (typeof Storage !== 'undefined') ? Storage.getScriptUrl() : null;
    if (!scriptUrl) {
      toast('URL del Apps Script no configurada', 'error');
      return [];
    }
    try {
      const response = await fetch(scriptUrl + HISTORY_ENDPOINT);
      const raw = await response.json();
      let rows;
      if (Array.isArray(raw)) {
        rows = raw;
      } else if (raw && Array.isArray(raw.data)) {
        rows = raw.data;
      } else if (raw && Array.isArray(raw.result)) {
        rows = raw.result;
      } else if (raw && Array.isArray(raw.items)) {
        rows = raw.items;
      } else {
        rows = [];
      }

      // Skip header row if necessary
      if (rows.length && isNaN(parseFloat(rows[0].totalPrice || rows[0]['Total Price'] || rows[0].quantity))) {
        rows = rows.slice(1);
      }

      purchaseHistory = rows
        .map(entry => ({
          product: (entry.Product || entry.product || '').toString().trim(),
          quantity: parseFloat(entry.Quantity || entry.quantity) || 1,
          totalPrice: parseFloat(entry['Total Price'] || entry.totalPrice || entry.TotalPrice) || 0,
          purchaseDate: parseSafeDate(entry['Purchase Date'] || entry.purchaseDate || entry.PurchaseDate),
          store: (entry.Store || entry.store || '').toString().trim(),
          category: (entry.Category || entry.category || '').toString().trim(),
        }))
        .filter(e => e.product && !isNaN(e.purchaseDate.getTime()));

      buildIndex();
      populateFilters();
      return purchaseHistory;
    } catch (e) {
      console.error('Error fetching history', e);
      toast('No se pudo cargar el historial', 'error');
      return [];
    }
  };

  const buildIndex = () => {
    productIndex = {};
    purchaseHistory.forEach(entry => {
      const meta = parseProductMetadata(entry.product);
      const key = meta.normalizedKey;
      if (!productIndex[key]) {
        productIndex[key] = {
          entries: [],
          originalNames: new Set(),
          familyBase: meta.familyBase,
          variantLabel: meta.variantLabel
        };
      }
      productIndex[key].entries.push(entry);
      productIndex[key].originalNames.add(meta.originalName);
    });
    buildFamilyCandidates();
  };

  const populateFilters = () => {
    const stores = [...new Set(purchaseHistory.map(e => e.store).filter(Boolean))].sort();
    const categories = [...new Set(purchaseHistory.map(e => e.category).filter(Boolean))].sort();
    
    const storeEl = document.getElementById('filter-store');
    const catEl = document.getElementById('filter-category');
    
    if (storeEl) {
      storeEl.innerHTML = '<option value="">Todas</option>' +
        stores.map(s => `<option value="${s}">${s}</option>`).join('');
    }
    if (catEl) {
      catEl.innerHTML = '<option value="">Todas</option>' +
        categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  };

  const isLearnEnabled = () => {
    const el = document.getElementById('settings-learn-toggle');
    return el ? el.checked : true;
  };

  const updateLearnCount = product => {
    if (!isLearnEnabled()) return;
    const key = normalize(product);
    let counts;
    try { counts = JSON.parse(localStorage.getItem(LEARN_KEY) || '{}'); } catch { counts = {}; }
    counts[key] = (counts[key] || 0) + 1;
    localStorage.setItem(LEARN_KEY, JSON.stringify(counts));
  };

  const getLearnCount = product => {
    if (!isLearnEnabled()) return 0;
    const key = normalize(product);
    try { return JSON.parse(localStorage.getItem(LEARN_KEY) || '{}')[key] || 0; } catch { return 0; }
  };

  const getFilters = () => ({
    store: (document.getElementById('filter-store') || {}).value || '',
    category: (document.getElementById('filter-category') || {}).value || '',
    days: parseInt((document.getElementById('filter-days') || {}).value, 10) || ANALYSIS_DAYS,
  });

  const filteredEntries = (key, filters) => {
    const entries = productIndex[key] ? productIndex[key].entries : [];
    const now = Date.now();
    const ms = filters.days * 24 * 60 * 60 * 1000;
    return entries.filter(e => {
      if (now - e.purchaseDate.getTime() > ms) return false;
      if (filters.store && e.store !== filters.store) return false;
      if (filters.category && e.category !== filters.category) return false;
      return true;
    });
  };

  const toggleFamilyExpanded = familyKey => {
    if (expandedFamilies.has(familyKey)) {
      expandedFamilies.delete(familyKey);
    } else {
      expandedFamilies.add(familyKey);
    }
  };

  const renderSuggestions = (suggestions, query = '', queryTokens = []) => {
    const listEl = document.getElementById('price-suggestion-list');
    if (!listEl) return;
    lastSuggestionGroups = suggestions;
    renderSavedComparisonsPanel();

    if (purchaseHistory.length === 0) {
      listEl.innerHTML = `<li class="pl-suggestion-no-match">⚠️ El historial de compras está vacío. Pulsa el botón 🔄 para recargar.</li>`;
      listEl.classList.remove('hidden');
      return;
    }
    if (!suggestions.length) {
      if (query) {
        listEl.innerHTML = `<li class="pl-suggestion-no-match">No se encontraron productos para "${query}"</li>`;
        listEl.classList.remove('hidden');
      } else {
        listEl.innerHTML = '';
        listEl.classList.add('hidden');
      }
      return;
    }

    const renderProductItem = item => {
      const checked = comparisonSelection.has(item.key);
      const display = titleCase(item.title);
      const historyCount = item.freq || 0;
      const historyLabel = historyCount ? `${historyCount} compra${historyCount === 1 ? '' : 's'}` : 'Sin compras recientes';
      return `
        <li class="pl-suggestion-item${checked ? ' selected' : ''}" data-product="${item.key}" tabindex="0">
          <label class="pl-product-result-label">
            <input type="checkbox" class="pl-product-checkbox" data-key="${item.key}" ${checked ? 'checked' : ''}>
            <div class="pl-product-content">
              <div class="pl-suggestion-title">${escapeHtml(display)}</div>
              <div class="pl-suggestion-meta">${escapeHtml(historyLabel)}${item.learn ? ` · <span class="pl-learn-badge">${item.learn}</span>` : ''}</div>
            </div>
            <div class="pl-suggestion-count">${item.members.length} variante${item.members.length === 1 ? '' : 's'}</div>
          </label>
        </li>
      `;
    };

    listEl.innerHTML = suggestions.map(renderProductItem).join('');
    listEl.classList.remove('hidden');
  };

  const splitProductKey = key => key.split(/\s+/).filter(Boolean);
  const commonPrefixLength = (a, b) => {
    let count = 0;
    while (count < a.length && count < b.length && a[count] === b[count]) count++;
    return count;
  };

  const titleCase = text => String(text || '').replace(/\b\w/g, c => c.toUpperCase());

  const calculateFamilyConfidence = (base, members) => {
    if (members.length < 2) return 0;
    const baseTokens = splitProductKey(base);
    const scores = members.map(key => {
      const keyTokens = splitProductKey(key);
      const common = commonPrefixLength(baseTokens, keyTokens);
      return common / Math.max(baseTokens.length, keyTokens.length);
    });
    return Math.min(...scores) * 100;
  };

  const buildFamilyCandidates = () => {
    // Legacy family suggestion logic is deprecated for the new comparison UX.
    lastSuggestionGroups = [];
  };

  const findMatchingProducts = (queryTokens, excludeTokens, filters) => {
    return Object.entries(productIndex)
      .filter(([key]) => {
        if (EXCLUSIONS.has(key)) return false;
        const matchesAll = queryTokens.every(tok => key.includes(tok));
        const excluded = excludeTokens.some(tok => key.includes(tok));
        if (!matchesAll || excluded) return false;
        if (filters.store || filters.category) {
          return filteredEntries(key, filters).length > 0;
        }
        return true;
      })
      .map(([key]) => {
        const entries = filteredEntries(key, filters);
        const learn = getLearnCount(key);
        const freq = entries.length;
        const recent = entries.length ? Math.max(...entries.map(e => e.purchaseDate.getTime())) : 0;
        const similarity = queryTokens.filter(tok => key.includes(tok)).length;
        return { type: 'product', key, title: titleCase(key), members: [key], similarity, learn, freq, recent };
      })
      .sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
        if (b.learn !== a.learn) return b.learn - a.learn;
        if (b.freq !== a.freq) return b.freq - a.freq;
        if (b.recent !== a.recent) return b.recent - a.recent;
        return a.title.localeCompare(b.title);
      });
  };

  const rankProducts = (queryTokens, excludeTokens, filters) => {
    return findMatchingProducts(queryTokens, excludeTokens, filters).slice(0, 20);
  };

  const onSearchInput = debounce(ev => {
    const raw = normalize(ev.target.value);
    lastSearchQuery = raw;
    if (!raw) {
      lastQueryTokens = [];
      renderSuggestions([], '', []);
      return;
    }
    const filters = getFilters();
    const tokens = raw.split(/\s+/).filter(t => t);
    
    // Process tokens applying synonyms and checking stop words
    const include = tokens
      .filter(t => !t.startsWith('-'))
      .map(t => applySynonyms(t))
      .map(t => applyNormalization(t))
      .filter(t => !STOP_WORDS.has(t));
      
    const exclude = tokens
      .filter(t => t.startsWith('-'))
      .map(t => t.slice(1))
      .map(t => applySynonyms(t))
      .map(t => applyNormalization(t));

    lastQueryTokens = include;
    const matches = rankProducts(include, exclude, filters);
    renderSuggestions(matches, raw, include);
  }, DEBOUNCE_MS);

  // ----- Trend calculation -----
  const calculateTrend = (entries) => {
    if (entries.length < 2) return { icon: '➡', text: 'Estable' };
    
    // Sort entries chronologically
    const sorted = [...entries].sort((a, b) => a.purchaseDate - b.purchaseDate);
    const unitPrices = sorted.map(e => e.totalPrice / e.quantity);

    // Simple Linear Regression slope
    const n = unitPrices.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += unitPrices[i];
      sumXY += i * unitPrices[i];
      sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    // Define a small threshold to avoid minimal noise triggering trend changes
    const threshold = 0.01;
    if (slope > threshold) return { icon: '📈', text: 'Creciente' };
    if (slope < -threshold) return { icon: '📉', text: 'Decreciente' };
    return { icon: '➡', text: 'Estable' };
  };

  const computeMetrics = (product, observedPrice, qtyExpr, filters, activeKeys = null) => {
    const keys = activeKeys || [normalize(product)];
    const entries = keys.flatMap(key => filteredEntries(key, filters));
    if (!entries.length) return null;

    const qty = (() => {
      try { return evaluateExpression(qtyExpr) || 1; } catch { return 1; }
    })();
    const observedUnit = observedPrice / qty;

    const unitCosts = entries.map(e => e.totalPrice / e.quantity);
    const avg = unitCosts.reduce((s, v) => s + v, 0) / unitCosts.length;
    const minCost = Math.min(...unitCosts);
    const minEntry = entries[unitCosts.indexOf(minCost)];
    const lastEntry = entries.reduce((l, c) => c.purchaseDate > l.purchaseDate ? c : l, entries[0]);
    const lastUnit = lastEntry.totalPrice / lastEntry.quantity;

    const savings = (avg - observedUnit) * qty;
    const diffMin = (observedUnit - minCost) * qty;
    const trend = calculateTrend(entries);

    // Badge based purely on historical average
    let badge;
    if (observedUnit <= avg * 0.90) {
      badge = { label: 'Excelente precio', cls: 'badge-excellent', emoji: '🟢' };
    } else if (observedUnit <= avg) {
      badge = { label: 'Buen precio', cls: 'badge-good', emoji: '🟢' };
    } else if (observedUnit <= avg * 1.10) {
      badge = { label: 'Precio normal', cls: 'badge-normal', emoji: '🟡' };
    } else if (observedUnit <= avg * 1.20) {
      badge = { label: 'Algo costoso', cls: 'badge-warning', emoji: '🟠' };
    } else {
      badge = { label: 'Muy caro', cls: 'badge-danger', emoji: '🔴' };
    }

    return {
      productName: product,
      observedPrice,
      observedUnit: observedUnit.toFixed(2),
      qty,
      avg: avg.toFixed(2),
      minUnit: minCost.toFixed(2),
      minDate: minEntry.purchaseDate.toLocaleDateString('es-ES'),
      minStore: minEntry.store,
      lastUnit: lastUnit.toFixed(2),
      lastDate: lastEntry.purchaseDate.toLocaleDateString('es-ES'),
      lastStore: lastEntry.store,
      savings: savings.toFixed(2),
      diffMin: diffMin.toFixed(2),
      savingsPct: (((avg - observedUnit) / avg) * 100).toFixed(1),
      diffMinPct: (((observedUnit - minCost) / minCost) * 100).toFixed(1),
      trend,
      badge,
      entries
    };
  };

  const renderBadge = badge => {
    const el = document.getElementById('price-badge');
    if (!el) return;
    if (!badge) {
      el.classList.add('hidden');
      return;
    }
    el.className = `pl-badge ${badge.cls}`;
    el.textContent = `${badge.emoji} ${badge.label}`;
    el.classList.remove('hidden');
  };

  const escapeHtml = text => String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const getSelectedProductKeys = () => [...comparisonSelection].filter(key => productIndex[key]);

  const renderDetails = metrics => {
    const detailsDiv  = document.getElementById('price-details');
    const resultPanel = document.getElementById('price-result-panel');
    if (!detailsDiv || !resultPanel) return;

    const activeKeys = getSelectedProductKeys();
    const hasSelection = activeKeys.length > 0;
    const displayTitle = metrics && metrics.productName ? titleCase(metrics.productName) : (activeKeys.length === 1 ? titleCase(activeKeys[0]) : `Comparación de ${activeKeys.length} productos`);

    if (!hasSelection) {
      detailsDiv.classList.add('hidden');
      resultPanel.innerHTML = '';
      renderBadge(null);
      renderHistoryTable([]);
      renderStoreTable([]);
      return;
    }

    detailsDiv.classList.remove('hidden');
    renderBadge(metrics ? metrics.badge : null);

    const formatDifference = (val, pct, comparison) => {
      const isPositive = parseFloat(val) >= 0;
      const cleanVal = Math.abs(parseFloat(val)).toFixed(2);
      const cleanPct = Math.abs(parseFloat(pct)).toFixed(1);
      if (comparison === 'average') {
        return isPositive 
          ? `<span class="diff-positive">Ahorras $${cleanVal} (${cleanPct}%) vs promedio</span>` 
          : `<span class="diff-negative">Pagas $${cleanVal} (${cleanPct}%) más que el promedio</span>`;
      } else {
        return isPositive
          ? `<span class="diff-negative">+$${cleanVal} (+${cleanPct}%) vs mínimo</span>`
          : `<span class="diff-positive">-$${cleanVal} (-${cleanPct}%) vs mínimo</span>`;
      }
    };

    const selectionPanel = `
      <div class="pl-family-summary">
        <div class="pl-family-status">
          <span>${activeKeys.length} producto${activeKeys.length === 1 ? '' : 's'} seleccionado${activeKeys.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="pl-family-list">
        ${activeKeys.map(key => `
          <div class="pl-family-item included">
            <span class="pl-family-item-name">${escapeHtml(titleCase(key))}</span>
            <span class="pl-family-item-state">Seleccionado</span>
          </div>
        `).join('')}
      </div>
    `;

    if (!metrics) {
      resultPanel.innerHTML = `
        <div class="pl-product-info">
          <h2 class="pl-product-title">${escapeHtml(displayTitle)}</h2>
          <div class="pl-trend-badge">Selecciona productos y agrega un precio observado para calcular los indicadores.</div>
        </div>
        ${selectionPanel}
        <div class="pl-empty-state">Ingresa un precio observado válido para comparar los productos seleccionados.</div>
      `;
      renderHistoryTable([]);
      renderStoreTable([]);
      return;
    }

    resultPanel.innerHTML = `
      <div class="pl-product-info">
        <h2 class="pl-product-title">${escapeHtml(displayTitle)}</h2>
        <div class="pl-trend-badge">Tendencia: ${metrics.trend.icon} ${metrics.trend.text}</div>
      </div>
      ${selectionPanel}
      <div class="pl-metric-grid">
        <div class="pl-metric highlight">
          <span class="pl-metric-label">Precio Unitario Observado</span>
          <span class="pl-metric-value">$${metrics.observedUnit}</span>
          <span class="pl-metric-sub">Obs. $${metrics.observedPrice} (cant: ${metrics.qty})</span>
        </div>
        <div class="pl-metric">
          <span class="pl-metric-label">Promedio Histórico</span>
          <span class="pl-metric-value">$${metrics.avg}</span>
          <span class="pl-metric-sub">${formatDifference(metrics.savings, metrics.savingsPct, 'average')}</span>
        </div>
        <div class="pl-metric">
          <span class="pl-metric-label">Mínimo Histórico</span>
          <span class="pl-metric-value">$${metrics.minUnit}</span>
          <span class="pl-metric-sub">${metrics.minDate} en ${metrics.minStore}</span>
          <span class="pl-metric-sub-small">${formatDifference(metrics.diffMin, metrics.diffMinPct, 'minimum')}</span>
        </div>
        <div class="pl-metric">
          <span class="pl-metric-label">Última Compra</span>
          <span class="pl-metric-value">$${metrics.lastUnit}</span>
          <span class="pl-metric-sub">${metrics.lastDate} en ${metrics.lastStore}</span>
        </div>
      </div>`;

    renderHistoryTable(metrics.entries);
    renderStoreTable(metrics.entries);
  };

  const renderHistoryTable = entries => {
    const section = document.getElementById('pl-history-section');
    const tbody   = document.querySelector('#pl-history-table tbody');
    if (!section || !tbody) return;
    if (!entries.length) { section.classList.add('hidden'); return; }

    const sorted = [...entries].sort((a, b) => b.purchaseDate - a.purchaseDate);
    tbody.innerHTML = sorted.map(e => {
      const unit = (e.totalPrice / e.quantity).toFixed(2);
      return `<tr>
        <td>${e.purchaseDate.toLocaleDateString('es-ES')}</td>
        <td>${e.store}</td>
        <td>${e.quantity}</td>
        <td>$${e.totalPrice.toFixed(2)}</td>
        <td>$${unit}</td>
      </tr>`;
    }).join('');
    section.classList.remove('hidden');
  };

  const renderStoreTable = entries => {
    const section = document.getElementById('pl-store-section');
    const tbody   = document.querySelector('#pl-store-table tbody');
    if (!section || !tbody) return;
    if (!entries.length) { section.classList.add('hidden'); return; }

    const byStore = {};
    entries.forEach(e => {
      if (!byStore[e.store]) byStore[e.store] = [];
      byStore[e.store].push(e);
    });

    const storeSummaries = Object.entries(byStore).map(([store, ses]) => {
      const units = ses.map(e => e.totalPrice / e.quantity);
      const avg = units.reduce((s, v) => s + v, 0) / units.length;
      const min = Math.min(...units);
      const last = ses.reduce((l, c) => c.purchaseDate > l.purchaseDate ? c : l, ses[0]);
      const lastU = last.totalPrice / last.quantity;
      return {
        store,
        avg,
        min,
        lastU,
        lastDate: last.purchaseDate.toLocaleDateString('es-ES'),
        count: ses.length
      };
    });

    // Order supermarkets by lowest average unit price
    storeSummaries.sort((a, b) => a.avg - b.avg);

    tbody.innerHTML = storeSummaries.map(s => `
      <tr>
        <td><strong>${s.store}</strong> <span class="pl-count-badge">(${s.count})</span></td>
        <td>$${s.avg.toFixed(2)}</td>
        <td>$${s.min.toFixed(2)}</td>
        <td>$${s.lastU.toFixed(2)} <span class="pl-store-date">${s.lastDate}</span></td>
      </tr>
    `).join('');
    section.classList.remove('hidden');
  };


  const onSuggestionClick = ev => {
    if (ev.target.closest('.pl-product-checkbox')) return;
    const item = ev.target.closest('.pl-suggestion-item');
    if (!item) return;
    const checkbox = item.querySelector('.pl-product-checkbox');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    const key = checkbox.dataset.key;
    if (!key) return;
    if (checkbox.checked) {
      comparisonSelection.add(key);
    } else {
      comparisonSelection.delete(key);
    }
    recalcAndRender();
    renderSuggestions(lastSuggestionGroups, lastSearchQuery, lastQueryTokens);
  };

  const onSuggestionChange = ev => {
    const checkbox = ev.target.closest('.pl-product-checkbox');
    if (!checkbox) return;
    const key = checkbox.dataset.key;
    if (!key) return;
    if (checkbox.checked) {
      comparisonSelection.add(key);
    } else {
      comparisonSelection.delete(key);
    }
    recalcAndRender();
  };

  const focusSuggestionItem = productKey => {
    const listEl = document.getElementById('price-suggestion-list');
    if (!listEl) return;
    const item = listEl.querySelector(`.pl-suggestion-item[data-product="${productKey}"]`);
    if (item) item.focus();
  };

  const onSuggestionKeydown = ev => {
    const listEl = document.getElementById('price-suggestion-list');
    if (!listEl) return;
    const focusable = Array.from(listEl.querySelectorAll('.pl-suggestion-item[tabindex="0"]'));
    if (!focusable.length) return;

    const index = focusable.indexOf(document.activeElement);
    if (index === -1) return;

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      const next = focusable[index + 1] || focusable[0];
      next.focus();
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      const prev = focusable[index - 1] || focusable[focusable.length - 1];
      prev.focus();
      return;
    }

    const item = document.activeElement.closest('.pl-suggestion-item');
    if (!item) return;
    const checkbox = item.querySelector('.pl-product-checkbox');
    if (!checkbox) return;

    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      checkbox.checked = !checkbox.checked;
      const key = checkbox.dataset.key;
      if (!key) return;
      if (checkbox.checked) {
        comparisonSelection.add(key);
      } else {
        comparisonSelection.delete(key);
      }
      recalcAndRender();
      renderSuggestions(lastSuggestionGroups, lastSearchQuery, lastQueryTokens);
      return;
    }
  };

  const recalcAndRender = () => {
    const observedVal = parseFloat((document.getElementById('observed-price-input') || {}).value);
    const activeKeys = getSelectedProductKeys();
    if (!activeKeys.length) {
      renderDetails(null);
      return;
    }
    if (isNaN(observedVal) || observedVal <= 0) {
      renderDetails(null);
      return;
    }
    const qtyExpr = (document.getElementById('quantity-expr-input') || {}).value || '1';
    const filters = getFilters();
    const title = activeKeys.length === 1 ? activeKeys[0] : `Comparación de ${activeKeys.length} productos`;
    const metrics = computeMetrics(title, observedVal, qtyExpr, filters, activeKeys);
    renderDetails(metrics);
  };

  const init = async () => {
    loadPrefs();

    // Register all UI listeners synchronously so they work immediately
    const searchInput = document.getElementById('price-search-input');
    if (searchInput) searchInput.addEventListener('input', onSearchInput);

    const suggestionList = document.getElementById('price-suggestion-list');
    if (suggestionList) {
      suggestionList.addEventListener('click', onSuggestionClick);
      suggestionList.addEventListener('change', onSuggestionChange);
      suggestionList.addEventListener('keydown', onSuggestionKeydown);
    }

    const savedComparisonsPanel = document.getElementById('pl-saved-comparisons-panel');
    if (savedComparisonsPanel) savedComparisonsPanel.addEventListener('click', handleSavedComparisonsPanelAction);

    const comparisonSettingsList = document.getElementById('pl-family-settings-list');
    if (comparisonSettingsList) comparisonSettingsList.addEventListener('click', handleSavedComparisonSettingsAction);

    const priceInput = document.getElementById('observed-price-input');
    if (priceInput) priceInput.addEventListener('input', recalcAndRender);
    
    const qtyInput = document.getElementById('quantity-expr-input');
    if (qtyInput) qtyInput.addEventListener('input', recalcAndRender);

    const filterStore = document.getElementById('filter-store');
    if (filterStore) filterStore.addEventListener('change', recalcAndRender);
    
    const filterCat = document.getElementById('filter-category');
    if (filterCat) filterCat.addEventListener('change', recalcAndRender);

    const selectAllBtn = document.getElementById('btn-select-all');
    if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
      const productKeys = lastSuggestionGroups.map(item => item.key);
      productKeys.forEach(key => comparisonSelection.add(key));
      recalcAndRender();
      renderSuggestions(lastSuggestionGroups, lastSearchQuery, lastQueryTokens);
    });

    const deselectAllBtn = document.getElementById('btn-deselect-all');
    if (deselectAllBtn) deselectAllBtn.addEventListener('click', () => {
      comparisonSelection.clear();
      recalcAndRender();
      renderSuggestions(lastSuggestionGroups, lastSearchQuery, lastQueryTokens);
    });

    const invertSelectionBtn = document.getElementById('btn-invert-selection');
    if (invertSelectionBtn) invertSelectionBtn.addEventListener('click', () => {
      const currentKeys = lastSuggestionGroups.map(item => item.key);
      const newSelection = new Set();
      currentKeys.forEach(key => {
        if (!comparisonSelection.has(key)) newSelection.add(key);
      });
      comparisonSelection = newSelection;
      recalcAndRender();
      renderSuggestions(lastSuggestionGroups, lastSearchQuery, lastQueryTokens);
    });

    const filterDays = document.getElementById('filter-days');
    if (filterDays) filterDays.addEventListener('change', () => {
      ANALYSIS_DAYS = parseInt(filterDays.value, 10) || DEFAULT_DAYS;
      recalcAndRender();
    });

    const refreshBtn = document.getElementById('price-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        purchaseHistory = [];
        productIndex = {};
        await fetchHistory();
        toast('Historial recargado', 'success');
        const si = document.getElementById('price-search-input');
        const pi = document.getElementById('observed-price-input');
        const qi = document.getElementById('quantity-expr-input');
        if (si) si.value = '';
        if (pi) pi.value = '';
        if (qi) qi.value = '';
        renderSuggestions([]);
        renderDetails(null);
      });
    }

    const backBtn = document.getElementById('btn-price-back');
    if (backBtn) backBtn.addEventListener('click', () => {
      if (typeof showView === 'function') showView('view-home');
    });

    // Save preferences from settings view
    const saveBtn = document.getElementById('btn-save-settings');
    if (saveBtn) saveBtn.addEventListener('click', savePrefs);

    // Clear learned products
    const clearLearnBtn = document.getElementById('btn-clear-learn');
    if (clearLearnBtn) {
      clearLearnBtn.addEventListener('click', () => {
        if (confirm('¿Limpiar el historial de búsquedas aprendidas?')) {
          localStorage.removeItem(LEARN_KEY);
          toast('Historial de aprendizaje eliminado', 'success');
        }
      });
    }

    // Load history in the background without blocking the UI init
    fetchHistory().catch(err => console.error('Background fetchHistory error:', err));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();
