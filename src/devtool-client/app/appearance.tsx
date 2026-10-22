import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface Appearance {
  dark: boolean;
  setDark: (dark: boolean) => void;
  hydrate: (dark: boolean) => void;
}
const AppearanceContext = createContext<Appearance | undefined>(undefined);
export function AppearanceProvider({
  children,
  initialDark = false,
}: {
  children: ReactNode;
  initialDark?: boolean;
}) {
  const [dark, updateDark] = useState(initialDark);
  const initialized = useRef(false);
  const setDark = useCallback((value: boolean) => {
    initialized.current = true;
    updateDark(value);
  }, []);
  const hydrate = useCallback((value: boolean) => {
    if (!initialized.current) {
      initialized.current = true;
      updateDark(value);
    }
  }, []);
  const value = useMemo(() => ({ dark, setDark, hydrate }), [dark, setDark, hydrate]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("AppearanceProvider is required.");
  return value;
}
