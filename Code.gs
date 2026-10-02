// ═══════════════════════════════════════════════════════════
//  fën gastos — Apps Script · Code.gs  v2.0.0  (2026-10-02)
//  v2.0.0: doPost se movió a Seguridad.gs (archivo nuevo en el mismo
//  proyecto), que exige la sesión del dueño en cada llamada. Aquí la
//  antigua doPost se llama ejecutarAccionLegada(data). El resto es igual.
// ═══════════════════════════════════════════════════════════

const SPREADSHEET_ID   = "1IQabDQ3a7Tz3yAUbeYNhlTGsTSdr9SA5326F1yTslBA";
const FOLDER_NAME      = "Boletas Gastos";
const FORMATO_PESO     = '"$"#.##0';
const ANTELACION_DIAS  = 3;   // días de anticipación con que se genera un vencimiento (para avisar antes)
const DIAS_MOSTRAR_PAGADOS = 7; // vista rápida en Obligaciones — el historial completo se ve con getHistorialPagos
const CORREOS_AVISO = ['emmanuel.vepal@gmail.com'];

// v2.0.0: antes era doPost. Ahora doPost/doGet viven en Seguridad.gs, que
// revisa la sesión del dueño y recién entonces llama a esta función con los
// datos ya leídos. Devuelve el objeto de respuesta (no el texto JSON).
function ejecutarAccionLegada(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const action = data.action || '';

    // ── OBLIGACIONES: PLANTILLAS (reglas recurrentes) ─────
    if (action === 'getPlantillas')            return getPlantillas(ss);
    if (action === 'savePlantilla')             return savePlantilla(ss, data);
    if (action === 'archivarPlantilla')         return archivarPlantilla(ss, data);
    if (action === 'activarPlantilla')          return activarPlantilla(ss, data);
    if (action === 'deletePlantilla')           return deletePlantilla(ss, data);

    // ── OBLIGACIONES: VENCIMIENTOS (ocurrencias reales) ───
    if (action === 'getVencimientos')           return getVencimientos(ss);
    if (action === 'getHistorialPagos')         return getHistorialPagos(ss, data);
    if (action === 'registrarPagoVencimiento')  return registrarPagoVencimiento(ss, data);
    if (action === 'eliminarVencimiento')       return eliminarVencimiento(ss, data);

    // ── GASTOS ─────────────────────────────────────────────
    if (action === 'getGastos')         return getGastos(ss, data);
    if (action === 'editarGasto')       return editarGasto(ss, data);
    if (action === 'eliminarGasto')     return eliminarGasto(ss, data);

    // ── ÍTEMS ──────────────────────────────────────────────
    if (action === 'getItems')          return getItems(ss);
    if (action === 'saveItem')          return saveItem(ss, data);
    if (action === 'deleteItem')        return deleteItem(ss, data);
    if (action === 'moverItem')         return moverItem(ss, data);
    if (action === 'getVentasPorArea')  return getVentasPorArea();

    // ── CARGA MASIVA SII ───────────────────────────────────
    if (action === 'getFoliosImportados') return getFoliosImportados(ss);
    if (action === 'importarSII')         return importarSII(ss, data);
    if (action === 'getDetalleDocumento')  return getDetalleDocumento(ss, data);
    if (action === 'registrarCargaSII')    return registrarCargaSII(ss, data);
    if (action === 'getCargasSII')         return getCargasSII(ss);
    if (action === 'leerArchivoCarga')     return leerArchivoCarga(ss, data);
    if (action === 'buscarCoincidencias')  return buscarCoincidencias(ss, data);
    if (action === 'vincularGastoConDocumento') return vincularGastoConDocumento(ss, data);
    if (action === 'eliminarCargaSII')     return eliminarCargaSII(ss, data);
    if (action === 'guardarNotaCarga')     return guardarNotaCarga(ss, data);
    if (action === 'guardarNotaDocumento') return guardarNotaDocumento(ss, data);

    // ── REGISTRO DE GASTO (flujo original) ────────────────
    // v2.0.0: una acción desconocida ya no registra un gasto por error.
    if (action && action !== 'registrarGasto') return { status: 'error', message: 'Acción no reconocida: ' + action };
    return registrarGasto(ss, data);

  } catch (err) {
    return { status: "error", message: err.message };
  }
}

function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════
// HELPERS GENERALES
// ════════════════════════════════════════════════
function hoyStrGS() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function fechaISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function colIdx(headers, name) {
  for (var i=0; i<headers.length; i++) {
    if (String(headers[i]).toLowerCase().replace(/[^a-z]/g,'') === name.toLowerCase().replace(/[^a-z]/g,'')) return i;
  }
  return -1;
}

function normalizarFecha(val) {
  if (!val) return '';
  if (val instanceof Date) {
    var y = val.getFullYear();
    var m = String(val.getMonth()+1).padStart(2,'0');
    var d = String(val.getDate()).padStart(2,'0');
    return y + '-' + m + '-' + d;
  }
  var s = String(val).trim();
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.slice(0,10);
  // dd/mm/yyyy o dd-mm-yyyy — este último es el que genera la app al registrar un gasto.
  // Sin esta rama, new Date("08-09-2026") lo interpreta como mes-día y devuelve una
  // fecha equivocada (9 de agosto en vez de 8 de septiembre).
  var mDMA = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (mDMA) {
    return mDMA[3] + '-' + mDMA[2].padStart(2,'0') + '-' + mDMA[1].padStart(2,'0');
  }
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    var y2 = parsed.getFullYear();
    var m2 = String(parsed.getMonth()+1).padStart(2,'0');
    var d2 = String(parsed.getDate()).padStart(2,'0');
    return y2 + '-' + m2 + '-' + d2;
  }
  return s;
}

function getOrCreateFolder(name) {
  var folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

// ════════════════════════════════════════════════
// REGISTRO DE GASTO
// ════════════════════════════════════════════════
function registrarGasto(ss, data) {
  var sheet = ss.getSheets()[0];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Fecha","Hora","Ítem Gasto","Categoría","Tipo","Sub Tipo",
      "Área","Tipo Monto","Monto Neto","Monto Final","Es Harina","Forma Pago","Fecha Pago","Archivo","Observación","URL Foto"]);
    sheet.getRange(1,1,1,16).setFontWeight("bold");
  }

  var fileUrl = "";
  if (data.imageData) {
    var folder = getOrCreateFolder(FOLDER_NAME);
    var blob = Utilities.newBlob(Utilities.base64Decode(data.imageData), data.mimeType || "image/jpeg", data.fileName || "boleta.jpg");
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    fileUrl = file.getUrl();
  }

  var tipoMonto = data.tipoMonto || 'bruto';
  var formaPago = data.formaPago || 'contado';
  var fechaPago = data.fechaPago || '';
  var items = data.items || [];

  // Soporte legado (payload sin items array)
  if (!items.length && data.item) {
    items = [{
      item: data.item, categoria: data.categoria, tipo: data.tipo,
      subTipo: data.subTipo, area: data.area, esHarina: data.esHarina,
      areas: data.multiArea || [], prorrateo: data.prorrateo,
      montoTotal: parseFloat((data.monto||'0').toString().replace(/\./g,'').replace(',','.')) || 0
    }];
  }

  for (var ii = 0; ii < items.length; ii++) {
    var it = items[ii];
    var baseRow = [data.fecha||'', data.hora||'', it.item||'', it.categoria||'', it.tipo||'', it.subTipo||''];
    var esHarina = it.esHarina ? 'Sí' : 'No';
    var factor = it.esHarina ? 1.31 : 1.19;

    if (it.area === 'PRORRATEADO' && it.prorrateo) {
      var p = it.prorrateo;
      var montoFinalP = it.montoTotal;
      var montoNetoP;
      if (tipoMonto === 'neto') { montoNetoP = montoFinalP; montoFinalP = Math.round(montoFinalP * factor); }
      else if (tipoMonto === 'siniva') { montoNetoP = montoFinalP; }
      else { montoNetoP = Math.round(montoFinalP / factor); }
      var pct1 = parseFloat(p.pct1)||0, pct2 = parseFloat(p.pct2)||0, pct3 = parseFloat(p.pct3)||0;
      var m1 = Math.round(montoFinalP*pct1/100), m2 = Math.round(montoFinalP*pct2/100), m3 = Math.round(montoFinalP*pct3/100);
      var n1 = Math.round(montoNetoP*pct1/100), n2 = Math.round(montoNetoP*pct2/100), n3 = Math.round(montoNetoP*pct3/100);
      if (p.area3 && pct3) {
        sheet.insertRowAfter(1);
        sheet.getRange(2,1,1,16).setValues([[...baseRow, p.area3, tipoMonto, n3, m3, esHarina, formaPago, fechaPago, data.fileName||'', data.observacion||'', fileUrl]]);
        sheet.getRange(2,9,1,2).setNumberFormat(FORMATO_PESO);
      }
      sheet.insertRowAfter(1);
      sheet.getRange(2,1,1,16).setValues([[...baseRow, p.area2, tipoMonto, n2, m2, esHarina, formaPago, fechaPago, data.fileName||'', data.observacion||'', fileUrl]]);
      sheet.getRange(2,9,1,2).setNumberFormat(FORMATO_PESO);
      sheet.insertRowAfter(1);
      sheet.getRange(2,1,1,16).setValues([[...baseRow, p.area1, tipoMonto, n1, m1, esHarina, formaPago, fechaPago, data.fileName||'', data.observacion||'', fileUrl]]);
      sheet.getRange(2,9,1,2).setNumberFormat(FORMATO_PESO);
    } else if (it.areas && it.areas.length) {
      for (var ai = it.areas.length - 1; ai >= 0; ai--) {
        var areaItem = it.areas[ai];
        var maBruto = parseFloat(areaItem.monto)||0;
        var maNeto;
        if (tipoMonto === 'neto') { maNeto = maBruto; maBruto = Math.round(maBruto * factor); }
        else if (tipoMonto === 'siniva') { maNeto = maBruto; }
        else { maNeto = Math.round(maBruto / factor); }
        sheet.insertRowAfter(1);
        sheet.getRange(2,1,1,16).setValues([[...baseRow, areaItem.area, tipoMonto, maNeto, maBruto, esHarina, formaPago, fechaPago, data.fileName||'', data.observacion||'', fileUrl]]);
        sheet.getRange(2,9,1,2).setNumberFormat(FORMATO_PESO);
      }
    }
  }

  // Crear un VENCIMIENTO automático si es crédito — UNA SOLA por factura (evento único, sin plantilla)
  if ((formaPago === 'tarjeta' || formaPago === 'proveedor') && fechaPago && items.length) {
    var shV = getSheetVencimientos(ss);
    var nombreItems = items.map(function(i){ return i.item||''; }).join(' + ');
    var nombreVenc = (formaPago === 'tarjeta' ? '💳 Tarjeta: ' : '📋 Crédito: ') + nombreItems;

    var montoTotalFinal = 0;
    var multiAreaStr = '';
    var todasAreas = [];
    var areaVenc = '';

    for (var oi = 0; oi < items.length; oi++) {
      var itO = items[oi];
      var factorO = itO.esHarina ? 1.31 : 1.19;

      if (itO.areas && itO.areas.length) {
        for (var ai2 = 0; ai2 < itO.areas.length; ai2++) {
          var montoArea = parseFloat(itO.areas[ai2].monto)||0;
          var montoBrutoArea = tipoMonto === 'neto' ? Math.round(montoArea * factorO) : montoArea;
          montoTotalFinal += montoBrutoArea;
          todasAreas.push({area: itO.areas[ai2].area, monto: montoBrutoArea});
        }
      } else if (itO.prorrateo) {
        var montoP = parseFloat(itO.montoTotal)||0;
        var montoBrutoP = tipoMonto === 'neto' ? Math.round(montoP * factorO) : montoP;
        montoTotalFinal += montoBrutoP;
      }
    }

    if (todasAreas.length === 1) areaVenc = todasAreas[0].area;
    else if (todasAreas.length > 1) { areaVenc = 'MULTI'; multiAreaStr = JSON.stringify(todasAreas); }

    var itemNombre = items.length === 1 ? (items[0].item||'') : '';
    var catVenc = items.length === 1 ? (items[0].categoria||'') : '';
    var tipoVenc = items.length === 1 ? (items[0].tipo||'') : '';
    var subTipoVenc = items.length === 1 ? (items[0].subTipo||'') : '';

    var hoyD = new Date(); hoyD.setHours(0,0,0,0);
    var fechaPagoD = new Date(fechaPago + 'T00:00:00');
    var estadoInicial = fechaPagoD < hoyD ? 'VENCIDA' : 'PENDIENTE';
    var vId = Utilities.getUuid();
    var periodoKey = fechaPago.slice(0,7);

    shV.appendRow([vId, '', nombreVenc, itemNombre, periodoKey, fechaPago, montoTotalFinal, data.observacion||'',
      areaVenc, catVenc, tipoVenc, subTipoVenc, multiAreaStr, estadoInicial, '', '', '', fileUrl, '', '', '', '', '', '', '', data.fecha||'', '']);
  }

  return { status: "ok" };
}

// ════════════════════════════════════════════════
// OBLIGACIONES — PLANTILLAS (reglas recurrentes o de fecha fija)
// ════════════════════════════════════════════════
function getSheetPlantillas(ss) {
  var sh = ss.getSheetByName('Obligaciones');
  if (!sh) {
    sh = ss.insertSheet('Obligaciones');
    sh.appendRow(['ID','Nombre','Item','Frecuencia','Dia','FechaEsp','MontoEstimado','Obs','Area','Categoria','Tipo','SubTipo','PArea1','PPct1','PArea2','PPct2','PArea3','PPct3','MultiArea','Estado','FechaCreacion','TipoMonto','Cuotas']);
    sh.getRange(1,1,1,23).setFontWeight('bold');
  }
  return sh;
}

function getPlantillas(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = getSheetPlantillas(ss);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return { plantillas: [] };
  var h = rows[0];
  function ci(name){ return colIdx(h,name); }
  var iId=ci('ID'), iNom=ci('Nombre'), iItem=ci('Item'), iFrec=ci('Frecuencia'), iDia=ci('Dia'), iFechaEsp=ci('FechaEsp'),
      iMonto=ci('MontoEstimado'), iObs=ci('Obs'), iArea=ci('Area'), iCat=ci('Categoria'), iTipo=ci('Tipo'), iSubTipo=ci('SubTipo'),
      iPArea1=ci('PArea1'), iPPct1=ci('PPct1'), iPArea2=ci('PArea2'), iPPct2=ci('PPct2'), iPArea3=ci('PArea3'), iPPct3=ci('PPct3'),
      iMultiArea=ci('MultiArea'), iEst=ci('Estado'), iFC=ci('FechaCreacion'), iTipoMonto=ci('TipoMonto'), iCuotas=ci('Cuotas');

  // Para el "panorama del mes": si ya existe un vencimiento abierto (no pagado) de la
  // plantilla, esa es su próxima fecha real. Si el último vencimiento generado ya está
  // pagado, hay que proyectar el siguiente período A PARTIR de esa fecha (no desde
  // FechaCreacion de nuevo, o quedaría "pegado" en el primer período para siempre).
  var shV = getSheetVencimientos(ss);
  var vrows = shV.getDataRange().getValues();
  var vh = vrows.length ? vrows[0] : [];
  var vPlantillaId = colIdx(vh,'PlantillaID'), vFecha = colIdx(vh,'FechaVencimiento'), vEstado = colIdx(vh,'Estado');

  function datosVencimientosPlantilla(plantillaId) {
    var abierta = null;     // fecha del vencimiento no pagado más próximo (si existe)
    var ultimaFecha = null; // fecha más reciente entre TODOS los vencimientos (pagados o no)
    for (var k=1; k<vrows.length; k++) {
      if (String(vrows[k][vPlantillaId]) === plantillaId) {
        var f = normalizarFecha(vrows[k][vFecha]);
        if (String(vrows[k][vEstado]) !== 'PAGADO' && (!abierta || f < abierta)) abierta = f;
        if (!ultimaFecha || f > ultimaFecha) ultimaFecha = f;
      }
    }
    return { abierta: abierta, ultimaFecha: ultimaFecha };
  }

  var plantillas = rows.slice(1).map(function(row) {
    var id = String(row[iId]||'');
    var frecuencia = String(row[iFrec]||'');
    var estado = String(row[iEst]||'ACTIVA');

    var datosV = datosVencimientosPlantilla(id);
    var proximaFecha = datosV.abierta;
    if (!proximaFecha && estado === 'ACTIVA') {
      if (frecuencia === 'variable') {
        proximaFecha = normalizarFecha(row[iFechaEsp]);
      } else if (frecuencia) {
        var anchor;
        if (datosV.ultimaFecha) {
          anchor = new Date(datosV.ultimaFecha + 'T00:00:00');
          anchor.setDate(anchor.getDate() + 1); // proyectar el período SIGUIENTE al último ya generado
        } else {
          var fc = normalizarFecha(row[iFC]);
          anchor = fc ? new Date(fc+'T00:00:00') : new Date();
        }
        var calc = calcularOcurrenciaDesde(frecuencia, row[iDia], anchor);
        if (calc) proximaFecha = fechaISO(calc);
      }
    }

    return {
      id: id,
      nombre: String(row[iNom]||''),
      item: String(row[iItem]||''),
      frecuencia: frecuencia,
      dia: String(row[iDia]||''),
      fechaEsp: normalizarFecha(row[iFechaEsp]),
      montoEstimado: String(row[iMonto]||''),
      obs: String(row[iObs]||''),
      area: String(row[iArea]||''),
      categoria: String(row[iCat]||''),
      tipo: String(row[iTipo]||''),
      subTipo: String(row[iSubTipo]||''),
      pArea1: String(row[iPArea1]||''), pPct1: String(row[iPPct1]||''),
      pArea2: String(row[iPArea2]||''), pPct2: String(row[iPPct2]||''),
      pArea3: String(row[iPArea3]||''), pPct3: String(row[iPPct3]||''),
      multiArea: (function(v){ try{ return v ? JSON.parse(v) : null; }catch(e){ return null; } })(row[iMultiArea]),
      estado: estado,
      fechaCreacion: normalizarFecha(row[iFC]),
      tipoMonto: String(row[iTipoMonto]||''),
      cuotas: (function(v){ try{ return v ? JSON.parse(v) : null; }catch(e){ return null; } })(iCuotas>-1 ? row[iCuotas] : ''),
      proximaFecha: proximaFecha || ''
    };
  }).filter(function(p){ return p.id; });

  return { plantillas: plantillas };
}

function savePlantilla(ss, data) {
  var sh = getSheetPlantillas(ss);
  var rows = sh.getDataRange().getValues();
  var h = rows[0];
  var iTipoMonto = colIdx(h, 'TipoMonto');

  if (data.id) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sh.getRange(i+1, 2, 1, 18).setValues([[
          data.nombre, data.item||'', data.frecuencia, data.dia||'', data.fechaEsp||'',
          data.montoEstimado||'', data.obs||'', data.area||'', data.categoria||'',
          data.tipo||'', data.subTipo||'', data.pArea1||'', data.pPct1||'',
          data.pArea2||'', data.pPct2||'', data.pArea3||'', data.pPct3||'',
          data.multiArea ? JSON.stringify(data.multiArea) : ''
        ]]);
        if (iTipoMonto > -1) sh.getRange(i+1, iTipoMonto+1).setValue(data.tipoMonto||'');
        return { ok: true };
      }
    }
    return { error: 'No encontrado' };
  } else {
    var newId = 'P' + Date.now();
    var cuotasStr = (data.frecuencia === 'cuponera' && data.cuotas) ? JSON.stringify(data.cuotas) : '';
    sh.appendRow([newId, data.nombre, data.item||'', data.frecuencia, data.dia||'',
      data.fechaEsp||'', data.montoEstimado||'', data.obs||'', data.area||'',
      data.categoria||'', data.tipo||'', data.subTipo||'', data.pArea1||'',
      data.pPct1||'', data.pArea2||'', data.pPct2||'', data.pArea3||'',
      data.pPct3||'', data.multiArea ? JSON.stringify(data.multiArea) : '',
      'ACTIVA', hoyStrGS(), data.tipoMonto||'', cuotasStr]);

    if (data.frecuencia === 'cuponera' && data.cuotas && data.cuotas.length) {
      // Cuponera: las fechas ya se conocen de antemano — se generan TODOS los
      // vencimientos de una vez, sin esperar la ventana de 3 días de anticipación
      // que usan las demás obligaciones recurrentes.
      generarCuponera(ss, newId, data);
    } else {
      // Generar de inmediato el primer vencimiento — no esperar al trigger diario
      generarVencimientos(ss);
    }
    return { ok: true };
  }
}

function generarCuponera(ss, plantillaId, data) {
  var shV = getSheetVencimientos(ss);
  var hoyD = new Date(); hoyD.setHours(0,0,0,0);
  var multiAreaStr = data.multiArea ? JSON.stringify(data.multiArea) : '';

  data.cuotas.forEach(function(c) {
    if (!c.fecha) return;
    var fechaD = new Date(c.fecha + 'T00:00:00');
    var estado = fechaD < hoyD ? 'VENCIDA' : 'PENDIENTE';
    var vId = Utilities.getUuid();
    var periodoKey = c.fecha.slice(0,7);
    shV.appendRow([vId, plantillaId, data.nombre, data.item||'', periodoKey, c.fecha, c.monto||'',
      data.obs||'', data.area||'', data.categoria||'', data.tipo||'', data.subTipo||'', multiAreaStr,
      estado, '', '', '', '', '',
      data.pArea1||'', data.pPct1||'', data.pArea2||'', data.pPct2||'', data.pArea3||'', data.pPct3||'',
      '', data.tipoMonto||'']);
  });
}

function archivarPlantilla(ss, data) {
  var sh = getSheetPlantillas(ss);
  var rows = sh.getDataRange().getValues();
  var h = rows[0];
  var iId = colIdx(h,'ID'), iEst = colIdx(h,'Estado');
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][iId]) === String(data.id)) {
      sh.getRange(i+1, iEst+1).setValue('ARCHIVADA');
      return { ok: true };
    }
  }
  return { error: 'No encontrado' };
}

// Reactiva una plantilla archivada — vuelve a generar vencimientos desde ahora en
// adelante (no retroactivo, mismo criterio usado en toda la app).
function activarPlantilla(ss, data) {
  var sh = getSheetPlantillas(ss);
  var rows = sh.getDataRange().getValues();
  var h = rows[0];
  var iId = colIdx(h,'ID'), iEst = colIdx(h,'Estado'), iFC = colIdx(h,'FechaCreacion');
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][iId]) === String(data.id)) {
      sh.getRange(i+1, iEst+1).setValue('ACTIVA');
      // Reiniciar el ancla de generación a hoy, para que no intente generar de golpe
      // todos los períodos que pasaron mientras estuvo archivada.
      sh.getRange(i+1, iFC+1).setValue(hoyStrGS());
      generarVencimientos(ss);
      return { ok: true };
    }
  }
  return { error: 'No encontrado' };
}

function deletePlantilla(ss, data) {
  var sh = getSheetPlantillas(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sh.deleteRow(i+1);
      return { ok: true };
    }
  }
  return { error: 'No encontrado' };
}

// ════════════════════════════════════════════════
// OBLIGACIONES — VENCIMIENTOS (ocurrencias reales, una fila por período)
// ════════════════════════════════════════════════
function getSheetVencimientos(ss) {
  var sh = ss.getSheetByName('Vencimientos');
  if (!sh) {
    sh = ss.insertSheet('Vencimientos');
    sh.appendRow(['ID','PlantillaID','Nombre','Item','PeriodoKey','FechaVencimiento','MontoEstimado','Obs','Area','Categoria','Tipo','SubTipo','MultiArea','Estado','FechaPago','MontoPago','ObsPago','URLComprobante','Notificado','PArea1','PPct1','PArea2','PPct2','PArea3','PPct3','FechaCompra','TipoMonto']);
    sh.getRange(1,1,1,27).setFontWeight('bold');
  }
  return sh;
}

// Calcula la primera ocurrencia de la regla con fecha >= refDate (Date, hora 00:00)
function calcularOcurrenciaDesde(frecuencia, dia, refDate) {
  var yr = refDate.getFullYear(), mo = refDate.getMonth();
  if (frecuencia === 'mensual_dia') {
    var d = parseInt(dia);
    var fecha = new Date(yr, mo, d);
    if (fecha < refDate) fecha = new Date(yr, mo+1, d);
    return fecha;
  }
  if (frecuencia === 'mensual_ultimo') {
    var fecha2 = new Date(yr, mo+1, 0);
    if (fecha2 < refDate) fecha2 = new Date(yr, mo+2, 0);
    return fecha2;
  }
  if (frecuencia === 'quincenal') {
    var candidatos = [new Date(yr,mo,1), new Date(yr,mo,15), new Date(yr,mo+1,1), new Date(yr,mo+1,15)];
    for (var i=0;i<candidatos.length;i++) { if (candidatos[i] >= refDate) return candidatos[i]; }
  }
  return null;
}

function filaVencimiento(plantillaId, row, cols, fechaStr, estado) {
  var periodoKey = fechaStr.slice(0,7);
  var vId = Utilities.getUuid();
  return [vId, plantillaId, row[cols.iNom]||'', row[cols.iItem]||'', periodoKey, fechaStr, row[cols.iMonto]||'',
    row[cols.iObs]||'', row[cols.iArea]||'', row[cols.iCat]||'', row[cols.iTipo]||'', row[cols.iSubTipo]||'',
    row[cols.iMultiArea]||'', estado, '', '', '', '', '',
    row[cols.iPArea1]||'', row[cols.iPPct1]||'', row[cols.iPArea2]||'', row[cols.iPPct2]||'', row[cols.iPArea3]||'', row[cols.iPPct3]||'', '',
    row[cols.iTipoMonto]||''];
}

// Motor de generación: revisa cada plantilla ACTIVA y crea los vencimientos que falten
// (todos los períodos entre el último generado y hoy + margen de anticipación).
// Es idempotente: se puede llamar muchas veces sin duplicar filas.
function generarVencimientos(ss) {
  var shP = getSheetPlantillas(ss);
  var shV = getSheetVencimientos(ss);
  var prows = shP.getDataRange().getValues();
  if (prows.length <= 1) return;
  var ph = prows[0];
  var cols = {
    iId: colIdx(ph,'ID'), iNom: colIdx(ph,'Nombre'), iItem: colIdx(ph,'Item'), iFrec: colIdx(ph,'Frecuencia'),
    iDia: colIdx(ph,'Dia'), iFechaEsp: colIdx(ph,'FechaEsp'), iMonto: colIdx(ph,'MontoEstimado'), iObs: colIdx(ph,'Obs'),
    iArea: colIdx(ph,'Area'), iCat: colIdx(ph,'Categoria'), iTipo: colIdx(ph,'Tipo'), iSubTipo: colIdx(ph,'SubTipo'),
    iMultiArea: colIdx(ph,'MultiArea'), iEst: colIdx(ph,'Estado'), iFC: colIdx(ph,'FechaCreacion'),
    iPArea1: colIdx(ph,'PArea1'), iPPct1: colIdx(ph,'PPct1'), iPArea2: colIdx(ph,'PArea2'), iPPct2: colIdx(ph,'PPct2'),
    iPArea3: colIdx(ph,'PArea3'), iPPct3: colIdx(ph,'PPct3'), iTipoMonto: colIdx(ph,'TipoMonto')
  };

  var vrows = shV.getDataRange().getValues();
  var vh = vrows.length ? vrows[0] : ['ID','PlantillaID','Nombre','Item','PeriodoKey','FechaVencimiento','MontoEstimado','Obs','Area','Categoria','Tipo','SubTipo','MultiArea','Estado','FechaPago','MontoPago','ObsPago','URLComprobante','Notificado','PArea1','PPct1','PArea2','PPct2','PArea3','PPct3','FechaCompra','TipoMonto'];
  var vPlantillaId = colIdx(vh,'PlantillaID'), vFecha = colIdx(vh,'FechaVencimiento');

  var hoyD = new Date(); hoyD.setHours(0,0,0,0);
  var limiteD = new Date(hoyD); limiteD.setDate(limiteD.getDate() + ANTELACION_DIAS);

  var nuevasFilas = [];

  for (var i = 1; i < prows.length; i++) {
    var row = prows[i];
    if (!row[cols.iId]) continue;
    if (String(row[cols.iEst]||'') !== 'ACTIVA') continue;
    var frecuencia = String(row[cols.iFrec]||'');
    var plantillaId = String(row[cols.iId]);
    var existentes = vrows.slice(1).filter(function(v){ return String(v[vPlantillaId]) === plantillaId; });

    if (frecuencia === 'variable') {
      if (existentes.length) continue; // ya se generó su único vencimiento
      var feStr = normalizarFecha(row[cols.iFechaEsp]);
      if (!feStr) continue;
      var feDate = new Date(feStr + 'T00:00:00');
      if (feDate > limiteD) continue; // aún no toca generarlo
      var estadoIni = feDate < hoyD ? 'VENCIDA' : 'PENDIENTE';
      nuevasFilas.push(filaVencimiento(plantillaId, row, cols, feStr, estadoIni));
      shP.getRange(i+1, cols.iEst+1).setValue('ARCHIVADA'); // one-off: se archiva sola al generar su vencimiento
      continue;
    }

    // Recurrentes: continuar desde el último vencimiento generado, o desde FechaCreacion si es la primera vez
    var ultimaFecha = null;
    existentes.forEach(function(v) {
      // normalizarFecha() es indispensable: la celda puede venir como objeto Date de
      // Sheets, y concatenarle 'T00:00:00' daría una fecha inválida, dejando el ancla
      // roto y cortando la generación de los períodos siguientes.
      var fStr = normalizarFecha(v[vFecha]);
      if (!fStr) return;
      var f = new Date(fStr + 'T00:00:00');
      if (isNaN(f.getTime())) return;
      if (!ultimaFecha || f > ultimaFecha) ultimaFecha = f;
    });
    var anchor;
    if (ultimaFecha) {
      anchor = new Date(ultimaFecha.getTime() + 86400000);
    } else {
      var fc = normalizarFecha(row[cols.iFC]);
      anchor = fc ? new Date(fc + 'T00:00:00') : new Date(hoyD);
    }

    var guard = 0;
    var actual = calcularOcurrenciaDesde(frecuencia, row[cols.iDia], anchor);
    while (actual && actual <= limiteD && guard < 36) {
      var estado = actual < hoyD ? 'VENCIDA' : 'PENDIENTE';
      nuevasFilas.push(filaVencimiento(plantillaId, row, cols, fechaISO(actual), estado));
      actual = calcularOcurrenciaDesde(frecuencia, row[cols.iDia], new Date(actual.getTime() + 86400000));
      guard++;
    }
  }

  if (nuevasFilas.length) {
    shV.getRange(shV.getLastRow()+1, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);
  }
}

// Mantiene el Estado consistente con la fecha real, en ambas direcciones:
// PENDIENTE -> VENCIDA cuando la fecha ya pasó, y VENCIDA -> PENDIENTE si la fecha
// quedó en el presente/futuro (ej: se corrigió a mano en el Sheet). PAGADO no se toca.
function actualizarEstadosVencidos(ss) {
  var sh = getSheetVencimientos(ss);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return;
  var h = rows[0];
  var iFecha = colIdx(h,'FechaVencimiento'), iEst = colIdx(h,'Estado');
  var hoyStr = hoyStrGS();
  for (var i = 1; i < rows.length; i++) {
    var estado = String(rows[i][iEst]||'');
    if (estado !== 'PENDIENTE' && estado !== 'VENCIDA') continue;
    var fecha = normalizarFecha(rows[i][iFecha]);
    if (!fecha) continue;
    if (estado === 'PENDIENTE' && fecha < hoyStr) {
      sh.getRange(i+1, iEst+1).setValue('VENCIDA');
    } else if (estado === 'VENCIDA' && fecha >= hoyStr) {
      sh.getRange(i+1, iEst+1).setValue('PENDIENTE');
    }
  }
}

function mapearFilaVencimiento(row, ci) {
  var iId=ci('ID'), iPlantillaId=ci('PlantillaID'), iNom=ci('Nombre'), iItem=ci('Item'), iPeriodo=ci('PeriodoKey'),
      iFecha=ci('FechaVencimiento'), iMonto=ci('MontoEstimado'), iObs=ci('Obs'), iArea=ci('Area'), iCat=ci('Categoria'),
      iTipo=ci('Tipo'), iSubTipo=ci('SubTipo'), iMultiArea=ci('MultiArea'), iEst=ci('Estado'), iFPago=ci('FechaPago'),
      iMPago=ci('MontoPago'), iOPago=ci('ObsPago'), iUrl=ci('URLComprobante'),
      iPArea1=ci('PArea1'), iPPct1=ci('PPct1'), iPArea2=ci('PArea2'), iPPct2=ci('PPct2'), iPArea3=ci('PArea3'), iPPct3=ci('PPct3'),
      iFechaCompra=ci('FechaCompra'), iTipoMonto=ci('TipoMonto');
  return {
    id: String(row[iId]||''),
    plantillaId: String(row[iPlantillaId]||''),
    nombre: String(row[iNom]||''),
    item: String(row[iItem]||''),
    periodoKey: String(row[iPeriodo]||''),
    fecha: normalizarFecha(row[iFecha]),
    montoEstimado: String(row[iMonto]||''),
    obs: String(row[iObs]||''),
    area: String(row[iArea]||''),
    categoria: String(row[iCat]||''),
    tipo: String(row[iTipo]||''),
    subTipo: String(row[iSubTipo]||''),
    multiArea: (function(v){ try{ return v ? JSON.parse(v) : null; }catch(e){ return null; } })(row[iMultiArea]),
    estado: String(row[iEst]||''),
    fechaPago: normalizarFecha(row[iFPago]),
    montoPago: String(row[iMPago]||''),
    obsPago: String(row[iOPago]||''),
    urlComprobante: String(row[iUrl]||''),
    pArea1: String(row[iPArea1]||''), pPct1: String(row[iPPct1]||''),
    pArea2: String(row[iPArea2]||''), pPct2: String(row[iPPct2]||''),
    pArea3: String(row[iPArea3]||''), pPct3: String(row[iPPct3]||''),
    fechaCompra: iFechaCompra>-1 ? String(row[iFechaCompra]||'') : '',
    tipoMonto: iTipoMonto>-1 ? String(row[iTipoMonto]||'') : ''
  };
}

function getVencimientos(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // Self-heal: aunque falle el trigger diario, cada lectura deja todo al día
  actualizarEstadosVencidos(ss);
  generarVencimientos(ss);

  var sh = getSheetVencimientos(ss);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return { vencimientos: [] };
  var h = rows[0];
  function ci(name) { return colIdx(h, name); }

  var corte = new Date(); corte.setDate(corte.getDate() - DIAS_MOSTRAR_PAGADOS);
  var corteStr = fechaISO(corte);

  var vencimientos = rows.slice(1)
    .map(function(row) { return mapearFilaVencimiento(row, ci); })
    .filter(function(v) {
      if (!v.id) return false;
      if (v.estado === 'PAGADO') return v.fechaPago >= corteStr; // ocultar pagados muy antiguos de la vista rápida
      return true;
    });

  return { vencimientos: vencimientos };
}

// Historial completo de vencimientos PAGADOS, sin el recorte de días de getVencimientos.
// data.mes/data.anio opcionales (1-12 / yyyy): si no se envían, devuelve todo el historial.
function getHistorialPagos(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = getSheetVencimientos(ss);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return { historial: [] };
  var h = rows[0];
  function ci(name) { return colIdx(h, name); }

  var filtroMes = data && data.mes ? String(data.mes).padStart(2,'0') : null;
  var filtroAnio = data && data.anio ? String(data.anio) : null;

  var historial = rows.slice(1)
    .map(function(row) { return mapearFilaVencimiento(row, ci); })
    .filter(function(v) {
      if (!v.id || v.estado !== 'PAGADO' || !v.fechaPago) return false;
      if (filtroAnio && v.fechaPago.slice(0,4) !== filtroAnio) return false;
      if (filtroMes && v.fechaPago.slice(5,7) !== filtroMes) return false;
      return true;
    })
    .sort(function(a,b) { return b.fechaPago.localeCompare(a.fechaPago); });

  return { historial: historial };
}

function fechaISOaDDMMYYYY(iso) {
  var p = String(iso).slice(0,10).split('-');
  if (p.length !== 3) return String(iso);
  return p[2] + '-' + p[1] + '-' + p[0];
}

// Crea la(s) fila(s) correspondientes en la hoja principal de Gastos al pagar una
// obligación recurrente o de fecha fija (no ligada a una compra a crédito ya existente).
// Fecha = fecha del vencimiento (devengado) · Fecha Pago = fecha real de pago (caja).
// Si la obligación es PRORRATEADO o tiene multiArea, se generan varias filas (una por área),
// igual que ocurre al registrar una compra desde la pestaña Registrar.
function crearGastosPorPagoVencimiento(ss, v, montoPago, fechaPago, obsPago, fileUrl, tipoMonto) {
  tipoMonto = tipoMonto || 'bruto'; // compatibilidad con pagos antiguos que no mandaban este dato
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Fecha","Hora","Ítem Gasto","Categoría","Tipo","Sub Tipo",
      "Área","Tipo Monto","Monto Neto","Monto Final","Es Harina","Forma Pago","Fecha Pago","Archivo","Observación","URL Foto"]);
    sheet.getRange(1,1,1,16).setFontWeight("bold");
  }

  var fechaDevengado = fechaISOaDDMMYYYY(v.fecha);
  var horaStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
  var obs = obsPago || v.obs || '';
  var montoTotal = parseFloat(montoPago) || 0;

  function filaBase(area, montoIngresado) {
    var neto, bruto;
    if (tipoMonto === 'neto') { neto = montoIngresado; bruto = Math.round(neto * 1.19); }
    else if (tipoMonto === 'siniva') { neto = montoIngresado; bruto = montoIngresado; }
    else { bruto = montoIngresado; neto = Math.round(bruto / 1.19); } // 'bruto'
    return [fechaDevengado, horaStr, v.item||'', v.categoria||'', v.tipo||'', v.subTipo||'',
      area, tipoMonto, neto, bruto, 'No', 'contado', fechaPago, '', obs, fileUrl||''];
  }

  var filas = [];
  if (v.area === 'PRORRATEADO' && v.pArea1 && v.pPct1) {
    var p1 = parseFloat(v.pPct1)||0, p2 = parseFloat(v.pPct2)||0, p3 = parseFloat(v.pPct3)||0;
    filas.push(filaBase(v.pArea1, Math.round(montoTotal*p1/100)));
    if (v.pArea2 && p2) filas.push(filaBase(v.pArea2, Math.round(montoTotal*p2/100)));
    if (v.pArea3 && p3) filas.push(filaBase(v.pArea3, Math.round(montoTotal*p3/100)));
  } else if (v.multiArea && v.multiArea.length) {
    v.multiArea.forEach(function(a) {
      filas.push(filaBase(a.area, parseFloat(a.monto)||0));
    });
  } else {
    filas.push(filaBase(v.area||'', montoTotal));
  }

  filas.forEach(function(f) { sheet.appendRow(f); });
}

function registrarPagoVencimiento(ss, data) {
  var sh = getSheetVencimientos(ss);
  var rows = sh.getDataRange().getValues();
  var h = rows[0];
  function ci(name) { return colIdx(h, name); }
  var iId=ci('ID'), iEst=ci('Estado'), iFPago=ci('FechaPago'), iMPago=ci('MontoPago'),
      iOPago=ci('ObsPago'), iUrl=ci('URLComprobante'), iItem=ci('Item'), iPlantillaId=ci('PlantillaID'),
      iMultiArea=ci('MultiArea');

  var fileUrl = '';
  if (data.imageData) {
    var folder = getOrCreateFolder('Comprobantes Pagos');
    var blob = Utilities.newBlob(Utilities.base64Decode(data.imageData), data.mimeType || 'image/jpeg', data.fileName || 'comprobante.jpg');
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    fileUrl = file.getUrl();
  }

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][iId]) === String(data.id)) {
      var v = mapearFilaVencimiento(rows[i], ci);

      // Si en el pago se editó la distribución por área, esos son los montos REALES
      // de este período — se guardan en el vencimiento y se usan para crear los gastos.
      if (data.multiArea && data.multiArea.length) {
        sh.getRange(i+1, iMultiArea+1).setValue(JSON.stringify(data.multiArea));
        v.multiArea = data.multiArea;
      }

      sh.getRange(i+1, iEst+1).setValue('PAGADO');
      sh.getRange(i+1, iFPago+1).setValue(data.fechaPago||'');
      sh.getRange(i+1, iMPago+1).setValue(data.montoPago||'');
      sh.getRange(i+1, iOPago+1).setValue(data.obsPago||'');
      if (fileUrl) sh.getRange(i+1, iUrl+1).setValue(fileUrl);

      if (v.plantillaId) {
        // Obligación recurrente o de fecha fija creada manualmente: el pago se
        // registra recién ahora como gasto nuevo (antes no existía en Gastos).
        if (data.fechaPago) {
          crearGastosPorPagoVencimiento(ss, v, data.montoPago, data.fechaPago, data.obsPago, fileUrl, data.tipoMonto);
        }
      } else if (data.fechaPago) {
        // Vencimiento nacido de una compra a crédito: el gasto YA existe (se creó al
        // comprar), solo hay que completarle la fecha de pago y el comprobante.
        // Si la factura se dividió en varias áreas, hay VARIAS filas en la hoja principal
        // para la misma compra — hay que actualizarlas todas, no solo la primera.
        var nombreItem = String(rows[i][iItem]||'');
        var shMain = ss.getSheets()[0];
        var mainRows = shMain.getDataRange().getValues();
        var mainHeaders = mainRows[0];
        var mIItem=-1, mIFormaPago=-1, mIFechaPago=-1, mIUrlFoto=-1, mIFecha=-1;
        for (var hh = 0; hh < mainHeaders.length; hh++) {
          var norm = String(mainHeaders[hh]).toLowerCase().replace(/[^a-z]/g,'');
          if (norm === 'itemgasto' || norm === 'tem') mIItem = hh;
          if (norm === 'formapago') mIFormaPago = hh;
          if (norm === 'fechapago') mIFechaPago = hh;
          if (norm === 'urlfoto') mIUrlFoto = hh;
          if (norm === 'fecha') mIFecha = hh;
        }
        if (mIItem > -1 && mIFechaPago > -1 && nombreItem) {
          for (var j = 1; j < mainRows.length; j++) {
            var itemMatch = String(mainRows[j][mIItem]).toLowerCase() === nombreItem.toLowerCase();
            var sinFechaPago = !mainRows[j][mIFechaPago];
            var esCredito = mIFormaPago > -1 && (String(mainRows[j][mIFormaPago]) === 'proveedor' || String(mainRows[j][mIFormaPago]) === 'tarjeta');
            // Si el vencimiento guarda la fecha de compra (facturas nuevas), se exige que
            // coincida exacto para no mezclar compras distintas del mismo ítem.
            var fechaCompraMatch = v.fechaCompra ? (mIFecha > -1 && String(mainRows[j][mIFecha]) === v.fechaCompra) : true;
            if (itemMatch && sinFechaPago && esCredito && fechaCompraMatch) {
              shMain.getRange(j+1, mIFechaPago+1).setValue(data.fechaPago);
              if (fileUrl && mIUrlFoto > -1) shMain.getRange(j+1, mIUrlFoto+1).setValue(fileUrl);
              // Sin fecha de compra guardada (vencimientos creados antes de este arreglo):
              // por seguridad se actualiza solo la primera coincidencia, como antes.
              if (!v.fechaCompra) break;
            }
          }
        }
      }

      // Generar de inmediato el siguiente vencimiento si corresponde — no esperar al trigger diario
      generarVencimientos(ss);
      return { ok: true };
    }
  }
  return { error: 'No encontrado' };
}

function eliminarVencimiento(ss, data) {
  var sh = getSheetVencimientos(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sh.deleteRow(i+1);
      return { ok: true };
    }
  }
  return { error: 'No encontrado' };
}

// Envía avisos por correo: 3 días antes, el día del vencimiento, y todos los días
// mientras siga vencida sin pagar. Usa la columna "Notificado" para no enviar
// más de un correo por día para el mismo vencimiento.
function enviarNotificacionesVencimientos(ss) {
  var sh = getSheetVencimientos(ss);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return;
  var h = rows[0];
  var iId=colIdx(h,'ID'), iNom=colIdx(h,'Nombre'), iFecha=colIdx(h,'FechaVencimiento'), iMonto=colIdx(h,'MontoEstimado'),
      iEst=colIdx(h,'Estado'), iNotif=colIdx(h,'Notificado'), iObs=colIdx(h,'Obs');

  var hoyStr = hoyStrGS();
  var hoyD = new Date(); hoyD.setHours(0,0,0,0);

  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][iId]) continue;
    var estado = String(rows[i][iEst]||'');
    if (estado === 'PAGADO') continue;
    if (String(rows[i][iNotif]||'') === hoyStr) continue; // ya se envió un correo hoy para este vencimiento

    var fecha = normalizarFecha(rows[i][iFecha]);
    if (!fecha) continue;
    var fechaD = new Date(fecha + 'T00:00:00');
    var diffDias = Math.round((fechaD - hoyD) / 86400000);

    var nombre = String(rows[i][iNom]||'');
    var montoRaw = rows[i][iMonto];
    var monto = montoRaw && !isNaN(parseInt(montoRaw)) ? '$' + parseInt(montoRaw).toLocaleString('es-CL') : 'monto no definido';
    var obs = String(rows[i][iObs]||'');
    var obsLinea = obs ? '\n\nObservación: ' + obs : '';

    var asunto = null, cuerpo = null;
    if (diffDias === 3) {
      asunto = '⏰ Aviso: "' + nombre + '" vence en 3 días';
      cuerpo = 'La obligación "' + nombre + '" vence el ' + fecha + ' (' + monto + ').\n\nAún tienes tiempo para programar el pago.' + obsLinea;
    } else if (diffDias === 0) {
      asunto = '🔴 Último día para pagar: "' + nombre + '"';
      cuerpo = 'Hoy vence la obligación "' + nombre + '" (' + monto + ').\n\nEs el último día para pagarla sin que quede vencida.' + obsLinea;
    } else if (diffDias < 0) {
      var diasVencida = Math.abs(diffDias);
      asunto = '🔴 VENCIDA hace ' + diasVencida + ' día' + (diasVencida === 1 ? '' : 's') + ': "' + nombre + '"';
      cuerpo = 'La obligación "' + nombre + '" está vencida desde el ' + fecha + ' (' + monto + ') y aún no se regulariza.\n\nEste aviso se repetirá todos los días hasta que se registre el pago en la app.' + obsLinea;
    }

    if (asunto) {
      for (var c = 0; c < CORREOS_AVISO.length; c++) {
        MailApp.sendEmail(CORREOS_AVISO[c], asunto, cuerpo);
      }
      sh.getRange(i+1, iNotif+1).setValue(hoyStr);
    }
  }
}

// ════════════════════════════════════════════════
// TRIGGER DIARIO
// ════════════════════════════════════════════════
function tareaDiariaObligaciones() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  actualizarEstadosVencidos(ss);
  generarVencimientos(ss);
  enviarNotificacionesVencimientos(ss);
}

// Ejecutar UNA VEZ manualmente desde el editor de Apps Script (▶ Ejecutar) para instalar el trigger.
// Si se vuelve a ejecutar, reemplaza el trigger anterior en vez de duplicarlo.
function instalarTriggerDiario() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'tareaDiariaObligaciones') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('tareaDiariaObligaciones')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  Logger.log('Trigger diario instalado: "tareaDiariaObligaciones" correrá todos los días alrededor de las 6am.');
}

// ════════════════════════════════════════════════
// MIGRACIÓN DE DATOS LEGADO (ejecutar UNA VEZ manualmente desde el editor)
// ════════════════════════════════════════════════
function migrarDatosLegado() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var shVieja = ss.getSheetByName('Obligaciones');
  if (!shVieja) { Logger.log('No hay hoja "Obligaciones" para migrar.'); return; }

  var rows = shVieja.getDataRange().getValues();
  var headers = rows[0];

  if (colIdx(headers,'UltimoPago') === -1) {
    Logger.log('La hoja "Obligaciones" no tiene el esquema legado esperado (falta columna UltimoPago). Migración cancelada por seguridad — probablemente ya fue migrada.');
    return;
  }
  if (ss.getSheetByName('Vencimientos') || ss.getSheetByName('Obligaciones (legado)')) {
    Logger.log('Ya existen hojas nuevas ("Vencimientos" y/o "Obligaciones (legado)"). Para evitar duplicar datos, esta función no se ejecuta de nuevo. Si necesitas re-migrar, elimina esas hojas manualmente primero.');
    return;
  }

  // 1. Respaldar hoja vieja renombrándola
  shVieja.setName('Obligaciones (legado)');

  // 2. Crear hojas nuevas
  var shP = getSheetPlantillas(ss);
  var shV = getSheetVencimientos(ss);

  var iId=colIdx(headers,'ID'), iNom=colIdx(headers,'Nombre'), iItem=colIdx(headers,'Item'), iFrec=colIdx(headers,'Frecuencia'),
      iDia=colIdx(headers,'Dia'), iFechaEsp=colIdx(headers,'FechaEsp'), iMonto=colIdx(headers,'MontoEstimado'),
      iObs=colIdx(headers,'Obs'), iArea=colIdx(headers,'Area'), iCat=colIdx(headers,'Categoria'), iTipo=colIdx(headers,'Tipo'),
      iSubTipo=colIdx(headers,'SubTipo'), iPArea1=colIdx(headers,'PArea1'), iPPct1=colIdx(headers,'PPct1'),
      iPArea2=colIdx(headers,'PArea2'), iPPct2=colIdx(headers,'PPct2'), iPArea3=colIdx(headers,'PArea3'), iPPct3=colIdx(headers,'PPct3'),
      iMultiArea=colIdx(headers,'MultiArea'), iEst=colIdx(headers,'Estado'),
      iUltPago=colIdx(headers,'UltimoPago'), iMontoUlt=colIdx(headers,'MontoUltimoPago'), iObsUlt=colIdx(headers,'ObsUltimoPago'),
      iUrl=colIdx(headers,'URLComprobante');

  var hoyStr = hoyStrGS();
  var hoyD = new Date(); hoyD.setHours(0,0,0,0);
  var nPlantillas = 0, nVencimientos = 0, nOmitidas = 0;

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[iId]) continue;
    var frecuencia = String(row[iFrec]||'');

    // Limpieza de valores corruptos detectados en el análisis previo a la migración
    var montoLimpio = row[iMonto];
    if (String(montoLimpio).trim().toUpperCase() === 'PENDIENTE') montoLimpio = '';
    var multiAreaLimpio = row[iMultiArea];
    try {
      if (multiAreaLimpio) {
        var parsed = JSON.parse(multiAreaLimpio);
        var sospechoso = parsed.some(function(a){ return parseFloat(a.monto) <= 10; });
        if (sospechoso) multiAreaLimpio = '';
      }
    } catch(e) {}

    if (frecuencia === 'variable') {
      var fechaVenc = normalizarFecha(row[iFechaEsp]);
      if (!fechaVenc) { nOmitidas++; continue; }
      var estadoV = String(row[iEst]||'') === 'PAGADO' ? 'PAGADO' : 'PENDIENTE';
      if (estadoV === 'PENDIENTE') {
        var fD = new Date(fechaVenc + 'T00:00:00');
        if (fD < hoyD) estadoV = 'VENCIDA';
      }
      var vId = Utilities.getUuid();
      shV.appendRow([vId, '', row[iNom]||'', row[iItem]||'', fechaVenc.slice(0,7), fechaVenc, montoLimpio,
        row[iObs]||'', row[iArea]||'', row[iCat]||'', row[iTipo]||'', row[iSubTipo]||'', multiAreaLimpio,
        estadoV, normalizarFecha(row[iUltPago]), row[iMontoUlt]||'', row[iObsUlt]||'', row[iUrl]||'', '', '', '', '', '', '', '', '', '']);
      nVencimientos++;
    } else if (frecuencia) {
      var pId = 'P' + Date.now() + '_' + i;
      shP.appendRow([pId, row[iNom]||'', row[iItem]||'', frecuencia, row[iDia]||'', '', montoLimpio,
        row[iObs]||'', row[iArea]||'', row[iCat]||'', row[iTipo]||'', row[iSubTipo]||'',
        row[iPArea1]||'', row[iPPct1]||'', row[iPArea2]||'', row[iPPct2]||'', row[iPArea3]||'', row[iPPct3]||'',
        multiAreaLimpio, 'ACTIVA', hoyStr]);
      nPlantillas++;
    } else {
      nOmitidas++;
    }
  }

  // 3. Generar el primer vencimiento de cada plantilla recién creada
  generarVencimientos(ss);

  Logger.log('Migración completa: ' + nPlantillas + ' plantillas creadas, ' + nVencimientos + ' vencimientos de crédito migrados, ' + nOmitidas + ' filas omitidas (sin frecuencia/fecha válida). Revisa las hojas "Obligaciones", "Vencimientos" y "Obligaciones (legado)".');
}

// ════════════════════════════════════════════════
// VINCULAR FOTO MANUALMENTE (para vencimientos de crédito antiguos, creados antes
// de que se guardara la FechaCompra — no se pueden emparejar automáticamente).
// Ejecutar UNA VEZ manualmente desde el editor, con los datos completados abajo.
// ════════════════════════════════════════════════
function vincularFotosManualmente() {
  // Completa cada par:
  //  - vencimientoId: columna A ("ID") en la hoja "Vencimientos"
  //  - filaGasto: el número de fila (el número gris de la izquierda en Sheets) de esa
  //    factura en la hoja "Registro Gasto" — si la factura tiene varias filas (varias
  //    áreas), usa cualquiera de ellas, todas comparten la misma foto.
  var PARES = [
    { vencimientoId: '082a8a56-8981-48b2-a338-abc749ce8931', filaGasto: 118 }, // Cunaco F. 342232 — $896.302
    { vencimientoId: '3ae26b2d-2e8a-4eab-b4aa-1aa3f75fcd22', filaGasto: 29 },  // Harina PAN+BOL — $394.965
    { vencimientoId: 'beb51817-ee52-4ca5-822e-449da3687947', filaGasto: 26 }   // Harina PAN+BOL — $928.004
  ];

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var shV = getSheetVencimientos(ss);
  var vrows = shV.getDataRange().getValues();
  var vh = vrows[0];
  var vIId = colIdx(vh,'ID'), vIUrl = colIdx(vh,'URLComprobante');

  var shMain = ss.getSheets()[0];
  var mh = shMain.getDataRange().getValues()[0];
  var mIUrl = colIdx(mh,'URL Foto');

  PARES.forEach(function(par) {
    if (!par.filaGasto) { Logger.log('Falta completar filaGasto para ' + par.vencimientoId); return; }
    var urlFoto = shMain.getRange(par.filaGasto, mIUrl+1).getValue();
    if (!urlFoto) { Logger.log('La fila ' + par.filaGasto + ' de Registro Gasto no tiene URL Foto.'); return; }
    var encontrado = false;
    for (var i = 1; i < vrows.length; i++) {
      if (String(vrows[i][vIId]) === par.vencimientoId) {
        shV.getRange(i+1, vIUrl+1).setValue(urlFoto);
        Logger.log('✅ Vinculado: ' + par.vencimientoId + ' -> ' + urlFoto);
        encontrado = true;
        break;
      }
    }
    if (!encontrado) Logger.log('⚠️ No se encontró ningún vencimiento con ID ' + par.vencimientoId);
  });
}


// ════════════════════════════════════════════════
// CARGA MASIVA DESDE EL REGISTRO DE COMPRAS DEL SII
// ════════════════════════════════════════════════

// Asegura que la hoja de gastos tenga las columnas de proveedor (se agregan al final,
// quedan vacías en los registros manuales y llenas en los importados).
function asegurarColumnasProveedor(sheet) {
  var headers = sheet.getDataRange().getValues()[0] || [];
  var iRut = colIdx(headers, 'RUT Proveedor');
  var iRazon = colIdx(headers, 'Razon Social');
  if (iRut === -1) {
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('RUT Proveedor').setFontWeight('bold');
    iRut = col - 1;
  }
  if (iRazon === -1) {
    var col2 = sheet.getLastColumn() + 1;
    sheet.getRange(1, col2).setValue('Razon Social').setFontWeight('bold');
    iRazon = col2 - 1;
  }
  return { iRut: iRut, iRazon: iRazon };
}

// Devuelve las claves "RUT|FOLIO" ya presentes en la hoja, para no importar dos veces
// el mismo documento aunque se vuelva a subir el archivo del mes completo.
// Claves "RUT|FOLIO" ya presentes en el sistema. Revisa TANTO Registro Gasto como
// Detalle Compras: si se borró el gasto pero quedó el detalle (o viceversa), el
// documento igual cuenta como ya importado y no debe duplicarse.
function clavesImportadas(ss) {
  var claves = {};

  var sheet = ss.getSheets()[0];
  var cols = asegurarColumnasProveedor(sheet);
  var rows = sheet.getDataRange().getValues();
  if (rows.length > 1) {
    var headers = rows[0];
    var iObs = colIdx(headers, 'Observación');
    if (iObs === -1) iObs = colIdx(headers, 'Observacion');
    for (var i = 1; i < rows.length; i++) {
      var rut = String(rows[i][cols.iRut] || '').trim();
      if (!rut) continue;
      // El folio se guarda en la observación con el prefijo "F." al importar
      var m = String(rows[i][iObs] || '').match(/F\.(\d+)/);
      if (m) claves[rut + '|' + m[1]] = true;
    }
  }

  var shD = ss.getSheetByName('Detalle Compras');
  if (shD && shD.getLastRow() > 1) {
    var drows = shD.getDataRange().getValues();
    var dh = drows[0];
    var dRut = colIdx(dh, 'RUT Proveedor'), dFolio = colIdx(dh, 'Folio');
    for (var j = 1; j < drows.length; j++) {
      var r2 = String(drows[j][dRut] || '').trim();
      var f2 = String(drows[j][dFolio] || '').trim();
      if (r2 && f2) claves[r2 + '|' + f2] = true;
    }
  }

  return claves;
}

function getFoliosImportados(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return { folios: Object.keys(clavesImportadas(ss)), notasDocs: mapaNotasDocs(ss) };
}

// Hoja aparte con el detalle de productos de cada documento. No se mezcla con Registro
// Gasto (que mantiene una fila por ítem/área) — acá vive el dato fino para costeo.
var COLS_DETALLE = ['Fecha','RUT Proveedor','Razon Social','Folio','Descripcion','Codigo',
                    'Unidad','Cantidad','Precio Unitario','Precio Lista','Descuento',
                    'Monto Neto','Item Gasto','Area'];

function getSheetDetalleCompras(ss) {
  var sh = ss.getSheetByName('Detalle Compras');
  if (!sh) {
    sh = ss.insertSheet('Detalle Compras');
    sh.appendRow(COLS_DETALLE);
    sh.getRange(1,1,1,COLS_DETALLE.length).setFontWeight('bold');
    return sh;
  }
  // La hoja pudo crearse antes de que existieran Area, Unidad, Precio Lista o Descuento:
  // se agregan las que falten al final, sin mover las que ya tienen datos.
  var headers = sh.getDataRange().getValues()[0] || [];
  COLS_DETALLE.forEach(function(nombre) {
    if (colIdx(headers, nombre) === -1) {
      headers.push(nombre);
      sh.getRange(1, headers.length).setValue(nombre).setFontWeight('bold');
    }
  });
  return sh;
}

function importarSII(ss, data) {
  var sheet = ss.getSheets()[0];
  var cols = asegurarColumnasProveedor(sheet);
  var headers = sheet.getDataRange().getValues()[0];
  var totalCols = headers.length;

  var facturas = data.facturas || [];
  if (!facturas.length) return { error: 'No hay facturas para importar' };

  // Guardia contra duplicados: se revisa JUSTO ANTES de escribir, no al cargar el
  // archivo. Así se atrapa el caso de reintentar tras un error de red donde el
  // guardado sí había alcanzado a completarse.
  var yaExisten = clavesImportadas(ss);
  var repetidas = facturas.filter(function(f) {
    return yaExisten[String(f.rut).trim() + '|' + String(f.folio).trim()];
  });
  if (repetidas.length && !data.omitirRepetidas) {
    return {
      duplicados: repetidas.map(function(f) {
        return { rut: f.rut, folio: f.folio, razonSocial: f.razonSocial, total: f.total };
      }),
      nuevas: facturas.length - repetidas.length
    };
  }
  if (data.omitirRepetidas) {
    facturas = facturas.filter(function(f) {
      return !yaExisten[String(f.rut).trim() + '|' + String(f.folio).trim()];
    });
    if (!facturas.length) return { error: 'Todas las facturas ya estaban importadas' };
  }

  var iObs = colIdx(headers, 'Observación');
  if (iObs === -1) iObs = colIdx(headers, 'Observacion');

  var filas = [];
  var horaStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
  var nVencimientos = 0;

  facturas.forEach(function(f) {
    var obsBase = 'F.' + f.folio;
    if (f.obs) obsBase += ' ' + f.obs;

    (f.lineas || []).forEach(function(ln) {
      (ln.areas || []).forEach(function(a) {
        // Los montos llegan ya resueltos desde el frontend (bruto por área).
        // El neto se prorratea respetando la proporción real del documento del SII,
        // para que el IVA cuadre exactamente con lo declarado y no por un cálculo propio.
        var bruto = Math.round(a.monto);
        var proporcion = f.total ? (bruto / f.total) : 0;
        var neto = Math.round(f.neto * proporcion);

        var fila = [];
        for (var c = 0; c < totalCols; c++) fila[c] = '';
        fila[colIdx(headers,'Fecha')] = f.fechaDocto;        // dd-mm-yyyy (devengado)
        fila[colIdx(headers,'Hora')] = horaStr;
        fila[colIdx(headers,'Ítem Gasto') > -1 ? colIdx(headers,'Ítem Gasto') : colIdx(headers,'Item Gasto')] = ln.item || '';
        fila[colIdx(headers,'Categoría') > -1 ? colIdx(headers,'Categoría') : colIdx(headers,'Categoria')] = ln.categoria || '';
        fila[colIdx(headers,'Tipo')] = ln.tipo || '';
        fila[colIdx(headers,'Sub Tipo')] = ln.subTipo || '';
        fila[colIdx(headers,'Área') > -1 ? colIdx(headers,'Área') : colIdx(headers,'Area')] = a.area;
        fila[colIdx(headers,'Tipo Monto')] = 'bruto';
        fila[colIdx(headers,'Monto Neto')] = neto;
        fila[colIdx(headers,'Monto Final')] = bruto;
        fila[colIdx(headers,'Es Harina')] = f.esHarina ? 'Sí' : 'No';
        fila[colIdx(headers,'Forma Pago')] = f.estado === 'pagada' ? 'contado' : 'proveedor';
        fila[colIdx(headers,'Fecha Pago')] = f.estado === 'pagada' ? f.fechaEstado : '';
        fila[iObs] = obsBase;
        fila[cols.iRut] = f.rut;
        fila[cols.iRazon] = f.razonSocial;
        filas.push(fila);
      });
    });

    // Pendiente de pago → se crea su obligación en Vencimientos, igual que una compra a crédito
    if (f.estado === 'pendiente' && f.fechaEstado) {
      var shV = getSheetVencimientos(ss);
      var todasAreas = [];
      (f.lineas || []).forEach(function(ln) {
        (ln.areas || []).forEach(function(a) { todasAreas.push({ area: a.area, monto: Math.round(a.monto) }); });
      });
      var nombreItems = (f.lineas || []).map(function(l){ return l.item; }).filter(String).join(' + ');
      var areaVenc = todasAreas.length === 1 ? todasAreas[0].area : 'MULTI';
      var multiAreaStr = todasAreas.length > 1 ? JSON.stringify(todasAreas) : '';
      var primera = (f.lineas || [])[0] || {};
      shV.appendRow([Utilities.getUuid(), '', '📋 ' + f.razonSocial + ' F.' + f.folio,
        primera.item || '', f.fechaEstado.slice(0,7), f.fechaEstado, Math.round(f.total), obsBase,
        areaVenc, primera.categoria || '', primera.tipo || '', primera.subTipo || '', multiAreaStr,
        'PENDIENTE', '', '', '', '', '', '', '', '', '', '', '', f.fechaDocto, '']);
      nVencimientos++;
    }
  });

  if (filas.length) {
    sheet.insertRowsAfter(1, filas.length);
    sheet.getRange(2, 1, filas.length, totalCols).setValues(filas);
    var iNeto = colIdx(headers,'Monto Neto'), iFinal = colIdx(headers,'Monto Final');
    sheet.getRange(2, iNeto+1, filas.length, 2).setNumberFormat(FORMATO_PESO);
  }

  // Detalle de productos (solo cuando el documento lo trae): va a su propia hoja
  var shD = getSheetDetalleCompras(ss);
  var hD = shD.getDataRange().getValues()[0] || [];
  // Se arma cada fila leyendo los encabezados reales de la hoja: así da lo mismo en qué
  // orden quedaron las columnas o cuáles se agregaron después.
  function filaDetalle(f, d) {
    var valores = {
      'Fecha': f.fechaDocto, 'RUT Proveedor': f.rut, 'Razon Social': f.razonSocial,
      'Folio': f.folio, 'Descripcion': d.descripcion || '', 'Codigo': d.codigo || '',
      'Unidad': d.unidad || '', 'Cantidad': d.cantidad || '',
      'Precio Unitario': d.precioUnitario || '', 'Precio Lista': d.precioLista || '',
      'Descuento': d.descuento || '', 'Monto Neto': d.monto || 0,
      'Item Gasto': d.item || '', 'Area': d.area || ''
    };
    var fila = [];
    for (var c = 0; c < hD.length; c++) {
      var nombre = String(hD[c]).trim();
      fila.push(valores.hasOwnProperty(nombre) ? valores[nombre] : '');
    }
    return fila;
  }

  var filasDetalle = [];
  facturas.forEach(function(f) {
    (f.detalle || []).forEach(function(d) { filasDetalle.push(filaDetalle(f, d)); });
  });
  if (filasDetalle.length) {
    shD.getRange(shD.getLastRow()+1, 1, filasDetalle.length, hD.length).setValues(filasDetalle);
  }

  return { ok: true, filas: filas.length, vencimientos: nVencimientos, detalle: filasDetalle.length };
}

// Devuelve las líneas de producto de un documento concreto (para verlas desde la app)
function getDetalleDocumento(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('Detalle Compras');
  if (!sh) return { detalle: [] };
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return { detalle: [] };
  var h = rows[0];
  var iRut = colIdx(h,'RUT Proveedor'), iFolio = colIdx(h,'Folio'), iDesc = colIdx(h,'Descripcion'),
      iCant = colIdx(h,'Cantidad'), iPrecio = colIdx(h,'Precio Unitario'), iMonto = colIdx(h,'Monto Neto'),
      iItem = colIdx(h,'Item Gasto'), iArea = colIdx(h,'Area'), iRazon = colIdx(h,'Razon Social'),
      iFecha = colIdx(h,'Fecha'), iUnidad = colIdx(h,'Unidad'),
      iLista = colIdx(h,'Precio Lista'), iDesc2 = colIdx(h,'Descuento');

  var rutBuscado = String(data.rut||'').trim();
  var folioBuscado = String(data.folio||'').trim();
  var detalle = [], razonSocial = '', fecha = '';

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][iRut]).trim() !== rutBuscado) continue;
    if (String(rows[i][iFolio]).trim() !== folioBuscado) continue;
    razonSocial = String(rows[i][iRazon]||'');
    fecha = String(rows[i][iFecha]||'');
    detalle.push({
      descripcion: String(rows[i][iDesc]||''),
      unidad: iUnidad > -1 ? String(rows[i][iUnidad]||'') : '',
      cantidad: rows[i][iCant] || '',
      precioUnitario: rows[i][iPrecio] || '',
      precioLista: iLista > -1 ? (rows[i][iLista] || '') : '',
      descuento: iDesc2 > -1 ? (rows[i][iDesc2] || '') : '',
      monto: rows[i][iMonto] || 0,
      item: String(rows[i][iItem]||''),
      area: iArea > -1 ? String(rows[i][iArea]||'') : ''
    });
  }
  return { detalle: detalle, razonSocial: razonSocial, fecha: fecha, folio: folioBuscado };
}

// ════════════════════════════════════════════════
// HISTORIAL DE CARGAS SII
// ════════════════════════════════════════════════
function getSheetCargasSII(ss) {
  var sh = ss.getSheetByName('Cargas SII');
  if (!sh) {
    sh = ss.insertSheet('Cargas SII');
    sh.appendRow(['ID','FechaCarga','PeriodoDesde','PeriodoHasta','NombreArchivo','URLArchivo','TotalDocs','Documentos','Nota']);
    sh.getRange(1,1,1,9).setFontWeight('bold');
  } else {
    // La hoja pudo crearse antes de que existiera la columna Nota: se agrega si falta.
    var headers = sh.getDataRange().getValues()[0] || [];
    if (colIdx(headers, 'Nota') === -1) {
      sh.getRange(1, headers.length + 1).setValue('Nota').setFontWeight('bold');
    }
  }
  return sh;
}

// Registra el archivo cargado: guarda una copia en Drive y deja constancia de qué
// documentos venía conteniendo, para poder seguir el avance por período.
function registrarCargaSII(ss, data) {
  var sh = getSheetCargasSII(ss);
  var docs = data.documentos || [];
  if (!docs.length) return { error: 'Sin documentos' };

  // El período se deduce de las fechas de emisión: el archivo del SII no lo indica
  var fechas = docs.map(function(d){ return d.fecha; }).filter(String).sort();
  var desde = fechas.length ? fechas[0] : '';
  var hasta = fechas.length ? fechas[fechas.length-1] : '';

  var url = '';
  if (data.archivoBase64 && data.nombreArchivo) {
    try {
      var folder = getOrCreateFolder('Cargas SII');
      var blob = Utilities.newBlob(Utilities.base64Decode(data.archivoBase64), data.mimeType || 'text/plain', data.nombreArchivo);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      url = file.getUrl();
    } catch(e) { /* si falla la subida, igual se registra la carga */ }
  }

  // Si ya se registró este mismo archivo (mismo período y cantidad), se actualiza en
  // vez de duplicar la fila del historial.
  var rows = sh.getDataRange().getValues();
  var claveDocs = JSON.stringify(docs.map(function(d){
    return { k: d.rut + '|' + d.folio, n: d.razonSocial || '' };
  }).sort(function(a,b){ return a.k.localeCompare(b.k); }));
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][7]) === claveDocs) {
      if (url) sh.getRange(i+1, 6).setValue(url);
      return { ok: true, actualizada: true };
    }
  }

  sh.appendRow([Utilities.getUuid(), hoyStrGS(), desde, hasta,
    data.nombreArchivo || '', url, docs.length, claveDocs]);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  MANTENCIÓN DE "DETALLE COMPRAS" — se corren a mano desde el editor, una vez
// ═══════════════════════════════════════════════════════════════════════════

// Repara el corrimiento de columnas: cuando se escribía por posición, los valores
// podían caer en una columna sin encabezado mientras la columna con nombre quedaba
// vacía. Mueve esos valores a la columna correcta y elimina la columna sin nombre.
// Solo mueve cuando el destino está vacío: nunca pisa un dato existente.
function repararDetalleCompras() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('Detalle Compras');
  if (!sh) { Logger.log('No existe la hoja Detalle Compras'); return; }
  var rango = sh.getDataRange();
  var datos = rango.getValues();
  if (datos.length < 2) { Logger.log('La hoja no tiene datos'); return; }

  var headers = datos[0];
  var sinNombre = [];
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).trim() === '') sinNombre.push(c);
  }
  if (!sinNombre.length) { Logger.log('No hay columnas sin encabezado: nada que reparar'); return; }
  Logger.log('Columnas sin encabezado: ' + sinNombre.map(function(i){ return i+1; }).join(', '));

  // El destino es la primera columna CON nombre que esté a la derecha de la huérfana.
  var movidos = 0, conflictos = 0;
  sinNombre.forEach(function(colVacia) {
    var destino = -1;
    for (var c = colVacia + 1; c < headers.length; c++) {
      if (String(headers[c]).trim() !== '') { destino = c; break; }
    }
    if (destino === -1) return;
    for (var f = 1; f < datos.length; f++) {
      var valor = String(datos[f][colVacia] || '').trim();
      if (!valor) continue;
      if (String(datos[f][destino] || '').trim() === '') { datos[f][destino] = valor; movidos++; }
      else conflictos++;
    }
  });

  rango.setValues(datos);
  Logger.log('Valores movidos: ' + movidos + ' · sin mover por tener destino ocupado: ' + conflictos);

  // Seguro: solo se elimina la columna huérfana si TODO su contenido se pudo mover.
  // Si quedó algo sin mover (porque el destino ya tenía dato), la columna se conserva
  // para que puedas mirarla: borrarla ahí sería perder información en silencio.
  if (conflictos > 0) {
    Logger.log('NO se eliminaron las columnas sin encabezado: hay ' + conflictos +
               ' valor(es) que no se pudieron mover. Revísalos a mano y vuelve a correr.');
    return;
  }
  // Se borran de derecha a izquierda para que los índices no se corran al eliminar.
  sinNombre.slice().reverse().forEach(function(c){ sh.deleteColumn(c + 1); });
  Logger.log('Columnas sin encabezado eliminadas: ' + sinNombre.length);
}

// Solo INFORMA qué documentos tienen líneas de detalle repetidas. No borra nada.
function revisarDuplicadosDetalle() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('Detalle Compras');
  if (!sh || sh.getLastRow() < 2) { Logger.log('Sin datos'); return; }
  var rows = sh.getDataRange().getValues();
  var h = rows[0];
  var iRut = colIdx(h,'RUT Proveedor'), iFolio = colIdx(h,'Folio'),
      iDesc = colIdx(h,'Descripcion'), iMonto = colIdx(h,'Monto Neto');

  var vistos = {}, repetidos = {};
  for (var i = 1; i < rows.length; i++) {
    var doc = String(rows[i][iRut]).trim() + '|' + String(rows[i][iFolio]).trim();
    var linea = doc + '|' + String(rows[i][iDesc]).trim() + '|' + String(rows[i][iMonto]).trim();
    if (vistos[linea]) { repetidos[doc] = (repetidos[doc] || 0) + 1; }
    else vistos[linea] = true;
  }
  var claves = Object.keys(repetidos);
  if (!claves.length) { Logger.log('No hay líneas repetidas'); return; }
  Logger.log('Documentos con líneas repetidas (' + claves.length + '):');
  claves.forEach(function(k){ Logger.log('   ' + k + '  →  ' + repetidos[k] + ' línea(s) de más'); });
  Logger.log('Total de filas que se eliminarían: ' +
    claves.reduce(function(a,k){ return a + repetidos[k]; }, 0));
  Logger.log('Si estás de acuerdo, corre eliminarDuplicadosDetalle().');
}

// Elimina las líneas de detalle exactamente repetidas, dejando la primera de cada una.
// Correr primero revisarDuplicadosDetalle() para ver qué se va a borrar.
function eliminarDuplicadosDetalle() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('Detalle Compras');
  if (!sh || sh.getLastRow() < 2) { Logger.log('Sin datos'); return; }
  var rows = sh.getDataRange().getValues();
  var h = rows[0];
  var iRut = colIdx(h,'RUT Proveedor'), iFolio = colIdx(h,'Folio'),
      iDesc = colIdx(h,'Descripcion'), iMonto = colIdx(h,'Monto Neto');

  var vistos = {}, aBorrar = [];
  for (var i = 1; i < rows.length; i++) {
    var linea = String(rows[i][iRut]).trim() + '|' + String(rows[i][iFolio]).trim() + '|' +
                String(rows[i][iDesc]).trim() + '|' + String(rows[i][iMonto]).trim();
    if (vistos[linea]) aBorrar.push(i + 1); else vistos[linea] = true;
  }
  if (!aBorrar.length) { Logger.log('No había filas repetidas'); return; }
  // De abajo hacia arriba, para que borrar una fila no corra las siguientes.
  aBorrar.reverse().forEach(function(f){ sh.deleteRow(f); });
  Logger.log('Filas eliminadas: ' + aBorrar.length);
}

// Documentos que tienen detalle de productos guardado, por RUT|folio.
function mapaConDetalle(ss) {
  var m = {};
  var sh = ss.getSheetByName('Detalle Compras');
  if (sh && sh.getLastRow() > 1) {
    var rows = sh.getDataRange().getValues();
    var h = rows[0];
    var iRut = colIdx(h, 'RUT Proveedor'), iFolio = colIdx(h, 'Folio');
    for (var i = 1; i < rows.length; i++) {
      m[String(rows[i][iRut]||'').trim() + '|' + String(rows[i][iFolio]||'').trim()] = true;
    }
  }
  return m;
}

// Devuelve cada carga con su avance real: cuántos de sus documentos ya están importados
function getCargasSII(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = getSheetCargasSII(ss);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return { cargas: [] };

  var yaImportadas = clavesImportadas(ss);
  var notasDocs = mapaNotasDocs(ss);
  var conDetalle = mapaConDetalle(ss);

  var cargas = rows.slice(1).map(function(r) {
    var docs = [];
    try {
      var parsed = JSON.parse(r[7] || '[]');
      // Formato antiguo: solo las claves como texto. Nuevo: objetos con nombre.
      docs = parsed.map(function(x){ return typeof x === 'string' ? { k: x, n: '' } : x; });
    } catch(e) {}
    var pendientes = docs.filter(function(d){ return !yaImportadas[d.k]; });
    return {
      id: String(r[0]||''),
      fechaCarga: normalizarFecha(r[1]),
      desde: normalizarFecha(r[2]),
      hasta: normalizarFecha(r[3]),
      nombreArchivo: String(r[4]||''),
      url: String(r[5]||''),
      total: docs.length,
      importados: docs.length - pendientes.length,
      nota: String(r[8] || ''),
      enDuda: pendientes.filter(function(d){ return notasDocs[d.k]; }).length,
      pendientes: pendientes.map(function(d){
        return { clave: d.k, folio: d.k.split('|')[1] || '', razonSocial: d.n || '',
                 nota: notasDocs[d.k] || '' };
      }),
      // Todos los documentos de la carga, para poder revisarla completa (no solo lo que
      // falta) y abrir el detalle de cada factura sin volver a cargar el archivo.
      documentos: docs.map(function(d){
        var partes = String(d.k).split('|');
        return { clave: d.k, rut: partes[0] || '', folio: partes[1] || '',
                 razonSocial: d.n || '', importado: !!yaImportadas[d.k],
                 nota: notasDocs[d.k] || '', tieneDetalle: !!conDetalle[d.k] };
      })
    };
  }).filter(function(c){ return c.id; });

  cargas.sort(function(a,b){ return (b.desde||'').localeCompare(a.desde||''); });
  return { cargas: cargas };
}


// ═══════════════════════════════════════════════════════════════════════════
//  NOTAS Y LIMPIEZA DEL HISTORIAL DE CARGAS
// ═══════════════════════════════════════════════════════════════════════════

// Las notas de documento se guardan por RUT|folio, NO dentro de la carga. Así se puede
// marcar una duda apenas se abre el archivo (antes de que exista fila de carga) y la
// nota sigue al documento aunque reaparezca en otro archivo del SII.
function getSheetNotasDocs(ss) {
  var sh = ss.getSheetByName('Notas Documentos');
  if (!sh) {
    sh = ss.insertSheet('Notas Documentos');
    sh.appendRow(['Clave','RUT Proveedor','Razon Social','Folio','Nota','Fecha']);
    sh.getRange(1,1,1,6).setFontWeight('bold');
  }
  return sh;
}

function mapaNotasDocs(ss) {
  var sh = getSheetNotasDocs(ss);
  var rows = sh.getDataRange().getValues();
  var m = {};
  for (var i = 1; i < rows.length; i++) {
    var k = String(rows[i][0] || '').trim();
    var nota = String(rows[i][4] || '').trim();
    if (k && nota) m[k] = nota;
  }
  return m;
}

// Guarda, actualiza o borra la nota de un documento. Nota vacía = borrar la fila.
function guardarNotaDocumento(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var clave = String(data.clave || '').trim();
  if (!clave) return { error: 'Falta identificar el documento' };
  var nota = String(data.nota || '').trim();
  var sh = getSheetNotasDocs(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === clave) {
      if (!nota) { sh.deleteRow(i + 1); return { ok: true, borrada: true }; }
      sh.getRange(i + 1, 5).setValue(nota);
      sh.getRange(i + 1, 6).setValue(hoyStrGS());
      return { ok: true };
    }
  }
  if (!nota) return { ok: true, borrada: true };
  sh.appendRow([clave, String(data.rut || ''), String(data.razonSocial || ''),
                String(data.folio || ''), nota, hoyStrGS()]);
  return { ok: true };
}

// Nota libre de la carga completa: para qué quedó a medias, hasta dónde se alcanzó, etc.
function guardarNotaCarga(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = getSheetCargasSII(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sh.getRange(i + 1, 9).setValue(String(data.nota || '').trim());
      return { ok: true };
    }
  }
  return { error: 'Carga no encontrada' };
}

// Borra una carga del historial. Esto es SOLO bitácora: no toca los gastos ya
// importados ni la detección de duplicados, que se calcula leyendo RUT y folio desde
// Registro Gasto y Detalle Compras. La copia del archivo se manda a la papelera de
// Drive (no se destruye), por si hubiera que recuperarla.
function eliminarCargaSII(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = getSheetCargasSII(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      var archivoBorrado = false;
      var url = String(rows[i][5] || '');
      if (url) {
        var m = url.match(/\/d\/([^\/]+)/);
        if (m) {
          try { DriveApp.getFileById(m[1]).setTrashed(true); archivoBorrado = true; } catch(e) {}
        }
      }
      sh.deleteRow(i + 1);
      return { ok: true, archivoBorrado: archivoBorrado };
    }
  }
  return { error: 'Carga no encontrada' };
}

// Devuelve el contenido del archivo de una carga guardada, para reabrirla sin tener
// que buscarlo de nuevo en el computador.
function leerArchivoCarga(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = getSheetCargasSII(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      var url = String(rows[i][5] || '');
      if (!url) return { error: 'Esta carga no tiene archivo guardado' };
      var m = url.match(/\/d\/([^\/]+)/);
      if (!m) return { error: 'No se pudo identificar el archivo' };
      try {
        var file = DriveApp.getFileById(m[1]);
        return { ok: true, contenido: file.getBlob().getDataAsString('UTF-8'), nombre: file.getName() };
      } catch(e) {
        return { error: 'No se pudo leer el archivo desde Drive: ' + e.message };
      }
    }
  }
  return { error: 'Carga no encontrada' };
}

// Los gastos registrados a mano (antes de la carga masiva) no tienen RUT ni folio, así
// que no se detectan como ya importados. Esta función busca coincidencias probables por
// monto total y fecha cercana, agrupando las filas de una misma compra (que puede estar
// dividida en varias áreas o ítems). No decide nada: solo sugiere, el usuario confirma.
function buscarCoincidencias(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheets()[0];
  var cols = asegurarColumnasProveedor(sheet);
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { coincidencias: {} };

  var h = rows[0];
  var iFecha = colIdx(h,'Fecha'), iItem = colIdx(h,'Ítem Gasto');
  if (iItem === -1) iItem = colIdx(h,'Item Gasto');
  var iArea = colIdx(h,'Área'); if (iArea === -1) iArea = colIdx(h,'Area');
  var iFinal = colIdx(h,'Monto Final'), iObs = colIdx(h,'Observación');
  if (iObs === -1) iObs = colIdx(h,'Observacion');
  var iFormaPago = colIdx(h,'Forma Pago');

  var MARGEN_DIAS = 5;

  // Agrupar por fecha: una compra puede ocupar varias filas (áreas/ítems distintos)
  var grupos = {};
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][cols.iRut]||'').trim()) continue; // ya tiene proveedor: vino del SII
    // normalizarFecha() es indispensable: Sheets puede devolver la celda como objeto
    // Date ("Tue Sep 08 2026...") y no como texto dd-mm-yyyy.
    var fechaISO = normalizarFecha(rows[i][iFecha]);
    if (!fechaISO || !/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) continue;
    var clave = fechaISO + '|' + String(rows[i][iObs]||'').trim();
    if (!grupos[clave]) grupos[clave] = { fecha: fechaISO, filas: [], detalleFilas: [], total: 0, items: {}, areas: {}, obs: String(rows[i][iObs]||''), formaPago: String(rows[i][iFormaPago]||'') };
    var g = grupos[clave];
    g.filas.push(i+1);
    g.detalleFilas.push({
      fila: i+1,
      monto: parseFloat(rows[i][iFinal]) || 0,
      item: String(rows[i][iItem]||''),
      area: String(rows[i][iArea]||''),
      obs: String(rows[i][iObs]||'')
    });
    g.total += parseFloat(rows[i][iFinal]) || 0;
    if (rows[i][iItem]) g.items[String(rows[i][iItem])] = true;
    if (rows[i][iArea]) g.areas[String(rows[i][iArea])] = (g.areas[String(rows[i][iArea])]||0) + (parseFloat(rows[i][iFinal])||0);
  }

  function difDias(a, b) {
    return Math.abs((new Date(a+'T00:00:00') - new Date(b+'T00:00:00')) / 86400000);
  }

  var resultado = {};
  (data.documentos || []).forEach(function(doc) {
    var candidatos = [];
    var vistos = {};
    Object.keys(grupos).forEach(function(k) {
      var g = grupos[k];
      var dias = difDias(g.fecha, doc.fecha);
      if (dias > MARGEN_DIAS) return;

      // Caso 1: el grupo completo calza con el total del documento (compra dividida
      // en varias áreas o ítems, todas de la misma factura).
      if (Math.round(g.total) === Math.round(Math.abs(doc.total))) {
        candidatos.push({
          fecha: g.fecha, total: Math.round(g.total),
          items: Object.keys(g.items),
          areas: Object.keys(g.areas).map(function(a){ return { area: a, monto: Math.round(g.areas[a]) }; }),
          obs: g.obs, formaPago: g.formaPago, filas: g.filas, diasDif: dias, parcial: false
        });
        vistos[k] = true;
        return;
      }

      // Caso 2: alguna fila suelta del mismo día calza (dos compras distintas el mismo
      // día habrían quedado sumadas en el grupo y el total no cuadraría).
      g.detalleFilas.forEach(function(fila) {
        if (Math.round(fila.monto) !== Math.round(Math.abs(doc.total))) return;
        candidatos.push({
          fecha: g.fecha, total: Math.round(fila.monto),
          items: [fila.item], areas: fila.area ? [{ area: fila.area, monto: Math.round(fila.monto) }] : [],
          obs: fila.obs, formaPago: g.formaPago, filas: [fila.fila], diasDif: dias, parcial: true
        });
      });
    });
    candidatos.sort(function(a,b){ return a.diasDif - b.diasDif; });
    if (candidatos.length) resultado[doc.rut + '|' + doc.folio] = candidatos.slice(0, 4);
  });

  return { coincidencias: resultado };
}

// Marca un gasto ya registrado a mano como correspondiente a un documento del SII:
// le escribe el RUT y el folio para que no vuelva a aparecer como pendiente.
function vincularGastoConDocumento(ss, data) {
  var sheet = ss.getSheets()[0];
  var cols = asegurarColumnasProveedor(sheet);
  var h = sheet.getDataRange().getValues()[0];
  var iObs = colIdx(h,'Observación');
  if (iObs === -1) iObs = colIdx(h,'Observacion');

  var filas = data.filas || [];
  filas.forEach(function(fila) {
    sheet.getRange(fila, cols.iRut+1).setValue(data.rut);
    sheet.getRange(fila, cols.iRazon+1).setValue(data.razonSocial || '');
    var obsActual = String(sheet.getRange(fila, iObs+1).getValue() || '');
    if (obsActual.indexOf('F.' + data.folio) === -1) {
      sheet.getRange(fila, iObs+1).setValue(('F.' + data.folio + ' ' + obsActual).trim());
    }
  });
  return { ok: true, filas: filas.length };
}

function getGastos(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheets()[0];
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return { gastos: [] };
  var headers = rows[0].map(function(h) { return String(h).trim(); });

  function col(name) {
    var idx = headers.indexOf(name);
    if (idx > -1) return idx;
    var norm = name.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n');
    for (var i=0; i<headers.length; i++) {
      var h = headers[i].toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n');
      if (h === norm) return i;
    }
    return -1;
  }

  var idxFecha   = col('Fecha');
  var idxItem    = col('Item Gasto') > -1 ? col('Item Gasto') : col('Ítem Gasto');
  var idxCat     = col('Categoria') > -1 ? col('Categoria') : col('Categoría');
  var idxTipo    = col('Tipo');
  var idxSubTipo = col('Sub Tipo');
  var idxArea    = col('Area') > -1 ? col('Area') : col('Área');
  var idxTipoM   = col('Tipo Monto');
  var idxNeto    = col('Monto Neto');
  var idxFinal   = col('Monto Final');
  var idxFormaPago = col('Forma Pago');
  var idxFechaPago = col('Fecha Pago');
  var idxUrlFoto = col('URL Foto');

  // Cruce con Vencimientos: para las compras a crédito (tarjeta/proveedor), se busca
  // su vencimiento asociado por Ítem + Fecha de compra (misma clave usada para vincular
  // el pago) y se le agrega su fecha de vencimiento y estado real de la obligación.
  // Documentos que tienen detalle de productos guardado, para ofrecer el botón de verlo
  var conDetalle = mapaConDetalle(ss);

  var vencMap = {};
  var shV = getSheetVencimientos(ss);
  var vrows = shV.getDataRange().getValues();
  if (vrows.length > 1) {
    var vh = vrows[0];
    var vIItem = colIdx(vh,'Item'), vIFechaCompra = colIdx(vh,'FechaCompra'), vIFechaVenc = colIdx(vh,'FechaVencimiento'),
        vIEstado = colIdx(vh,'Estado'), vIPlantillaId = colIdx(vh,'PlantillaID');
    for (var vi = 1; vi < vrows.length; vi++) {
      if (vrows[vi][vIPlantillaId]) continue; // solo interesan los de crédito (sin plantilla)
      var fc = String(vrows[vi][vIFechaCompra]||'').trim();
      var itemV = String(vrows[vi][vIItem]||'').trim().toUpperCase();
      if (!fc || !itemV) continue;
      vencMap[itemV + '|' + fc] = {
        fechaVencimiento: normalizarFecha(vrows[vi][vIFechaVenc]),
        estadoObligacion: String(vrows[vi][vIEstado]||'')
      };
    }
  }

  var idxRutProv = colIdx(headers, 'RUT Proveedor');
  var idxObsGasto = colIdx(headers, 'Observación');
  if (idxObsGasto === -1) idxObsGasto = colIdx(headers, 'Observacion');

  var gastos = rows.slice(1).map(function(r, i) {
    var formaPago = idxFormaPago > -1 ? String(r[idxFormaPago]||'') : '';
    var fechaRaw = String(r[idxFecha] || '');
    var itemRaw = String(r[idxItem] || '');
    // El folio se guarda como "F.123456" dentro de la observación al importar del SII
    var rutGasto = idxRutProv > -1 ? String(r[idxRutProv]||'').trim() : '';
    var mFolio = idxObsGasto > -1 ? String(r[idxObsGasto]||'').match(/F\.(\d+)/) : null;
    var folioGasto = mFolio ? mFolio[1] : '';
    var venc = (formaPago === 'tarjeta' || formaPago === 'proveedor')
      ? vencMap[itemRaw.trim().toUpperCase() + '|' + fechaRaw.trim()]
      : null;
    return {
      fila:       i + 2,
      fecha:      fechaRaw,
      item:       itemRaw,
      categoria:  String(r[idxCat] || ''),
      tipo:       String(r[idxTipo] || ''),
      subTipo:    String(r[idxSubTipo] || ''),
      area:       String(r[idxArea] || ''),
      tipoMonto:  String(r[idxTipoM] || ''),
      montoNeto:  r[idxNeto] || 0,
      montoFinal: r[idxFinal] || 0,
      formaPago:  formaPago,
      fechaPago:  idxFechaPago > -1 ? normalizarFecha(r[idxFechaPago]) : '',
      fechaVencimiento: venc ? venc.fechaVencimiento : '',
      estadoObligacion: venc ? venc.estadoObligacion : '',
      urlFoto:    idxUrlFoto > -1 ? String(r[idxUrlFoto]||'') : '',
      rutProveedor: rutGasto,
      folio: folioGasto,
      tieneDetalle: !!(rutGasto && folioGasto && conDetalle[rutGasto + '|' + folioGasto]),
      observacion: r[14] || ''
    };
  }).filter(function(g) { return g.fecha && g.fecha !== ''; });

  return { gastos: gastos };
}

function editarGasto(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheets()[0];
  var fila = parseInt(data.fila);
  if (!fila || fila < 2) return { error: 'Fila inválida' };
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  function col(name) {
    for (var i=0; i<headers.length; i++) {
      var h = String(headers[i]).toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').replace(/[^a-z]/g,'');
      var n = name.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').replace(/[^a-z]/g,'');
      if (h === n) return i;
    }
    return -1;
  }
  if (data.fecha) sheet.getRange(fila, col('Fecha')+1).setValue(data.fecha);
  if (data.monto) {
    var m = parseInt(data.monto)||0;
    var iFinal = col('Monto Final');
    if (iFinal>-1) sheet.getRange(fila, iFinal+1).setValue(m);
  }
  if (data.area) { var iArea = col('Area') > -1 ? col('Area') : col('Área'); if (iArea>-1) sheet.getRange(fila, iArea+1).setValue(data.area); }
  if (data.obs !== undefined) { var iObs = col('Observacion') > -1 ? col('Observacion') : col('Observación'); if (iObs>-1) sheet.getRange(fila, iObs+1).setValue(data.obs); }
  return { ok: true };
}

function eliminarGasto(ss, data) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheets()[0];
  var fila = parseInt(data.fila);
  if (!fila || fila < 2) return { error: 'Fila inválida' };
  sheet.deleteRow(fila);
  return { ok: true };
}

// ════════════════════════════════════════════════
// MAESTRO DE ÍTEMS DE GASTO
// ════════════════════════════════════════════════
function getSheetItems(ss) {
  var sh = ss.getSheetByName('Items Gasto');
  if (!sh) {
    sh = ss.insertSheet('Items Gasto');
    sh.appendRow(['Item','Categoria','Tipo','SubTipo','Area','Orden']);
    sh.getRange(1,1,1,6).setFontWeight('bold');
    var defaults = [
      ['ARRIENDO SALA PRODUCCIÓN','FIJO','DIRECTO','OPERATIVO','PRORRATEADO'],
      ['REMUNERACIONES PRODUCCIÓN','FIJO','DIRECTO','OPERATIVO','SELECCIONAR'],
      ['LUZ AINAVILLO','FIJO','DIRECTO','OPERATIVO','PRORRATEADO'],
      ['AGUA AINAVILLO','FIJO','DIRECTO','OPERATIVO','PRORRATEADO'],
      ['MANTENIMIENTO PREVENTIVO DE EQUIPOS','FIJO','DIRECTO','OPERATIVO','SELECCIONAR'],
      ['ARRIENDO SALA VENTAS','FIJO','INDIRECTO','OPERATIVO','VENTAS'],
      ['OTRAS REMUNERACIONES','FIJO','INDIRECTO','OPERATIVO','SELECCIONAR'],
      ['CONTADOR','FIJO','INDIRECTO','OPERATIVO','ADMIN'],
      ['S.G.V (TOTEAT)','FIJO','INDIRECTO','OPERATIVO','VENTAS'],
      ['TELEFONIA','FIJO','INDIRECTO','OPERATIVO','VENTAS'],
      ['INTERNET','FIJO','INDIRECTO','OPERATIVO','VENTAS'],
      ['LUZ BARROS ARANA','FIJO','INDIRECTO','OPERATIVO','VENTAS'],
      ['AGUA BARROS ARANA','FIJO','INDIRECTO','OPERATIVO','VENTAS'],
      ['MATERIA PRIMA','VARIABLE','DIRECTO','OPERATIVO','SELECCIONAR'],
      ['OTROS INSUMOS','VARIABLE','DIRECTO','OPERATIVO','SELECCIONAR'],
      ['GAS','VARIABLE','DIRECTO','OPERATIVO','PRORRATEADO'],
      ['MANTENIMIENTO CORRECTIVO','VARIABLE','DIRECTO','OPERATIVO','SELECCIONAR'],
      ['ACTIVO FIJO','VARIABLE','DIRECTO','INVERSIÓN','SELECCIONAR'],
      ['HABILITACIÓN INFRAESTRUCTURA','VARIABLE','DIRECTO','INVERSIÓN','SELECCIONAR'],
      ['BIENESTAR','VARIABLE','INDIRECTO','OPERATIVO','ADMIN'],
      ['BENCINA','VARIABLE','INDIRECTO','OPERATIVO','VENTAS'],
      ['MANTENIMIENTO CORRECTIVO (IND)','VARIABLE','INDIRECTO','OPERATIVO','SELECCIONAR'],
      ['SANITARIOS','VARIABLE','INDIRECTO','OPERATIVO','ADMIN'],
      ['DELIVERY','VARIABLE','INDIRECTO','COMERCIAL','VENTAS'],
      ['COMISIONES','VARIABLE','INDIRECTO','COMERCIAL','VENTAS'],
      ['MARKETING','VARIABLE','INDIRECTO','COMERCIAL','VENTAS'],
      ['PROMOCIONES','VARIABLE','INDIRECTO','COMERCIAL','VENTAS'],
      ['PUBLICIDAD','VARIABLE','INDIRECTO','COMERCIAL','VENTAS'],
      ['ARRIENDO MAQUINA TRANSBANK','FIJO','INDIRECTO','COMERCIAL','VENTAS'],
      ['COMPRA MAQUINA TRANSBANK','VARIABLE','INDIRECTO','COMERCIAL','VENTAS'],
      ['GESTIÓN EMPRESARIAL','VARIABLE','INDIRECTO','OPERATIVO','ADMIN'],
      ['ACTIVO INTANGIBLE','VARIABLE','INDIRECTO','INVERSIÓN','SELECCIONAR'],
      ['HABILITACIÓN INFRAESTRUCTURA (INDIRECTO)','VARIABLE','INDIRECTO','INVERSIÓN','SELECCIONAR'],
      ['PRESTAMO BANCARIO','VARIABLE','INDIRECTO','FINANCIERO','ADMIN'],
      ['TARJETA CRÉDITO','VARIABLE','INDIRECTO','FINANCIERO','ADMIN'],
      ['TGR','VARIABLE','INDIRECTO','PASIVO','ADMIN'],
      ['IVA','VARIABLE','INDIRECTO','PASIVO','ADMIN']
    ];
    if (defaults.length) {
      var conOrden = defaults.map(function(d, idx) { return d.concat([(idx+1)*10]); });
      sh.getRange(2, 1, conOrden.length, 6).setValues(conOrden);
    }
  }
  return sh;
}

function asegurarColumnaOrden(sh) {
  var headers = sh.getDataRange().getValues()[0] || [];
  var iOrden = colIdx(headers, 'Orden');
  if (iOrden === -1) {
    var col = headers.length + 1;
    sh.getRange(1, col).setValue('Orden').setFontWeight('bold');
    iOrden = col - 1;
  }
  return iOrden;
}

function getItems(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = getSheetItems(ss);
  var iOrden = asegurarColumnaOrden(sh);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return { items: [] };

  // Backfill: a los ítems creados antes de este cambio se les asigna un Orden
  // según su posición actual en la hoja, para que el orden no cambie de golpe.
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] && (rows[i][iOrden] === '' || rows[i][iOrden] === null || rows[i][iOrden] === undefined)) {
      var ordenAsignado = i * 10;
      sh.getRange(i+1, iOrden+1).setValue(ordenAsignado);
      rows[i][iOrden] = ordenAsignado;
    }
  }

  // Ítems que pertenecen a una obligación RECURRENTE activa (no "variable"/crédito) no
  // deben registrarse a mano desde la pestaña Registrar — se pagan desde Obligaciones,
  // que ahora genera el gasto automáticamente. Se marcan aquí para que el frontend los
  // pueda excluir solo del selector de Registrar.
  var itemsRecurrentes = {};
  var shP = getSheetPlantillas(ss);
  var prows = shP.getDataRange().getValues();
  if (prows.length > 1) {
    var ph = prows[0];
    var pIItem = colIdx(ph,'Item'), pIFrec = colIdx(ph,'Frecuencia'), pIEst = colIdx(ph,'Estado');
    for (var p = 1; p < prows.length; p++) {
      var itemNombre = String(prows[p][pIItem]||'').trim().toUpperCase();
      var frec = String(prows[p][pIFrec]||'');
      var est = String(prows[p][pIEst]||'');
      if (itemNombre && frec && frec !== 'variable' && est === 'ACTIVA') {
        itemsRecurrentes[itemNombre] = true;
      }
    }
  }

  var items = rows.slice(1).map(function(r) {
    var nombre = String(r[0]||'');
    return {
      item: nombre, categoria: String(r[1]||''), tipo: String(r[2]||''), subTipo: String(r[3]||''), area: String(r[4]||''),
      orden: parseFloat(r[iOrden]) || 0,
      esObligacionRecurrente: !!itemsRecurrentes[nombre.trim().toUpperCase()]
    };
  }).filter(function(i) { return i.item; });

  items.sort(function(a,b) { return a.orden - b.orden; });

  return { items: items };
}

// Sube o baja un ítem una posición, intercambiando su valor de Orden con el vecino.
function moverItem(ss, data) {
  var sh = getSheetItems(ss);
  var iOrden = asegurarColumnaOrden(sh);
  var rows = sh.getDataRange().getValues();
  var headers = rows[0];
  var iItem = colIdx(headers, 'Item');
  var nombre = String(data.item||'').trim().toUpperCase();
  var direccion = data.direccion; // 'arriba' | 'abajo'

  var lista = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][iItem]) continue;
    lista.push({ fila: i+1, nombre: String(rows[i][iItem]).trim().toUpperCase(), orden: parseFloat(rows[i][iOrden]) || 0 });
  }
  lista.sort(function(a,b){ return a.orden - b.orden; });

  var idx = lista.findIndex(function(x){ return x.nombre === nombre; });
  if (idx === -1) return { error: 'Ítem no encontrado' };

  var idxVecino = direccion === 'arriba' ? idx - 1 : idx + 1;
  if (idxVecino < 0 || idxVecino >= lista.length) return { ok: true }; // ya está en el extremo

  var actual = lista[idx], vecino = lista[idxVecino];
  sh.getRange(actual.fila, iOrden+1).setValue(vecino.orden);
  sh.getRange(vecino.fila, iOrden+1).setValue(actual.orden);
  return { ok: true };
}

function saveItem(ss, data) {
  var sh = getSheetItems(ss);
  var iOrden = asegurarColumnaOrden(sh);
  var rows = sh.getDataRange().getValues();
  var headers = rows[0];
  var iItem=colIdx(headers,'Item'), iCat=colIdx(headers,'Categoria'), iTipo=colIdx(headers,'Tipo'),
      iSubTipo=colIdx(headers,'SubTipo'), iArea=colIdx(headers,'Area');

  var nombreOrig = String(data.nombreOriginal||'').trim().toUpperCase();
  var nombreNuevo = String(data.nombre||'').trim().toUpperCase();

  if (nombreOrig) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][iItem]).trim().toUpperCase() === nombreOrig) {
        sh.getRange(i+1, iItem+1).setValue(nombreNuevo);
        sh.getRange(i+1, iCat+1).setValue(data.categoria||'');
        sh.getRange(i+1, iTipo+1).setValue(data.tipo||'');
        sh.getRange(i+1, iSubTipo+1).setValue(data.subTipo||'');
        sh.getRange(i+1, iArea+1).setValue(data.area||'');
        return { ok: true };
      }
    }
    return { error: 'Ítem no encontrado' };
  } else {
    for (var j = 1; j < rows.length; j++) {
      if (String(rows[j][iItem]).trim().toUpperCase() === nombreNuevo) return { error: 'Ya existe un ítem con ese nombre' };
    }
    var maxOrden = 0;
    for (var k = 1; k < rows.length; k++) {
      var o = parseFloat(rows[k][iOrden]) || 0;
      if (o > maxOrden) maxOrden = o;
    }
    var nuevaFila = [];
    nuevaFila[iItem] = nombreNuevo;
    nuevaFila[iCat] = data.categoria||'';
    nuevaFila[iTipo] = data.tipo||'';
    nuevaFila[iSubTipo] = data.subTipo||'';
    nuevaFila[iArea] = data.area||'';
    nuevaFila[iOrden] = maxOrden + 10; // se agrega al final de la lista
    for (var c = 0; c < headers.length; c++) { if (nuevaFila[c] === undefined) nuevaFila[c] = ''; }
    sh.appendRow(nuevaFila);
    return { ok: true };
  }
}

function deleteItem(ss, data) {
  var sh = getSheetItems(ss);
  var rows = sh.getDataRange().getValues();
  var nombre = String(data.nombre||'').trim().toUpperCase();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === nombre) {
      sh.deleteRow(i+1);
      return { ok: true };
    }
  }
  return { error: 'Ítem no encontrado' };
}

// ════════════════════════════════════════════════
// VENTAS POR ÁREA (desde hoja Admin Ventas B2B)
// ════════════════════════════════════════════════
function getVentasPorArea() {
  var SHEET_VENTAS_ID = '1iZA6467dXZ1EWi8P3TzKfFTwodmcbeZiaJAUhsAsLUc';
  var CATEGORIA_A_AREA = { 'BOL': 'BOL', 'PAN': 'PAN', 'PAS': 'PAS', 'AA: para despacho': 'VENTAS', 'CAF': 'CAF' };

  try {
    var ssV = SpreadsheetApp.openById(SHEET_VENTAS_ID);
    var shProd = ssV.getSheetByName('Productos');
    if (!shProd) return { ok: false, error: 'Hoja Productos no encontrada' };
    var prodRows = shProd.getDataRange().getValues();
    var prodMap = {};
    for (var p = 1; p < prodRows.length; p++) {
      var nombre = String(prodRows[p][0]||'').trim();
      var cat = String(prodRows[p][2]||'').trim();
      if (nombre && cat) prodMap[nombre.toLowerCase()] = CATEGORIA_A_AREA[cat] || cat;
    }

    var hoy = new Date();
    var mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth()-1, 1);
    var anioMes = mesAnterior.getFullYear();
    var mesMes = mesAnterior.getMonth();
    var nombreMes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][mesMes];

    var shDet = ssV.getSheetByName('Detalle Ventas');
    if (!shDet) return { ok: false, error: 'Hoja Detalle Ventas no encontrada' };
    var detRows = shDet.getDataRange().getValues();
    var headers = detRows[0];

    var iDate = -1, iProd = -1, iNeto = -1;
    for (var h = 0; h < headers.length; h++) {
      var hh = String(headers[h]).toLowerCase();
      if (hh.includes('fecha')) iDate = h;
      if (hh === 'producto') iProd = h;
      if (hh.includes('neto total')) iNeto = h;
    }
    if (iProd === -1 || iNeto === -1) return { ok: false, error: 'Columnas no encontradas' };

    var totalPorArea = {};
    var totalGeneral = 0;
    for (var r = 1; r < detRows.length; r++) {
      var fecha = detRows[r][iDate];
      if (!fecha) continue;
      var d = fecha instanceof Date ? fecha : new Date(fecha);
      if (d.getFullYear() !== anioMes || d.getMonth() !== mesMes) continue;
      var prod = String(detRows[r][iProd]||'').trim().toLowerCase();
      var neto = parseFloat(detRows[r][iNeto]||0);
      var area = prodMap[prod] || null;
      if (!area || !neto) continue;
      totalPorArea[area] = (totalPorArea[area]||0) + neto;
      totalGeneral += neto;
    }

    if (totalGeneral === 0) return { ok: true, areas: [], mes: nombreMes + ' ' + anioMes };

    var areas = Object.keys(totalPorArea).map(function(a) {
      return { area: a, total: totalPorArea[a], pct: Math.round(totalPorArea[a]/totalGeneral*100) };
    }).sort(function(a,b) { return b.total - a.total; });

    var sumPct = areas.reduce(function(s,a){ return s+a.pct; }, 0);
    if (sumPct !== 100 && areas.length) areas[0].pct += (100 - sumPct);

    return { ok: true, areas: areas, mes: nombreMes + ' ' + anioMes };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}