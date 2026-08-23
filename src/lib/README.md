# Fix: textos largos sin JSON

Reemplaza este archivo en tu proyecto:

```txt
src/lib/gemini.ts
```

por:

```txt
src/lib/gemini.ts
```

del ZIP.

## Qué corrige

- Propuesta editorial ya NO vuelve dentro de JSON.
- Introducción ya NO vuelve dentro de JSON.
- Capítulos ya NO vuelven dentro de JSON.
- Solo `BUILD_FULL_DOSSIER` usa JSON.
- Detecta cuota diaria Free Tier agotada y corta rápido.

## Por qué

El error:

```txt
Expected ',' or '}' after property value
```

pasa cuando Gemini mete texto largo con comillas/saltos dentro de JSON y lo rompe.

Regla nueva:

```txt
Texto largo = texto plano.
JSON = solo estructura pequeña.
```
