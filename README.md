# 📊 Gastos IA — PWA de Clasificación de Gastos

Esta es una Progressive Web App (PWA) móvil diseñada para automatizar el registro y clasificación de tus gastos. Toma una foto a tu recibo o factura física, la inteligencia artificial de **Google Gemini** clasifica automáticamente cada artículo en la categoría correcta, y los envía directamente a tu **Google Sheet** en la pestaña **"Recibos"**.

---

## 🛠️ Configuración Paso a Paso (Una Sola Vez)

### 1. Configurar tu Google Sheet y Apps Script

1. Abre el Google Sheet donde registras tus gastos.
2. Asegúrate de tener una pestaña/tab llamada exactamente **"Recibos"**.
3. En la barra superior, ve a **Extensiones > Apps Script**.
4. Borra cualquier código existente y pega el contenido del archivo [`apps_script/Code.gs`](file:///c:/Users/USUARIO/Documents/Codigo/Control%20de%20gastos/apps_script/Code.gs).
5. Haz clic en el ícono de guardar (💾).
6. Haz clic en el botón azul **Implementar > Nueva implementación**.
7. Configura los campos así:
   - **Tipo de implementación:** App web (clic en el engranaje ⚙️ si no aparece).
   - **Descripción:** API Gastos IA
   - **Ejecutar como:** Yo (tu correo)
   - **Quién tiene acceso:** Cualquier persona (*Anyone*).
8. Haz clic en **Implementar**. Si te pide autorización de acceso, otórgala usando tu cuenta de Google (en la pantalla de advertencia haz clic en "Configuración avanzada" y luego en "Ir a Proyecto (no seguro)").
9. **Copia la URL de la app web** generada (termina en `/exec`). La necesitarás para la configuración de la app.

---

### 2. Obtener tu API Key de Gemini

1. Entra a [Google AI Studio](https://aistudio.google.com/apikey).
2. Inicia sesión con tu cuenta de Google.
3. Haz clic en el botón azul **Create API Key** (Crear clave de API).
4. Selecciona un proyecto o crea uno nuevo y haz clic en **Create API Key**.
5. **Copia la clave generada** (empieza por `AIzaSy`).

---

### 3. Configurar la Aplicación

1. Cuando abras la aplicación por primera vez en tu navegador, verás un banner naranja indicando **"Configuración requerida"**.
2. Haz clic en el banner o ve al ícono de engranaje (⚙️) en la esquina superior derecha.
3. Pega tu **API Key de Gemini** en el primer campo.
4. Pega la **URL de tu Apps Script** (la que copiaste en el paso 1) en el segundo campo.
5. Haz clic en **Probar Conexión** para verificar que todo esté en orden. Si la conexión es exitosa, se mostrará un indicador verde.
6. Haz clic en **Guardar Configuración**.

---

## 🚀 Cómo Ejecutar la App Localmente

Para probar la app en tu computadora o red local, puedes usar un servidor estático rápido con Node.js:

1. Abre una terminal (PowerShell o CMD) en la carpeta del proyecto:
   `c:\Users\USUARIO\Documents\Codigo\Control de gastos`
2. Ejecuta el servidor integrado de Node con:
   ```bash
   npx serve .
   ```
3. Abre en tu navegador la dirección que se muestra en pantalla (usualmente `http://localhost:3000` o `http://localhost:5000`).

---

## 📱 Cómo Instalar la App en tu Teléfono (PWA)

Para que la app sea instalable en tu pantalla de inicio y tenga comportamiento nativo (pantalla completa, sin barra de direcciones), **debe servirse a través de una conexión segura (HTTPS)**.

### Opción Recomendada y Gratuita: GitHub Pages

1. Sube este proyecto a un repositorio de GitHub (puedes crearlo de forma privada o pública).
2. En la página del repositorio en GitHub, ve a **Settings > Pages** (Configuración > Páginas).
3. En **Build and deployment**, bajo **Source**, selecciona **Deploy from a branch**.
4. Selecciona la rama principal (`main` o `master`) y la carpeta `/ (root)`. Haz clic en **Save**.
5. En un par de minutos, GitHub te dará una URL HTTPS como: `https://tu-usuario.github.io/tu-repositorio/`.
6. **En tu teléfono (Android o iOS):**
   - Abre la URL en **Google Chrome** (Android) o **Safari** (iOS).
   - **En Android (Chrome):** Verás un banner inferior o una opción en el menú de tres puntos que dice **"Agregar a la pantalla principal"** o **"Instalar aplicación"**.
   - **En iOS (Safari):** Haz clic en el botón de compartir (el cuadrado con la flecha hacia arriba) y selecciona **"Agregar a la pantalla de inicio"**.

¡Listo! Ahora tendrás la aplicación en tu pantalla de inicio como una app nativa.

---

## 🤖 Formato de Clasificación y Reglas de la IA

La inteligencia artificial está programada para seguir el formato exacto de tu prompt de Google Lens:
- **Formato CSV generado:** `descripción, cantidad, precio, establecimiento, fecha de compra, , , categoría`
- **Precios:** En miles de pesos colombianos sin comas (ej. `50000` para 50 mil).
- **Categorías automáticas:** `mercado`, `Ocio`, `Educación`, `Formula`, `Aseo`, `Gustos`, `Ropa`, `casa`, `Servicios`, `salud`, `otros`.
- **Campos 6 y 7:** Quedan vacíos tal como lo solicita tu plantilla de Google Sheets.
- Si no puede determinar la categoría, la clasificará como `'por clasificar'` para que la definas manualmente en la app antes de enviarla.
