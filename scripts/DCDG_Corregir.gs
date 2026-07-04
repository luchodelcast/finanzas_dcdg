// ═══════════════════════════════════════════════════════════════════
// DCDG FINANZAS — Correcciones post-restructuración
// Fix A: ADCM → DCDG en Pagos Fijos (búsqueda col B)
// Fix B: Eliminar duplicados en ⚙️ CUENTAS (3164 y 3355)
// Fix C: Excluir MCS del Total Variables DCDG
// Fix D: Columna Tarjeta Débito en CUENTAS / Registro Gastos / 2026 COP
// Ejecutar: Extensions → Apps Script → Run → corregirIssues
// ═══════════════════════════════════════════════════════════════════

function corregirIssues() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  fixA_adcmPagosFijos(ss);
  fixB_cuentasDuplicadas(ss);
  fixC_mcsEnVariables(ss);
  fixD_tarjetasDebito(ss);

  logEntry_(ss,
    'Corregir 4 issues + agregar columnas tarjeta débito',
    'Ejecutó script corregirIssues()',
    'Fix A: ADCM→DCDG en Pagos Fijos. ' +
    'Fix B: Duplicados 3164 y 3355 eliminados de ⚙️ CUENTAS. ' +
    'Fix C: MCS excluida del Total Variables DCDG. ' +
    'Fix D: Col Tarjeta Débito en CUENTAS(I), Registro Gastos(J), 2026 COP(P). ' +
    'Tarjetas precargadas: 2331→0965 (Luis), 6940→3355 (Luis).',
    'Completado. Pendiente: agregar tarjetas Carolina en ⚙️ CUENTAS col I.'
  );

  SpreadsheetApp.getUi().alert('DCDG',
    '✅ 4 fixes aplicados:\n\n' +
    'A · ADCM → FAMILIA=DCDG en Pagos Fijos\n' +
    'B · Duplicados 3164 y 3355 eliminados de ⚙️ CUENTAS\n' +
    'C · MCS excluida del Total Variables DCDG\n' +
    'D · Columna Tarjeta Débito en CUENTAS, Registro Gastos y 2026 COP\n\n' +
    'Pendiente: completar tarjetas débito de cuentas Carolina en ⚙️ CUENTAS col I.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ── FIX A: ADCM en Pagos Fijos — buscar en columna B ──────────────

function fixA_adcmPagosFijos(ss) {
  const sh = ss.getSheetByName('Pagos Fijos');
  if (!sh) return;

  const lastRow = sh.getLastRow();
  for (let r = 5; r <= lastRow; r++) {
    const label = String(sh.getRange(r, 2).getValue()).toLowerCase();
    if (label.includes('adcm') || label.includes('ladcc - adcm') || label.includes('ladcc-adcm')) {
      sh.getRange(r, 2).setValue('Med. prepagada ADCM · Luis + papá Del Castillo');
      sh.getRange(r, 3).setValue('DCDG');
      sh.getRange(r, 1, 1, 12)
        .setBackground('#E6F1FB')
        .setFontColor('#111827');
      Logger.log('Fix A: ADCM actualizado en fila ' + r);
      break;
    }
  }
}

// ── FIX B: Eliminar duplicados en ⚙️ CUENTAS ─────────────────────

function fixB_cuentasDuplicadas(ss) {
  const sh = ss.getSheetByName('⚙️ CUENTAS');
  if (!sh) return;

  const lastRow = sh.getLastRow();
  const rows = sh.getRange(4, 1, lastRow - 3, 8).getValues();

  // Find duplicates by account number in name (3164 and 3355)
  const seen = {};
  const toDelete = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue; // skip empty rows
    const name = String(r[1] || '').toLowerCase();

    // Extract account numbers mentioned in name
    const matches = name.match(/\b(0965|3164|3355|4549|5688|6940|3057|3013)\b/g);
    if (!matches) continue;

    const key = matches[0]; // use first match as key
    const sheetRow = i + 4; // actual sheet row (1-based, data starts at row 4)

    if (seen[key]) {
      // This is a duplicate — mark for deletion
      toDelete.push(sheetRow);
      Logger.log('Fix B: duplicate found for ' + key + ' at row ' + sheetRow);
    } else {
      seen[key] = sheetRow;
    }
  }

  // Delete duplicates from bottom up to avoid row shifting issues
  toDelete.sort((a, b) => b - a);
  for (const row of toDelete) {
    sh.deleteRow(row);
    Logger.log('Fix B: deleted row ' + row);
  }

  // Re-number the # column after deletion
  const newLastRow = sh.getLastRow();
  let counter = 1;
  for (let r = 4; r <= newLastRow; r++) {
    const val = sh.getRange(r, 1).getValue();
    if (val && !isNaN(parseFloat(val))) {
      sh.getRange(r, 1).setValue(counter++);
    }
  }
}

// ── FIX C: Excluir MCS del Total Variables DCDG ───────────────────
// MCS está en F41, que cae dentro de SUM(C40:C42) en el Total Variables.
// Solución: cambiar la fórmula de F50 para excluir F41 explícitamente.

function fixC_mcsEnVariables(ss) {
  const pres = ss.getSheetByName('Presupuesto');
  if (!pres) return;

  // Find MCS row (search col A for "MCS")
  let mcsRow = -1;
  const lastRow = pres.getLastRow();
  for (let r = 30; r <= 55; r++) {
    const val = String(pres.getRange(r, 1).getValue()).toLowerCase();
    if (val.includes('mcs') || val.includes('marina cadavid')) {
      mcsRow = r;
      break;
    }
  }

  if (mcsRow < 0) {
    Logger.log('Fix C: MCS row not found');
    return;
  }

  Logger.log('Fix C: MCS found at row ' + mcsRow);

  // Find Total Variables row (F50)
  let totalVarRow = -1;
  for (let r = 45; r <= 60; r++) {
    const val = String(pres.getRange(r, 1).getValue()).toUpperCase();
    if (val.includes('TOTAL') && val.includes('VARIABLE')) {
      totalVarRow = r;
      break;
    }
  }

  if (totalVarRow < 0) {
    Logger.log('Fix C: Total Variables row not found');
    return;
  }

  Logger.log('Fix C: Total Variables at row ' + totalVarRow);

  // Update formula for all 12 months to exclude MCS row
  // New formula pattern: SUM(range) - MCS_cell
  for (let m = 0; m < 12; m++) {
    const pttoCol = 4 + m * 3;
    const ejecCol  = pttoCol + 1;
    const varCol   = pttoCol + 2;

    const pL = colLetter_(pttoCol);
    const eL = colLetter_(ejecCol);
    const vL = colLetter_(varCol);

    // Get current formula and subtract MCS row
    const currentPttoFormula = pres.getRange(totalVarRow, pttoCol).getFormula();
    if (currentPttoFormula && !currentPttoFormula.includes('-' + pL + mcsRow)) {
      pres.getRange(totalVarRow, pttoCol)
        .setFormula(currentPttoFormula + '-' + pL + mcsRow);
    }

    const currentEjecFormula = pres.getRange(totalVarRow, ejecCol).getFormula();
    if (currentEjecFormula && !currentEjecFormula.includes('-' + eL + mcsRow)) {
      pres.getRange(totalVarRow, ejecCol)
        .setFormula(currentEjecFormula + '-' + eL + mcsRow);
    }

    // VAR = PTTO - EJEC (recalculate)
    pres.getRange(totalVarRow, varCol)
      .setFormula('=' + pL + totalVarRow + '-' + eL + totalVarRow);
  }

  // Also update PTTO BASE (col C)
  const currentBase = pres.getRange(totalVarRow, 3).getFormula();
  if (currentBase && !currentBase.includes('-C' + mcsRow)) {
    pres.getRange(totalVarRow, 3)
      .setFormula(currentBase + '-C' + mcsRow);
  }
}

// ── FIX D: Columna Tarjeta Débito en CUENTAS, Registro Gastos, 2026 COP ──

// Master card map: last 4 digits → account info
const TARJETAS_CONOCIDAS = {
  '2331': { cuenta: 'Bcol Aho 0965', titular: 'Luis'     },
  '6940': { cuenta: 'Bcol Aho 3355', titular: 'Luis'     },
  '5773': { cuenta: 'Bcol Aho 4549', titular: 'Luis'     },
  '4550': { cuenta: 'Bcol Aho 3164', titular: 'Carolina' },
  '1360': { cuenta: 'Bcol Aho 5688', titular: 'Carolina' },
};

function fixD_tarjetasDebito(ss) {
  fixD_cuentas(ss);
  fixD_registroGastos(ss);
  fixD_2026cop(ss);
}

// 1. Add col I "Tarjeta(s) Débito" to ⚙️ CUENTAS and fill known values
function fixD_cuentas(ss) {
  const sh = ss.getSheetByName('⚙️ CUENTAS');
  if (!sh) return;

  const COL_TARJETA = 9; // column I
  const HDR_ROW     = 3;
  const DATA_START  = 4;
  const lastRow     = sh.getLastRow();

  // Header
  const hdrCell = sh.getRange(HDR_ROW, COL_TARJETA);
  hdrCell.setValue('Tarjeta(s) Débito\n(últ. 4 dígitos)')
    .setBackground('#1F3B6E').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true);
  sh.setColumnWidth(COL_TARJETA, 130);

  // Fill known cards by matching account name in col B
  for (let r = DATA_START; r <= lastRow; r++) {
    const acctName = String(sh.getRange(r, 2).getValue());
    if (!acctName) continue;

    let cardVal = '';
    for (const [digits, info] of Object.entries(TARJETAS_CONOCIDAS)) {
      if (acctName.toLowerCase().includes(info.cuenta.toLowerCase()) ||
          acctName.includes(digits)) {
        cardVal = digits;
        break;
      }
    }

    const cell = sh.getRange(r, COL_TARJETA);
    if (cardVal) {
      cell.setValue(cardVal)
        .setFontColor('#0F6E56').setFontWeight('bold')
        .setHorizontalAlignment('center');
    } else {
      cell.setValue('—').setFontColor('#9CA3AF')
        .setHorizontalAlignment('center');
    }
    // Alternate row background
    const bg = (r % 2 === 0) ? '#F4F5F6' : '#FFFFFF';
    cell.setBackground(bg);
  }

  // Tip note below data
  const tipRow = lastRow + 2;
  sh.getRange(tipRow, COL_TARJETA)
    .setValue('➕ Agrega aquí los últimos 4\ndígitos de cada tarjeta')
    .setFontColor('#1A7A4A').setFontStyle('italic').setFontSize(9)
    .setWrap(true).setBackground('#D6F0E3');

  Logger.log('Fix D: ⚙️ CUENTAS col I agregada');
}

// 2. Add col J "Tarjeta (últ. 4)" to Registro Gastos
function fixD_registroGastos(ss) {
  const sh = ss.getSheetByName('Registro Gastos');
  if (!sh) return;

  const COL_TARJETA = 10; // column J
  const HDR_ROW     = 2;
  const lastRow     = sh.getLastRow();

  // Header
  sh.getRange(HDR_ROW, COL_TARJETA)
    .setValue('TARJETA\n(últ. 4 dígitos)')
    .setBackground('#1F3B6E').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true);
  sh.setColumnWidth(COL_TARJETA, 110);

  // Add INDEX/MATCH formula to resolve card → account name
  // for existing data rows (col G = Método de pago, col J = tarjeta)
  // Formula: if tarjeta entered, show matched account; else empty
  const COL_MATCH = 11; // column K = auto-resolved account
  sh.getRange(HDR_ROW, COL_MATCH)
    .setValue('CUENTA\n(auto-resuelta)')
    .setBackground('#1F3B6E').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true);
  sh.setColumnWidth(COL_MATCH, 160);

  // Add lookup formula for all data rows
  for (let r = HDR_ROW + 1; r <= Math.max(lastRow, 200); r++) {
    sh.getRange(r, COL_MATCH)
      .setFormula(
        `=IF(J${r}="","",IFERROR(INDEX('⚙️ CUENTAS'!$B$4:$B$100,` +
        `MATCH(TEXT(J${r},"0"),'⚙️ CUENTAS'!$I$4:$I$100,0)),"? tarjeta no registrada"))`
      )
      .setFontSize(10).setVerticalAlignment('middle');
  }

  sh.setColumnWidth(COL_MATCH, 200);
  Logger.log('Fix D: Registro Gastos cols J+K agregadas');
}

// 3. Add col P "Tarjeta Débito" to 2026 COP
function fixD_2026cop(ss) {
  const sh = ss.getSheetByName('2026 COP');
  if (!sh) return;

  const COL_TARJETA = 16; // column P
  const HDR_ROW     = 1;

  sh.getRange(HDR_ROW, COL_TARJETA)
    .setValue('TARJETA DÉBITO\n(últ. 4 dígitos)')
    .setBackground('#1F3B6E').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true);
  sh.setColumnWidth(COL_TARJETA, 120);

  // Col Q: auto-resolved account
  const COL_MATCH = 17; // column Q
  sh.getRange(HDR_ROW, COL_MATCH)
    .setValue('CUENTA RESUELTA\n(auto)')
    .setBackground('#1F3B6E').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true);
  sh.setColumnWidth(COL_MATCH, 200);

  const lastRow = sh.getLastRow();
  for (let r = HDR_ROW + 1; r <= Math.max(lastRow, 300); r++) {
    sh.getRange(r, COL_MATCH)
      .setFormula(
        `=IF(P${r}="","",IFERROR(INDEX('⚙️ CUENTAS'!$B$4:$B$100,` +
        `MATCH(TEXT(P${r},"0"),'⚙️ CUENTAS'!$I$4:$I$100,0)),"? tarjeta no registrada"))`
      )
      .setFontSize(10).setVerticalAlignment('middle');
  }

  Logger.log('Fix D: 2026 COP cols P+Q agregadas');
}

// ── SHARED HELPERS ────────────────────────────────────────────────

function colLetter_(n) {
  let s = ''; n--;
  while (n >= 0) {
    s = String.fromCharCode(65 + n % 26) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function logEntry_(ss, userRequest, actionTaken, details, outcome) {
  const log = ss.getSheetByName('Claude Log');
  if (!log) return;

  const lastRow  = log.getLastRow();
  const lastTurn = lastRow > 1
    ? parseFloat(log.getRange(lastRow, 1).getValue()) || 0
    : 0;
  const nextTurn = Math.floor(lastTurn) + 1;

  log.appendRow([nextTurn, new Date(),
    userRequest || '', actionTaken || '', details || '', outcome || '']);

  const newRow = log.getLastRow();
  log.getRange(newRow, 2).setNumberFormat('yyyy-mm-dd');
  log.getRange(newRow, 1, 1, 6)
     .setFontSize(10).setVerticalAlignment('middle').setWrap(true);
  log.setRowHeight(newRow, 60);
}
