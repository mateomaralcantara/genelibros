// Acceso a la app: sesión de Supabase, formulario de entrada/registro y
// aprobación manual (profiles.has_access + access_requests).
// El servidor vuelve a comprobar has_access en cada llamada que gasta dinero
// (src/server/request-guard.ts); esto solo decide qué pantalla mostrar.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getSession } from "../data/repo";
import { ensureString, normalizeError } from "../lib/editor";
import type { AuthMode } from "../../components/AuthGate";

export type AccessProfile = {
  email: string;
  has_access: boolean;
  full_name?: string | null;
  phone?: string | null;
};

export type AccessRequest = {
  id: string;
  status: string;
  created_at?: string;
};

type UseAccessGateOptions = {
  /** Muestra (o limpia con null) el error global de la app. */
  setError: (message: string | null) => void;
  /** Se llama cuando Supabase informa que ya no hay sesión. */
  onSignedOut: () => void;
};

export function useAccessGate({ setError, onSignedOut }: UseAccessGateOptions) {
  // auth
  const [session, setSession] = useState<any>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // intake (signup)
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // approval gate
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [gateBusy, setGateBusy] = useState(false);

  const onSignedOutRef = useRef(onSignedOut);
  onSignedOutRef.current = onSignedOut;

  /* -------------------------- session sync -------------------------- */

  useEffect(() => {
    (async () => {
      try {
        const s = await getSession();
        setSession(s);
      } catch (e) {
        setError(normalizeError(e));
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);

      if (!newSession) {
        setProfile(null);
        setRequest(null);
        setAuthNotice(null);
        onSignedOutRef.current();
      }
    });

    return () => {
      sub?.subscription?.unsubscribe();
    };
  }, []);

  /* -------------------------- approval gate -------------------------- */

  const refreshApprovalStatus = useCallback(async () => {
    const uid = session?.user?.id ?? null;
    const em = session?.user?.email ?? "";
    if (!uid) return;

    setGateBusy(true);
    try {
      // IMPORTANTE:
      // El cliente NO debe hacer upsert con has_access:false cuando el profile ya existe.
      // Si lo hace, puede pisar o bloquear una aprobación manual.
      let { data: pData, error: pErr } = await supabase
        .from("profiles")
        .select("email,has_access,full_name,phone")
        .eq("user_id", uid)
        .maybeSingle();

      if (pErr) throw pErr;

      if (!pData) {
        const { error: insertProfileErr } = await supabase.from("profiles").insert({
          user_id: uid,
          email: em,
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          // NO mandamos has_access desde el cliente.
          // La DB lo deja en false por default y solo el admin/backend lo cambia a true.
        });

        if (insertProfileErr) throw insertProfileErr;

        const refreshed = await supabase
          .from("profiles")
          .select("email,has_access,full_name,phone")
          .eq("user_id", uid)
          .maybeSingle();

        if (refreshed.error) throw refreshed.error;
        pData = refreshed.data;
      } else {
        const profilePatch: Record<string, string | null> = {};

        if (em && em !== (pData as any).email) profilePatch.email = em;
        if (fullName.trim() && fullName.trim() !== ((pData as any).full_name ?? "")) profilePatch.full_name = fullName.trim();
        if (phone.trim() && phone.trim() !== ((pData as any).phone ?? "")) profilePatch.phone = phone.trim();

        if (Object.keys(profilePatch).length > 0) {
          const { error: updateProfileErr } = await supabase
            .from("profiles")
            .update(profilePatch)
            .eq("user_id", uid);

          if (updateProfileErr) throw updateProfileErr;

          const refreshed = await supabase
            .from("profiles")
            .select("email,has_access,full_name,phone")
            .eq("user_id", uid)
            .maybeSingle();

          if (refreshed.error) throw refreshed.error;
          pData = refreshed.data;
        }
      }

      const hasAccess = Boolean((pData as any)?.has_access);

      setProfile({
        email: ensureString((pData as any)?.email, em),
        has_access: hasAccess,
        full_name: (pData as any)?.full_name ?? null,
        phone: (pData as any)?.phone ?? null,
      });

      const { data: rData, error: rErr } = await supabase
        .from("access_requests")
        .select("id,status,created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1);

      if (rErr) throw rErr;

      if (!rData?.[0] && !hasAccess) {
        const { error: insertRequestErr } = await supabase.from("access_requests").insert({
          user_id: uid,
          email: em,
          full_name: fullName.trim() || ((pData as any)?.full_name ?? null),
          phone: phone.trim() || ((pData as any)?.phone ?? null),
          status: "PENDING",
        });

        if (insertRequestErr) throw insertRequestErr;

        const { data: r2, error: r2Err } = await supabase
          .from("access_requests")
          .select("id,status,created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(1);

        if (r2Err) throw r2Err;
        setRequest((r2?.[0] ?? null) as any);
      } else {
        setRequest((rData?.[0] ?? null) as any);
      }
    } catch (e) {
      setError(`Setup gate (profiles/access_requests): ${normalizeError(e)}`);
      setProfile({ email: session?.user?.email ?? "", has_access: false });
    } finally {
      setGateBusy(false);
    }
  }, [fullName, phone, session?.user?.email, session?.user?.id]);

  useEffect(() => {
    if (!session) return;
    refreshApprovalStatus().catch((e) => setError(normalizeError(e)));
  }, [session, refreshApprovalStatus]);

  /* -------------------------- auth actions -------------------------- */

  const handleSignIn = useCallback(async () => {
    setError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      const e = email.trim();
      if (!e || !password) throw new Error("Escribe email y clave.");
      const { data, error: signErr } = await supabase.auth.signInWithPassword({ email: e, password });
      if (signErr) throw signErr;
      setSession(data.session);
      await refreshApprovalStatus();
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setAuthBusy(false);
    }
  }, [email, password, refreshApprovalStatus]);

  const handleSignUp = useCallback(async () => {
    setError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      const e = email.trim();
      const name = fullName.trim();
      const ph = phone.trim();

      if (!e || !password) throw new Error("Escribe email y clave.");
      if (!name) throw new Error("Escribe tu nombre.");
      if (!ph) throw new Error("Escribe tu WhatsApp/teléfono.");

      const { data, error: upErr } = await supabase.auth.signUp({ email: e, password });
      if (upErr) throw upErr;

      if (!data.session) throw new Error('Tu Supabase tiene "Confirm email" activado. Desactívalo para flujo inmediato.');

      setSession(data.session);

      const uid = data.session.user.id;

      // IMPORTANTE:
      // Nunca hacemos upsert con has_access:false desde el cliente.
      // Si el usuario ya fue aprobado, un upsert así puede tumbar o bloquear el acceso.
      const { data: existingProfile, error: existingProfileErr } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();

      if (existingProfileErr) throw existingProfileErr;

      if (!existingProfile) {
        const { error: insertProfileErr } = await supabase.from("profiles").insert({
          user_id: uid,
          email: e,
          full_name: name,
          phone: ph,
        });

        if (insertProfileErr) throw insertProfileErr;
      } else {
        const { error: updateProfileErr } = await supabase
          .from("profiles")
          .update({
            email: e,
            full_name: name,
            phone: ph,
          })
          .eq("user_id", uid);

        if (updateProfileErr) throw updateProfileErr;
      }

      const { data: existingRequest, error: existingRequestErr } = await supabase
        .from("access_requests")
        .select("id")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingRequestErr) throw existingRequestErr;

      if (!existingRequest?.[0]) {
        const { error: requestErr } = await supabase.from("access_requests").insert({
          user_id: uid,
          email: e,
          full_name: name,
          phone: ph,
          status: "PENDING",
        });

        if (requestErr) throw requestErr;
      }

      await refreshApprovalStatus();
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setAuthBusy(false);
    }
  }, [email, fullName, password, phone, refreshApprovalStatus]);

  return {
    session,
    profile,
    request,
    gateBusy,
    authMode,
    setAuthMode,
    email,
    setEmail,
    password,
    setPassword,
    fullName,
    setFullName,
    phone,
    setPhone,
    authBusy,
    authNotice,
    setAuthNotice,
    refreshApprovalStatus,
    handleSignIn,
    handleSignUp,
  };
}
