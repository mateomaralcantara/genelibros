# Genelibros — Book Production V1

## Objetivo

Automatizar la producción secuencial de un libro completo reutilizando **Genelibros Production V1** capítulo por capítulo, sin crear pipelines especiales por número de capítulo.

## Principio de ejecución

El libro se procesa en orden ascendente:

`Capítulo N -> QUALITY -> APPLY -> Capítulo N+1`

El capítulo siguiente no comienza hasta que el anterior haya sido aprobado y aplicado. Esto permite que el contexto del capítulo siguiente vea el contenido editorial actualizado del capítulo anterior.

## Comandos públicos

### Verificación de costo cero

```powershell
npm run deep:prod:book:verify
```

No ejecuta LLM.

### Preflight de un libro o rango

```powershell
npm run deep:prod:book -- --project <project_uuid> --from 4 --to 12 --target 2500
```

El preflight:

- lee las sections CHAPTER del proyecto;
- identifica el último Research `ready_for_writing` de cada capítulo pendiente;
- detecta capítulos ya aplicados;
- detecta QUALITY rechazado pendiente de reparación;
- detecta fallos técnicos;
- detecta jobs activos;
- calcula el techo máximo de llamadas de primera pasada;
- escribe un manifest local de progreso;
- realiza **0 llamadas LLM**.

## Ejecución real

La ejecución requiere dos opt-ins explícitos:

1. `--execute`
2. `--book-max-calls N`

Ejemplo:

```powershell
npm run deep:prod:book -- --project <project_uuid> --from 4 --to 12 --target 2500 --execute --book-max-calls 63
```

Con nueve capítulos pendientes, `63 = 9 x 7` reserva como máximo siete llamadas registradas de primera pasada por capítulo.

## Presupuesto global

El orquestador nunca inicia un capítulo nuevo si el presupuesto restante del libro es inferior a siete llamadas registradas.

Si el presupuesto se agota entre capítulos:

- no inicia el capítulo siguiente;
- conserva todos los capítulos ya aplicados;
- guarda el manifest;
- termina con estado `PAUSED_BOOK_BUDGET`.

El límite contabiliza llamadas registradas por el pipeline. Un error del proveedor ocurrido antes de poder persistir usage puede ser facturado externamente aunque no aparezca en el ledger; por eso cualquier fallo técnico pausa el libro y no se reintenta automáticamente.

## Research

Book Production V1 **no genera Research**.

Para cada capítulo pendiente exige un dossier `ready_for_writing` antes de iniciar una corrida pagada. Si falta uno, todo el execute se bloquea antes de gastar.

Esto evita descubrir a mitad de un libro que faltan fuentes o evidencia.

Los overrides editoriales de Research continúan disponibles en `deep:prod:chapter`, pero no se automatizan a nivel libro.

## QUALITY y reparación

Book Production V1 mantiene el contrato congelado:

- threshold: `9.3`;
- primera pasada: máximo `7` llamadas registradas;
- drafts: `2`;
- reparación automática: `0`.

Si un capítulo termina REJECTED:

- el libro se pausa en ese capítulo;
- no regenera capítulos anteriores;
- no ejecuta REPAIR automáticamente;
- muestra el comando exacto `deep:prod:repair` para ese job.

Después de reparar y aplicar el capítulo, se vuelve a ejecutar `deep:prod:book`; los capítulos ya aplicados se detectan y se saltan.

## Fallos técnicos

Un job `RETRYING`, `FAILED` o `DEAD_LETTER` bloquea la corrida del libro.

El orquestador no usa `--resume-technical` y no contiene retries automáticos.

La recuperación técnica se hace explícitamente a nivel capítulo y luego se reanuda el libro.

## Jobs activos

El worker Deep reclama trabajo de una cola compartida. Por seguridad, Book Production V1 exige que no existan otros Deep Work jobs activos del mismo usuario antes de arrancar una corrida de libro.

Esto impide que el worker local procese accidentalmente otro proyecto mientras el orquestador cree estar trabajando en el libro seleccionado.

## Capítulos ya terminados

Por defecto, si el contenido actual de una section coincide con el candidato final de cualquier job `COMPLETED + APPROVED >= 9.3`, el capítulo se considera aplicado y se salta, incluso si fue generado por un flujo anterior a Production V1.

Esto permite reconocer capítulos reales ya cerrados sin pagar otra generación.

Para forzar una nueva producción usando el Research listo más reciente se requiere:

```text
--refresh-research
```

## Manifest local

Cada preflight/ejecución escribe:

```text
exports/production-v1/book-<project_uuid>-last-run.json
```

El manifest registra:

- rango de capítulos;
- estados por capítulo;
- dossier seleccionado;
- job utilizado;
- llamadas registradas durante la corrida;
- causa de pausa;
- progreso completado.

La fuente de verdad sigue siendo Supabase; el manifest es una ayuda operacional y de auditoría.

## Estados principales

- `READY`: listo para primera pasada.
- `APPLIED`: ya aprobado y aplicado.
- `APPROVED_PENDING_APPLY`: aprobado; falta APPLY idempotente.
- `BLOCK_RESEARCH`: falta Research listo.
- `BLOCK_ACTIVE`: existe job activo.
- `BLOCK_TECHNICAL`: fallo técnico pendiente de decisión explícita.
- `NEEDS_REPAIR`: QUALITY rechazó el capítulo.
- `PAUSED_BOOK_BUDGET`: no queda presupuesto suficiente para iniciar otro capítulo.
- `PAUSED_REPAIR_REQUIRED`: el capítulo actual requiere reparación explícita.
- `COMPLETED`: todos los capítulos seleccionados terminaron/aplicaron.

## Regla operacional

No crear scripts `book-X`, `chapter4-final`, `chapter5-final`, etc.

Los caminos oficiales son:

```text
deep:prod:chapter
deep:prod:repair
deep:prod:book
```

El orquestador del libro coordina; el motor editorial continúa siendo Production V1 universal.
