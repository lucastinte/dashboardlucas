# Stock → Google Sheets (una vía)

Panel dentro de **Inventario** que vuelca tu stock actual a una Google Sheet, para verlo o compartirlo afuera. La app (Supabase) sigue siendo la fuente de verdad: acá **no** vuelven cambios desde la hoja.

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
    : ['Producto','Cantidad','Condición','Ubicación','Precio compra','Precio venta','Categoría','Tanda','En tienda','Fecha'];
  const items = Array.isArray(payload.items) ? payload.items : [];

  const values = [headers];
  for (const r of items) {
    values.push(headers.map((_, i) => (r[i] == null ? '' : r[i])));
  }

  sh.clearContents();
  if (values.length) sh.getRange(1, 1, values.length, headers.length).setValues(values);

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
- Cada sync **reemplaza** la pestaña `Stock` con el inventario actual (no es un histórico).
- El link "Abrir la hoja" y la hora de la última sincronización se guardan en tu navegador.

## Troubleshooting
- **"No se pudo sincronizar"**: revisá que la URL del `.env` termine en `/exec`, que el Web App esté publicado con *acceso: Cualquier persona*, y que reiniciaste el dev server.
- **CORS / respuesta bloqueada**: si algún navegador bloquea la respuesta, hay un plan B (un passthrough serverless igual a `api/catalogo.js`) — avisá y lo armamos.
- **Cambios en la hoja no vuelven a la app**: es así por diseño (espejo una vía).
