/* ═══════════════════════════════════════════
   storage.js — Almacenamiento local
   ═══════════════════════════════════════════ */

const Storage = {
  KEYS: {
    API_KEY: 'gastos_ia_api_key',
    SCRIPT_URL: 'gastos_ia_script_url',
    HISTORY: 'gastos_ia_history',
  },

  /* ── API Key ── */
  getApiKey() {
    return localStorage.getItem(this.KEYS.API_KEY) || '';
  },

  setApiKey(key) {
    localStorage.setItem(this.KEYS.API_KEY, key.trim());
  },

  /* ── Script URL ── */
  getScriptUrl() {
    return localStorage.getItem(this.KEYS.SCRIPT_URL) || '';
  },

  setScriptUrl(url) {
    localStorage.setItem(this.KEYS.SCRIPT_URL, url.trim());
  },

  /* ── Estado de configuración ── */
  isConfigured() {
    return this.getApiKey().length > 0 && this.getScriptUrl().length > 0;
  },

  /* ── Historial de escaneos ── */
  getHistory() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.HISTORY) || '[]');
    } catch {
      return [];
    }
  },

  addToHistory(entry) {
    const history = this.getHistory();
    history.unshift({
      ...entry,
      timestamp: new Date().toISOString(),
    });
    // Mantener solo los últimos 30 registros
    while (history.length > 30) history.pop();
    localStorage.setItem(this.KEYS.HISTORY, JSON.stringify(history));
  },

  clearHistory() {
    localStorage.removeItem(this.KEYS.HISTORY);
  },
};
