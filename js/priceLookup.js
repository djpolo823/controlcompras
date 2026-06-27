// js/priceLookup.js – Independent price lookup module
// Provides UI for searching past purchase history and comparing prices.
// Self‑contained; does not modify other app parts.

(() => {
  // ----- Configuration -----
  const HISTORY_ENDPOINT = '?action=getHistory';
  const LEARN_KEY        = 'priceLookupLearnCounts';
  const PREFS_KEY        = 'priceLookupPrefs';
  const DEBOUNCE_MS      = 150;
  const DEFAULT_DAYS     = 90;

  const DEFAULT_STOP_WORDS = new Set([
    'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'en', 'con', 'un', 'una', 'por', 'para', 'al'
  ]);

  // Synonym dictionary as specified in requirements
  const CONSTANT_SYNONYMS = {
    'litro': 'l', 'lt': 'l', 'lts': 'l',
    'gramo': 'g', 'gr': 'g', 'gramos': 'g',
    'kilogramo': 'kg', 'kilo': 'kg', 'kgs': 'kg'
  };

  // ----- Runtime State -----
  let purchaseHistory = [];   // in-memory only, never persisted
  let productIndex    = {};   // key → [entries]
  let debounceTimer   = null;
  let selectedProduct = '';
  let ANALYSIS_DAYS   = DEFAULT_DAYS;
  let STOP_WORDS      = new Set(DEFAULT_STOP_WORDS);
  let USER_SYNONYMS   = {};   // dynamically parsed from settings
  let EXCLUSIONS      = new Set();

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

      // Checkboxes in settings
      const learnEl = document.getElementById('settings-learn-toggle');
      if (learnEl) learnEl.checked = p.learnEnabled !== false;
    } catch (_) { /* ignore */ }
  };

  const savePrefs = () => {
    const daysEl = document.getElementById('settings-analysis-days');
    const synEl  = document.getElementById('settings-synonyms');
    const learnEl = document.getElementById('settings-learn-toggle');
    
    const prefs = {
      analysisDays: daysEl ? parseInt(daysEl.value, 10) || DEFAULT_DAYS : DEFAULT_DAYS,
      synonymsRaw:  synEl  ? synEl.value : '',
      learnEnabled: learnEl ? learnEl.checked : true,
      exclusions: Array.from(EXCLUSIONS)
    };
    
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    ANALYSIS_DAYS = prefs.analysisDays;
    parseUserSynonyms(prefs.synonymsRaw);
    
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

  const applySynonyms = token => {
    // 1. Check user-defined synonyms
    if (USER_SYNONYMS[token]) return USER_SYNONYMS[token];
    // 2. Check constant dictionary mapping
    if (CONSTANT_SYNONYMS[token]) return CONSTANT_SYNONYMS[token];
    return token;
  };

  // ----- Helpers -----
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
          purchaseDate: new Date(entry['Purchase Date'] || entry.purchaseDate || entry.PurchaseDate),
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
      const key = normalize(entry.product);
      if (!productIndex[key]) productIndex[key] = [];
      productIndex[key].push(entry);
    });
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
    const entries = productIndex[key] || [];
    const now = Date.now();
    const ms = filters.days * 24 * 60 * 60 * 1000;
    return entries.filter(e => {
      if (now - e.purchaseDate.getTime() > ms) return false;
      if (filters.store && e.store !== filters.store) return false;
      if (filters.category && e.category !== filters.category) return false;
      return true;
    });
  };

  const renderSuggestions = suggestions => {
    const listEl = document.getElementById('price-suggestion-list');
    if (!listEl) return;
    if (!suggestions.length) {
      listEl.innerHTML = '';
      listEl.classList.add('hidden');
      return;
    }
    listEl.innerHTML = suggestions.map(p => {
      const display = p.replace(/\b\w/g, c => c.toUpperCase());
      const learn = getLearnCount(p);
      return `<li class="pl-suggestion-item" data-product="${p}">${display}${learn ? ` <span class="pl-learn-badge">${learn}</span>` : ''}</li>`;
    }).join('');
    listEl.classList.remove('hidden');
  };

  const rankProducts = (queryTokens, excludeTokens, filters) => {
    const now = Date.now();
    const ms = filters.days * 24 * 60 * 60 * 1000;
    return Object.keys(productIndex)
      .filter(key => {
        // Exclude permanently excluded products or session excluded products
        if (EXCLUSIONS.has(key)) return false;

        const matchesAll = queryTokens.every(tok => key.includes(tok));
        const excluded = excludeTokens.some(tok => key.includes(tok));
        if (!matchesAll || excluded) return false;

        if (filters.store || filters.category) {
          return filteredEntries(key, filters).length > 0;
        }
        return productIndex[key].some(e => now - e.purchaseDate.getTime() <= ms);
      })
      .map(key => {
        const entries = filteredEntries(key, filters);
        const learn = getLearnCount(key);
        const freq = entries.length;
        const recent = entries.length ? Math.max(...entries.map(e => e.purchaseDate.getTime())) : 0;
        const similarity = queryTokens.filter(tok => key.includes(tok)).length;
        return { key, similarity, learn, freq, recent };
      })
      .sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
        if (b.learn !== a.learn) return b.learn - a.learn;
        if (b.freq !== a.freq) return b.freq - a.freq;
        if (b.recent !== a.recent) return b.recent - a.recent;
        return a.key.localeCompare(b.key);
      })
      .map(o => o.key);
  };

  const onSearchInput = debounce(ev => {
    const raw = normalize(ev.target.value);
    if (!raw) { renderSuggestions([]); return; }
    const filters = getFilters();
    const tokens = raw.split(/\s+/).filter(t => t);
    
    // Process tokens applying synonyms and checking stop words
    const include = tokens
      .filter(t => !t.startsWith('-'))
      .map(t => applySynonyms(t))
      .filter(t => !STOP_WORDS.has(t));
      
    const exclude = tokens
      .filter(t => t.startsWith('-'))
      .map(t => t.slice(1));

    const matches = rankProducts(include, exclude, filters).slice(0, 10);
    renderSuggestions(matches);
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

  const computeMetrics = (product, observedPrice, qtyExpr, filters) => {
    const key = normalize(product);
    const entries = filteredEntries(key, filters);
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

  const renderDetails = metrics => {
    const detailsDiv  = document.getElementById('price-details');
    const resultPanel = document.getElementById('price-result-panel');
    if (!detailsDiv || !resultPanel) return;

    if (!metrics) {
      detailsDiv.classList.add('hidden');
      resultPanel.innerHTML = '';
      renderBadge(null);
      renderHistoryTable([]);
      renderStoreTable([]);
      return;
    }

    detailsDiv.classList.remove('hidden');
    renderBadge(metrics.badge);

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

    resultPanel.innerHTML = `
      <div class="pl-product-info">
        <h2 class="pl-product-title">${metrics.productName.replace(/\b\w/g, c => c.toUpperCase())}</h2>
        <div class="pl-trend-badge">Tendencia: ${metrics.trend.icon} ${metrics.trend.text}</div>
      </div>
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
    const li = ev.target.closest('.pl-suggestion-item');
    if (!li) return;
    const product = li.dataset.product;
    selectedProduct = product;
    updateLearnCount(product);
    document.getElementById('price-search-input').value = product.replace(/\b\w/g, c => c.toUpperCase());
    document.getElementById('price-suggestion-list').classList.add('hidden');
    
    const filters = getFilters();
    const temp = computeMetrics(product, 0, '1', filters);
    if (temp) {
      document.getElementById('observed-price-input').value = temp.lastUnit;
    }
    recalcAndRender();
  };

  const recalcAndRender = () => {
    if (!selectedProduct) return;
    const observedVal = parseFloat(document.getElementById('observed-price-input').value);
    if (isNaN(observedVal) || observedVal <= 0) {
      renderDetails(null);
      return;
    }
    const qtyExpr = (document.getElementById('quantity-expr-input') || {}).value || '1';
    const filters = getFilters();
    const metrics = computeMetrics(selectedProduct, observedVal, qtyExpr, filters);
    renderDetails(metrics);
  };

  const init = async () => {
    loadPrefs();
    await fetchHistory();

    const searchInput = document.getElementById('price-search-input');
    if (searchInput) searchInput.addEventListener('input', onSearchInput);

    const suggestionList = document.getElementById('price-suggestion-list');
    if (suggestionList) suggestionList.addEventListener('click', onSuggestionClick);

    const priceInput = document.getElementById('observed-price-input');
    if (priceInput) priceInput.addEventListener('input', recalcAndRender);
    
    const qtyInput = document.getElementById('quantity-expr-input');
    if (qtyInput) qtyInput.addEventListener('input', recalcAndRender);

    const filterStore = document.getElementById('filter-store');
    if (filterStore) filterStore.addEventListener('change', recalcAndRender);
    
    const filterCat = document.getElementById('filter-category');
    if (filterCat) filterCat.addEventListener('change', recalcAndRender);
    
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
        selectedProduct = '';
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();
