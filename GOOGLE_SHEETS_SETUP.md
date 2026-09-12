# Stock → Google Sheets (una vía)

Panel dentro de **Inventario** que vuelca a una Google Sheet **solo los productos publicados en tienda**, con las columnas que ve un cliente (Producto, Descripción, Precio de venta, Cantidad, Categoría y Link a la publicación), para compartir el catálogo afuera. La app (Supabase) sigue siendo la fuente de verdad: acá **no** vuelven cambios desde la hoja.

La columna **Link** apunta a `https://lepzito.vercel.app/producto/<id>` y se rearma en cada sync, así que siempre refleja lo publicado. La base de esa URL se configura en `STORE_CONFIG.storeBaseUrl` (`src/config/storeConfig.ts`).

## Setup único (~5 min)

### 1. Creá la hoja
Andá a [sheets.new](https://sheets.new) en tu cuenta de Google y nombrala (ej. "Stock dashboard"). El script usa (o crea) una pestaña llamada `Stock`.

### 2. Pegá el script
En la hoja: **Extensiones → Apps Script**. Borrá lo que haya y pegá el código de abajo. **Guardar**.

### 3. Publicalo como Web App
**Implementar → Nueva implementación → Aplicación web**:
- Descripción: `stock sync`
- **Ejecutar como:** *Yo*
- **Acceso:** *Cualquier persona* (Google va a pedir autorización: aceptar el aviso "no verificada" y continuar)
- **Implementar** y copiá la **URL del Web App** (termina en `/exec`).

### 4. Guardá la URL en la app
En este repo, agregá al archivo `.env` (ya existe, no se commitea):

```
VITE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/XXXX/exec
```

Y reiniciá `npm run dev`.

> **Producción (Vercel):** agregá la misma variable con prefijo `VITE_` en el proyecto (Settings → Environment Variables) y redeployá.

### 5. (Opcional) Token
Si querés que solo tu app pueda escribir, poné una clave en el script y mandala como `?token=` desde la app (el panel aún no la manda; avisá si la querés activar).

## Código de Apps Script

```javascript
// Panel de stock → esta hoja. Publicar como Web App (acceso: Cualquier persona).
const TOKEN = ''; // opcional: clave secreta; la app la manda en la URL (?token=)

function doPost(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  let payload = {};
  try { payload = JSON.parse(body); } catch (_) {}

  if (TOKEN && payload.token !== TOKEN) return send({ ok: false, error: 'token inválido' });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Stock');
  if (!sh) sh = ss.insertSheet('Stock');

  const headers = (payload.headers && payload.headers.length) ? payload.headers
    : ['Producto','Descripción','Precio venta','Cantidad','Categoría','Link'];
  const items = Array.isArray(payload.items) ? payload.items : [];

  const values = [headers];
  for (const r of items) {
    values.push(headers.map((_, i) => (r[i] == null ? '' : r[i])));
  }

  sh.clearContents();
  if (values.length) sh.getRange(1, 1, values.length, headers.length).setValues(values);

  // Hacer clickeables las celdas que contienen URLs (columna Link).
  // setValues guarda el texto pero no siempre lo convierte en link.
  if (items.length) {
    const body = sh.getRange(2, 1, items.length, headers.length).getValues();
    for (let r = 0; r < body.length; r++) {
      for (let c = 0; c < body[r].length; c++) {
        const v = body[r][c];
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          sh.getRange(r + 2, c + 1).setRichTextValue(
            SpreadsheetApp.newRichTextValue().setText(v).setLinkUrl(v).build()
          );
        }
      }
    }
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3f4f6');
  try { sh.autoResizeColumns(1, headers.length); } catch (_) {}

  return send({ ok: true, rows: items.length, url: ss.getUrl() });
}

function doGet() { return send({ ok: true, message: 'Web app lista. Usá POST.' }); }

function send(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Cómo se usa
- Abrí la pestaña **Inventario** → panel **"Stock en Google Sheets"** → **Sincronizar hoja**.
- Cada sync **reemplaza** la pestaña `Stock` con los productos publicados en tienda (no es un histórico).
- El link "Abrir la hoja" y la hora de la última sincronización se guardan en tu navegador.

## Por qué hay un `/api/sheets` en el medio

El navegador **no puede** hablar directo con el Web App de Apps Script: responde con un 302 a `script.googleusercontent.com`, y esa respuesta final no trae los headers CORS. El `fetch` del cliente muere con `TypeError: Failed to fetch` antes de que la request salga.

Por eso el panel hace `POST /api/sheets` (la función de `api/sheets.js`), que reenvía el payload desde el servidor — donde CORS no aplica — y devuelve la respuesta ya limpia.

> **Ojo:** esto significa que el sync necesita la función serverless. En producción (Vercel) anda solo. Con `vite dev` a secas `/api` no existe, así que el panel cae al llamado directo — que va a fallar por CORS. Para probar local usá `vercel dev`.

## Troubleshooting
- **"El navegador bloqueó el llamado a la hoja (CORS)"**: estás corriendo `vite dev` sin la función serverless. Usá `vercel dev`, o probá contra el deploy.
- **"La hoja respondió HTTP 4xx/5xx"**: el Web App dejó de estar accesible. Revisá que siga publicado con *acceso: Cualquier persona* (si lo pusiste en "Solo yo", Google redirige al login y el POST falla).
- **"No se pudo contactar la hoja de Google"**: la URL del `.env` no termina en `/exec`, o el deploy del Web App se venció.
- **La columna Link sale sin ser clickeable**: el Apps Script quedó en la versión vieja. Hay que redesplegar (Implementar → *Gestionar implementaciones* → editar → *Nueva versión*); guardar no alcanza.
- **Cambios en la hoja no vuelven a la app**: es así por diseño (espejo una vía).
