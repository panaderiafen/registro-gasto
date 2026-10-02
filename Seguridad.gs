// ═══════════════════════════════════════════════════════════
//  fën — Apps Script · Seguridad.gs  v2.0.0  (2026-10-02)
//  App: Gastos
//
//  Archivo NUEVO: va en el mismo proyecto de Apps Script que Code.gs.
//  Recibe todas las llamadas de la app (doPost / doGet) y, antes de
//  ejecutar cualquier acción, revisa quién la pide:
//
//   · Dueño: la misma contraseña del panel de Asistencia. Esta app se la
//     pregunta a Asistencia (servidor a servidor), así hay UNA sola
//     contraseña. La sesión dura 30 días si se marcó "Recordar en este
//     equipo"; si no, mientras la pestaña esté abierta.
//   · Cada escritura lleva una clave única (idem) y se hace con bloqueo:
//     aunque llegue dos veces, se ejecuta una.
//
//  Configuración (una vez, ver README):
//   Configuración del proyecto ▸ Propiedades del script:
//     ASISTENCIA_URL   = URL /exec del Apps Script de Asistencia
//     ASISTENCIA_CLAVE = clave que entrega crearClaveServicioGastos() en Asistencia
//   Luego ejecutar instalarSeguridad() para probar la conexión.
// ═══════════════════════════════════════════════════════════

const SEG_VERSION = '2.0.0';
const SEG_SERVICIO = 'gastos';          // nombre de esta app ante Asistencia
const SEG_SESION_DUENO_DIAS = 30;
const SEG_SESION_PERSONA_HORAS = 12;
const SEG_DISPOSITIVO_DIAS = 400;
// Acción que se ejecuta cuando la app no manda ninguna (flujo antiguo).
const SEG_ACCION_DEFECTO = 'registrarGasto';
// Acciones que puede hacer una persona con PIN (vacío = app solo del dueño).
const SEG_ACCIONES_PERSONA = [];
// Lecturas que la app hace al abrir pero que una persona no debe ver: en vez
// de un error (que detendría la carga), reciben este valor vacío.
const SEG_VACIAS_PERSONA = {};
// Prefijos de acciones que solo leen (no llevan bloqueo).
const SEG_LECTURA_RE = /^(get(?!Vencimientos)|leer|buscar|ping)/i  // getVencimientos también crea vencimientos: va con bloqueo;

const SEG_PUBLICAS = {
  ping:                  () => ({ ok: true, version: SEG_VERSION }),
  seg_estado:            segEstado,
  seg_login_dueno:       segLoginDueno,
  seg_autorizar_equipo:  segAutorizarEquipo,
  seg_login_persona:     segLoginPersona,
  seg_logout:            segLogout,
};
const SEG_DUENO = {
  seg_datos:         segDatos,
  seg_guardar_personas: segGuardarPersonas,
  seg_revocar:       segRevocar,
};

// ═══════════════════════════════════════════════════════════
//  Entrada
// ═══════════════════════════════════════════════════════════

function doPost(e) {
  let p;
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return segSalida(segError('Solicitud inválida', 'formato')); }
  return segSalida(segDespachar(p));
}

function doGet(e) {
  const prm = (e && e.parameter) || {};
  if (prm.action === 'ping') return segSalida({ ok: true, version: SEG_VERSION });
  // Respaldo cuando Google desvía el POST: la app reenvía el mismo JSON en "p".
  if (prm.p) {
    let p;
    try { p = JSON.parse(prm.p); } catch (err) { return segSalida(segError('Solicitud inválida', 'formato')); }
    return segSalida(segDespachar(p));
  }
  return segSalida(segError('Solicitud sin datos: la app reintentará.', 'version'));
}

function segSalida(d) {
  return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);
}

// Error en los formatos que ya entienden las apps antiguas (ok/msg y status/message).
function segError(msg, code) {
  return { ok: false, success: false, status: 'error', code: code || 'error', msg, message: msg, error: msg };
}

function segPropia(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

function segDespachar(p) {
  const accion = String(p.action || SEG_ACCION_DEFECTO || '');
  try {
    if (segPropia(SEG_PUBLICAS, accion)) return SEG_PUBLICAS[accion](p);

    const ses = segLeerSesion(p.token);
    if (!ses || (ses.rol !== 'dueno' && ses.rol !== 'persona') || (ses.rol === 'persona' && !segPersonaVigente(ses))) {
      return segError('Tu sesión venció. Vuelve a entrar.', 'sesion');
    }
    if (ses.rol === 'persona' && segPropia(SEG_VACIAS_PERSONA, accion)) return SEG_VACIAS_PERSONA[accion];
    if (ses.rol === 'persona' && SEG_ACCIONES_PERSONA.indexOf(accion) < 0) {
      return segError('Esta acción la hace el dueño.', 'permiso');
    }
    if (segPropia(SEG_DUENO, accion) && ses.rol !== 'dueno') return segError('Esta acción la hace el dueño.', 'permiso');

    const datos = Object.assign({}, p);
    delete datos.token; delete datos.idem;
    datos.action = accion;
    const ejecutar = () => segPropia(SEG_DUENO, accion) ? SEG_DUENO[accion](datos, ses) : segLlamarLegado(accion, datos, ses);

    if (SEG_LECTURA_RE.test(accion) || segPropia(SEG_DUENO, accion) && accion === 'seg_datos') return ejecutar();

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return segError('El sistema está ocupado, intenta de nuevo en unos segundos.', 'ocupado');
    try {
      const idem = typeof p.idem === 'string' && /^[a-z0-9-]{8,64}$/i.test(p.idem)
        ? 'idem_' + segSha(ses.id + '|' + accion + '|' + p.idem).slice(0, 32) : null;
      const previo = idem ? segCache().get(idem) : null;
      if (previo) return JSON.parse(previo);
      const r = ejecutar();
      if (idem) { try { segCache().put(idem, JSON.stringify(r), 600); } catch (e) {} }
      return r;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return segError(String(err && err.message || err));
  }
}

// Llama al código antiguo. Si la app la usa una persona (no el dueño), aquí
// se pueden agregar reglas propias de cada app (ver segReglasPersona).
function segLlamarLegado(accion, datos, ses) {
  if (typeof segValidar === 'function') {   // reglas de datos para todos (dueño incluido)
    const malo = segValidar(accion, datos);
    if (malo) return segError(malo, 'datos');
  }
  if (ses.rol === 'persona' && typeof segReglasPersona === 'function') {
    const rechazo = segReglasPersona(accion, datos, ses);
    if (rechazo) return segError(rechazo, 'permiso');
  }
  const r = ejecutarAccionLegada(datos);
  return ses.rol === 'persona' && typeof segFiltrarPersona === 'function' ? segFiltrarPersona(accion, r, ses) : r;
}

// ═══════════════════════════════════════════════════════════
//  Sesiones
// ═══════════════════════════════════════════════════════════

function segProps() { return PropertiesService.getScriptProperties(); }
function segCache() { return CacheService.getScriptCache(); }
function segSha(texto) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8);
  return b.map(x => ((x + 256) % 256).toString(16).padStart(2, '0')).join('');
}
function segToken() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function segCrearSesion(datos, ms) {
  const token = segToken();
  const id = segSha(token).slice(0, 24);
  segProps().setProperty('PSES_' + id, JSON.stringify(Object.assign({ id, creada: new Date().toISOString(), vence: Date.now() + ms }, datos)));
  segLimpiarSesiones();
  return token;
}

function segLeerSesion(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const id = segSha(token).slice(0, 24);
  const raw = segProps().getProperty('PSES_' + id);
  if (!raw) return null;
  const ses = JSON.parse(raw);
  if (Date.now() > ses.vence) { segProps().deleteProperty('PSES_' + id); return null; }
  return ses;
}

// Lee una sesión por su id (no por el token), revisando que no haya vencido.
function segLeerSesion0(id) {
  const raw = segProps().getProperty('PSES_' + id);
  if (!raw) return null;
  const ses = JSON.parse(raw);
  return Date.now() > ses.vence ? null : ses;
}

function segLimpiarSesiones() {
  const todas = segProps().getProperties();
  Object.keys(todas).forEach(k => {
    if (k.indexOf('PSES_') !== 0) return;
    try { if (JSON.parse(todas[k]).vence < Date.now()) segProps().deleteProperty(k); }
    catch (e) { segProps().deleteProperty(k); }
  });
}

// ═══════════════════════════════════════════════════════════
//  Conexión con Asistencia (contraseña del dueño y PIN)
// ═══════════════════════════════════════════════════════════

function segAsistencia(action, datos) {
  const url = segProps().getProperty('ASISTENCIA_URL');
  const clave = segProps().getProperty('ASISTENCIA_CLAVE');
  if (!url || !clave) return { error: 'Falta conectar esta app con Asistencia (ver README, paso de configuración).', code: 'config' };
  const cuerpo = JSON.stringify(Object.assign({ action, servicio: SEG_SERVICIO, claveServicio: clave }, datos || {}));
  let d;
  try {
    d = JSON.parse(UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: cuerpo, muteHttpExceptions: true }).getContentText());
    if (d && d.code === 'version') {
      d = JSON.parse(UrlFetchApp.fetch(url + '?p=' + encodeURIComponent(cuerpo), { muteHttpExceptions: true }).getContentText());
    }
  } catch (e) {
    return { error: 'No se pudo conectar con Asistencia. Intenta de nuevo en un momento.', code: 'conexion' };
  }
  return d || { error: 'Asistencia no respondió.' };
}

function segPersonasAsistencia(forzar) {
  if (!forzar) { const c = segCache().get('seg_personas'); if (c) return JSON.parse(c); }
  const r = segAsistencia('srvPersonas');
  if (!r.success) return null;
  try { segCache().put('seg_personas', JSON.stringify(r.personas), 600); } catch (e) {}
  return r.personas;
}

// Personas con acceso (solo apps con rol de persona). Se guardan en las
// propiedades del script como lista de correos.
function segLeerPersonas() {
  try { return JSON.parse(segProps().getProperty('SEG_PERSONAS') || '[]'); } catch (e) { return []; }
}

function segGuardarPersonas(d) {
  const validos = (segPersonasAsistencia(true) || []).map(p => p.email.toLowerCase());
  const lista = [].concat(d.personas || []).map(x => String(x).trim().toLowerCase()).filter(x => validos.indexOf(x) >= 0);
  segProps().setProperty('SEG_PERSONAS', JSON.stringify(lista));
  return { ok: true, personas: lista };
}

function segPersonaVigente(ses) {
  if (!ses.dispositivoId) return false;
  const disp = segLeerSesion0(ses.dispositivoId);
  if (!disp || disp.rol !== 'dispositivo') return false;
  return segLeerPersonas().indexOf(String(ses.email).toLowerCase()) >= 0;
}

// ═══════════════════════════════════════════════════════════
//  Acciones de acceso
// ═══════════════════════════════════════════════════════════

function segEstado(d) {
  const ses = segLeerSesion(d.sesion);
  const disp = segLeerSesion(d.dispositivo);
  const dispOk = !!(disp && disp.rol === 'dispositivo');
  const r = {
    ok: true, version: SEG_VERSION, conPersonas: SEG_ACCIONES_PERSONA.length > 0,
    sesion: ses && (ses.rol === 'dueno' || (ses.rol === 'persona' && segPersonaVigente(ses))) ? { rol: ses.rol, nombre: ses.nombre || '' } : null,
    dispositivo: dispOk ? { nombre: disp.nombre } : null,
  };
  if (r.conPersonas && (dispOk || (ses && ses.rol === 'dueno'))) {
    const porEmail = {};
    (segPersonasAsistencia() || []).forEach(p => { porEmail[p.email.toLowerCase()] = p; });
    r.personas = segLeerPersonas().map(e => porEmail[e]).filter(p => p && p.tienePin).map(p => ({ email: p.email, nombre: p.nombre }));
  }
  return r;
}

function segVerificarDueno(password) {
  if (typeof password !== 'string' || !password) return { error: 'Escribe la contraseña.' };
  return segAsistencia('srvVerificarAdmin', { password });
}

function segLoginDueno(d) {
  const v = segVerificarDueno(d.password);
  if (!v.success) return segError(v.error || 'Clave incorrecta.', v.code || 'clave');
  const nombre = String(d.nombreDispositivo || 'Equipo del dueño').slice(0, 40);
  return {
    ok: true,
    token: segCrearSesion({ rol: 'dueno', nombre }, SEG_SESION_DUENO_DIAS * 86400000),
    dispositivo: SEG_ACCIONES_PERSONA.length && !segLeerSesion(d.dispositivo)
      ? segCrearSesion({ rol: 'dispositivo', nombre }, SEG_DISPOSITIVO_DIAS * 86400000) : null,
  };
}

function segAutorizarEquipo(d) {
  if (!SEG_ACCIONES_PERSONA.length) return segError('Esta app es solo del dueño.', 'permiso');
  const v = segVerificarDueno(d.password);
  if (!v.success) return segError(v.error || 'Clave incorrecta.', v.code || 'clave');
  const nombre = String(d.nombreDispositivo || 'Equipo').slice(0, 40);
  return { ok: true, dispositivo: segCrearSesion({ rol: 'dispositivo', nombre }, SEG_DISPOSITIVO_DIAS * 86400000) };
}

function segLoginPersona(d) {
  if (!SEG_ACCIONES_PERSONA.length) return segError('Esta app es solo del dueño.', 'permiso');
  const disp = segLeerSesion(d.dispositivo);
  if (!disp || disp.rol !== 'dispositivo') return segError('Este equipo no está autorizado.', 'dispositivo');
  const email = String(d.email || '').toLowerCase();
  if (segLeerPersonas().indexOf(email) < 0) return segError('Esa persona no tiene acceso a esta app.', 'permiso');
  const persona = (segPersonasAsistencia() || []).find(x => x.email.toLowerCase() === email);
  const v = segAsistencia('srvVerificarPin', { email: persona ? persona.email : email, pin: String(d.pin || '') });
  if (!v.success) return segError(v.error || 'PIN incorrecto', v.code || 'pin');
  const token = segCrearSesion({ rol: 'persona', email, nombre: v.nombre, dispositivoId: disp.id, dispositivoNombre: disp.nombre },
                               SEG_SESION_PERSONA_HORAS * 3600000);
  return { ok: true, token, nombre: v.nombre };
}

function segLogout(d) {
  const ses = segLeerSesion(d.sesion);
  if (ses) segProps().deleteProperty('PSES_' + ses.id);
  return { ok: true };
}

function segDatos(d, ses) {
  const todas = segProps().getProperties();
  const sesiones = Object.keys(todas).filter(k => k.indexOf('PSES_') === 0).map(k => JSON.parse(todas[k]))
    .filter(s => s.vence > Date.now())
    .map(s => ({ id: s.id, rol: s.rol, nombre: s.rol === 'persona' ? s.nombre + ' · ' + (s.dispositivoNombre || '') : s.nombre,
                 creada: s.creada, vence: new Date(s.vence).toISOString(), esta: s.id === ses.id }))
    .sort((a, b) => a.creada < b.creada ? 1 : -1);
  const personas = segPersonasAsistencia(true);
  return { ok: true, version: SEG_VERSION, asistencia: personas ? 'conectada' : 'sin conexión',
           conPersonas: SEG_ACCIONES_PERSONA.length > 0, personas: personas || [], elegidas: segLeerPersonas(), sesiones };
}

function segRevocar(d) {
  if (!/^[0-9a-f]{24}$/.test(String(d.id || ''))) return segError('Sesión inválida');
  segProps().deleteProperty('PSES_' + d.id);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
//  INSTALACIÓN — ejecutar desde el editor (Ejecutar ▸ instalarSeguridad)
// ═══════════════════════════════════════════════════════════
function instalarSeguridad() {
  const url = segProps().getProperty('ASISTENCIA_URL');
  const clave = segProps().getProperty('ASISTENCIA_CLAVE');
  if (!url || !clave) {
    Logger.log('FALTA CONFIGURAR: en Configuración del proyecto ▸ Propiedades del script, agrega ASISTENCIA_URL y ASISTENCIA_CLAVE (ver README).');
    return { ok: false };
  }
  const ping = segAsistencia('srvPing');
  if (!ping.success) {
    Logger.log('No se pudo conectar con Asistencia: ' + (ping.error || JSON.stringify(ping)));
    Logger.log('Revisa que Asistencia esté en v5.2.0 (con su nueva versión implementada) y que ASISTENCIA_CLAVE sea la de crearClaveServicioGastos().');
    return { ok: false, error: ping.error };
  }
  Logger.log('Conexión con Asistencia OK (v' + ping.version + ').');
  Logger.log('Seguridad de Gastos v' + SEG_VERSION + ' lista.');
  return { ok: true };
}
