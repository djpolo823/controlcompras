/* ═══════════════════════════════════════════
   gemini.js — Integración con Google Gemini API
   ═══════════════════════════════════════════ */

const GeminiService = {
  API_URL:
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',

  /**
   * Prompt completo de clasificación — basado en el prompt original del usuario.
   * Gemini recibe esto junto con la imagen del recibo.
   */
  PROMPT: `Genera la información en formato .csv separado por comas, sin encabezados ni texto adicional. Cada línea debe seguir este orden estricto: descripción, cantidad, precio, establecimiento, fecha de compra, , , categoría.
Reglas de formato:
Los precios deben estar en miles de pesos y sin comas (ejemplo: 50000).
Clasifica cada elemento automáticamente en una de estas categorías: mercado, Ocio, Educación, Formula, Aseo, Gustos, Ropa, casa, Servicios, salud, otros.
Si no puedes determinar la categoría, escribe 'por clasificar'.
Los espacios 6 y 7 deben quedar vacíos (usando una coma: ,).

"Formula" se refiere a "Formula Infantil Nestogeno Etapa 1 Comfortis" o similares.
"Casa" se refiere a artículos para el hogar ejemplo: organizadores, refacciones y todo lo relacionado al mantenimiento del hogar excepto elementos de aseo.
"Educación" se refiere a elementos que usaría un niño para hacer sus tareas o estudiar.
"Ocio" son salidas de casa, paseos, salidas a divertirse, ejemplo cine.
"gustos" son por lo general alimentos que no hacen parte de la canasta familiar ni al mercado de alimentos.

No incluyas preguntas, descripciones o detalles adicionales al inicio o al final.`,

  /**
   * Analiza una imagen de recibo y devuelve items clasificados.
   * @param {string} imageBase64 — Imagen codificada en base64
   * @param {string} mimeType   — Tipo MIME (image/jpeg, image/png, etc.)
   * @returns {Promise<Array>}  — Array de objetos ExpenseItem
   */
  async analyzeReceipt(imageBase64, mimeType) {
    const apiKey = Storage.getApiKey();
    if (!apiKey) throw new Error('API Key de Gemini no configurada');

    const response = await fetch(`${this.API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: this.PROMPT },
              { inlineData: { mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1, // Baja temperatura para respuestas consistentes
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.error?.message || `Error ${response.status} de Gemini`;
      throw new Error(msg);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Gemini no pudo extraer información del recibo');
    }

    return this.parseCSV(text);
  },

  /**
   * Parsea texto CSV (respuesta de Gemini) a un array de objetos.
   * Maneja casos donde Gemini agrega markdown fences u otro texto extra.
   */
  parseCSV(text) {
    // Eliminar bloques de código markdown si existen
    let csv = text.replace(/```(?:csv|text)?\s*/gi, '').trim();

    const lines = csv.split('\n').filter((line) => {
      const trimmed = line.trim();
      // Una línea CSV válida debe tener comas, no estar vacía, y no ser un comentario
      return (
        trimmed.length > 0 &&
        trimmed.includes(',') &&
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('//') &&
        !trimmed.toLowerCase().startsWith('descripción') // Ignorar encabezados
      );
    });

    if (lines.length === 0) {
      throw new Error('No se encontraron datos en la respuesta de Gemini');
    }

    return lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      return {
        description: parts[0] || '',
        quantity: parts[1] || '1',
        price: parts[2] || '0',
        establishment: parts[3] || '',
        date: this.normalizeDate(parts[4] || ''),
        col6: '',
        col7: '',
        category: parts[7] || parts[5] || 'por clasificar',
      };
    });
  },

  /**
   * Normaliza la fecha al formato estricto D/M/YYYY (ej. 10/6/2026)
   */
  normalizeDate(dateStr) {
    if (!dateStr) return '';
    dateStr = dateStr.trim().replace(/['"]/g, '');

    // 1. Formato YYYY-MM-DD o YYYY/MM/DD
    let match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      const y = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const d = parseInt(match[3], 10);
      return `${d}/${m}/${y}`;
    }

    // 2. Formato DD-MM-YYYY o DD/MM/YYYY
    match = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (match) {
      const d = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const y = parseInt(match[3], 10);
      return `${d}/${m}/${y}`;
    }

    // 3. Intento genérico con Date
    try {
      const cleaned = dateStr.replace(/-/g, '/');
      const parsed = Date.parse(cleaned);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        const day = d.getDate();
        const month = d.getMonth() + 1;
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      }
    } catch (e) {}

    return dateStr;
  },
};
