# DCDG · Finanzas — Brief de diseño para rediseño de UI/UX

> **Para:** Claude Design (u otro agente/diseñador de UI).
> **Objetivo:** rediseñar la interfaz de la PWA de finanzas familiares DCDG. Hoy
> es funcional pero **poco estética y con fricciones de UX**. Se busca una
> propuesta visual moderna, cálida y confiable —tipo app fintech premium— sin
> perder la densidad de información ni romper las restricciones técnicas.

---

## 1. Qué es el producto

**DCDG Finanzas** es una **PWA móvil** (se instala en el celular) para llevar la
contabilidad de una familia (Luis + Carolina + hijos) con rigor de software
contable, pero con captura ágil "on-the-go". No es una app comercial: es interna,
para ~6 personas.

Dos grandes usos conviven:
1. **Captura rápida** de gastos/ingresos/transferencias (foto de factura, texto
   libre, o formulario), pensada para hacerse en segundos desde el celular.
2. **Contabilidad formal** de partida doble (plan de cuentas PUC, asientos,
   libro mayor, estados financieros) y **portal de consulta** para el equipo
   (contador, y dos personas más) en modo lectura.

La marca es sobria y financiera: hoy usa **azul marino** (`#1F3B6E`) como color
primario, verde-teal para acciones, y acentos dorado/rojo/morado por categoría.

## 2. Usuarios y roles

| Rol | Quién | Qué hace |
|-----|-------|----------|
| **owner** | Luis, Carolina | Capturan, editan, montan saldos, todo. |
| **equipo (solo lectura)** | Contador (Santiago), María Isabel, Ángela | Consultan reportes/estados; no escriben. |

La UI ya distingue roles: a los de solo-lectura se les ocultan botones de captura/edición. El rediseño debe respetar esa distinción (una vista "consulta" más limpia para el equipo tiene mucho sentido).

## 3. Restricciones técnicas (importantes para el diseño)

- **PWA de una sola página**, mobile-first. Todo vive en `app/index.html` con
  **CSS inline** en un `<style>` y **JavaScript vanilla** (sin framework, sin
  Tailwind, sin librerías de componentes). Vite hace el build.
- **Navegación por "pantallas"**: cada sección es un `<div class="scr" id="scr-*">`
  y se muestra/oculta con la clase `.on` (una visible a la vez). No hay router.
- **Ancho máximo 430px** (`#app{max-width:430px;margin:0 auto}`) — diseño de
  teléfono, centrado en desktop. Debe verse bien en notch/safe-area de iOS.
- **Dark mode** ya soportado vía `@media(prefers-color-scheme:dark)`. Mantenerlo.
- Se prefieren **emojis** como iconografía hoy (no hay set de íconos SVG). Se
  puede proponer un set de íconos, pero considerar el costo de inline SVG.
- El header es **sticky** y hoy acumula **13 íconos** de navegación (problema, ver §6).
- Sin backend de assets externos: fuentes del sistema (`-apple-system`…). Cualquier
  fuente custom debe poder incrustarse o servirse desde el mismo dominio.

## 4. Sistema visual actual (tokens y componentes)

### Paleta (CSS custom properties)
```
--navy:#1F3B6E  --navy-d:#131E3A  --blue:#2E5FA3  --blue-l:#E6F1FB
--teal:#0F6E56  --teal-l:#E1F5EE  --teal-m:#5DCAA5
--gold:#F0A500  --gold-l:#FFF3CD   --red:#C0392B  --red-l:#FDECEA
--green:#1A7A4A --green-l:#D6F0E3   --purple:#534AB7 --purple-l:#EEEDFE
--gray:#F4F5F6  --gray-m:#D1D5DB   --gray-d:#6B7280  --text:#111827
--r:12px (radio)  --r-s:8px  --sh / --sh-m (sombras suaves)
```
Tipografía: stack del sistema, base 16px. Números grandes en peso 800 y tracking negativo.

### Componentes existentes (clases)
- `.hdr` header navy sticky con título + badge de conexión + fila de íconos.
- `.card` tarjeta blanca con sombra; `.card-ttl` rótulo mayúsculas gris.
- `.fld` campo de formulario (label mayúsculas + input); `.row2` grid 2 columnas.
- `.btn` (variantes `-p` teal primario, `-s` secundario, `-d` peligro).
- `.act-btn` botones grandes de acción con ícono en cuadro y gradiente (Home).
- `.h-item` fila de lista (nombre izq. / monto der.).
- `.cfb` chip de confianza (alta/media/baja) para la clasificación por IA.
- `.tw` aviso de umbral, `.iwin-notice` aviso morado, `.pdf-notice`.
- `.seg` control segmentado (Este mes / Mes pasado / Año) del dashboard.
- `.bar-row/.bar-fill` barras horizontales del dashboard por categoría.
- `.spin` spinner, `.suc-ico` check de éxito, `.toast`, `.empty`, `.chip`.

## 5. Inventario de pantallas (24 secciones)

Cada una es un `scr-*`. El header con los íconos está siempre visible.

| Pantalla | Ícono | Rol | Propósito |
|---|---|---|---|
| **login** | — | todos | Google Sign-In (botón oficial). Puerta de entrada. |
| **setup** | — | 1ª vez | Config inicial (Client ID / Spreadsheet). Se ve una sola vez. |
| **home** | 🏠 | todos | **Tablero**: saldos en bancos, pagos del mes pendientes/vencidos, comparativo mes vs. mes, y accesos rápidos. *(Es la que se ve fea/vacía primero.)* |
| **registrar** | (acceso desde Home) | owner | **Registrar egresos**: captura de gasto por Foto / Galería / Texto / CET / Transferencia. |
| **conf** | — | owner | Confirmar/editar lo que la IA clasificó antes de guardar (categoría, monto, cuenta, chip de confianza, avisos). |
| **proc** | — | — | Pantalla de "procesando" (spinner). |
| **ok** | — | — | Éxito (check grande + monto + detalle). |
| **text** | — | owner | Entrada por texto libre con chips de ejemplo. |
| **cet** | — | owner | Comprobante de Egreso/Transferencia (formulario que arma un correo). |
| **transfer** | — | owner | Transferencia entre cuentas propias. |
| **ingreso** | 💵 | owner | Registrar un ingreso (salario, honorarios, ventas, etc.). |
| **dash** | 📊 | todos | **Dashboard**: total del periodo (segmentado mes/mes/año), variación %, barras por categoría. |
| **extractos** | 🧾 | owner | Cargar extracto bancario (CSV o PDF con contraseña). |
| **conciliacion** | 🔗 | owner | Conciliar extracto vs. lo capturado; backfill de líneas del banco. |
| **pagos** | 📅 | todos | **Pagos del mes**: lista de pagos fijos (arriendo, colegio, servicios…) con estado ✅/⏳/🔴. |
| **prestamos** | 🤝 | owner | Préstamos entre Luis y Carolina (saldo neto). |
| **solicitudes** | 💡 | todos | Pedir mejoras a la app (crea issues). |
| **aportes** | 🧮 | todos | Aportes IBC por persona (seguridad social). |
| **apertura** | 🏦 | owner | Saldos iniciales / asiento de apertura (montar saldos por cuenta). |
| **mayor** | 📒 | todos | Libro Mayor + Balance de Comprobación (contable, tablas). |
| **estados** | 📈 | todos | Estado de Resultados + Balance General. |
| **exports** | 📥 | todos | Descargar reportes contables en CSV. |
| **settings** | ⚙ | owner | Configuración / cerrar sesión. |
| **history** | — | — | Historial local reciente de capturas. |

## 6. Problemas de UI/UX detectados (qué arreglar)

1. **Header sobrecargado:** 13 íconos-emoji en una sola fila del header. No caben
   bien, no comunican jerarquía, y es difícil encontrar lo que se busca. Necesita
   un modelo de navegación mejor (tab bar inferior + "más", menú agrupado, o
   secciones colapsables por dominio: *Capturar · Consultar · Contabilidad · Config*).
2. **Estética plana/anticuada:** tarjetas blancas planas, mucho gris, poca
   jerarquía visual. Se siente "hoja de cálculo con estilos" más que app fintech.
   Falta calidez, profundidad y un lenguaje visual con personalidad.
3. **Home poco resuelto:** los bloques (saldos, pagos, comparativo) se ven
   sueltos y en "Cargando…" al abrir; falta un hero/resumen claro del estado
   financiero del mes de un vistazo, y micro-jerarquía (qué es urgente hoy).
4. **Densidad e inconsistencia:** rótulos en mayúsculas por todos lados,
   tamaños/pesos poco sistemáticos, listas monótonas (nombre-izq/monto-der) que
   no diferencian tipos (gasto vs. ingreso vs. transferencia vs. pago).
5. **Feedback de estado pobre:** el badge "Conectado/Sin conectar", los estados
   de pago (✅/⏳/🔴) y la confianza de la IA se comunican con emojis sueltos;
   podrían ser componentes de estado más legibles y accesibles.
6. **Formularios largos** (captura, ingreso, CET, apertura) sin agrupación visual
   ni progreso; se sienten pesados en móvil.
7. **Modo consulta del equipo:** hoy es la misma UI con botones ocultos; el
   contador/María Isabel/Ángela merecen una vista de solo-lectura más limpia y
   orientada a reportes.

## 7. Lo que se busca del rediseño

- **Estética "fintech premium" pero cálida y familiar** (es la plata de una
  familia, no un banco frío): confianza, claridad, un toque humano.
- **Sistema de diseño coherente**: escala tipográfica, espaciado, jerarquía de
  color por significado (ingreso/gasto/saldo/alerta), estados y componentes
  reutilizables. Que se pueda expresar como CSS custom properties + clases
  (no framework).
- **Navegación repensada** para ~20 secciones sin saturar (probablemente **tab
  bar inferior** con 4–5 destinos principales + un "Más"/menú agrupado).
- **Home como centro de mando**: de un vistazo, "cuánto hay, qué se debe, qué
  falta pagar, cómo voy vs. el mes pasado".
- **Dark mode** de primera clase (no un parche).
- Respetar el ancho 430px, safe-areas iOS, y que todo se pueda implementar con
  HTML + CSS inline + JS vanilla.

### Entregables ideales de la propuesta
1. **Dirección visual** (moodboard/estilo, paleta refinada, tipografía, radios,
   sombras, iconografía).
2. **Sistema de componentes** (botones, tarjetas, listas por tipo, chips de
   estado, campos, tab bar, encabezados).
3. **Rediseño de 3–5 pantallas clave**: **Home**, **Registrar egresos/captura**,
   **Dashboard**, **Pagos del mes**, y una **vista de reporte** (Estados/Mayor).
4. Notas de accesibilidad (contraste, tamaños táctiles) y de dark mode.

### Fuera de alcance
- Lógica de negocio, backend, contabilidad de partida doble (ya existe y funciona).
- No cambiar los nombres de las secciones ni los flujos de datos; sí su presentación.

---

*Contexto técnico de referencia: la implementación actual está en
`app/index.html` (estilos + markup) y `app/src/` (JS por módulos). El sistema de
tokens y componentes del §4 se puede leer literal en el `<style>` de
`app/index.html`.*
