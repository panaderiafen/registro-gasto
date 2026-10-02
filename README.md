# fën gastos · v2.0.0 (seguridad)

**App:** v2.0.0 · **Apps Script:** v2.0.0 (`Code.gs` + `Seguridad.gs`) · Requiere **Asistencia Apps Script v5.2.0** · 2 de octubre de 2026

Tercera entrega de la Fase 0 de Sistema Fën. Hasta ahora, cualquiera que tuviera la dirección del script podía leer tus gastos, registrar, editar o borrar. Desde esta versión, la app pide **tu contraseña de dueño**, la misma del panel de Asistencia, y el script la revisa en cada llamada. Las pantallas y el trabajo son los mismos.

## Qué cambia

| Antes (v1) | Ahora (v2) |
| --- | --- |
| El script aceptaba cualquier llamada, y un envío sin "action" registraba un gasto | Ninguna acción funciona sin sesión del dueño, tampoco el registro de gasto |
| La app se abría directo | Al abrir, pide la contraseña del dueño. Si marcas "Recordar en este equipo", la sesión dura 30 días; si no, mientras la pestaña esté abierta |
| Un registro podía guardarse dos veces si la conexión fallaba y se reintentaba | Cada escritura lleva una clave única: aunque llegue dos veces, se guarda una. Además, las escrituras se hacen con bloqueo |
| Si Google desviaba la llamada (con varias cuentas abiertas), fallaba | La app lo detecta y reintenta por otra vía |
| — | Abajo a la izquierda hay un botón **Salir** |

## Archivos

```
index.html     igual que v1 + 2 líneas que cargan fen-acceso.js     → GitHub (raíz del repo de Gastos)
fen-acceso.js  NUEVO: pantalla de entrada y conexión segura         → GitHub (junto a index.html)
Code.gs        el script de v1; su doPost ahora se llama
               ejecutarAccionLegada                                  → Apps Script (reemplaza al archivo que tiene doPost)
Seguridad.gs   NUEVO: recibe todas las llamadas y revisa la sesión   → Apps Script (archivo nuevo en el mismo proyecto)
README.md      este archivo                                          → GitHub (respaldo)
```

## Antes de empezar: Asistencia v5.2.0

1. En el Apps Script de **Asistencia** (la planilla real), reemplaza el código por `Code.gs` v5.2.0 y guarda.
2. Ve a **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Sin esto, la URL sigue respondiendo con la versión anterior.
3. Ejecuta `crearClaveServicioGastos`. En el registro aparece una clave `fsv-…`: cópiala directo en Gastos (paso 1.3) y no la guardes en ningún documento.
4. La clave de Producción no cambia, así que no hay que tocar nada en Producción.

## 1. Probar en una copia

1. En Drive, haz una copia de la planilla de Gastos y llámala `fen gastos PRUEBA`. Copia también la **dirección (ID)** de la copia: es la parte de la URL entre `/d/` y `/edit`.
2. Abre la copia y ve a **Extensiones → Apps Script**.
   - Si ahí aparece el código de Gastos, la copia trae su propio script. Sigue con el paso 3.
   - Si aparece vacío, el script está aparte: búscalo en [script.google.com](https://script.google.com) y usa **⋮ → Hacer una copia**.
3. En el script de la copia:
   - Reemplaza el archivo que tiene `function doPost` por `Code.gs`.
   - Crea un archivo nuevo **＋ → Secuencia de comandos** llamado `Seguridad` y pega `Seguridad.gs`.
   - **Importante:** en la primera línea de `Code.gs`, cambia el `SPREADSHEET_ID` por el ID de la copia (paso 1). Si no, la prueba escribiría en tu planilla real.
   - Guarda.
4. Ve a **⚙️ Configuración del proyecto → Propiedades del script** y agrega:
   - `ASISTENCIA_URL` = la misma URL de Asistencia que usaste en Producción.
   - `ASISTENCIA_CLAVE` = la clave `fsv-…` de Gastos.
5. Vuelve al editor, abre `Seguridad.gs` y ejecuta `instalarSeguridad`. Acepta los permisos. Debe decir "Conexión con Asistencia OK (v5.2.0)".
6. Ve a **Implementar → Nueva implementación → Aplicación web**, con "Ejecutar como: Yo" y "Acceso: Cualquier persona". Copia la URL.
7. En GitHub, sube la carpeta `prueba` del zip `prueba-gastos.zip` al repo de Gastos. Luego edita `prueba/index.html` con el lápiz ✏️: busca `const BACKEND_URL =` y pon entre comillas la URL del paso 6.
8. Abre la app de prueba (`…/prueba/`) y revisa la lista de verificación.

## 2. Pasar a producción

1. Haz una copia de respaldo de la planilla real.
2. En el script real, repite los pasos 1.3 (sin cambiar `SPREADSHEET_ID`), 1.4 y 1.5.
3. Ve a **Implementar → Gestionar implementaciones → ✏️ → Nueva versión → Implementar**. La URL no cambia.
4. En la raíz del repo, sube `index.html` y `fen-acceso.js`, y además `Code.gs`, `Seguridad.gs` y `README.md` como respaldo.
5. Abre la app y entra con tu contraseña. Marca "Recordar" en tu celular y en tu computador.

## Lista de verificación en la copia

- [ ] Al abrir pide la contraseña. `fen2026admin` o una clave mala da error, y la tuya entra.
- [ ] Registrar un gasto sin foto y otro con foto: los dos aparecen en "Últimos registros" y en la planilla de prueba.
- [ ] Editar y eliminar un gasto.
- [ ] **Obligaciones:** se ven los vencimientos y se puede registrar un pago.
- [ ] **Análisis** muestra los datos del mes.
- [ ] **Carga SII:** importar un archivo de prueba y ver el historial.
- [ ] **Ítems:** crear, mover y eliminar un ítem.
- [ ] Con "Recordar" marcado, al cerrar y volver a abrir la app no pide la clave. Sin marcarlo, sí la pide.
- [ ] **Salir** vuelve a pedir la clave.

## Si algo sale mal

- **"Falta conectar esta app con Asistencia" o "No se pudo conectar":** revisa las dos propiedades del script y que Asistencia tenga implementada la v5.2.0. Ejecuta `instalarSeguridad` para ver el detalle.
- **Volver a v1:** en **Gestionar implementaciones**, vuelve a la versión anterior y restaura el `index.html` anterior desde el historial de GitHub. No se pierde ningún dato, porque v2 no cambia ninguna hoja.

## Pruebas automáticas

Corrieron en el simulador, con Gastos y Asistencia conectados y datos ficticios: 7 pruebas del script y 6 en el navegador (computador y celular). Cubren que nada funciona sin sesión (tampoco el registro sin "action", y una acción desconocida ya no registra un gasto), la contraseña del dueño, que un registro repetido no se duplica, "Recordar", "Salir", y que si Asistencia no responde se avisa claro.

## Riesgos conocidos (para el rediseño 2027)

- Las fotos de boletas en Drive quedan compartidas como "cualquiera con el enlace". Nadie las encuentra sin el enlace, pero quien lo tenga puede verlas. No lo cambio ahora porque puede afectar dónde se usan esos enlaces.
- Si existe una copia antigua de la app de Gastos en Netlify, dejará de funcionar con el script nuevo. Eso es lo esperado.
