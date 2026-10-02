// ═══════════════════════════════════════════════════════════
//  fën — Acceso v2.0.0 (2026-10-02)
//  Pantalla de entrada + conexión segura con el Apps Script.
//  Va antes del código de la app:
//    <script>window.FEN_ACCESO = { app:'gastos', nombre:'Registro de Gastos', version:'2.0.0' };</script>
//    <script src="fen-acceso.js"></script>
//
//  · Pide la contraseña del dueño (la misma del panel de Asistencia) o, en
//    apps con personas, el PIN de Asistencia de quien entra.
//  · Toda llamada de la app al Apps Script pasa por aquí: se le agrega la
//    sesión y una clave única (idem), y si Google desvía el POST se reintenta
//    por GET. Si no hay sesión, la llamada espera a que alguien entre.
//  · Este archivo es público: aquí NO va ninguna clave.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const CFG = Object.assign({ app: 'app', nombre: 'fën', version: '', conPersonas: false }, window.FEN_ACCESO || {});
  const K = { dueno: 'fen_' + CFG.app + '_dueno', persona: 'fen_' + CFG.app + '_persona', disp: 'fen_' + CFG.app + '_equipo' };
  const _fetch = window.fetch.bind(window);
  const leer = (a, k) => { try { return a.getItem(k); } catch (e) { return null; } };
  const poner = (a, k, v) => { try { v ? a.setItem(k, v) : a.removeItem(k); } catch (e) {} };

  const Ses = {
    dueno: () => leer(localStorage, K.dueno) || leer(sessionStorage, K.dueno),
    persona: () => leer(sessionStorage, K.persona),
    disp: () => leer(localStorage, K.disp),
    actual() { return this.persona() || this.dueno(); },
    setDueno(t, recordar) { poner(localStorage, K.dueno, recordar ? t : null); poner(sessionStorage, K.dueno, recordar ? null : t); },
    setPersona(t) { poner(sessionStorage, K.persona, t); },
    setDisp(t) { poner(localStorage, K.disp, t); },
    limpiar() { this.setDueno(null); this.setPersona(null); },
  };

  let rol = null, nombre = '', esperando = null, resolverEspera = null, estado = null;

  function urlBackend() {
    if (typeof CFG.url === 'function') return CFG.url();
    if (CFG.url) return CFG.url;
    try { return BACKEND_URL; } catch (e) {} // const global de la app
    try { return GS; } catch (e) {}
    return '';
  }
  const idem = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));

  // A veces Google entrega una página de error en vez del JSON (de forma
  // intermitente). Se reintenta hasta 3 veces con la MISMA clave idem, así
  // una escritura que sí alcanzó a hacerse no se repite.
  // La contraseña y los PIN solo se envían a un Apps Script de Google (o al
  // servidor de pruebas local): nunca a otra dirección que alguien haya puesto.
  function urlConfiable(u) { return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u) || /^\/[\w\/-]*$/.test(u); }

  async function llamarCrudo(cuerpo) {
    const url = urlBackend();
    if (!urlConfiable(url)) {
      const m = 'La dirección del script no es de Google Apps Script. Revisa la configuración.';
      return { ok: false, status: 'error', code: 'url', msg: m, message: m, error: m };
    }
    const texto = JSON.stringify(cuerpo);
    for (let intento = 1; intento <= 3; intento++) {
      try {
        let d = await (await _fetch(url, { method: 'POST', body: texto, cache: 'no-store' })).json();
        if (d && d.code === 'version') d = await (await _fetch(url + '?p=' + encodeURIComponent(texto), { cache: 'no-store' })).json();
        return d;
      } catch (e) {
        if (intento < 3) await new Promise(r => setTimeout(r, 700 * intento));
      }
    }
    const m = 'Sin conexión con el servidor o respuesta inválida de Google. Intenta de nuevo.';
    return { ok: false, status: 'error', code: 'red', msg: m, message: m, error: m };
  }

  // Llamada de la app: espera sesión, agrega token e idem, y si la sesión
  // venció pide entrar de nuevo y reintenta una vez con la misma clave idem.
  async function llamar(datos) {
    const clave = idem();
    for (let intento = 0; intento < 2; intento++) {
      if (!Ses.actual()) await pedirEntrada();
      const enviado = Ses.actual();
      const d = await llamarCrudo(Object.assign({}, datos, { token: enviado, idem: clave }));
      if (d && d.code === 'sesion') {
        if (Ses.actual() === enviado) { Ses.limpiar(); rol = null; } // si ya entró de nuevo, no se borra la sesión nueva
        continue;
      }
      return d;
    }
    return { ok: false, status: 'error', code: 'sesion', msg: 'Sesión vencida', message: 'Sesión vencida' };
  }

  window.fetch = async function (recurso, init) {
    const url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
    const base = urlBackend();
    if (!base || url.indexOf(base) !== 0) return _fetch(recurso, init);
    let datos = {};
    try {
      if (init && typeof init.body === 'string') datos = JSON.parse(init.body);
      else {
        const q = new URLSearchParams(url.split('?')[1] || '');
        const p = q.get('payload') || q.get('p');
        if (p) datos = JSON.parse(p);
        else q.forEach((v, k) => { datos[k] = v; });
      }
    } catch (e) { datos = {}; }
    const d = await llamar(datos);
    return new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  // ── Interfaz ──────────────────────────────────────────────
  const css = `
  .fa-fondo{position:fixed;inset:0;z-index:99990;background:#fff3e9;display:flex;align-items:center;justify-content:center;padding:16px;font-family:'DM Sans',system-ui,sans-serif;color:#1a1714}
  .fa-caja{background:#fff;border:1px solid #e2ddd8;border-radius:22px;box-shadow:0 8px 32px rgba(0,0,0,.10);width:380px;max-width:100%;padding:28px 24px;text-align:center}
  .fa-caja img{width:64px;height:64px;object-fit:contain;border-radius:16px;margin-bottom:10px}
  .fa-caja h2{font-size:19px;font-weight:600;margin:4px 0 6px}
  .fa-caja p{font-size:13.5px;color:#5c5751;line-height:1.55;margin:0 0 14px}
  .fa-caja input[type=password],.fa-caja input[type=text]{width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid #e2ddd8;border-radius:10px;font:inherit;font-size:15px;margin-bottom:10px}
  .fa-caja input:focus{outline:none;border-color:#003a79}
  .fa-rec{display:flex;align-items:center;gap:8px;font-size:13px;color:#5c5751;text-align:left;margin:2px 0 6px;cursor:pointer}
  .fa-btn{width:100%;padding:12px;border:none;border-radius:10px;background:#003a79;color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer;margin-top:6px}
  .fa-btn.sec{background:#fff;color:#003a79;border:1.5px solid #e2ddd8}
  .fa-btn:disabled{opacity:.6}
  .fa-err{min-height:18px;font-size:13px;color:#C62828;margin:6px 0 0}
  .fa-pie{font-size:11px;color:#9c9690;margin-top:16px}
  .fa-i{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#e8eef5;color:#003a79;font:italic 700 10px Georgia,serif;cursor:help;position:relative;margin-left:4px;vertical-align:1px}
  .fa-i:hover::after,.fa-i:focus::after{content:attr(data-info);position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);width:240px;max-width:78vw;padding:10px 12px;border-radius:6px;background:#1a1714;color:#fff;font:400 12px/1.5 system-ui,sans-serif;text-align:left;z-index:99999}
  .fa-personas{display:flex;flex-direction:column;gap:8px;margin:6px 0 12px}
  .fa-persona{padding:13px;border:1.5px solid #e2ddd8;border-radius:10px;background:#fff;font:inherit;font-size:15px;cursor:pointer}
  .fa-persona:hover{border-color:#003a79}
  .fa-puntos{display:flex;gap:14px;justify-content:center;margin:12px 0 4px}
  .fa-puntos span{width:15px;height:15px;border-radius:50%;border:2px solid #ccc8c2}
  .fa-puntos span.lleno{background:#003a79;border-color:#003a79}
  .fa-teclas{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:10px}
  .fa-tecla{height:56px;border:1.5px solid #e2ddd8;border-radius:10px;background:#fff;font:inherit;font-size:21px;cursor:pointer}
  .fa-tecla.acc{background:#f7f4ef;color:#5c5751}
  .fa-salir{position:fixed;left:12px;bottom:12px;z-index:9000;display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e2ddd8;border-radius:99px;padding:6px 8px 6px 12px;font:12px 'DM Sans',system-ui,sans-serif;color:#5c5751;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .fa-salir button{border:none;background:#003a79;color:#fff;border-radius:99px;padding:5px 12px;font:inherit;font-weight:600;cursor:pointer}
  body.fa-con-salir{padding-bottom:60px}
  .fa-seg{font-family:'DM Sans',system-ui,sans-serif}
  .fa-seg-fila,.fa-seg-ses{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .fa-seg-ses{padding:9px 0;border-bottom:1px solid #eee;font-size:13px}
  .fa-seg-ses small,.fa-seg-check small{display:block;color:#9c9690;font-size:11px}
  .fa-seg-sub{font-weight:600;font-size:14px;margin:16px 0 8px}
  .fa-seg-lista{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
  .fa-seg-check{display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;color:#1a1714;margin:0}
  .fa-seg-check small{text-transform:none;letter-spacing:0;font-weight:400}
  .fa-seg-check input{width:auto;margin-top:3px}
  .fa-chip{font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px}
  .fa-chip.ok{background:#E8F5E9;color:#2E7D32}.fa-chip.mal{background:#FFEBEE;color:#C62828}
  @media print{.fa-salir{display:none}}`;
  function inyectarCss() {
    if (document.getElementById('fa-css')) return;
    const st = document.createElement('style'); st.id = 'fa-css'; st.textContent = css; document.head.appendChild(st);
  }
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function pantalla(html) {
    inyectarCss();
    let f = document.getElementById('fa-fondo');
    if (!f) { f = document.createElement('div'); f.id = 'fa-fondo'; f.className = 'fa-fondo'; document.body.appendChild(f); }
    f.innerHTML = `<div class="fa-caja"><img src="logosecundario.jpg" alt="" onerror="this.remove()">${html}
      <div class="fa-pie">${esc(CFG.nombre)} · app v${esc(CFG.version)}</div></div>`;
    const i = f.querySelector('input'); if (i) setTimeout(() => i.focus(), 30);
    return f;
  }
  function cerrarPantalla() { const f = document.getElementById('fa-fondo'); if (f) f.remove(); }

  function pedirEntrada() {
    if (!esperando) {
      esperando = new Promise(r => { resolverEspera = r; });
      mostrarInicio();
    }
    return esperando;
  }
  function entro(nuevoRol, nuevoNombre) {
    rol = nuevoRol; nombre = nuevoNombre || '';
    document.body.classList.toggle('fa-rol-persona', rol === 'persona');
    document.body.classList.toggle('fa-rol-dueno', rol === 'dueno');
    cerrarPantalla();
    pintarSalir();
    const r = resolverEspera; esperando = null; resolverEspera = null;
    if (r) r();
    document.dispatchEvent(new CustomEvent('fen-acceso', { detail: { rol, nombre } }));
  }

  async function mostrarInicio() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', mostrarInicio, { once: true }); return; }
    if (CFG.conPersonas && !estado) {
      pantalla('<p>Cargando…</p>');
      estado = await llamarCrudo({ action: 'seg_estado', dispositivo: Ses.disp() });
    }
    if (!CFG.conPersonas || !estado || !estado.ok) { formDueno(); return; }
    const personas = estado.personas || [];
    const f = pantalla(`<h2>¿Quién entra?</h2>
      ${Ses.disp() && personas.length ? `<div class="fa-personas">${personas.map((p, i) => `<button class="fa-persona" data-i="${i}">${esc(p.nombre)}</button>`).join('')}</div>` : ''}
      ${!Ses.disp() ? `<p>Este equipo aún no está autorizado para el equipo de trabajo.
        <span class="fa-i" tabindex="0" data-info="La primera vez, el dueño escribe su contraseña para autorizar este equipo. Después, cada persona entra con su PIN de Asistencia.">i</span></p>
        <button class="fa-btn sec" id="fa-autorizar">Autorizar este equipo</button>` : ''}
      <button class="fa-btn" id="fa-dueno">Entrar como dueño</button>`);
    f.querySelectorAll('.fa-persona').forEach(b => { b.onclick = () => formPin(personas[Number(b.dataset.i)]); });
    f.querySelector('#fa-dueno').onclick = formDueno;
    const a = f.querySelector('#fa-autorizar'); if (a) a.onclick = formAutorizar;
  }

  function formDueno() {
    const f = pantalla(`<h2>${esc(CFG.nombre)}</h2>
      <p>Escribe la contraseña del dueño: es la misma del panel de Asistencia.</p>
      <form id="fa-form" autocomplete="off">
        <input type="password" id="fa-clave" placeholder="Contraseña" autocomplete="current-password">
        <label class="fa-rec"><input type="checkbox" id="fa-recordar"> Recordar en este equipo por 30 días
          <span class="fa-i" tabindex="0" data-info="Márcalo solo en tu computador o tu celular. Si no lo marcas, la sesión dura mientras la pestaña esté abierta.">i</span></label>
        <button class="fa-btn" type="submit" id="fa-ok">Entrar</button>
        ${CFG.conPersonas ? '<button class="fa-btn sec" type="button" id="fa-volver">Volver</button>' : ''}
        <div class="fa-err" id="fa-err"></div>
      </form>`);
    const v = f.querySelector('#fa-volver'); if (v) v.onclick = mostrarInicio;
    f.querySelector('#fa-form').onsubmit = async ev => {
      ev.preventDefault();
      const clave = f.querySelector('#fa-clave').value;
      if (!clave) return;
      const btn = f.querySelector('#fa-ok'); btn.disabled = true; btn.textContent = 'Revisando…';
      const r = await llamarCrudo({ action: 'seg_login_dueno', password: clave, dispositivo: Ses.disp(), nombreDispositivo: 'Equipo del dueño' });
      if (r && r.ok) {
        Ses.setPersona(null);
        Ses.setDueno(r.token, f.querySelector('#fa-recordar').checked);
        if (r.dispositivo) Ses.setDisp(r.dispositivo);
        entro('dueno', 'Dueño');
      } else {
        btn.disabled = false; btn.textContent = 'Entrar';
        f.querySelector('#fa-err').textContent = (r && (r.msg || r.error)) || 'No se pudo entrar.';
      }
    };
  }

  function formAutorizar() {
    const f = pantalla(`<h2>Autorizar este equipo</h2>
      <p>Una sola vez por equipo. Escribe la contraseña del dueño y un nombre para reconocerlo.</p>
      <form id="fa-form" autocomplete="off">
        <input type="password" id="fa-clave" placeholder="Contraseña del dueño">
        <input type="text" id="fa-equipo" placeholder="Nombre del equipo (ej. Celular despacho)" maxlength="40">
        <button class="fa-btn" type="submit" id="fa-ok">Autorizar</button>
        <button class="fa-btn sec" type="button" id="fa-volver">Volver</button>
        <div class="fa-err" id="fa-err"></div>
      </form>`);
    f.querySelector('#fa-volver').onclick = mostrarInicio;
    f.querySelector('#fa-form').onsubmit = async ev => {
      ev.preventDefault();
      const btn = f.querySelector('#fa-ok'); btn.disabled = true;
      const r = await llamarCrudo({ action: 'seg_autorizar_equipo', password: f.querySelector('#fa-clave').value, nombreDispositivo: f.querySelector('#fa-equipo').value.trim() });
      if (r && r.ok) { Ses.setDisp(r.dispositivo); estado = null; mostrarInicio(); return; }
      btn.disabled = false;
      f.querySelector('#fa-err').textContent = (r && (r.msg || r.error)) || 'No se pudo autorizar.';
    };
  }

  function formPin(persona) {
    let pin = '', enviando = false;
    const f = pantalla(`<h2>${esc(persona.nombre)}</h2>
      <p>Tu PIN de Asistencia <span class="fa-i" tabindex="0" data-info="El mismo PIN de 4 dígitos con el que marcas en la tablet.">i</span></p>
      <div class="fa-puntos"><span></span><span></span><span></span><span></span></div>
      <div class="fa-err" id="fa-err"></div>
      <div class="fa-teclas">${[1,2,3,4,5,6,7,8,9].map(n => `<button class="fa-tecla" data-n="${n}">${n}</button>`).join('')}
        <button class="fa-tecla acc" data-n="x" aria-label="Volver">✕</button><button class="fa-tecla" data-n="0">0</button>
        <button class="fa-tecla acc" data-n="b" aria-label="Borrar">⌫</button></div>`);
    const puntos = f.querySelectorAll('.fa-puntos span');
    const pintar = () => puntos.forEach((p, i) => p.classList.toggle('lleno', i < pin.length));
    const tecla = async n => {
      if (enviando) return;
      if (n === 'x') { mostrarInicio(); return; }
      if (n === 'b') { pin = pin.slice(0, -1); pintar(); return; }
      if (pin.length >= 4) return;
      pin += n; pintar(); f.querySelector('#fa-err').textContent = '';
      if (pin.length < 4) return;
      enviando = true; f.querySelector('#fa-err').textContent = 'Revisando…';
      const r = await llamarCrudo({ action: 'seg_login_persona', dispositivo: Ses.disp(), email: persona.email, pin });
      if (r && r.ok) { Ses.setPersona(r.token); entro('persona', r.nombre); return; }
      if (r && r.code === 'dispositivo') { Ses.setDisp(null); estado = null; }
      pin = ''; pintar(); enviando = false;
      f.querySelector('#fa-err').textContent = (r && (r.msg || r.error)) || 'No se pudo entrar.';
    };
    f.querySelectorAll('.fa-tecla').forEach(b => { b.onclick = () => tecla(b.dataset.n); });
    f.tabIndex = -1; f.focus();
    f.onkeydown = ev => { if (/^\d$/.test(ev.key)) tecla(ev.key); else if (ev.key === 'Backspace') tecla('b'); };
  }

  function pintarSalir() {
    inyectarCss();
    let s = document.getElementById('fa-salir');
    if (!s) { s = document.createElement('div'); s.id = 'fa-salir'; s.className = 'fa-salir'; document.body.appendChild(s); }
    s.innerHTML = `<span>${esc(nombre)}</span><button type="button">Salir</button>`;
    document.body.classList.add('fa-con-salir'); // deja espacio para que el botón no tape el final de la página
    s.querySelector('button').onclick = salir;
  }

  async function salir() {
    const tokens = [Ses.persona(), Ses.dueno()].filter(Boolean);
    Ses.limpiar(); rol = null;
    tokens.forEach(t => llamarCrudo({ action: 'seg_logout', sesion: t }));
    const s = document.getElementById('fa-salir'); if (s) s.remove();
    location.reload();
  }

  // Al abrir: si hay una sesión guardada se comprueba; si no, se pide entrar.
  async function inicio() {
    if (!urlBackend()) return;
    const anterior = Ses.persona();
    Ses.setPersona(null); // una persona vuelve a poner su PIN al recargar
    if (anterior) llamarCrudo({ action: 'seg_logout', sesion: anterior }); // y su sesión anterior se cierra // la app aún no tiene la dirección del script: se pedirá entrar en la primera llamada
    const t = Ses.dueno();
    if (t) {
      const r = await llamarCrudo({ action: 'seg_estado', sesion: t, dispositivo: Ses.disp() });
      estado = r && r.ok ? r : null;
      if (r && r.ok && r.sesion && r.sesion.rol === 'dueno') { entro('dueno', 'Dueño'); return; }
      if (r && r.ok) Ses.setDueno(null);
    }
    pedirEntrada();
  }

  // ── Panel "Seguridad" para el dueño (personas con acceso y sesiones) ──
  async function renderSeguridad(el) {
    if (!el) return;
    inyectarCss();
    el.innerHTML = '<div style="color:#888;font-size:13px">Cargando…</div>';
    const d = await llamar({ action: 'seg_datos' });
    if (!d || !d.ok) { el.innerHTML = `<div style="color:#C62828;font-size:13px">${esc((d && (d.msg || d.error)) || 'No se pudo cargar')}</div>`; return; }
    const fecha = iso => new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
    const rolTxt = { dueno: 'Dueño', persona: 'Persona', dispositivo: 'Equipo autorizado' };
    el.innerHTML = `
      <div class="fa-seg">
        <div class="fa-seg-fila"><strong>Conexión con Asistencia</strong>
          <span class="fa-chip ${d.asistencia === 'conectada' ? 'ok' : 'mal'}">${d.asistencia === 'conectada' ? 'Conectada' : 'Sin conexión'}</span></div>
        ${d.conPersonas ? `
        <div class="fa-seg-sub">${esc(CFG.etiquetaPersonas || 'Personas con acceso')}
          <span class="fa-i" tabindex="0" data-info="${esc(CFG.ayudaPersonas || 'Entran con su PIN de Asistencia desde un equipo autorizado.')}">i</span></div>
        <div class="fa-seg-lista">${d.personas.map(p => `<label class="fa-seg-check"><input type="checkbox" value="${esc(p.email)}" ${d.elegidas.includes(p.email.toLowerCase()) ? 'checked' : ''}>
          <span>${esc(p.nombre)}${p.tienePin ? '' : '<small>Sin PIN: no podrá entrar hasta que le asignes uno en Asistencia</small>'}</span></label>`).join('')}</div>
        <button type="button" class="fa-btn" id="fa-seg-guardar" style="width:auto;padding:9px 16px">Guardar</button> <span id="fa-seg-msg" style="font-size:13px;color:#5c5751"></span>` : ''}
        <div class="fa-seg-sub">Equipos y sesiones abiertas
          <span class="fa-i" tabindex="0" data-info="Si pierdes un equipo, ciérralo aquí: tendrá que autorizarse o entrar de nuevo.">i</span></div>
        ${d.sesiones.map(s => `<div class="fa-seg-ses"><div><strong>${esc(s.nombre || '—')}</strong><br><small>${rolTxt[s.rol] || s.rol} · desde ${fecha(s.creada)} · vence ${fecha(s.vence)}</small></div>
          ${s.esta ? '<span class="fa-chip ok">Esta sesión</span>' : `<button type="button" class="fa-btn sec fa-seg-cerrar" data-id="${s.id}" style="width:auto;padding:7px 14px;margin:0">Cerrar</button>`}</div>`).join('') || '<div style="font-size:13px;color:#888">No hay sesiones abiertas.</div>'}
        <div style="font-size:11px;color:#9c9690;margin-top:10px">${esc(CFG.nombre)} · app v${esc(CFG.version)} · Apps Script v${esc(d.version)}</div>
      </div>`;
    const g = el.querySelector('#fa-seg-guardar');
    if (g) g.onclick = async () => {
      g.disabled = true;
      const personas = [...el.querySelectorAll('.fa-seg-check input:checked')].map(c => c.value);
      const r = await llamar({ action: 'seg_guardar_personas', personas });
      g.disabled = false;
      el.querySelector('#fa-seg-msg').textContent = r && r.ok ? 'Guardado.' : ((r && (r.msg || r.error)) || 'No se pudo guardar.');
    };
    el.querySelectorAll('.fa-seg-cerrar').forEach(b => {
      b.onclick = async () => {
        if (!confirm('¿Cerrar esta sesión? Ese equipo o persona tendrá que entrar de nuevo.')) return;
        await llamar({ action: 'seg_revocar', id: b.dataset.id });
        renderSeguridad(el);
      };
    });
  }

  window.FenAcceso = { rol: () => rol, nombre: () => nombre, salir, llamar, renderSeguridad, cuandoEntre: () => (rol ? Promise.resolve() : pedirEntrada()) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicio, { once: true });
  else inicio();
})();
