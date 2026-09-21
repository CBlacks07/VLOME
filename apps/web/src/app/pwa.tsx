"use client";

import { useEffect, useState } from "react";

/** Événement Chromium non typé par TypeScript : proposé par le navigateur quand le site est installable. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "vlome_pwa_dismissed_at";
const DISMISS_DAYS = 14;

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return !!at && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * PWA : enregistre le service worker (production uniquement) et propose d'installer l'application.
 * - Android / Chrome / Edge : bouton « Installer » branché sur l'événement beforeinstallprompt.
 * - iPhone / iPad (Safari) : pas d'API d'installation, on explique « Partager → Sur l'écran d'accueil ».
 * Rien n'est affiché si l'application est déjà installée (mode standalone) ou si l'invitation a été
 * refusée récemment.
 */
export default function PwaSetup() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => { /* non bloquant */ });
    } else {
      // En développement, un ancien service worker servirait des fichiers périmés : on le retire.
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => { /* ignore */ });
    }
  }, []);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone || recentlyDismissed()) return;

    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    if (isIos && isSafari) {
      setIos(true);
      const t = setTimeout(() => setVisible(true), 4000);
      return () => clearTimeout(t);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault(); // on affiche notre propre invitation plutôt que la mini-barre du navigateur
      setEvt(e as InstallPromptEvent);
      setTimeout(() => setVisible(true), 3000);
    };
    const onInstalled = () => { setVisible(false); setEvt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
  }

  async function install() {
    if (!evt) return;
    setVisible(false);
    await evt.prompt();
    const choice = await evt.userChoice.catch(() => null);
    setEvt(null);
    if (choice && choice.outcome !== "accepted") {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    }
  }

  if (!visible || (!evt && !ios)) return null;

  return (
    <div
      role="dialog"
      aria-label="Installer l'application Miabe Esport"
      style={{
        position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 400, margin: "0 auto", maxWidth: 440,
        display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
        background: "#14141D", border: "1px solid #33334A", borderRadius: 16, boxShadow: "0 18px 50px rgba(0,0,0,.55)",
        fontFamily: "Inter, system-ui, sans-serif", color: "#F4F5FB",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/pwa-icon/192" alt="" width={44} height={44} style={{ borderRadius: 11, flex: "none", border: "1px solid #282838" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 750, fontSize: 14 }}>Installer Miabe Esport</div>
        <div style={{ fontSize: 12, color: "#8E8FA6", lineHeight: 1.45, marginTop: 2 }}>
          {ios
            ? "Touche « Partager » puis « Sur l'écran d'accueil » pour l'ajouter comme une application."
            : "Accès rapide depuis ton écran d'accueil, en plein écran."}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "none" }}>
        {!ios && (
          <button onClick={install} style={{ background: "linear-gradient(135deg,#22D3EE,#12aec4)", color: "#04222a", border: 0, borderRadius: 10, padding: "8px 14px", fontWeight: 750, fontSize: 13, cursor: "pointer" }}>
            Installer
          </button>
        )}
        <button onClick={dismiss} style={{ background: "transparent", color: "#8E8FA6", border: 0, padding: "4px 6px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
          {ios ? "Compris" : "Plus tard"}
        </button>
      </div>
    </div>
  );
}
