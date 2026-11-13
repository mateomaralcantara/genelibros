# Modelo comercial de LibroSeller

Evolución de LibroSeller a una plataforma editorial con cuatro modalidades:

| Modalidad | Qué es | Estado |
|---|---|---|
| **D — Libro elaborado por el equipo editorial** | Servicio premium hecho por personas | ✅ **Fase 1 (implementada)** |
| A — Libro individual | Compra única de la generación de un libro | Página informativa; venta en fase 2 |
| B — Suscripción de autor | Planes periódicos con créditos | Página informativa; venta en fase 2–4 |
| C — Créditos de producción | Paquetes de créditos sin suscripción | Página informativa; venta en fase 2 |

## 1. Auditoría del sistema existente (noviembre 2026)

| Necesidad | Existente | Decisión |
|---|---|---|
| Planes | `subscription_plans` (4 planes con importes de ejemplo de una versión anterior) | Reutilizar. Los importes se editarán desde el panel (fase 2); el código no usa importes fijos |
| Suscripciones | `user_plan_assignments` | Reutilizar como `subscriptions` (fase 2–4) |
| Consumo | `usage_events`, `api_rate_limits` | Reutilizar como historial y límites |
| Acceso | `profiles.has_access` + aprobación manual (`access_requests`, con `transfer_reference`) | Se mantiene; un pago confirmado podrá activar el acceso |
| Roles | No existían | **Nuevo:** `app_roles` (`admin`, `editor`) |
| Archivos privados | Storage no se usaba | **Nuevo:** bucket privado `editorial-files` |
| GeneSeller / EditorSeller | No existen con ese nombre. La generación es `api/composer` + OS4, y la edición es el visor (`BookViewer`) + refinery | Se nombran así en la interfaz |
| Checkout / pagos | No había ninguna integración real (solo marcas `stripe: true` sin código) | **Nuevo:** núcleo de pagos independiente del proveedor |

## 2. Fase 1 — implementada

Migración: `supabase/migrations/20261118_roles_editorial_payments.sql`.

### Tablas
| Tabla | Para qué |
|---|---|
| `app_roles` | Quién es `admin` o `editor`. Funciones `has_role()` / `is_staff()` para las políticas |
| `editorial_orders` | El encargo: formulario del cliente, estado (14 etapas + cancelado), responsable y propuesta (importe, moneda y condiciones que fija el equipo) |
| `editorial_order_stages` | Por etapa: responsable, fecha límite, inicio, fin y notas internas |
| `editorial_order_events` | Auditoría: cambios de estado, asignaciones, propuestas, aprobaciones, pagos y comentarios (marcados como visibles o internos) |
| `editorial_deliverables` | Archivos del encargo en Storage privado, visibles al cliente solo si el equipo lo decide |
| `payment_orders` | Orden de pago (propósito, referencia, importe, moneda, estado y proveedor). `idempotency_key` única: sin órdenes duplicadas |
| `payment_transactions` | Cobros y reembolsos. Única por (proveedor, id de transacción, tipo): un cobro no se registra dos veces |

### Seguridad (RLS)
- **Cliente:** crea su solicitud **sin** campos administrativos (estado, precio, responsable); ve solo sus encargos, eventos visibles y archivos visibles. **No puede actualizar** encargos: comenta, aprueba la propuesta y pide ajustes **solo** mediante funciones (`editorial_add_client_comment`, `editorial_client_approve_proposal`, `editorial_client_request_changes`) que validan el estado.
- **Editor:** gestiona encargos, etapas, archivos y notas. **No** confirma pagos.
- **Admin:** todo lo del editor, más confirmar pagos y gestionar roles.
- Pagos: el cliente solo **lee** los suyos. Nadie los escribe desde el navegador salvo la función de administrador.
- Archivos: bucket privado. El cliente descarga con un enlace temporal de 10 minutos y solo los archivos visibles de sus encargos.

### Flujo de pago actual: transferencia verificada
1. El equipo envía la propuesta (importe, moneda y condiciones).
2. El cliente la **aprueba**. Esto **no** marca nada como pagado.
3. El cliente paga por transferencia y el administrador **verifica el ingreso en el banco**.
4. El administrador pulsa **"Confirmar pago verificado"** con la referencia bancaria: se crea la orden y la transacción (idempotente) y el encargo pasa a **Proyecto contratado**.

Un pago **nunca** se considera hecho por una redirección del navegador ni por la palabra del cliente.

### Interfaz
- **Servicios LibroSeller** (barra lateral y pantalla de cuenta en revisión): las 4 modalidades, cada una con su página. La D destaca como servicio premium.
- **Mis encargos editoriales:** progreso por etapas, propuesta, aprobación, mensajes, petición de ajustes y descargas.
- **Panel del equipo** (solo `admin`/`editor`): lista con filtro por estado; en cada encargo, estado, responsable, propuesta, etapas (responsable, fecha y nota), archivos, notas y confirmación de pago.

### Dar roles al equipo
Supabase → SQL Editor:
```sql
insert into public.app_roles (user_id, role)
select user_id, 'admin' from public.profiles where email = 'tu-email@ejemplo.com'
on conflict do nothing;
-- editores: el mismo insert con 'editor'
```

## 3. Próximas fases

### Fase 2 — Créditos y productos configurables (Modalidades A y C)
- `credit_wallets` y `credit_transactions` (movimientos con `idempotency_key`), con funciones atómicas para `reservar → confirmar / reintegrar` créditos: validación de saldo antes de empezar, sin doble consumo y reintegro si falla el sistema.
- Productos y paquetes configurables (`commercial_products`: tipo, créditos, importe, moneda y activo) editables desde el panel.
- Panel administrativo: modalidades, planes, paquetes, cupones, clientes y transacciones.

### Fase 3 — Proveedores de pago reales
Arquitectura: un **adaptador por proveedor** detrás de una interfaz común (`crear pago → URL o formulario`, `verificar notificación firmada → transacción`) que escribe en `payment_orders` / `payment_transactions`. El servicio solo se activa al recibir la **confirmación firmada** del proveedor (webhook).

| Proveedor | Qué hace falta para integrarlo |
|---|---|
| **PayPal** | Cuenta Business y credenciales de API (Client ID y Secret, sandbox y producción). La API pública está documentada |
| **AZUL** | Afiliación comercial con AZUL y su documentación técnica (Payment Page / Webservices), Merchant ID y claves |
| **Toke (Banco Popular)** | Autorización e integración comercial oficial con Banco Popular, y su documentación y credenciales |

> No se implementan endpoints ni credenciales sin la documentación oficial de cada proveedor.

### Fase 4 — Suscripciones completas
Renovación automática autorizada, vencimientos, cambios de plan, cancelaciones, cupones, reembolsos y conciliación con los informes del proveedor.

## 4. Limitaciones actuales (fase 1)
- Solo existe el pago por **transferencia verificada manualmente**; los pagos en línea llegan en la fase 3.
- Las modalidades A, B y C tienen página informativa pero aún **no se pueden comprar**.
- No hay notificaciones por email: el equipo ve las solicitudes nuevas en el panel (filtro "Solicitud recibida").
- Los importes de ejemplo que quedan en `subscription_plans` no se muestran en la interfaz.

## Motor de precios (USD)

Migración: `supabase/migrations/20261119_pricing_catalog.sql`. Ningún precio está en el código: las páginas
leen `pricing_catalog` y el administrador los cambia en **Panel del equipo → Precios**. Cada cambio queda
en `pricing_changes`. Re-ejecutar la migración no pisa los precios editados (`on conflict do nothing`).

Valores iniciales (editables):

| Modalidad | Producto | Precio | Créditos |
|---|---|---|---|
| A · Libro con un clic | Libro individual | US$15 | 150 |
| C · Créditos | 100 / 275 / 600 / 1.300 créditos | US$10 / 25 / 50 / 100 | +0 / 10 / 20 / 30 % |
| B · Suscripción (mes) | Autor Inicial / Profesional / Premium / Editorial | US$25 / 59 / 99 / 200 | 300 / 800 / 1.500 / 3.500 |
| D · Servicio editorial | Guía → Especializado | US$100 – 2.000 | — |

Consumo de créditos (1 crédito ≈ US$0,10): índice 10, capítulo 25, libro completo 150, investigación 40,
reescritura 20, corrección 3/1.000 palabras, traducción 8/1.000 palabras, portada 30.

**Cotizador editorial** (`pricing_settings.editorial_quote`): base por complejidad + tarifa por 1.000
palabras + entrevistas + investigación + diagramación + portada + rondas de revisión, ×1,25 si es urgente,
acotado entre el mínimo (US$100) y el máximo (US$2.000). En cada encargo, «Usar en la propuesta» rellena
importe, moneda y desglose. Fórmula de margen disponible en `priceFromCost`: P = Costo / (1 − margen).

Limitación actual: los botones de compra están desactivados («pronto») hasta integrar las pasarelas
(fase 3); hoy se cobra por transferencia y el admin la registra manualmente.

## Cobro: PayPal y transferencia

Migración: `supabase/migrations/20261120_checkout_paypal_transfer.sql` · API: `api/payments.ts` · Cliente PayPal: `src/server/paypal.ts`.

| Método | Cómo se confirma | Quién |
|---|---|---|
| **PayPal** (y tarjeta vía PayPal) | El servidor captura la orden (`/v2/checkout/orders/{id}/capture`) y solo si PayPal responde `COMPLETED` con el mismo importe y moneda la marca pagada. Respaldo: webhook `PAYMENT.CAPTURE.COMPLETED` verificado con `/v1/notifications/verify-webhook-signature`. | Automático |
| **Transferencia** | El cliente pide el pedido y escribe la referencia; un admin confirma en **Panel del equipo → Pagos** cuando ve el dinero en el banco. | Admin |

Al confirmarse el pago (una sola vez, `fulfilled_at`): se suman los créditos del producto al monedero
(`credit_ledger`), se activa la cuenta (`profiles.has_access = true`) o el encargo editorial pasa a
CONTRATADO. El importe siempre sale del catálogo o de la propuesta, nunca del navegador.

### Activar PayPal
1. En https://developer.paypal.com → *Apps & Credentials* crea una app REST (primero en **Sandbox**).
2. En Vercel → *Settings → Environment Variables* añade: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `PAYPAL_ENV` (`sandbox` o `live`) y `PAYPAL_WEBHOOK_ID`.
3. En la app de PayPal crea un webhook a `https://TU-DOMINIO/api/payments?action=paypal-webhook` con el
   evento *Payment capture completed* y copia su id en `PAYPAL_WEBHOOK_ID`.
4. Redeploy y en **Panel del equipo → Pagos** marca «PayPal y tarjeta».

### Activar transferencia
En **Panel del equipo → Pagos** escribe los datos de la cuenta (banco, tipo, número, titular, RNC/cédula,
dónde enviar el comprobante) y guarda.

### Limitaciones actuales
- Las suscripciones se cobran mes a mes como pago único (sin renovación automática todavía; fase 4).
- Los créditos se acumulan en el monedero, pero la generación aún no los descuenta (fase 2).
- PayPal no admite DOP: los encargos editoriales en DOP se pagan por transferencia.
