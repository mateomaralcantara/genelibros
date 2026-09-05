# Genelibros Production V1 — FROZEN

Estado: **pipeline de producción por capítulo**.

Esta versión reemplaza el uso operativo de scripts especiales por capítulo (`chapter3-*`, `repair-once-*`). Esos archivos pueden conservarse como historial/auditoría, pero **no forman parte del camino normal de producción**.

## Contrato V1

- Depth: `SUPREME`
- QUALITY mínimo publicable: `9.3`
- Drafts: `2`
- Primera pasada: máximo `7` llamadas LLM registradas
- Reparaciones automáticas ocultas: `0`
- Si QUALITY pide reparación después de la primera pasada: STOP
- Reparación final: solo mediante comando explícito `deep:prod:repair`
- Reparación final máxima: `1 DIRECT REPAIR + 1 QUALITY`
- Hard cap final: `9` llamadas registradas
- Direct repair: texto plano, `thinkingLevel=MINIMAL`, output default `48000`
- Longform Draft A / Draft B / Synthesis: texto plano
- Critic / Quality: JSON corto
- Research factual: claims `VERIFIED + citationReady`
- Dossier normal: `ready_for_writing=true`
- Dossier no-ready: solo con `--allow-editorial-override`, sin falsificar el estado histórico
- Sin Research: solo con `--allow-no-research`
- Retry técnico: nunca automático; exige `--resume-technical`
- Si ya hubo repair/invocación final: `deep:prod:chapter` no puede reactivar el job
- Apply: solo `COMPLETED + APPROVED + score >= 9.3 + applyAllowed=true`
- Apply verifica longitud, source hash y crea backup antes de mutar la section

## Requisitos

Production V1 trabaja sobre una `section` de tipo `CHAPTER` ya existente. La estructura del libro se crea antes; este pipeline no inventa capítulos ni altera el outline.

## Comandos oficiales

### 1. Verificar instalación — 0 LLM

```powershell
npm run deep:prod:verify
```

### 2. Preflight de un capítulo — 0 LLM

Busca automáticamente el dossier `ready_for_writing` más reciente del capítulo:

```powershell
npm run deep:prod:chapter -- --project <PROJECT_UUID> --chapter 4 --target 2500
```

Con título/objetivo explícitos:

```powershell
npm run deep:prod:chapter -- --project <PROJECT_UUID> --chapter 4 --target 2500 --title "Título del capítulo" --objective "Objetivo editorial del capítulo"
```

Con dossier explícito:

```powershell
npm run deep:prod:chapter -- --project <PROJECT_UUID> --chapter 4 --dossier <DOSSIER_UUID> --target 2500
```

Dossier explícito no marcado `ready_for_writing`:

```powershell
npm run deep:prod:chapter -- --project <PROJECT_UUID> --chapter 4 --dossier <DOSSIER_UUID> --target 2500 --allow-editorial-override
```

### 3. Ejecutar primera pasada

```powershell
npm run deep:prod:chapter -- --project <PROJECT_UUID> --chapter 4 --target 2500 --execute
```

El runner ejecuta patches + tests + typecheck antes de encolar. Si el preflight falla, no se llama al LLM.

Flujo de primera pasada:

```text
PLAN
→ CONTEXT
→ DRAFT A
→ DRAFT B
→ CRITIC
→ SYNTHESIS
→ QUALITY
```

Si QUALITY aprueba con `>=9.3`, pasa a PERSIST y APPLY.

Si QUALITY pide REPAIR y el hard cap está agotado, el job se cierra REJECTED y **no se compra reparación automáticamente**.

### 4. Repair preflight — 0 LLM

```powershell
npm run deep:prod:repair -- --project <PROJECT_UUID> --chapter 4
```

También puede usarse un job explícito:

```powershell
npm run deep:prod:repair -- --job <JOB_UUID>
```

### 5. Ejecutar única reparación final

```powershell
npm run deep:prod:repair -- --project <PROJECT_UUID> --chapter 4 --execute
```

Flujo:

```text
SYNTHESIS persistido
→ DIRECT REPAIR (1 llamada)
→ checkpoint QUALITY
→ QUALITY final (1 llamada)
→ PERSIST
→ APPLY o REJECTED definitivo
```

Antes de llamar al proveedor se persiste `directRepairInvocations=1`. Si el proveedor falla, corta o cobra de forma ambigua, repetir el comando no vuelve a comprar otra reparación automáticamente.

## Retry técnico

Un job `RETRYING / FAILED / DEAD_LETTER` no se reactiva al repetir el comando normal.

Después de revisar el error, el único mecanismo permitido es:

```powershell
npm run deep:prod:chapter -- --project <PROJECT_UUID> --chapter 4 --execute --resume-technical
```

Esto solo aplica antes de la reparación final. Si `repairAttempts > 0` o `directRepairInvocations > 0`, el runner bloquea la reactivación.

## Parámetros opcionales

- `--project <uuid>` obligatorio
- `--chapter <n>` obligatorio
- `--target <words>` default `2500`, rango admitido `500-12000`
- `--title "..."` opcional; por defecto usa `sections.title`
- `--objective "..."` opcional
- `--operation IMPROVE|REWRITE` default `IMPROVE`
- `--dossier <uuid>` opcional
- `--allow-editorial-override` explícito para dossier no-ready
- `--allow-no-research` explícito para capítulos que deliberadamente no usan Research
- `--execute` convierte el preflight en ejecución real
- `--resume-technical` habilita un retry técnico revisado

## Regla operativa

A partir de Production V1, **no crear scripts nuevos por número de capítulo**. Cualquier necesidad que sea verdaderamente general debe implementarse en el contrato o en los runners `deep:prod:*`; una excepción puntual no debe convertirse en otro pipeline paralelo.
