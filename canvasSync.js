const { google } = require('googleapis');
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');

const sheetMapping = {
  "Detalle del Gasto": "Detalle de Gastos",
  "Resumen por Socio": "Resumen por Socio",
  "Saldo en Cuenta KanaliA": "Saldo Cuenta KanaliA",
  "Detalle de Movimientos - Cuenta KanaliA": "Movimientos Cuenta",
  "Resumen por Tipo de Gasto": "Resumen por Tipo"
};

async function getGoogleSheetsClient() {
  const token = JSON.parse(fs.readFileSync('token.json'));
  const credentials = JSON.parse(fs.readFileSync('oauth-credentials.json'));
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(token);
  return google.sheets({ version: 'v4', auth: oAuth2Client });
}

async function syncCanvasToSheets(app, canvasId, spreadsheetId) {
  // 1. Obtener HTML del Canvas
  const info = await app.client.files.info({ file: canvasId });
  if (!info.file.url_private_download) {
    throw new Error('No se pudo obtener el URL de descarga del Canvas');
  }

  const response = await axios.get(info.file.url_private_download, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }
  });
  const html = response.data;
  
  // 2. Parsear el HTML
  const $ = cheerio.load(html);
  const tablesToSync = [];

  $('table').each((i, table) => {
    let rawTitle = $(table).prevAll('h2, h3').first().text().trim();
    // Limpiar emojis estilo Slack (ej. :computer: )
    let title = rawTitle.replace(/:[a-zA-Z0-9_]+:\s*/g, '').trim();
    
    const rowsData = [];
    $(table).find('tr').each((j, tr) => {
      const row = [];
      $(tr).find('td, th').each((k, td) => {
        const cellTexts = [];
        $(td).find('p').each((l, p) => {
           let txt = $(p).text().replace(/:[a-zA-Z0-9_]+:\s*/g, '').trim();
           cellTexts.push(txt);
        });
        let cellText = cellTexts.length > 0 ? cellTexts.join('\n') : $(td).text().replace(/:[a-zA-Z0-9_]+:\s*/g, '').trim();
        row.push(cellText);
      });
      rowsData.push(row);
    });

    const sheetName = sheetMapping[title] || title;
    tablesToSync.push({ sheetName, rowsData });
  });

  // 3. Subir a Google Sheets
  const sheets = await getGoogleSheetsClient();
  
  for (const table of tablesToSync) {
    if (table.rowsData.length === 0) continue;
    
    console.log(`Sincronizando tabla a pestaña: ${table.sheetName}`);
    try {
      // Limpiar los valores anteriores
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `'${table.sheetName}'!A:Z`,
      });

      // Escribir los nuevos valores
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${table.sheetName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: table.rowsData
        }
      });
    } catch (e) {
      console.error(`Error actualizando pestaña ${table.sheetName}:`, e.message);
      // Continuar con las demás aunque una falle
    }
  }
}

module.exports = { syncCanvasToSheets };
