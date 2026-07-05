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
| Angela Guerrero | Líder administrativa y financiera | `admin_financiero` |
| María Isabel Bolaños | Líder de facturación y tesorería | `tesoreria` |
| Santiago Rodríguez | Contador — sociedades Colombia | `contador` (CO) |
| Marco Reina | Contador — sociedades EEUU | `contador` (US) |
| Juan Barrera | Contador — sociedades México | `contador` (MX) |

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

## 8. Preguntas abiertas para el equipo

- [ ] Correos de los 6 integrantes para dar acceso.
- [ ] ¿Quiénes acceden a las **finanzas familiares** (Horizonte 1)?
- [ ] Reglas del IBC (§3): costos reales vs presunción.
- [ ] Catálogo de **tipos de ingreso** (cédulas) que aplican a Luis y Carolina.
- [ ] Lista de **activos y pasivos** a incluir en el patrimonio.

## 9. Fases y siguiente paso

- **Fase 3.0 (este documento):** diseño para revisión del equipo.
- **Fase 3.1:** esquema `entidades` + `terceros` + `ingresos` + roles;
  captura de ingresos.
- **Fase 3.2:** cálculo y **reporte IBC mensual** por persona.
- **Fase 3.3:** `patrimonio` + hoja de trabajo de renta por cédulas.
- **Fase 4 (Horizonte 2):** partida doble, estados financieros, multi-entidad
  del grupo.

**Siguiente paso inmediato:** con la validación del equipo sobre §3 (reglas IBC)
y §5 (roles/accesos), implementamos la Fase 3.1.
