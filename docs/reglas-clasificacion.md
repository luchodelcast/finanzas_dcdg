# Reglas de clasificación DCDG

Fuente única: [`app/src/config/rules.js`](../app/src/config/rules.js). Reutilizada
por la PWA y por el backend. Estrategia en dos pasos:

1. **Reglas determinísticas** (barato, testeable): se normaliza la descripción
   (minúsculas, sin acentos) y se busca la primera regla cuyo keyword aparezca.
2. **Fallback a Claude**: si ninguna regla matchea, el modelo clasifica.

## Reglas vigentes (resumen)

| Grupo | Keywords | Categoría / Subcategoría |
|---|---|---|
| Mercado | Tienda D1, ARA, Dollarcity, Olímpica/STO, Makro, Éxito, Oxxo | Alimentación / Mercado |
| Restaurante | Cucinare, Fiordi, Kike López, Crepes & Waffles, Narcobollo | Alimentación / Restaurante |
| Domicilios | Rappi, iFood | Alimentación / Domicilios |
| Transporte | Uber, InDriver, Cabify | Transporte / Uber-Taxi |
| Gasolina | EDS, Terpel, Biomax | Transporte / Gasolina-EDS |
| Peajes | Flypass, F2X SAS Flypass | Transporte / Peajes |
| Vehículo | Prontowash, lavadero | Transporte / Vehículos-Lavado |
| Salud farma | Farmatodo, Cruz Verde, droguería | Salud / Medicamentos |
| Salud cita | Clínica, Sanitas | Salud / Citas Médicas |
| Suscripciones | Netflix, Spotify, Amazon, Apple, Disney, YouTube | Entretenimiento / Suscripciones |
| Biofood | Biofood Service SAS | Gastos Luhijo-Luciano / Meriendas-Almuerzos Colegio |
| Colegio | Colegio Alemán | Educación / Colegio |
| Bancario | 4x1000, cuota manejo, PSE, GMF | Gastos Bancarios / Comisiones |
| iWin/Corporativo | Jeeves, TC iWin, Superlikers | Corporativo / Adelanto Honorarios (`iwin_prestamo=true`) |

> Las 85+ reglas completas del sistema histórico se irán consolidando aquí. Las
> anteriores cubren los comercios de mayor frecuencia. Al agregar una regla,
> añadir su caso en `tests/classify.test.js`.

## Cómo agregar una regla

```js
// app/src/config/rules.js → array RULES (orden = prioridad)
{ id: 'mercado-jumbo', match: ['jumbo'], categoria: 'Alimentación', subcategoria: 'Mercado' },
```
Los `match` se comparan ya normalizados (sin acentos, minúsculas). Para forzar
método de pago o marcar adelanto iWin, agregar `metodo_pago` / `iwin_prestamo`.
