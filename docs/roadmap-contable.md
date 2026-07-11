# Roadmap contable/financiero DCDG

> Documento vivo para revisión del equipo financiero/contable. Las reglas y
> tarifas fiscales aquí descritas son **para validación de los contadores** — el
> sistema produce los reportes y la trazabilidad; la firma y las tarifas del año
> las pone el profesional.

## 1. Visión y horizontes

Hay **dos horizontes** y los abordamos en orden para no mezclarlos:

- **Horizonte 1 — Personal (Luis + Carolina).** Reportes financieros para la
  **declaración de renta personal**, los **aportes a seguridad social como
  independientes (IBC)** y para atender requerimientos de **DIAN y UGPP**.
  *Es lo que arrancamos ahora.*
- **Horizonte 2 — Sistema propio del grupo.** Un sistema contable/financiero
  multi-entidad y multi-país (CO/US/MX) operado por el equipo, que hoy coexiste
  con QuickBooks + facturación electrónica. Es el norte de mediano plazo.

**Principio rector:** construimos el Horizonte 1 con el **núcleo diseñado para
crecer** (multi-entidad, terceros, roles, multimoneda, "listo para partida
doble"), de modo que sea la semilla del Horizonte 2 y no un callejón sin salida.

## 2. Alcance del Horizonte 1

Objetivo #1 (este ciclo): **Base mensual de aportes IBC por persona.**
Objetivo #2 (siguiente): **Hoja de trabajo de renta por cédulas + patrimonio.**

Descubrimiento clave: hoy el sistema es casi solo de **gastos**, pero la renta y
el IBC se manejan por los **ingresos**. El primer pilar a construir es la
**captura de ingresos**.

## 3. El IBC: qué es y cómo lo calcularemos

**IBC = Ingreso Base de Cotización**: la base sobre la que se cotiza salud y
pensión. Para independientes:

```
IBC = 40% × (ingresos del mes − costos deducibles del mes)
      con piso = 1 SMMLV y techo = 25 SMMLV
```

Aportes sobre el IBC:
- **Salud: 12.5%**
- **Pensión: 16%**
- **Fondo de Solidaridad Pensional (FSP):** adicional si el IBC ≥ 4 SMMLV.
- **ARL:** según la clase de riesgo de la actividad (si aplica).

### Validaciones para el equipo contable (Santiago)
- [ ] ¿Depuramos **costos reales** o usamos el **esquema de presunción de
      costos** de la DIAN? (define cómo restamos costos al ingreso).
- [ ] Tratamiento de meses con ingresos irregulares (honorarios que cubren
      varios meses, anticipos).
- [ ] Tarifas y topes vigentes del año (SMMLV, FSP, ARL).
- [ ] Manejo de ingresos de **distinta naturaleza** (honorarios vs arriendos vs
      rendimientos) para la base de cotización.
- [ ] ¿Luis y Carolina cotizan cada uno por separado? (sí → dos contribuyentes).

## 4. Modelo de datos propuesto

Se agrega sobre el Postgres (Neon) actual, sin romper lo existente. Todo lleva
`entidad_id` desde el día uno.

| Tabla | Rol |
|---|---|
| `entidades` | Persona natural Luis, persona natural Carolina, y mañana cada sociedad. Núcleo del multi-entidad y la consolidación. |
| `terceros` | Maestro de terceros con **NIT/cédula**, nombre, tipo. Todo reporte fiscal es *por tercero* y permite cruzar la **exógena** de la DIAN. |
| `ingresos` | **El gran faltante.** Ingreso por persona: tipo/cédula (honorarios, arriendo, dividendos, rendimientos, salario…), tercero pagador, fecha, monto, **retenciones practicadas** (anticipo de renta). |
| `movimientos` (ya existe) | Gastos/costos. Se enlaza cuáles son **costo deducible** para el IBC/renta. |
| `patrimonio` | Snapshot anual de activos y pasivos a 31-dic (cuentas, propiedades, vehículos, inversiones, deudas) → patrimonio líquido. |
| `roles` / `usuarios` | Quién puede ver/operar qué (ver §5). |
| `asientos` (futuro) | Partida doble cuando entremos a estados financieros formales. Se diseña el modelo para que encaje sin re-arquitecturar. |

## 5. Roles y equipo

El sistema lo operará el equipo financiero/contable. Se propone un modelo de
**roles + alcance por entidad** (hoy tenemos `FINANZAS_USERS` + la bitácora
`eventos` como semilla; los volvemos de primera clase).

| Persona | Función | Rol propuesto |
|---|---|---|
| Luis / Carolina | Dueños | `owner` — ven todo, aprueban |
| Angela Guerrero · `angela@iwin.im` | Líder administrativa y financiera | `admin_financiero` — **acceso finanzas familiares** |
| María Isabel Bolaños · `ma.isabel@iwin.im` | Líder de facturación y tesorería | `tesoreria` — **acceso finanzas familiares** |
| Santiago Rodríguez · `santiago@iwin.im` | Contador — sociedades Colombia | `contador` (CO) — **acceso finanzas familiares** |
| Marco Reina | Contador — sociedades EEUU | `contador` (US) — Horizonte 2 |
| Juan Barrera | Contador — sociedades México | `contador` (MX) — Horizonte 2 |

Acceso concedido a Angela, María Isabel y Santiago para las **finanzas
familiares** (Horizonte 1). Marco y Juan entran con el Horizonte 2 (sociedades
US/MX). El acceso se controla con `FINANZAS_USERS` (env) + la tabla `usuarios`.

- **Alcance por entidad:** cada usuario ve las entidades que le corresponden
  (p. ej. finanzas familiares CO para Angela/María Isabel/Santiago; las
  sociedades US/MX para Marco/Juan cuando entre el Horizonte 2).
- **Auditoría:** toda acción queda en la bitácora `eventos` (quién, qué, cuándo,
  desde dónde). Los registros no se editan "a mano": se corrigen con
  ajustes/reversos.

> **Pendiente para activar accesos:** correos de cada integrante y confirmación
> de qué entidades ve cada uno (ver §8).

## 6. Reportes

1. **Base mensual de aportes IBC por persona** (primero). Ingresos − costos →
   40% → IBC → aportes (salud/pensión/FSP/ARL). Defendible ante UGPP.
2. **Hoja de trabajo de renta por cédulas + patrimonio, por persona** (después).
   Insumo para la declaración; la valida el contador.
3. **Estados financieros gerenciales** (Horizonte 2): Balance, Resultados,
   Flujo de Efectivo — cuando entre la partida doble.

## 7. Diseño para el Horizonte 2

- **`entidad_id` en todo** → multi-entidad y consolidación.
- **Terceros con NIT** compartido entre entidades.
- **Multimoneda** (ya hay USD; vienen US y MX con su moneda funcional).
- **Roles y permisos** de primera clase.
- **Partida doble "lista"** aunque el Horizonte 1 no la exija.
- **Coexistencia con QuickBooks (CO/US/MX):** el sistema propio empieza como
  **capa de consolidación + operación + gerencial por encima** de lo existente;
  se decide **entidad por entidad** si migra o se integra. No un *big bang*.
- **Conciliación con extractos = fuente de verdad final:** la captura en tiempo
  real (SilvIA/PWA/EmailBot/portales) es **provisional**; el **extracto bancario**
  deja todo "en firme" al conciliarse. El esquema ya contempla estados de
  conciliación. Ver [`docs/conciliacion.md`](conciliacion.md).

## 8. Preguntas abiertas para el equipo

- [ ] Correos de los 6 integrantes para dar acceso.
- [ ] ¿Quiénes acceden a las **finanzas familiares** (Horizonte 1)?
- [ ] Reglas del IBC (§3): costos reales vs presunción.
- [ ] Catálogo de **tipos de ingreso** (cédulas) que aplican a Luis y Carolina.
- [ ] Lista de **activos y pasivos** a incluir en el patrimonio.

## 8.b Catálogo de ingresos y casos particulares (insumos jul-2026)

Ingresos de Luis y Carolina y cómo se modelan (`ingresos.cedula`):

| Fuente | Persona | Cédula propuesta | Notas |
|---|---|---|---|
| Salario | Luis y Carolina | `trabajo` (laboral) | |
| Honorarios | Luis y Carolina | `honorarios` | Base típica del IBC de independientes |
| Transferencias Delca2 | Luis (y/o Carolina) | `dividendos` *(por confirmar)* | Clasificación a confirmar en otra sesión |
| **Ahinoa** (venta de prendas) | Carolina | `no_laboral` | Negocio informal — ver abajo |

### Caso Ahinoa (negocio informal de Carolina)
Marca bajo la cual Carolina vende prendas **confeccionadas por tejedoras que
contrata** o **compradas a proveedores**. Modelado:
- **Entidad** `Ahinoa` (tipo `negocio`), propiedad de Carolina. Se lleva su
  **mini P&L**: ingresos por ventas − costos (tejedoras + compra a proveedores)
  = utilidad, que **es ingreso de Carolina** para renta e IBC.
- Los **costos** (tejedoras, proveedores) van en `costos_actividad` con
  `actividad='Ahinoa'` → depuran la base. **Conservar soportes** es clave.
- Los ingresos entran a **cuentas personales** y, cuando son en efectivo, se
  **consignan en las cuentas de ahorro de los hijos** (Luis Alberto y Luciano).

> ⚠️ **Banderas fiscales (para el contador):**
> 1. Aunque el dinero de Ahinoa se reciba/consigne en cuentas de terceros
>    (incluidos los hijos), **sigue siendo ingreso de Carolina** para renta/IBC.
> 2. Consignaciones en **cuentas de los hijos** pueden aparecer en la **exógena**
>    y generar preguntas de la DIAN/UGPP → hay que dejarlas **trazadas** (qué
>    ingreso de Ahinoa corresponde a cada consignación).
> 3. Evaluar la conveniencia de **formalizar Ahinoa** (RUT/actividad) — decisión
>    del contador; el sistema ya lo modela como negocio aparte para cuando llegue.

Las cuentas de los hijos se registran en `cuentas_bancarias` con su titular
(entidades `menor`), para poder rastrear a dónde llega cada ingreso.

## 9. Fases y siguiente paso

- **Fase 3.0 (este documento):** diseño para revisión del equipo.
- **Fase 3.1:** esquema `entidades` + `terceros` + `ingresos` + roles;
  captura de ingresos.
- **Fase 3.2 (implementada, solo lectura — pendiente validación del contador):**
  cálculo y **reporte IBC mensual** por persona (`/api/pwa-aportes` + tarjeta
  🧮 en la PWA). Usa costos reales (no presunción DIAN), SMMLV/tarifas como
  config versionada en `app/src/config/aportes.js`, y asume que Luis y
  Carolina cotizan por separado. Las entidades tipo `negocio` con
  `propietario_id` (p.ej. Ahinoa → Carolina) **se consolidan automáticamente**
  en la base IBC de su dueño (issue #154, decisión de Luis) — el neto del
  negocio se suma a la base antes de aplicar el 40%; el desglose por negocio
  queda disponible en `consolida_negocios`. Ninguna de estas decisiones
  metodológicas está confirmada por Santiago todavía; no usar los números
  para trámites reales sin su validación.
- **Fase 3.3 (implementada, solo lectura — pendiente validación del contador):**
  patrimonio (`/api/pwa-patrimonio` + `/api/pwa-mi-patrimonio`, issue #115) y
  **hoja de trabajo de renta por cédulas + patrimonio fiscal a 31-dic**, por
  persona (`/api/pwa-renta-anual` + tarjeta 📋 "Renta anual" en la PWA, issue
  #130). Agrupa ingresos del año por cédula y costos deducibles (sin desglose
  por cédula, igual que Fase 3.2), y reutiliza `patrimonioPorPersona` a
  31-dic. Es un borrador/insumo para Santiago, no la declaración de renta;
  las mismas salvedades de la Fase 3.2 (costos reales) aplican acá — a
  diferencia del reporte IBC, esta hoja de trabajo por cédula **no** consolida
  aún el neto de Ahinoa (no tiene columna de cédula propia en
  `costos_actividad`).
- **Fase 4 (Horizonte 2):** partida doble, estados financieros, multi-entidad
  del grupo.

**Siguiente paso inmediato:** con la validación del equipo sobre §3 (reglas IBC)
y §5 (roles/accesos), implementamos la Fase 3.1.
