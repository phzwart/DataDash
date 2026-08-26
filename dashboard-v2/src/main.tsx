import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FinchConfigProvider } from "@blueskyproject/finch";
import "@blueskyproject/finch/style.css";
import App from "./App";
import {
  getTiledApiKey,
  getTiledApiUrl,
  TILED_SERVER_CHANGED,
} from "./lib/tiledServer";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function Root() {
  const [tiled, setTiled] = useState(() => ({
    tiledApiUrl: getTiledApiUrl(),
    tiledApiKey: getTiledApiKey(),
  }));

  useEffect(() => {
    const sync = () => {
      setTiled({
        tiledApiUrl: getTiledApiUrl(),
        tiledApiKey: getTiledApiKey(),
      });
      void queryClient.invalidateQueries();
    };
    window.addEventListener(TILED_SERVER_CHANGED, sync);
    return () => window.removeEventListener(TILED_SERVER_CHANGED, sync);
  }, []);

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <FinchConfigProvider config={tiled}>
          <App />
        </FinchConfigProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
