"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { MacroState } from "./types";

interface MacroContextValue {
  macro: MacroState | null;
  setMacro: (m: MacroState | null) => void;
}

const MacroContext = createContext<MacroContextValue>({
  macro: null,
  setMacro: () => {},
});

export function MacroProvider({ children }: { children: ReactNode }) {
  const [macro, setMacro] = useState<MacroState | null>(null);
  return (
    <MacroContext.Provider value={{ macro, setMacro }}>
      {children}
    </MacroContext.Provider>
  );
}

export function useMacroContext() {
  return useContext(MacroContext);
}
