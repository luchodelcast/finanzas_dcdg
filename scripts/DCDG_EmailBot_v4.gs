// ═══════════════════════════════════════════════════════════════════
// DCDG FINANZAS — Bot de emails bancarios v4
// Fix: filtro CETs iWin, debug parser, tarjeta resuelta correctamente
// ═══════════════════════════════════════════════════════════════════

// ── CONFIGURACIÓN ─────────────────────────────────────────────────
const CFG = {
  spreadsheetId:   '1c5i7gOqsRU0CCcg-B6rDDP0MlQWuQmFuT2X90Q5N4NQ',
  sheetGastos:     'Registro Gastos',
  labelDone:       'DCDG-Procesado',
  labelError:      'DCDG-Error',
  maxEmailsPerRun: 20,
};

// Cuentas iWin/Superlikers — CETs/alertas con estas cuentas como ORIGEN se ignoran.
// EXCLUIDOS de esta lista (sí son DCDG): 0965, 3355 (Luis personal), 3851, 9164 (Delca2 → paga a Luis/Carolina)
const IWIN_CUENTAS = [
  // iWin SAS — Bancolombia
  '5401', // BANCOL AHO IWIN SAS 0406516-5401
  '1039', // BANCOL CTE IWIN SAS 0401228-1039
  // iWin SAS — Pichincha
  '9530', // BCO PICHINCHA CTE IWIN SAS 41110-9530
  '2275', // TC IWIN SAS PICHINCHA 491264000650-2275
  // TC iWin / Jeeves
  '0322', // TC IWIN SAS BCOL 45942601377225-0322
  '4543', // TC JEEVES IWIN SAS 5362 81014265-4543
  '0530', // TC JEEVES IWIN SAS 5362 81006561-0530
  // CNB iWin
  '1491', // CNB IWIN SAS DACA 2972-1491
  '2721', // CNB IWIN SAS NO DACA 56505-2721
  // Mercury iWin LLC
  '3811', // MERCURY BANK IWIN LLC 20235034-3811
  '3329', // MERCURY BANK IWIN LLC 20233728-3329
  '2735', // TC MERCURY BANK IWIN LLC 523686003277-2735
  // Superlikers SAS / SPLKRS
  '8632', // BANCOL AHO SPLKRS SAS 6731295-8632
  '5945', // BBVA SPLKRS MXN 011742-5945
  '7064', // BBVA SPLKRS MXN 0117565-7064
  // SL Technologies (Mercury)
  '0490', // MERCURY BANK SL TECHNOLOGIES 20258313-0490
  '9928', // MERCURY BANK SL TECHNOLOGIES 20254641-9928
  // Ecosistemas
  '2997', // BANCOL AHO ECOSISTEMAS 55410001-2997
];

const IWIN_KEYWORDS = [
  'iwin sas', 'iwin llc', 'superlikers sas', 'splkrs',
  'sl technologies', 'ecosistemas', 'bcol cta recordar',
  'fve-', 'ingresos iwin',
];

// Mapa tarjetas débito (últimos 4 de tarjeta) → cuenta
const TARJETAS = {
  '2331': { cuenta: 'Bcol Aho 0965 · Débito 2331 (Luis)',      quien: 'Luis'     },
  '6940': { cuenta: 'Bcol Aho 3355 · Débito 6940 (Luis)',      quien: 'Luis'     },
  '5773': { cuenta: 'Bcol Aho 4549 · Débito 5773 (Luis/DCDG)', quien: 'Luis'     },
  '4550': { cuenta: 'Bcol Aho 3164 · Débito 4550 (Carolina)',  quien: 'Carolina' },
  '1360': { cuenta: 'Bcol Aho 5688 · Débito 1360 (Ahinoa)',    quien: 'Carolina' },
};

// Mapa cuentas (últimos 4 de número de cuenta) → cuenta
// Bancolombia a veces muestra el número de cuenta en vez de la tarjeta
const CUENTAS_MAP = {
  '0965': { cuenta: 'Bcol Aho 0965 · Débito 2331 (Luis)',      quien: 'Luis'     },
  '3355': { cuenta: 'Bcol Aho 3355 · Débito 6940 (Luis)',      quien: 'Luis'     },
  '4549': { cuenta: 'Bcol Aho 4549 · Débito 5773 (Luis/DCDG)', quien: 'Luis'     },
  '3164': { cuenta: 'Bcol Aho 3164 · Débito 4550 (Carolina)',  quien: 'Carolina' },
  '5688': { cuenta: 'Bcol Aho 5688 · Débito 1360 (Ahinoa)',    quien: 'Carolina' },
};

// ── FUNCIÓN PRINCIPAL ─────────────────────────────────────────────
function procesarEmailsNuevos() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  if (!apiKey) { Logger.log('⚠️ Falta ANTHROPIC_KEY en Script Properties'); return; }

  const lblDone  = getOrCreateLabel_(CFG.labelDone);
  const lblError = getOrCreateLabel_(CFG.labelError);

  // ── Timestamp del último mensaje procesado (evita reprocessar hilos viejos)
  const props       = PropertiesService.getScriptProperties();
  const lastTsStr   = props.getProperty('LAST_PROCESSED_TS') || '0';
  const lastTs      = parseInt(lastTsStr) || 0;
  const newLastTs   = { value: lastTs };

  const threads = GmailApp.search(buildQuery_(), 0, CFG.maxEmailsPerRun);
  Logger.log('📧 Threads encontrados: ' + threads.length);
  if (!threads.length) return;

  const ss    = SpreadsheetApp.openById(CFG.spreadsheetId);
  const sheet = ss.getSheetByName(CFG.sheetGastos);
  let procesados = 0, errores = 0;

  for (const thread of threads) {
    let anyNewMessage = false;

    for (const msg of thread.getMessages()) {
      const msgTs = msg.getDate().getTime();

      // ── Solo procesar mensajes más nuevos que el último procesado
      if (msgTs <= lastTs) {
        Logger.log('⏭️ Mensaje antiguo omitido: ' + msg.getDate());
        continue;
      }

      anyNewMessage = true;
      if (msgTs > newLastTs.value) newLastTs.value = msgTs;

      try {
        const result = procesarMensaje_(msg, apiKey);
        if (result) {
          if (!esDuplicado_(sheet, result)) {
            appendToSheet_(sheet, result);
            procesados++;
            Logger.log('✅ ' + result.comercio + ' $' + result.monto);
          } else {
            Logger.log('⏭️ Duplicado omitido: ' + result.comercio + ' $' + result.monto);
          }
        }
      } catch(e) {
        Logger.log('❌ Error: ' + e.message);
        errores++;
        thread.addLabel(lblError);
      }
    }

    // Etiquetar el hilo solo si tenía mensajes nuevos
    if (anyNewMessage) thread.addLabel(lblDone);
  }

  // ── Guardar timestamp del mensaje más reciente procesado
  if (newLastTs.value > lastTs) {
    props.setProperty('LAST_PROCESSED_TS', String(newLastTs.value));
    Logger.log('🕐 Nuevo timestamp guardado: ' + new Date(newLastTs.value));
  }

  if (procesados > 0 || errores > 0) {
    logEntry_(ss,
      'EmailBot: procesamiento automático',
      'procesarEmailsNuevos() · ' + new Date().toISOString(),
      procesados + ' transacciones registradas. ' + errores + ' errores.',
      errores > 0 ? 'Revisar emails etiqueta ' + CFG.labelError : 'OK'
    );
  }
  Logger.log('📊 Resultado: ' + procesados + ' procesados, ' + errores + ' errores');
}

// ── PROCESAR UN EMAIL ─────────────────────────────────────────────
function procesarMensaje_(msg, apiKey) {
  const from    = msg.getFrom();
  const subject = msg.getSubject() || '';
  const body    = msg.getPlainBody() || msg.getBody();
  const date    = msg.getDate();
  const texto   = limpiarTexto_(body);

  // ── CET: asunto empieza con "CET DDMMAA"
  if (/^CET\s+\d{6}/i.test(subject.trim())) {
    // Filtrar CETs de iWin — no son gastos familiares
    const subjectLower = subject.toLowerCase();
    const esIwin = IWIN_KEYWORDS.some(k => subjectLower.includes(k)) ||
                   IWIN_CUENTAS.some(c => subject.includes(c));
    if (esIwin) {
      Logger.log('⏭️ CET iWin ignorado: ' + subject);
      return null;
    }
    return parsearCET_(subject, texto, from, date, apiKey);
  }

  // ── Alerta bancaria: verificar contenido
  const esBancario = /bancolombia|nequi|colpatria|serfinanza/i.test(texto) ||
                     /compraste|pagaste|retiraste|transferiste/i.test(texto);
  if (!esBancario) {
    Logger.log('⏭️ Email no bancario ignorado. From: ' + from.substring(0, 40));
    return null;
  }

  // Log raw body for debugging (first 300 chars)
  Logger.log('📧 Parseando: ' + texto.substring(0, 300));

  const parsed = preParsar_(texto, from, date);
  if (!parsed) {
    Logger.log('⚠️ preParsar_ devolvió null — formato no reconocido');
    Logger.log('   Texto: ' + texto.substring(0, 200));
    return null;
  }
  if (!parsed.monto) {
    Logger.log('⚠️ Monto = 0 en: ' + texto.substring(0, 150));
    return null;
  }

  return llamarClaude_(parsed, apiKey);
}

// ── LIMPIAR TEXTO ─────────────────────────────────────────────────
function limpiarTexto_(body) {
  return (body || '')
    .replace(/<[^>]+>/g, ' ')   // strip HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── PARSEAR CET ───────────────────────────────────────────────────
// Asunto: "CET 050426 por COP 50000 desde Cta 0965 a Air-e - concepto"
function parsearCET_(subject, cuerpo, from, date, apiKey) {
  const m = subject.match(
    /CET\s+(\d{6})\s+por\s+(COP|USD)\s+([\d.,]+)\s+desde\s+(?:Cta\s+)?(\w+)\s+a\s+(.+?)(?:\s+-\s+(.+))?$/i
  );
  if (!m) return null;

  const [, ddmmaa, moneda, montoStr, cuentaOrigen, destino, concepto] = m;
  const dd = ddmmaa.slice(0,2), mm = ddmmaa.slice(2,4), aa = ddmmaa.slice(4,6);
  const fecha  = `20${aa}-${mm}-${dd}`;
  const monto  = parseMonto_(montoStr);

  const infoOrigen = CUENTAS_MAP[cuentaOrigen] || TARJETAS[cuentaOrigen] || {};
  const metodo     = infoOrigen.cuenta || 'Bcol Cta ' + cuentaOrigen;
  const quien      = infoOrigen.quien  || 'Luis';

  // Detectar si el destino es una cuenta propia
  const destinoCodigo = destino.replace(/Cta\s*/i,'').trim();
  const destinoLuis   = ['0965','3355','4549','2331','6940','5773'].includes(destinoCodigo);
  const destinoCaro   = ['3164','5688','4550','1360'].includes(destinoCodigo);

  if (destinoLuis || destinoCaro) {
    // Transferencia interna — no llamar Claude
    return {
      fecha, mes: parseInt(mm) || 1,
      categoria:    destinoLuis ? 'Personal LADCC' : 'Personal CMDG',
      subcategoria: destinoLuis ? 'Gastos Personales LADCC' : 'Gastos Personales CMDG',
      descripcion:  concepto || ('Transferencia a Cta ' + destinoCodigo),
      monto, metodo, quien,
      notas:        subject + ' 🤖',
      tarjeta:      cuentaOrigen,
      confianza:    'alta',
    };
  }

  // Pago externo — llamar Claude para clasificar por concepto
  const parsed = {
    fuente: 'CET', tipo: 'Pagaste',
    monto, comercio: destino.trim(),
    tarjeta: cuentaOrigen, tipoTarjeta: 'débito',
    metodo, quien, fecha,
  };
  const result = llamarClaude_(parsed, apiKey);
  // Override notas con el asunto completo del CET
  result.notas = (result.notas || '') + ' | ' + subject;
  return result;
}

// ── PRE-PARSER ────────────────────────────────────────────────────
function preParsar_(texto, from, date) {
  const quien = detectarQuien_(from, texto);

  // Helper: resolve 4-digit code against both maps, return card number
  const resolverCodigo = (codigo) =>
    TARJETAS[codigo] || CUENTAS_MAP[codigo] || null;

  // Helper: get the actual card number (not account number) for tarjeta field
  const tarjetaDebito = (codigo) => {
    if (TARJETAS[codigo]) return codigo; // it's already a card number
    // It's an account number — find associated card
    const entry = Object.entries(TARJETAS).find(([card, info]) =>
      info.cuenta && info.cuenta.includes(codigo)
    );
    return entry ? entry[0] : codigo;
  };

  // ── BANCOLOMBIA formato 1: Compraste/Retiraste en COMERCIO con T.Deb *XXXX
  // "Compraste $59.923,00 en SUPERTIENDA OLIMPICA con tu T.Deb *5773, el 05/04/2026"
  let m = texto.match(
    /(Compraste|Retiraste|Avanzaste)\s+\$([\d.,]+)\s+en\s+(.+?)\s+con\s+tu\s+T\.(Deb|Cred)\s+[*·]+(\d{4})/i
  );
  if (m) {
    const info = resolverCodigo(m[5]) || {};
    return {
      fuente: 'Bancolombia', tipo: m[1],
      monto:   parseMonto_(m[2]),
      comercio: m[3].trim(),
      tarjeta:  tarjetaDebito(m[5]),
      tipoTarjeta: m[4] === 'Deb' ? 'débito' : 'crédito',
      metodo:  info.cuenta || 'Bcol ****' + m[5],
      quien:   info.quien  || quien,
      fecha:   parseFecha_(texto) || formatDate_(date),
    };
  }

  // ── BANCOLOMBIA formato 2: Pagaste $X a COMERCIO desde tu producto *XXXX
  // "Pagaste $30,000.00 a F2X SAS desde tu producto *0965 el 05/04/2026"
  m = texto.match(
    /Pagaste\s+\$([\d.,]+)\s+a\s+(.+?)\s+desde\s+tu\s+producto\s+[*·]+(\d{4})/i
  );
  if (m) {
    const info = resolverCodigo(m[3]) || {};
    return {
      fuente: 'Bancolombia', tipo: 'Pagaste',
      monto:   parseMonto_(m[1]),
      comercio: m[2].trim(),
      tarjeta:  tarjetaDebito(m[3]),
      tipoTarjeta: 'débito',
      metodo:  info.cuenta || 'Bcol ****' + m[3],
      quien:   info.quien  || quien,
      fecha:   parseFecha_(texto) || formatDate_(date),
    };
  }

  // ── BANCOLOMBIA formato 3: Compraste $X en COMERCIO con T.Deb *XXXX (variante sin "tu")
  m = texto.match(
    /(Compraste|Pagaste)\s+\$([\d.,]+)\s+en\s+(.+?)\s+con\s+T\.(Deb|Cred)\s+[*·]+(\d{4})/i
  );
  if (m) {
    const info = resolverCodigo(m[5]) || {};
    return {
      fuente: 'Bancolombia', tipo: m[1],
      monto:   parseMonto_(m[2]),
      comercio: m[3].trim(),
      tarjeta:  tarjetaDebito(m[5]),
      tipoTarjeta: m[4] === 'Deb' ? 'débito' : 'crédito',
      metodo:  info.cuenta || 'Bcol ****' + m[5],
      quien:   info.quien  || quien,
      fecha:   parseFecha_(texto) || formatDate_(date),
    };
  }

  // ── BANCOLOMBIA formato 4: Transferencia
  m = texto.match(
    /Transferiste\s+\$([\d.,]+)\s+a\s+(.+?)\s+(?:desde|el\s)/i
  );
  if (m) {
    const cuentaM = texto.match(/producto\s+[*·]+(\d{4})/i);
    const codigo  = cuentaM ? cuentaM[1] : '';
    const info    = resolverCodigo(codigo) || {};
    return {
      fuente: 'Bancolombia', tipo: 'Transferiste',
      monto:   parseMonto_(m[1]),
      comercio: m[2].trim(),
      tarjeta:  tarjetaDebito(codigo),
      tipoTarjeta: 'débito',
      metodo:  info.cuenta || 'Bcol ****' + codigo,
      quien:   info.quien  || quien,
      fecha:   parseFecha_(texto) || formatDate_(date),
    };
  }

  // ── NEQUI ─────────────────────────────────────────────────────
  m = texto.match(
    /(Pagaste|Enviaste|Recibiste)\s+\$([\d.,]+)\s+(?:a\s+.+?|en\s+(.+?))(?:\s+desde|\s+con|\s+en)\s+Nequi/i
  );
  if (m) {
    return {
      fuente: 'Nequi', tipo: m[1],
      monto:   parseMonto_(m[2]),
      comercio: m[3] ? m[3].trim() : (m[1] === 'Enviaste' ? 'Transferencia Nequi' : 'Recarga Nequi'),
      tarjeta:  '',
      tipoTarjeta: 'billetera',
      metodo:  quien === 'Carolina' ? 'Nequi Carolina 3013155114' : 'Nequi Luis 3057454823',
      quien,
      fecha:   formatDate_(date),
    };
  }

  // ── COLPATRIA / SERFINANZA (TCs) ──────────────────────────────
  m = texto.match(
    /(?:compra|pago|transacci[oó]n)[^\d$]*\$([\d.,]+)[^*·\d]*[*·]+(\d{4})/i
  );
  if (m) {
    const info    = resolverCodigo(m[2]) || {};
    const comM    = texto.match(/en\s+([A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ\s]+?)(?:\s+con|\s+por|\s+el|\s*\.)/i);
    const fuente  = /colpatria/i.test(texto) ? 'Colpatria' : 'Serfinanza';
    return {
      fuente, tipo: 'Compraste',
      monto:   parseMonto_(m[1]),
      comercio: comM ? comM[1].trim() : 'Ver email',
      tarjeta:  tarjetaDebito(m[2]),
      tipoTarjeta: 'crédito',
      metodo:  info.cuenta || fuente + ' ****' + m[2],
      quien:   info.quien  || quien,
      fecha:   formatDate_(date),
    };
  }

  return null;
}

// ── LLAMAR CLAUDE API ─────────────────────────────────────────────
function llamarClaude_(parsed, apiKey) {
  const prompt =
`Eres el clasificador financiero DCDG (Barranquilla, Colombia). Clasifica esta transacción.

TRANSACCIÓN:
- Fuente: ${parsed.fuente}
- Tipo: ${parsed.tipo}
- Monto: $${parsed.monto} COP
- Comercio: ${parsed.comercio}
- Método: ${parsed.metodo}
- Quién pagó: ${parsed.quien}
- Fecha: ${parsed.fecha}

REGLAS DCDG (en orden de prioridad):
MERCADO: Tienda D1, ARA, Dollarcity, Olimpica, STO, Makro, Éxito, Oxxo → Alimentación / Mercado
RESTAURANTE: Cucinare, Fiordi, Kike Lopez, Crepes & Waffles, Buffalo Grill, La Casona, Maema, Narcobollo → Alimentación / Restaurante
DOMICILIOS: Rappi, iFood, Domicilios.com → Alimentación / Domicilios
TRANSPORTE: Uber, InDriver, Cabify → Transporte / Uber/Taxi
GASOLINA: EDS, Terpel, Biomax, Zeuss, gasolinera → Transporte / Gasolina/EDS
VEHÍCULO: Prontowash, lavadero, taller → Transporte / Vehículos/Lavado
SALUD FARMA: Farmatodo, Cruz Verde, droguería → Salud / Salud: Medicamentos
SALUD CITA: clínica, médico, Sanitas → Salud / Salud: Citas Médicas
SUSCRIPCIONES: Netflix, Spotify, Amazon, Apple, Disney, HBO, YouTube → Entretenimiento / Suscripciones Online
BIOFOOD: Biofood → Gastos Luhijo - Luciano / Meriendas y Almuerzos Colegio
COLEGIO: Colegio Alemán → Educación / Colegio
BANCARIO: 4x1000, cuota manejo, comisión, F2X SAS, PSE, pagos de servicios públicos → Gastos Bancarios / Comisiones
PEAJES: Flypass, peaje, tag, recarga peaje, F2X SAS Flypass → Transporte / Peajes
TRANSFERENCIA propia entre cuentas LADCC/CMDG → Personal LADCC o Personal CMDG
DEFAULT: → Imprevistos / Otros

NOTAS: monto < 10000 COP es raro, mencionarlo en notas.

Devuelve ÚNICAMENTE JSON válido sin markdown ni explicaciones:
{"categoria":"","subcategoria":"","notas":"","confianza":"alta|media|baja"}`;

  try {
    const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      payload: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages:   [{ role: 'user', content: prompt }],
      }),
      muteHttpExceptions: true,
    });

    const data = JSON.parse(resp.getContentText());
    if (data.error) {
      Logger.log('Claude API error: ' + JSON.stringify(data.error));
      return buildFallback_(parsed);
    }

    const raw = data.content[0].text.trim()
      .replace(/```json\n?/g,'').replace(/```/g,'').trim();
    const cls = JSON.parse(raw);

    return {
      fecha:        parsed.fecha,
      mes:          parseInt(parsed.fecha.split('-')[1]) || 1,
      categoria:    cls.categoria    || 'Imprevistos',
      subcategoria: cls.subcategoria || 'Otros',
      descripcion:  parsed.comercio,
      monto:        parsed.monto,
      metodo:       parsed.metodo,
      quien:        parsed.quien,
      notas:        (cls.notas || parsed.fuente + ' auto') + ' 🤖',
      tarjeta:      parsed.tarjeta || '',
      confianza:    cls.confianza  || 'media',
    };
  } catch(e) {
    Logger.log('Error Claude: ' + e.message);
    return buildFallback_(parsed);
  }
}

function buildFallback_(parsed) {
  return {
    fecha: parsed.fecha, mes: parseInt(parsed.fecha.split('-')[1]) || 1,
    categoria: 'Imprevistos', subcategoria: 'Otros',
    descripcion: parsed.comercio, monto: parsed.monto,
    metodo: parsed.metodo, quien: parsed.quien,
    notas: parsed.fuente + ' auto · error API 🤖', tarjeta: parsed.tarjeta || '',
    confianza: 'baja',
  };
}

// ── ESCRIBIR EN SHEETS ────────────────────────────────────────────
// ── DUPLICATE DETECTION ──────────────────────────────────────────
// Bloquea solo si misma fecha + monto + primeros 6 chars de comercio
// NO compara por método (causaba falsos positivos)
function esDuplicado_(sheet, result) {
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow < 3) return false;
    const startRow = Math.max(3, lastRow - 100);
    const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 6).getValues();
    const desc6 = result.descripcion.toLowerCase().substring(0, 6);
    return data.some(row => {
      const rowFecha = row[0] ? String(row[0]).substring(0, 10) : '';
      const rowMonto = parseFloat(row[5]) || 0;
      const rowDesc  = String(row[4] || '').toLowerCase().substring(0, 6);
      return rowFecha === result.fecha &&
             Math.abs(rowMonto - result.monto) < 1 &&
             desc6.length >= 4 &&
             rowDesc === desc6;
    });
  } catch(e) {
    Logger.log('Error esDuplicado_: ' + e.message);
    return false;
  }
}

function appendToSheet_(sheet, r) {
  // Cols A-J: fecha, mes, cat, sub, desc, monto, metodo, quien, notas, tarjeta
  sheet.appendRow([
    r.fecha, r.mes, r.categoria, r.subcategoria,
    r.descripcion, r.monto, r.metodo, r.quien,
    r.notas, r.tarjeta,
  ]);

  const lastRow = sheet.getLastRow();

  // ── Col K: fórmula que auto-resuelve tarjeta → nombre de cuenta desde ⚙️ CUENTAS
  sheet.getRange(lastRow, 11).setFormula(
    `=IF(J${lastRow}="","",IFERROR(INDEX('⚙️ CUENTAS'!$B$4:$B$100,` +
    `MATCH(VALUE(J${lastRow}),'⚙️ CUENTAS'!$I$4:$I$100,0)),"? tarjeta no registrada"))`
  );

  // Color by confidence: media=amarillo, baja=rojo, alta=normal
  const bg = { alta: null, media: '#FFF3CD', baja: '#FDECEA' }[r.confianza];
  if (bg) sheet.getRange(lastRow, 1, 1, 11).setBackground(bg);
}

// ── HELPERS ───────────────────────────────────────────────────────

function buildQuery_() {
  // Captura:
  // 1. Alertas bancarias directas y reenviadas (por asunto)
  // 2. CETs enviados por Luis a cetladca (asunto empieza con "CET")
  const alertas = `subject:"Alertas y Notificaciones" -label:${CFG.labelDone} -label:${CFG.labelError} newer_than:7d`;
  const cets    = `subject:"CET " -label:${CFG.labelDone} -label:${CFG.labelError} newer_than:30d`;
  return `(${alertas}) OR (${cets})`;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function parseMonto_(str) {
  const s = str.replace(/[$\s]/g, '');
  // Detectar formato: colombiano 59.923,00 vs americano 30,000.00
  if (/,\d{2}$/.test(s) && s.includes('.')) {
    // Colombiano: 59.923,00 → quitar puntos, cambiar coma por punto
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  // Americano: 30,000.00 → quitar comas
  return parseFloat(s.replace(/,/g, '')) || 0;
}

function parseFecha_(texto) {
  // "el 05/04/2026 a las 15:03"
  const m = texto.match(/el\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // "05/04/2026"
  const m2 = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

function formatDate_(date) {
  const d = new Date(date);
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

function detectarQuien_(from, texto) {
  // Email reenviado por Carolina
  if ((from||'').toLowerCase().includes('carodz2')) return 'Carolina';
  if ((texto||'').toLowerCase().includes('carodz2')) return 'Carolina';
  // Detectar por número de tarjeta/cuenta en el texto
  const codigoM = (texto||'').match(/[*·]+(\d{4})/);
  if (codigoM) {
    const codigo = codigoM[1];
    if (['4550','1360','3164','5688'].includes(codigo)) return 'Carolina';
  }
  return 'Luis';
}

// ── RESET TIMESTAMP (ejecutar para reprocesar emails recientes) ───
function resetTimestamp() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_PROCESSED_TS');
  Logger.log('✅ Timestamp reseteado — próxima ejecución procesará todos los emails de los últimos 7 días');
}
function reprocesarErrores() {
  const apiKey  = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  const lblError = GmailApp.getUserLabelByName(CFG.labelError);
  if (!lblError) { Logger.log('No hay etiqueta de errores'); return; }

  const threads = lblError.getThreads(0, 10);
  const ss      = SpreadsheetApp.openById(CFG.spreadsheetId);
  const sheet   = ss.getSheetByName(CFG.sheetGastos);
  const lblDone = getOrCreateLabel_(CFG.labelDone);

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      try {
        const body   = msg.getPlainBody() || msg.getBody();
        const texto  = limpiarTexto_(body);
        const parsed = preParsar_(texto, msg.getFrom(), msg.getDate());
        if (parsed) {
          const result = llamarClaude_(parsed, apiKey);
          appendToSheet_(sheet, result);
          thread.addLabel(lblDone);
          thread.removeLabel(lblError);
          Logger.log('✅ Reintento OK: ' + result.comercio);
        }
      } catch(e) { Logger.log('Reintento fallido: ' + e.message); }
    }
  }
}

// ── PRUEBA MANUAL ─────────────────────────────────────────────────
function probarConUltimoEmail() {
  const apiKey  = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  const threads = GmailApp.search('subject:"Alertas y Notificaciones" newer_than:2d', 0, 3);
  if (!threads.length) { Logger.log('No se encontró ningún email bancario'); return; }

  // Try up to 3 recent threads to find one that parses correctly
  for (const thread of threads) {
    const msg    = thread.getMessages()[0];
    const body   = msg.getPlainBody() || msg.getBody();
    const texto  = limpiarTexto_(body);

    Logger.log('─────────────────────────────');
    Logger.log('De: '    + msg.getFrom());
    Logger.log('Fecha: ' + msg.getDate());
    Logger.log('Cuerpo (400 chars): ' + texto.substring(0, 400));

    const parsed = preParsar_(texto, msg.getFrom(), msg.getDate());
    Logger.log('Pre-parseado: ' + JSON.stringify(parsed));

    if (parsed) {
      const result = llamarClaude_(parsed, apiKey);
      Logger.log('Clasificado: ' + JSON.stringify(result));
      Logger.log('✅ Fecha:' + result.fecha + ' | Cat:' + result.categoria +
                 ' | Desc:' + result.descripcion + ' | $' + result.monto +
                 ' | Método:' + result.metodo + ' | Tarjeta:' + result.tarjeta);
      break; // found one that works
    } else {
      Logger.log('⚠️ null — formato no reconocido por ningún regex');
    }
  }
}

// ── CLAUDE LOG ────────────────────────────────────────────────────
function logEntry_(ss, userRequest, actionTaken, details, outcome) {
  const log = ss.getSheetByName('Claude Log');
  if (!log) return;
  const lastRow  = log.getLastRow();
  const lastTurn = lastRow > 1 ? parseFloat(log.getRange(lastRow,1).getValue()) || 0 : 0;
  log.appendRow([
    Math.floor(lastTurn) + 1, new Date(),
    userRequest||'', actionTaken||'', details||'', outcome||''
  ]);
  const r = log.getLastRow();
  log.getRange(r, 2).setNumberFormat('yyyy-mm-dd');
  log.getRange(r, 1, 1, 6).setFontSize(10).setVerticalAlignment('middle').setWrap(true);
  log.setRowHeight(r, 60);
}
