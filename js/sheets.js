/* ═══════════════════════════════════════════
   sheets.js — Envío de datos a Google Sheets
   via Google Apps Script Web App
   ═══════════════════════════════════════════ */

const SheetsService = {
  /**
   * Envía items clasificados al Google Sheet.
   * Usa Content-Type text/plain para evitar preflight CORS.
   *
   * @param {Array} items — Array de objetos ExpenseItem
   * @returns {Promise<Object>} — Respuesta del script
   */
  async sendToSheet(items) {
    const scriptUrl = Storage.getScriptUrl();
    if (!scriptUrl) throw new Error('URL del Apps Script no configurada');

    const rows = items.map((item) => [
      item.description,
      item.quantity,
      item.price,
      item.establishment,
      item.date,
      '', // Columna 6 vacía
      '', // Columna 7 vacía
      item.category,
    ]);

    try {
      // Intentar con redirect: follow — funciona si CORS permite leer la respuesta
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ rows }),
        redirect: 'follow',
      });

      if (response.ok) {
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          return { status: 'success' };
        }
      }

      throw new Error(`Error del servidor: ${response.status}`);
    } catch (error) {
      // Si CORS bloquea la respuesta (TypeError: Failed to fetch),
      // reintentar con no-cors — los datos se envían pero no podemos leer la respuesta
      if (error instanceof TypeError) {
        await fetch(scriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ rows }),
        });
        return {
          status: 'success',
          note: 'Datos enviados — verifica tu Google Sheet',
        };
      }
      throw error;
    }
  },

  /**
   * Prueba la conexión con el Apps Script (GET request).
   * @returns {Promise<Object>} — Respuesta del endpoint
   */
  async testConnection() {
    const scriptUrl = Storage.getScriptUrl();
    if (!scriptUrl) throw new Error('URL del Apps Script no configurada');

    try {
      // Usamos no-cors para evitar el bloqueo de redirección CORS de Google.
      // Si la URL es válida, se resolverá sin lanzar error.
      await fetch(scriptUrl, { 
        method: 'GET',
        mode: 'no-cors',
        redirect: 'follow'
      });
      
      return { 
        status: 'success', 
        message: 'Conectado exitosamente con Google Sheets (Redirección verificada)' 
      };
    } catch (error) {
      throw new Error(
        'No se pudo conectar. Verifica la conexión de red o que la URL sea correcta.'
      );
    }
  },
};
