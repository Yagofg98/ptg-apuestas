import { useEffect, useState } from "react";

/**
 * Instalación de la PWA. En Android/Chrome usa el prompt nativo (beforeinstallprompt);
 * en iOS (que no lo soporta) muestra las instrucciones de "Añadir a pantalla de inicio".
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || installed) {
    return <p className="text-sm text-padel-400">✓ App instalada en tu pantalla de inicio.</p>;
  }

  if (deferred) {
    return (
      <button
        onClick={async () => {
          deferred.prompt();
          await deferred.userChoice.catch(() => {});
          setDeferred(null);
        }}
        className="btn-primary w-full"
      >
        📲 Instalar app
      </button>
    );
  }

  // iOS o navegador sin prompt → instrucciones manuales.
  return (
    <p className="text-sm text-gray-300 leading-relaxed">
      {isIOS ? (
        <>
          En iPhone: pulsa <b>Compartir</b> (el cuadro con la flecha ↑) y luego{" "}
          <b>“Añadir a pantalla de inicio”</b>.
        </>
      ) : (
        <>
          Abre el <b>menú del navegador</b> (⋮) y elige <b>“Instalar aplicación”</b> o{" "}
          <b>“Añadir a pantalla de inicio”</b>.
        </>
      )}
    </p>
  );
}
