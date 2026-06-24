/**
 * Google Apps Script - Endpoint para recibir gastos desde la PWA
 * y automatizaciones de formato de la hoja de cálculo.
 * 
 * Instrucciones de despliegue:
 * 1. Abre tu Google Sheet
 * 2. Ve a Extensiones > Apps Script
 * 3. Borra el contenido existente y pega este código
 * 4. Click en Implementar > Nueva implementación (o Administrar implementaciones si ya habías implementado)
 * 5. Tipo: App web | Ejecutar como: Yo | Acceso: Cualquier persona
 * 6. Autoriza y copia la URL generada
 */

function doPost(e) {
  try {
    var lock = LockService.getScriptLock();
    lock.tryLock(10000);

    console.log("Petición POST recibida");

    if (!e || !e.postData || !e.postData.contents) {
      console.error("Error: Datos del POST vacíos o no recibidos.");
      lock.releaseLock();
      return _jsonResponse({ status: "error", message: "No post data received" });
    }

    console.log("Contenido recibido: " + e.postData.contents);
    var data = JSON.parse(e.postData.contents);
    
    // Intentar obtener el spreadsheet activo o abrir por el ID conocido de tu hoja
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      try {
        ss = SpreadsheetApp.openById("1i__e2hyPYKAz32gVxtYHZCWMaId2qA3t716towexuPU");
      } catch (err) {
        console.error("Error al abrir spreadsheet por ID: " + err.toString());
      }
    }

    if (!ss) {
      console.error("Error: No se pudo obtener el spreadsheet.");
      lock.releaseLock();
      return _jsonResponse({ status: "error", message: "No spreadsheet found" });
    }

    // Buscar pestaña "Recibos" de forma tolerante a mayúsculas/minúsculas y espacios
    var sheet = ss.getSheetByName("Recibos");
    if (!sheet) {
      var sheets = ss.getSheets();
      for (var i = 0; i < sheets.length; i++) {
        var nameNormalized = sheets[i].getName().trim().toLowerCase();
        if (nameNormalized === "recibos") {
          sheet = sheets[i];
          break;
        }
      }
    }

    if (!sheet) {
      console.error("Error: Pestaña 'Recibos' no encontrada en el documento.");
      lock.releaseLock();
      return _jsonResponse({ status: "error", message: "Pestaña 'Recibos' no encontrada" });
    }

    var count = 0;
    var rows = data.rows || data;
    var startRow = sheet.getLastRow() + 1;
    var filasModificadas = [];

    if (Array.isArray(rows)) {
      rows.forEach(function (row) {
        // Normalizar formato de fecha (columna 5, índice 4)
        if (row.length > 4) {
          row[4] = normalizeDateString(row[4]);
        }
        
        sheet.appendRow(row);
        var currentRow = startRow + count;
        
        // Agregar fórmula de precio unitario en F (columna 6)
        sheet.getRange(currentRow, 6).setFormula("=IFERROR(C" + currentRow + "/B" + currentRow + ",\"\")");
        
        filasModificadas.push(currentRow);
        count++;
      });
      
      // SISTEMA DE COMPROBACIÓN (Suma en I1 y log en J1)
      if (filasModificadas.length > 0) {
        var filaInicio = Math.min.apply(null, filasModificadas);
        var filaFin = Math.max.apply(null, filasModificadas);
        var rangoCalculado = "C" + filaInicio + ":C" + filaFin;

        sheet.getRange("I1").setFormula("=SUM(" + rangoCalculado + ")");
        sheet.getRange("J1").setValue("Rango sumado (PWA): " + rangoCalculado);
        sheet.getRange("J1").setBackground("#d1e7dd");
      }
    }

    console.log("Éxito: Se agregaron y procesaron " + count + " filas.");
    lock.releaseLock();

    return _jsonResponse({ status: "success", count: count });
  } catch (error) {
    console.error("Error en doPost: " + error.toString());
    return _jsonResponse({ status: "error", message: error.toString() });
  }
}

/**
 * GET endpoint — para verificar que el script está funcionando
 */
function doGet(e) {
  console.log("Petición GET recibida");
  return _jsonResponse({
    status: "ok",
    message: "Gastos IA endpoint activo",
    sheet: "Recibos",
    timestamp: new Date().toISOString()
  });
}

/**
 * Helper para crear respuestas JSON con CORS headers
 */
function _jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Evento onEdit para procesar pegados manuales de CSV en la columna A
 */
function onEdit(e) {
  var range = e.range;
  // Solo actúa si el cambio es en la columna A (columna 1)
  if (range.getColumn() === 1) {
    procesarCSV();
  }
}

/**
 * Procesa el CSV pegado manualmente y expande las columnas
 */
function procesarCSV() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;
  
  var sheet = ss.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var encabezado = "Nombre,Cantidad,Precio,Establecimiento,Fecha de compra";
  
  var filasModificadas = [];

  for (var row = lastRow; row >= 1; row--) {
    var csvValue = sheet.getRange(row, 1).getValue();
    
    // Validar que sea un string con comas y que las columnas B-E estén vacías
    if (!csvValue || typeof csvValue !== 'string' || !csvValue.includes(',')) continue;
    var bToE = sheet.getRange(row, 2, 1, 4).getValues()[0];
    var isRowEmpty = true;
    for (var j = 0; j < bToE.length; j++) {
      if (bToE[j] !== "") {
        isRowEmpty = false;
        break;
      }
    }
    if (!isRowEmpty) continue;

    // Limpieza de encabezados repetidos
    if (csvValue.replace(/\s+/g, '') === encabezado.replace(/\s+/g, '')) {
      sheet.deleteRow(row);
      continue;
    }

    // Procesar y expandir CSV
    var datos = csvValue.split(',').map(function(v) { return v.trim(); });
    
    // Normalizar formato de fecha si existe columna 5 (índice 4)
    if (datos.length > 4) {
      datos[4] = normalizeDateString(datos[4]);
    }
    
    sheet.getRange(row, 1, 1, datos.length).setValues([datos]);
    
    // Fórmula de precio unitario en F (columna 6)
    sheet.getRange(row, 6).setFormula("=IFERROR(C" + row + "/B" + row + ",\"\")");
    
    filasModificadas.push(row);
  }

  // SISTEMA DE COMPROBACIÓN
  if (filasModificadas.length > 0) {
    var filaInicio = Math.min.apply(null, filasModificadas);
    var filaFin = Math.max.apply(null, filasModificadas);
    var rangoCalculado = "C" + filaInicio + ":C" + filaFin;

    sheet.getRange("I1").setFormula("=SUM(" + rangoCalculado + ")");
    sheet.getRange("J1").setValue("Rango sumado (Manual): " + rangoCalculado);
    sheet.getRange("J1").setBackground("#d1e7dd"); 
  }
}

/**
 * Normaliza la fecha al formato D/M/YYYY (ej. 10/6/2026)
 */
function normalizeDateString(dateStr) {
  if (!dateStr) return '';
  dateStr = String(dateStr).trim().replace(/['"]/g, '');

  // 1. Formato YYYY-MM-DD o YYYY/MM/DD
  var match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return parseInt(match[3], 10) + "/" + parseInt(match[2], 10) + "/" + parseInt(match[1], 10);
  }

  // 2. Formato DD-MM-YYYY o DD/MM/YYYY
  match = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return parseInt(match[1], 10) + "/" + parseInt(match[2], 10) + "/" + parseInt(match[3], 10);
  }

  // 3. Intento genérico de parseo
  try {
    var cleaned = dateStr.replace(/-/g, '/');
    var d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
      return d.getDate() + "/" + (d.getMonth() + 1) + "/" + d.getFullYear();
    }
  } catch (e) {}

  return dateStr;
}
