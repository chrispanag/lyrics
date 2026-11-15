// biome-ignore lint/style/noRestrictedImports: the one module that wraps it.
import { type NavigateOptions, type To, useNavigate as useRouterNavigate } from "react-router-dom";

/**
 * react-router's `navigate`, typed as what it returns here. Its own type allows
 * a promise, which only a data router produces; under `BrowserRouter` it returns
 * nothing, so there is nothing for a caller to await or mark `void`. Moving to a
 * data router makes this type a lie: change it here, and await the calls.
 */
export interface Navigate {
  (to: To, options?: NavigateOptions): void;
  (delta: number): void;
}

export function useNavigate(): Navigate {
  return useRouterNavigate();
}
