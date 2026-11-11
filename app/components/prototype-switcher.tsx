// PROTOTYPE, throwaway. Floating variant switcher for UI prototypes.
// Variant lives in ?variant= and is mirrored to localStorage so it survives
// sidebar navigation (NavLinks drop the search param).
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STORAGE_KEY = "prototype-variant";

export function usePrototypeVariant(keys: string[]) {
  const [params] = useSearchParams();
  const fromUrl = params.get("variant");
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    if (fromUrl && keys.includes(fromUrl)) {
      try {
        localStorage.setItem(STORAGE_KEY, fromUrl);
      } catch {}
      setStored(fromUrl);
    } else {
      try {
        setStored(localStorage.getItem(STORAGE_KEY));
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const current = [fromUrl, stored].find((v) => v && keys.includes(v)) ?? keys[0];
  return current;
}

export function PrototypeSwitcher({
  variants,
  current,
  children,
}: {
  variants: { key: string; name: string }[];
  current: string;
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const index = Math.max(0, variants.findIndex((v) => v.key === current));

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    const p = new URLSearchParams(params);
    p.set("variant", next.key);
    navigate({ search: p.toString() }, { replace: true, preventScrollReset: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  const v = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-2 py-1.5 text-sm text-white shadow-xl ring-2 ring-amber-400">
      <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-white/20" title="Previous (←)">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-40 text-center font-mono">
        {v.key} ({v.name})
      </span>
      <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-white/20" title="Next (→)">
        <ChevronRight className="size-4" />
      </button>
      {children}
    </div>
  );
}
