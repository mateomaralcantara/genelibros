import { describe, expect, it, vi } from "vitest";
import { capturePaypalOrder, createPaypalOrder, money, paypalBase, paypalConfig, readCapture, verifyPaypalWebhook } from "../../src/server/paypal";

const cfg = { clientId: "id", clientSecret: "secret", env: "sandbox" as const, webhookId: "WH-1" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeFetch(routes: Record<string, (init: RequestInit) => Response>) {
  return vi.fn(async (url: any, init: any = {}) => {
    const path = String(url).replace(paypalBase(cfg), "");
    if (path === "/v1/oauth2/token") return json(200, { access_token: "tok" });
    const key = `${init.method || "GET"} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`Ruta no esperada: ${key}`);
    return route(init);
  }) as unknown as typeof fetch;
}

const completed = (amount = "25.00") => ({
  id: "ORDER1",
  status: "COMPLETED",
  purchase_units: [{ reference_id: "pay-1", payments: { captures: [{ id: "CAP1", status: "COMPLETED", custom_id: "pay-1", amount: { value: amount, currency_code: "USD" } }] } }],
});

describe("paypal", () => {
  it("sin credenciales no hay configuración; live/sandbox", () => {
    expect(paypalConfig({})).toBeNull();
    expect(paypalConfig({ PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" })?.env).toBe("sandbox");
    expect(paypalBase({ ...cfg, env: "live" })).toBe("https://api-m.paypal.com");
  });

  it("crea la orden con el importe del servidor e idempotencia", async () => {
    let sent: any;
    const f = fakeFetch({ "POST /v2/checkout/orders": (init) => { sent = { body: JSON.parse(String(init.body)), headers: init.headers }; return json(201, { id: "ORDER1" }); } });
    const id = await createPaypalOrder(cfg, { paymentOrderId: "pay-1", amount: 25, currency: "USD", description: "x" }, f);
    expect(id).toBe("ORDER1");
    expect(sent.body.purchase_units[0]).toMatchObject({ custom_id: "pay-1", amount: { currency_code: "USD", value: "25.00" } });
    expect(sent.headers["PayPal-Request-Id"]).toBe("create-pay-1");
  });

  it("captura completada", async () => {
    const f = fakeFetch({ "POST /v2/checkout/orders/ORDER1/capture": () => json(201, completed()) });
    const r = await capturePaypalOrder(cfg, "ORDER1", f);
    expect(r).toMatchObject({ completed: true, captureId: "CAP1", amount: 25, currency: "USD", customId: "pay-1" });
  });

  it("si ya estaba capturada, consulta la orden", async () => {
    const f = fakeFetch({
      "POST /v2/checkout/orders/ORDER1/capture": () => json(422, { name: "UNPROCESSABLE_ENTITY", message: "ORDER_ALREADY_CAPTURED" }),
      "GET /v2/checkout/orders/ORDER1": () => json(200, completed()),
    });
    expect((await capturePaypalOrder(cfg, "ORDER1", f)).completed).toBe(true);
  });

  it("una captura pendiente no cuenta como pagada", () => {
    const o = completed();
    o.purchase_units[0].payments.captures[0].status = "PENDING";
    expect(readCapture(o).completed).toBe(false);
    expect(readCapture({ status: "APPROVED" }).completed).toBe(false);
  });

  it("verifica la firma del webhook con PayPal", async () => {
    let sent: any;
    const ok = fakeFetch({ "POST /v1/notifications/verify-webhook-signature": (init) => { sent = JSON.parse(String(init.body)); return json(200, { verification_status: "SUCCESS" }); } });
    expect(await verifyPaypalWebhook(cfg, { "paypal-transmission-id": "t1" }, { id: "E1" }, ok)).toBe(true);
    expect(sent).toMatchObject({ webhook_id: "WH-1", transmission_id: "t1", webhook_event: { id: "E1" } });
    const bad = fakeFetch({ "POST /v1/notifications/verify-webhook-signature": () => json(200, { verification_status: "FAILURE" }) });
    expect(await verifyPaypalWebhook(cfg, {}, {}, bad)).toBe(false);
    expect(await verifyPaypalWebhook({ ...cfg, webhookId: "" }, {}, {}, ok)).toBe(false);
  });

  it("formatea importes", () => {
    expect(money(25)).toBe("25.00");
    expect(money(10.005)).toBe("10.01");
  });
});
