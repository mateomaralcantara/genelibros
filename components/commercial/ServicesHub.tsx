// Centro comercial de LibroSeller: las cuatro modalidades, cada una con su
// página. Sin precios en el código: los importes se configuran en el panel
// administrativo (fase 2) o los fija el equipo en cada propuesta (Modalidad D).

import React, { useState } from "react";
import EditorialRequestForm from "./EditorialRequestForm";
import MyEditorialOrders from "./MyEditorialOrders";

type Page = "hub" | "A" | "B" | "C" | "D" | "D_FORM" | "MY_ORDERS";

const card =
  "text-left rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-indigo-400";
const btn = "rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-widest transition";

const MODALITIES = [
  {
    key: "D" as const,
    title: "Encarga tu libro a nuestro equipo editorial",
    tag: "Servicio premium",
    text: "Tienes una idea, una historia o conocimientos que quieres convertir en un libro profesional, pero no quieres escribirlo tú. Nuestro equipo lo hace por ti.",
    accent: "border-amber-400/40 bg-gradient-to-br from-amber-500/15 to-fuchsia-500/10",
  },
  {
    key: "A" as const,
    title: "Crea tu propio libro",
    tag: "Libro individual",
    text: "Compra la generación de un libro y desarróllalo tú mismo con GeneSeller, sin suscripción.",
    accent: "border-slate-700 bg-slate-900",
  },
  {
    key: "B" as const,
    title: "Suscripción de autor",
    tag: "Para producir libros continuamente",
    text: "Un plan periódico con créditos mensuales para escribir varios libros.",
    accent: "border-slate-700 bg-slate-900",
  },
  {
    key: "C" as const,
    title: "Créditos de producción",
    tag: "Sin suscripción",
    text: "Compra paquetes de créditos y úsalos cuando quieras.",
    accent: "border-slate-700 bg-slate-900",
  },
];

const EDITORIAL_FLOW = [
  "Nos cuentas tu idea con un formulario sencillo.",
  "Un asesor editorial evalúa el proyecto.",
  "Te enviamos una propuesta de trabajo con condiciones y precio.",
  "Apruebas la propuesta y confirmamos el pago.",
  "Asignamos un editor o equipo de producción.",
  "Investigación y documentación del tema.",
  "Índice y arquitectura de capítulos.",
  "Redacción del manuscrito.",
  "Revisión editorial, corrección y verificación de referencias.",
  "Te presentamos una versión preliminar.",
  "Gestionamos las revisiones acordadas con tus observaciones.",
  "Aprobamos el manuscrito definitivo.",
  "Diagramación y diseño de portada.",
  "Te entregamos los archivos finales.",
];

const ComingSoon: React.FC<{ title: string; features: string[]; onBack: () => void }> = ({ title, features, onBack }) => (
  <div className="mx-auto max-w-3xl">
    <button type="button" onClick={onBack} className="mb-6 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white">
      ← Volver a servicios
    </button>
    <h2 className="text-3xl font-black text-white">{title}</h2>
    <ul className="mt-6 space-y-2 text-sm text-slate-300">
      {features.map((f) => (
        <li key={f}>• {f}</li>
      ))}
    </ul>
    <div className="mt-8 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5 text-sm text-indigo-100">
      Esta modalidad estará disponible muy pronto. Los planes, créditos y precios se publicarán aquí en cuanto el
      equipo los configure. Mientras tanto, puedes <strong>encargar tu libro a nuestro equipo editorial</strong>.
    </div>
  </div>
);

const ServicesHub: React.FC<{ onBack?: () => void; onOpenAdmin?: () => void }> = ({ onBack, onOpenAdmin }) => {
  const [page, setPage] = useState<Page>("hub");
  const back = () => setPage("hub");

  return (
    <div className="min-h-full bg-slate-950 px-5 py-8 text-slate-100 md:px-10">
      <div className="mx-auto mb-8 flex max-w-5xl flex-wrap items-center gap-3">
        {onBack && (
          <button type="button" onClick={onBack} className={`${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`}>
            ← Volver
          </button>
        )}
        <button type="button" onClick={() => setPage("MY_ORDERS")} className={`${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`}>
          Mis encargos editoriales
        </button>
        {onOpenAdmin && (
          <button type="button" onClick={onOpenAdmin} className={`${btn} ml-auto bg-emerald-700 text-white hover:bg-emerald-600`}>
            Panel del equipo
          </button>
        )}
      </div>

      {page === "hub" && (
        <div className="mx-auto max-w-5xl">
          <h1 className="text-4xl font-black text-white">¿Cómo quieres hacer tu libro?</h1>
          <p className="mt-2 text-sm text-slate-400">Elige la modalidad que mejor encaje contigo.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {MODALITIES.map((m) => (
              <button key={m.key} type="button" onClick={() => setPage(m.key)} className={`${card} ${m.accent} ${m.key === "D" ? "md:col-span-2" : ""}`}>
                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-200/90">{m.tag}</div>
                <div className={`mt-2 font-black text-white ${m.key === "D" ? "text-2xl" : "text-lg"}`}>{m.title}</div>
                <p className="mt-2 text-sm text-slate-300">{m.text}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {page === "D" && (
        <div className="mx-auto max-w-3xl">
          <button type="button" onClick={back} className="mb-6 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white">
            ← Volver a servicios
          </button>
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-200">Servicio editorial premium</div>
          <h2 className="mt-2 text-4xl font-black text-white">Tu libro, escrito por nuestro equipo editorial</h2>
          <p className="mt-4 text-slate-300">
            Tú no tienes que escribir, investigar ni estructurar nada. Nuestro equipo de editores, investigadores y
            correctores —personas reales, apoyadas por herramientas tecnológicas cuando corresponde— se responsabiliza
            de convertir tu idea en un libro profesional. Sigues el avance de tu encargo desde tu panel y apruebas cada
            paso importante.
          </p>
          <ol className="mt-8 space-y-2 text-sm text-slate-300">
            {EDITORIAL_FLOW.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="w-6 shrink-0 text-right font-black text-amber-300">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-slate-400">
            El precio es especial para cada proyecto: depende de la extensión, la investigación y los plazos. Te lo
            enviamos en la propuesta, sin compromiso.
          </p>
          <button type="button" onClick={() => setPage("D_FORM")} className={`${btn} mt-8 bg-amber-500 text-slate-950 hover:bg-amber-400`}>
            Solicitar mi libro
          </button>
        </div>
      )}

      {page === "D_FORM" && <EditorialRequestForm onCancel={() => setPage("D")} onCreated={() => setPage("MY_ORDERS")} />}
      {page === "MY_ORDERS" && <MyEditorialOrders onNewRequest={() => setPage("D")} />}

      {page === "A" && (
        <ComingSoon
          title="Crea tu propio libro"
          onBack={back}
          features={[
            "Compra individual, sin suscripción.",
            "Configuras las características de tu libro.",
            "Generación con GeneSeller.",
            "Edición y corrección con EditorSeller.",
            "Exportación en los formatos disponibles.",
            "Historial y almacenamiento del proyecto.",
          ]}
        />
      )}
      {page === "B" && (
        <ComingSoon
          title="Suscripción de autor"
          onBack={back}
          features={[
            "Planes periódicos configurables.",
            "Créditos mensuales y límites de producción.",
            "Créditos adicionales cuando los necesites.",
            "Renovación automática con tu autorización.",
            "Actualiza o cancela tu plan cuando quieras.",
            "Historial de consumo.",
          ]}
        />
      )}
      {page === "C" && (
        <ComingSoon
          title="Créditos de producción"
          onBack={back}
          features={[
            "Paquetes de créditos sin suscripción.",
            "Cada operación consume créditos según su tipo.",
            "Saldo e historial de movimientos.",
            "Validación de saldo antes de empezar.",
            "Protección contra cobros duplicados.",
            "Reintegro de créditos si un fallo del sistema interrumpe el proceso.",
          ]}
        />
      )}
    </div>
  );
};

export default ServicesHub;
