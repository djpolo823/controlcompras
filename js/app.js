/* ═══════════════════════════════════════════
   app.js — Controlador principal y navegación
   ═══════════════════════════════════════════ */

// Estado global de la aplicación
const AppState = {
  currentItems: [],
  imagePreviewUrl: null
};

// Componente Toast para notificaciones
const Toast = {
  element: document.getElementById('toast'),
  timeoutId: null,

  show(message, type = 'info', duration = 3000) {
    if (!this.element) return;
    
    // Cancelar el timeout anterior si existe
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.element.textContent = message;
    this.element.className = `toast show ${type}`;

    this.timeoutId = setTimeout(() => {
      this.element.classList.remove('show');
    }, duration);
  }
};

// Inicialización de la aplicación al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  checkConfiguration();
  renderHistory();
  setupEventListeners();
}

// Verifica si la configuración inicial está completa y muestra/oculta el banner
function checkConfiguration() {
  const setupBanner = document.getElementById('setup-banner');
  if (!setupBanner) return;

  if (Storage.isConfigured()) {
    setupBanner.style.display = 'none';
  } else {
    setupBanner.style.display = 'flex';
  }
}

// Renderiza el historial de escaneos anteriores
function renderHistory() {
  const historySection = document.getElementById('history-section');
  const historyList = document.getElementById('history-list');
  if (!historySection || !historyList) return;

  const history = Storage.getHistory();

  if (history.length === 0) {
    historySection.classList.remove('has-items');
    historyList.innerHTML = '';
    return;
  }

  historySection.classList.add('has-items');
  historyList.innerHTML = history.map(entry => `
    <div class="history-card">
      <div class="history-info">
        <div class="history-establishment">${escapeHtml(entry.establishment || 'Establecimiento desconocido')}</div>
        <div class="history-meta">${entry.itemCount} items · $${formatNumber(entry.total)}</div>
      </div>
      <div class="history-date">${formatRelativeTime(entry.timestamp)}</div>
    </div>
  `).join('');
}

// Configura todos los event listeners de la interfaz
function setupEventListeners() {
  // Navegación
  document.getElementById('btn-settings').addEventListener('click', () => {
    openSettings();
  });

  const setupBanner = document.getElementById('setup-banner');
  if (setupBanner) {
    setupBanner.addEventListener('click', () => {
      openSettings();
    });
  }

  document.getElementById('btn-settings-back').addEventListener('click', () => {
    showView('view-home');
    checkConfiguration();
    renderHistory();
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    if (confirm('¿Deseas salir? Perderás los cambios no guardados.')) {
      showView('view-home');
      renderHistory();
    }
  });

  // Acciones de cámara/galería
  const btnCamera = document.getElementById('btn-camera');
  const cameraInput = document.getElementById('camera-input');
  btnCamera.addEventListener('click', () => {
    if (!Storage.isConfigured()) {
      Toast.show('Configura tu API Key y URL antes de escanear', 'error');
      openSettings();
      return;
    }
    cameraInput.click();
  });

  const btnGallery = document.getElementById('btn-gallery');
  const galleryInput = document.getElementById('gallery-input');
  btnGallery.addEventListener('click', () => {
    if (!Storage.isConfigured()) {
      Toast.show('Configura tu API Key y URL antes de escanear', 'error');
      openSettings();
      return;
    }
    galleryInput.click();
  });

  cameraInput.addEventListener('change', handleImageSelection);
  galleryInput.addEventListener('change', handleImageSelection);

  // Configuración
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-test-connection').addEventListener('click', testConnection);
  document.getElementById('btn-toggle-key').addEventListener('click', toggleApiKeyVisibility);

  // Envío a Sheets
  document.getElementById('btn-send').addEventListener('click', sendExpensesToSheet);

  // Edición en tiempo real (para actualizar el total al modificar precio o cantidad)
  const itemsList = document.getElementById('items-list');
  itemsList.addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (field === 'price' || field === 'quantity') {
      updateTotal();
    }
  });

  // Cambiar color del select de categoría dinámicamente
  itemsList.addEventListener('change', (e) => {
    if (e.target.classList.contains('category-select')) {
      e.target.dataset.category = e.target.value;
    }
  });
}

// Cambia la vista activa agregando la clase 'active'
function showView(viewId) {
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });
  const activeView = document.getElementById(viewId);
  if (activeView) {
    activeView.classList.add('active');
  }
}

// Procesa la imagen seleccionada y la envía a Gemini
async function handleImageSelection(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Limpiar inputs
  event.target.value = '';

  // Validar tipo de archivo
  if (!file.type.startsWith('image/')) {
    Toast.show('Por favor selecciona una imagen válida', 'error');
    return;
  }

  showView('view-loading');

  try {
    const reader = new FileReader();
    
    // Crear promesa para esperar la carga del archivo
    const fileLoaded = new Promise((resolve, reject) => {
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (err) => reject(err);
    });

    reader.readAsDataURL(file);
    const dataUrl = await fileLoaded;

    // Guardar URL para preview
    AppState.imagePreviewUrl = dataUrl;

    // Obtener base64 puro y mimeType
    const mimeType = file.type;
    const base64Data = dataUrl.split(',')[1];

    Toast.show('Analizando imagen con Gemini...', 'info');
    
    // Llamar a Gemini Service
    const items = await GeminiService.analyzeReceipt(base64Data, mimeType);
    
    AppState.currentItems = items;
    renderReviewScreen();
    showView('view-review');
    Toast.show('¡Clasificación completada!', 'success');
  } catch (error) {
    console.error('Error al analizar recibo:', error);
    Toast.show(error.message || 'Error al analizar el recibo', 'error');
    showView('view-home');
    renderHistory();
  }
}

// Renderiza la lista de items en la pantalla de revisión
function renderReviewScreen() {
  const itemsList = document.getElementById('items-list');
  const previewContainer = document.getElementById('preview-container');
  const previewImage = document.getElementById('preview-image');

  if (!itemsList) return;

  // Configurar preview de la imagen
  if (AppState.imagePreviewUrl && previewContainer && previewImage) {
    previewImage.src = AppState.imagePreviewUrl;
    previewContainer.style.display = 'block';
  } else if (previewContainer) {
    previewContainer.style.display = 'none';
  }

  if (AppState.currentItems.length === 0) {
    itemsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">📝</span>
        <div class="empty-state-text">No se encontraron items. Intenta de nuevo.</div>
      </div>
    `;
    updateTotal();
    return;
  }

  itemsList.innerHTML = AppState.currentItems.map((item, index) => {
    // Determinar categoría por defecto
    const category = item.category || 'por clasificar';

    return `
      <div class="expense-card" data-index="${index}">
        <button class="btn-delete-item" onclick="deleteItem(${index})" aria-label="Eliminar item">×</button>
        <div class="card-header">
          <div class="card-description" contenteditable="true" data-field="description" placeholder="Descripción del producto">${escapeHtml(item.description)}</div>
          <div class="card-price-container">
            <span class="card-price-symbol">$</span><span class="card-price" contenteditable="true" data-field="price" placeholder="0">${escapeHtml(item.price)}</span>
          </div>
        </div>
        <div class="card-details">
          <span>Cant: <span contenteditable="true" data-field="quantity" placeholder="1">${escapeHtml(item.quantity)}</span></span>
          <span>Lugar: <span contenteditable="true" data-field="establishment" placeholder="Lugar">${escapeHtml(item.establishment)}</span></span>
          <span>Fecha: <span contenteditable="true" data-field="date" placeholder="DD/MM/AAAA">${escapeHtml(item.date)}</span></span>
        </div>
        <div class="card-footer">
          <select class="category-select" data-category="${category}" data-field="category">
            <option value="mercado" ${category === 'mercado' ? 'selected' : ''}>mercado</option>
            <option value="Ocio" ${category === 'Ocio' ? 'selected' : ''}>Ocio</option>
            <option value="Educación" ${category === 'Educación' ? 'selected' : ''}>Educación</option>
            <option value="Formula" ${category === 'Formula' ? 'selected' : ''}>Formula</option>
            <option value="Aseo" ${category === 'Aseo' ? 'selected' : ''}>Aseo</option>
            <option value="Gustos" ${category === 'Gustos' ? 'selected' : ''}>Gustos</option>
            <option value="Ropa" ${category === 'Ropa' ? 'selected' : ''}>Ropa</option>
            <option value="casa" ${category === 'casa' ? 'selected' : ''}>casa</option>
            <option value="Servicios" ${category === 'Servicios' ? 'selected' : ''}>Servicios</option>
            <option value="salud" ${category === 'salud' ? 'selected' : ''}>salud</option>
            <option value="otros" ${category === 'otros' ? 'selected' : ''}>otros</option>
            <option value="por clasificar" ${category === 'por clasificar' ? 'selected' : ''}>por clasificar</option>
          </select>
        </div>
      </div>
    `;
  }).join('');

  updateTotal();
}

// Elimina un item de la lista en la pantalla de revisión
window.deleteItem = function(index) {
  AppState.currentItems.splice(index, 1);
  renderReviewScreen();
};

// Calcula y actualiza el total de precios e items
function updateTotal() {
  const cards = document.querySelectorAll('.expense-card');
  let total = 0;
  let count = 0;

  cards.forEach(card => {
    const priceText = card.querySelector('[data-field="price"]').textContent.trim();
    const qtyText = card.querySelector('[data-field="quantity"]').textContent.trim();

    const price = parseFloat(priceText.replace(/[^0-9.-]/g, '')) || 0;
    const qty = parseFloat(qtyText.replace(/[^0-9.-]/g, '')) || 1;

    total += price * qty;
    count++;
  });

  const itemCountEl = document.getElementById('item-count');
  const totalPriceEl = document.getElementById('total-price');

  if (itemCountEl) itemCountEl.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  if (totalPriceEl) totalPriceEl.textContent = `Total: $${formatNumber(total)}`;
}

// Envía la lista de gastos a Google Sheets
async function sendExpensesToSheet() {
  const btnSend = document.getElementById('btn-send');
  if (!btnSend || btnSend.disabled) return;

  const cards = document.querySelectorAll('.expense-card');
  if (cards.length === 0) {
    Toast.show('No hay elementos para enviar', 'error');
    return;
  }

  // Recolectar datos editados del DOM
  const items = [];
  let totalSum = 0;
  let mainEstablishment = '';

  cards.forEach(card => {
    const description = card.querySelector('[data-field="description"]').textContent.trim();
    const priceRaw = card.querySelector('[data-field="price"]').textContent.trim();
    const quantityRaw = card.querySelector('[data-field="quantity"]').textContent.trim();
    const establishment = card.querySelector('[data-field="establishment"]').textContent.trim();
    const rawDate = card.querySelector('[data-field="date"]').textContent.trim();
    const date = GeminiService.normalizeDate(rawDate);
    const category = card.querySelector('[data-field="category"]').value;

    const price = priceRaw.replace(/[^0-9.-]/g, '');
    const quantity = quantityRaw.replace(/[^0-9.-]/g, '') || '1';

    if (!mainEstablishment && establishment) {
      mainEstablishment = establishment;
    }

    const priceNum = parseFloat(price) || 0;
    const qtyNum = parseFloat(quantity) || 1;
    totalSum += priceNum * qtyNum;

    items.push({
      description,
      quantity,
      price,
      establishment,
      date,
      category
    });
  });

  // Guardar estado visual original
  const originalText = btnSend.innerHTML;
  btnSend.disabled = true;
  btnSend.innerHTML = `
    <svg class="spinner-btn" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
    </svg>
    Enviando...
  `;

  Toast.show('Enviando datos a Google Sheets...', 'info');

  try {
    const result = await SheetsService.sendToSheet(items);
    
    // Guardar en el historial local
    Storage.addToHistory({
      establishment: mainEstablishment || 'Establecimiento',
      total: totalSum,
      itemCount: items.length
    });

    Toast.show(result.note || '¡Datos enviados correctamente!', 'success');
    
    // Volver a inicio
    AppState.currentItems = [];
    AppState.imagePreviewUrl = null;
    
    showView('view-home');
    checkConfiguration();
    renderHistory();
  } catch (error) {
    console.error('Error al enviar a Sheets:', error);
    Toast.show('Error al enviar: ' + error.message, 'error');
  } finally {
    btnSend.disabled = false;
    btnSend.innerHTML = originalText;
  }
}

// Abre la vista de configuración y carga los datos guardados
function openSettings() {
  document.getElementById('input-api-key').value = Storage.getApiKey();
  document.getElementById('input-script-url').value = Storage.getScriptUrl();
  document.getElementById('connection-status').innerHTML = '';
  showView('view-settings');
}

// Guarda los datos de configuración
function saveSettings() {
  const apiKey = document.getElementById('input-api-key').value;
  const scriptUrl = document.getElementById('input-script-url').value;

  if (!apiKey.trim() || !scriptUrl.trim()) {
    Toast.show('Por favor llena todos los campos', 'error');
    return;
  }

  Storage.setApiKey(apiKey);
  Storage.setScriptUrl(scriptUrl);

  Toast.show('Configuración guardada correctamente', 'success');
  
  showView('view-home');
  checkConfiguration();
  renderHistory();
}

// Prueba la conexión con el endpoint del script de Google Sheets
async function testConnection() {
  const statusEl = document.getElementById('connection-status');
  const btnTest = document.getElementById('btn-test-connection');
  
  if (!statusEl || !btnTest) return;

  const scriptUrl = document.getElementById('input-script-url').value;
  if (!scriptUrl.trim()) {
    Toast.show('Ingresa la URL del script primero', 'error');
    return;
  }

  // Guardar URL temporalmente para la prueba
  const originalUrl = Storage.getScriptUrl();
  Storage.setScriptUrl(scriptUrl);

  btnTest.disabled = true;
  statusEl.innerHTML = '<span class="status-badge info"><span class="status-dot"></span>Conectando...</span>';

  try {
    const result = await SheetsService.testConnection();
    if (result.status === 'ok' || result.status === 'success') {
      statusEl.innerHTML = `
        <span class="status-badge success">
          <span class="status-dot"></span>Conexión Exitosa: ${escapeHtml(result.message || 'OK')}
        </span>
      `;
      Toast.show('¡Conexión verificada con éxito!', 'success');
    } else {
      throw new Error(result.message || 'Respuesta no válida del servidor');
    }
  } catch (error) {
    statusEl.innerHTML = `
      <span class="status-badge error">
        <span class="status-dot"></span>Error: ${escapeHtml(error.message)}
      </span>
    `;
    Toast.show('Error al conectar con el script', 'error');
  } finally {
    btnTest.disabled = false;
    // Restaurar URL original si no se ha guardado explícitamente
    Storage.setScriptUrl(originalUrl);
  }
}

// Muestra/oculta el contenido de la API Key en el input
function toggleApiKeyVisibility() {
  const inputKey = document.getElementById('input-api-key');
  const btnToggle = document.getElementById('btn-toggle-key');
  if (!inputKey || !btnToggle) return;

  if (inputKey.type === 'password') {
    inputKey.type = 'text';
    btnToggle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  } else {
    inputKey.type = 'password';
    btnToggle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  }
}

/* ── HELPERS ── */

// Escapa caracteres HTML para evitar ataques XSS
function escapeHtml(text) {
  if (typeof text !== 'string') text = String(text || '');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Formatea números con separador de miles
function formatNumber(num) {
  const value = parseFloat(num);
  if (isNaN(value)) return '0';
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

// Formatea fecha en tiempo relativo
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  
  if (isNaN(date.getTime())) return 'Desconocido';

  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffMins < 1) return 'Ahora mismo';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHrs < 24) return `Hace ${diffHrs} h`;
  if (diffDays === 1) return 'Ayer';
  
  return date.toLocaleDateString('es-ES', { 
    day: 'numeric', 
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}
