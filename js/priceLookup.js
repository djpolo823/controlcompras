// js/priceLookup.js – Independent price lookup module
// Provides UI for searching past purchase history and comparing prices.
// Self‑contained; does not modify other app parts.

(() => {
  // ----- Configuration -----
  let ANALYSIS_DAYS = 90; // default period, can be updated from settings later
  const HISTORY_ENDPOINT = '?action=getHistory'; // appended to the Apps Script URL
  const LEARN_KEY = 'priceLookupLearnCounts'; // localStorage key for selection frequency
  const DEBOUNCE_MS = 150;
  const STOP_WORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'en', 'con']);

  // ----- Runtime State -----
  let purchaseHistory = [];
  let productIndex = {};
  let debounceTimer = null;
  let selectedProduct = '';

  // ----- Helper Functions -----
  const debounce = (fn, delay) => (...args) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fn(...args), delay);
  };

  const normalize = str => (str || '').toLowerCase().trim();

  // Safe recursive‑descent arithmetic parser for quantity expressions
  const evaluateExpression = expr => {
    if (!expr) return 1;
    let i = 0;
    const s = expr.replace(/\s+/g, '');

    const peek = () => s[i];
    const consume = () => s[i++];

    const parseNumber = () => {
      let start = i;
      while (/[0-9.]/.test(peek())) consume();
      const numStr = s.slice(start, i);
      if (!numStr) throw new Error('Expected number');
      return parseFloat(numStr);
    };

    const parseFactor = () => {
      if (peek() === '(') {
        consume(); // '('
        const val = parseExpression();
        if (consume() !== ')') throw new Error('Mismatched parenthesis');
        return val;
      }
      return parseNumber();
    };

    const parseTerm = () => {
      let val = parseFactor();
      while (true) {
        const op = peek();
        if (op === '*' || op === '/') {
          consume();
          const right = parseFactor();
          if (op === '*') val *= right; else val /= right;
        } else break;
      }
      return val;
    };

    const parseExpression = () => {
      let val = parseTerm();
      while (true) {
        const op = peek();
        if (op === '+' || op === '-') {
          consume();
          const right = parseTerm();
          if (op === '+') val += right; else val -= right;
        } else break;
      }
      return val;
    };

    const result = parseExpression();
    if (i < s.length) throw new Error('Invalid expression');
    return result;
  };

  const fetchHistory = async () => {
    const scriptUrl = Storage.getScriptUrl();
    if (!scriptUrl) {
      Toast.show('URL del Apps Script no configurada', 'error');
      return [];
    }
    try {
      const response = await fetch(scriptUrl + HISTORY_ENDPOINT);
      const data = await response.json();
      // Normalize entries
      purchaseHistory = data.map(entry => ({
        product: entry.Product || entry.product || '',
        quantity: parseFloat(entry.Quantity || entry.quantity) || 1,
        totalPrice: parseFloat(entry['Total Price'] || entry.totalPrice || entry.TotalPrice) || 0,
        purchaseDate: new Date(entry['Purchase Date'] || entry.purchaseDate || entry.PurchaseDate),
        store: entry.Store || entry.store || '',
        category: entry.Category || entry.category || ''
      }));
      buildIndex();
      return purchaseHistory;
    } catch (e) {
      console.error('Error fetching history', e);
      Toast.show('No se pudo cargar el historial', 'error');
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

  const updateLearnCount = product => {
    const key = normalize(product);
    const raw = localStorage.getItem(LEARN_KEY) || '{}';
    let counts;
    try { counts = JSON.parse(raw); } catch { counts = {}; }
    counts[key] = (counts[key] || 0) + 1;
    localStorage.setItem(LEARN_KEY, JSON.stringify(counts));
  };

  const getLearnCount = product => {
    const key = normalize(product);
    const raw = localStorage.getItem(LEARN_KEY) || '{}';
    try { return JSON.parse(raw)[key] || 0; } catch { return 0; }
  };

  const renderSuggestions = suggestions => {
    const listEl = document.getElementById('price-suggestion-list');
    if (!listEl) return;
    if (suggestions.length === 0) {
      listEl.innerHTML = '';
      listEl.classList.add('hidden');
      return;
    }
    listEl.innerHTML = suggestions.map(p => {
      const display = p.replace(/\b\w/g, c => c.toUpperCase());
      const learn = getLearnCount(p);
      return `<li class="suggestion-item" data-product="${p}">${display}${learn ? ` (${learn})` : ''}</li>`;
    }).join('');
    listEl.classList.remove('hidden');
  };

  // Ranking helper – returns an ordered array of product keys
  const rankProducts = (queryTokens, excludeTokens) => {
    const now = Date.now();
    const periodMs = ANALYSIS_DAYS * 24 * 60 * 60 * 1000;
    return Object.keys(productIndex)
      .filter(key => {
        // similarity check (all query tokens present)
        const matchesAll = queryTokens.every(tok => key.includes(tok));
        const excludes = excludeTokens.some(tok => key.includes(tok));
        return matchesAll && !excludes;
      })
      .map(key => {
        const entries = productIndex[key];
        const learn = getLearnCount(key);
        const purchaseFreq = entries.length;
        const mostRecent = Math.max(...entries.map(e => e.purchaseDate.getTime()));
        const similarity = queryTokens.filter(tok => key.includes(tok)).length;
        return { key, similarity, learn, purchaseFreq, mostRecent };
      })
      .sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
        if (b.learn !== a.learn) return b.learn - a.learn;
        if (b.purchaseFreq !== a.purchaseFreq) return b.purchaseFreq - a.purchaseFreq;
        if (b.mostRecent !== a.mostRecent) return b.mostRecent - a.mostRecent;
        return a.key.localeCompare(b.key);
      })
      .map(o => o.key);
  };

  const onSearchInput = debounce(ev => {
    const raw = normalize(ev.target.value);
    if (!raw) { renderSuggestions([]); return; }
    const tokens = raw.split(/\s+/).filter(t => t && !STOP_WORDS.has(t));
    const include = tokens.filter(t => !t.startsWith('-'));
    const exclude = tokens.filter(t => t.startsWith('-')).map(t => t.slice(1));
    const matches = rankProducts(include, exclude).slice(0, 10);
    renderSuggestions(matches);
  }, DEBOUNCE_MS);

  const onSuggestionClick = ev => {
    const li = ev.target.closest('.suggestion-item');
    if (!li) return;
    const product = li.dataset.product;
    selectedProduct = product;
    updateLearnCount(product);
    document.getElementById('price-search-input').value = product;
    document.getElementById('price-suggestion-list').classList.add('hidden');
    // Pre‑fill observed price with last known unit price if available (within period)
    const tempMetrics = computeMetrics(product, 0, '1');
    if (tempMetrics) {
      document.getElementById('observed-price-input').value = tempMetrics.lastUnit;
    }
    recalcAndRender();
  };

  const computeMetrics = (product, observedPrice, qtyExpr) => {
    const key = normalize(product);
    const entries = productIndex[key] || [];
    if (!entries.length) return null;
    const qty = (() => {
      try { return evaluateExpression(qtyExpr); } catch { return 1; }
    })();
    const observedUnit = observedPrice / qty;
    const now = Date.now();
    const periodMs = ANALYSIS_DAYS * 24 * 60 * 60 * 1000;
    const periodEntries = entries.filter(e => now - e.purchaseDate.getTime() <= periodMs);
    if (!periodEntries.length) return null;
    const avg = periodEntries.reduce((s, e) => s + e.totalPrice / e.quantity, 0) / periodEntries.length;
    const minEntry = periodEntries.reduce((best, cur) => (cur.totalPrice / cur.quantity) < (best.totalPrice / best.quantity) ? cur : best, periodEntries[0]);
    const minUnit = minEntry.totalPrice / minEntry.quantity;
    const lastEntry = periodEntries.reduce((latest, cur) => cur.purchaseDate > latest.purchaseDate ? cur : latest, periodEntries[0]);
    const lastUnit = lastEntry.totalPrice / lastEntry.quantity;
    const savings = (avg - observedUnit) * qty;
    const diffMin = (observedUnit - minUnit) * qty;
    return {
      observedUnit: observedUnit.toFixed(2),
      avg: avg.toFixed(2),
      minUnit: minUnit.toFixed(2),
      minDate: minEntry.purchaseDate.toLocaleDateString('es-ES'),
      minStore: minEntry.store,
      lastUnit: lastUnit.toFixed(2),
      lastDate: lastEntry.purchaseDate.toLocaleDateString('es-ES'),
      lastStore: lastEntry.store,
      savings: savings.toFixed(2),
      diffMin: diffMin.toFixed(2)
    };
  };

  const renderDetails = metrics => {
    const detailsDiv = document.getElementById('price-details');
    const resultPanel = document.getElementById('price-result-panel');
    if (!detailsDiv || !resultPanel) return;
    if (!metrics) {
      detailsDiv.classList.add('hidden');
      resultPanel.innerHTML = '';
      return;
    }
    detailsDiv.classList.remove('hidden');
    let html = '';
    html += `<p>Precio observado (unitario): $${metrics.observedUnit}</p>`;
    if (metrics.avg !== null) html += `<p>Promedio histórico (unitario): $${metrics.avg}</p>`;
    html += `<p>Precio histórico mínimo (unitario): $${metrics.minUnit} (el ${metrics.minDate} en ${metrics.minStore})</p>`;
    html += `<p>Última compra (unitario): $${metrics.lastUnit} (${metrics.lastDate} en ${metrics.lastStore})</p>`;
    if (metrics.savings !== null) html += `<p>Ahorro estimado vs promedio: $${metrics.savings}</p>`;
    html += `<p>Diferencia vs mínimo: $${metrics.diffMin}</p>`;
    resultPanel.innerHTML = html;
  };

  const recalcAndRender = () => {
    if (!selectedProduct) return;
    const observedVal = parseFloat(document.getElementById('observed-price-input').value);
    if (isNaN(observedVal) || observedVal <= 0) {
      Toast.show('Ingresa un precio observado válido (> 0)', 'error');
      return;
    }
    const qtyExpr = document.getElementById('quantity-expr-input').value;
    const metrics = computeMetrics(selectedProduct, observedVal, qtyExpr);
    renderDetails(metrics);
  };

  const init = async () => {
    await fetchHistory();
    const searchInput = document.getElementById('price-search-input');
    if (searchInput) searchInput.addEventListener('input', onSearchInput);
    const suggestionList = document.getElementById('price-suggestion-list');
    if (suggestionList) suggestionList.addEventListener('click', onSuggestionClick);
    const priceInput = document.getElementById('observed-price-input');
    if (priceInput) priceInput.addEventListener('input', recalcAndRender);
    const qtyInput = document.getElementById('quantity-expr-input');
    if (qtyInput) qtyInput.addEventListener('input', recalcAndRender);
    const refreshBtn = document.getElementById('price-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await fetchHistory();
        Toast.show('Historial recargado', 'success');
        selectedProduct = '';
        document.getElementById('price-search-input').value = '';
        document.getElementById('observed-price-input').value = '';
        document.getElementById('quantity-expr-input').value = '';
        renderSuggestions([]);
        renderDetails(null);
      });
    }
    const backBtn = document.getElementById('btn-price-back');
    if (backBtn) backBtn.addEventListener('click', () => showView('view-home'));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
