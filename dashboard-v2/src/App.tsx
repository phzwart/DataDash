import { useQuery } from "@tanstack/react-query";
import {
  FinchHeader,
  FinchMainContent,
  FinchSidebar,
  type RouteItem,
} from "@blueskyproject/finch";
import {
  ChartBar,
  FlowArrow,
  Gear,
  MagnifyingGlass,
  SquaresFour,
} from "@phosphor-icons/react";
import CratesPage from "./pages/CratesPage";
import CrateDetailPage from "./pages/CrateDetailPage";
import PlotsPage from "./pages/PlotsPage";
import SetupPage from "./pages/SetupPage";
import SearchPage from "./pages/SearchPage";
import CartPage from "./pages/CartPage";
import SelectionPage from "./pages/SelectionPage";
import ExportPage from "./pages/ExportPage";
import ActionsPage from "./pages/ActionsPage";
import NotesPage from "./pages/NotesPage";
import DensityPage from "./pages/DensityPage";
import NotesWindowLauncher from "./components/NotesWindowLauncher";
import RouteRedirect from "./components/RouteRedirect";
import { resolveDashboardUri } from "./lib/dashboardConfig";
import { isNotesPopupWindow } from "./lib/notesLog";
import { isDensityPopupWindow } from "./lib/densityPopup";
import { fetchDashboardConfig } from "./lib/schema";

/** Primary sidebar — top → bottom, nothing else. */
const navRoutes: RouteItem[] = [
  {
    path: "/search",
    label: "Search",
    element: <SearchPage />,
    icon: <MagnifyingGlass size={28} />,
    isBackgroundTransparent: true,
  },
  {
    path: "/",
    label: "Data Overview",
    element: <CratesPage />,
    icon: <SquaresFour size={28} />,
    isBackgroundTransparent: true,
    showPageTitle: false,
  },
  {
    path: "/plots",
    label: "Plots",
    element: <PlotsPage />,
    icon: <ChartBar size={28} />,
    isBackgroundTransparent: true,
  },
  {
    path: "/workflow",
    label: "Workflow",
    icon: <FlowArrow size={28} />,
    isBackgroundTransparent: true,
    tabs: [
      {
        path: "selection",
        label: "Selection",
        element: <SelectionPage />,
        isBackgroundTransparent: true,
      },
      {
        path: "cart",
        label: "Action queue",
        element: <CartPage />,
        isBackgroundTransparent: true,
      },
      {
        path: "actions",
        label: "Actions",
        element: <ActionsPage />,
        isBackgroundTransparent: true,
      },
      {
        path: "export",
        label: "Export",
        element: <ExportPage />,
        isBackgroundTransparent: true,
      },
    ],
  },
  {
    path: "/setup",
    label: "Setup",
    element: <SetupPage />,
    icon: <Gear size={28} />,
    isBackgroundTransparent: true,
  },
];

/** Reachable pages kept out of the sidebar (deep links, popups, legacy URLs). */
const hiddenRoutes: RouteItem[] = [
  {
    path: "/crates/:uuid",
    label: "Crate",
    element: <CrateDetailPage />,
    isBackgroundTransparent: true,
  },
  {
    path: "/notes",
    label: "Notes",
    element: <NotesPage />,
    isBackgroundTransparent: true,
  },
  {
    path: "/density",
    label: "Density",
    element: <DensityPage />,
    isBackgroundTransparent: true,
  },
  {
    path: "/schemas",
    label: "Schemas",
    element: <RouteRedirect to="/setup#schemas" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/browse",
    label: "Tiled",
    element: <RouteRedirect to="/setup#catalog-browser" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/selection",
    label: "Selection",
    element: <RouteRedirect to="/workflow/selection" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/cart",
    label: "Action queue",
    element: <RouteRedirect to="/workflow/cart" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/export",
    label: "Export",
    element: <RouteRedirect to="/workflow/export" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/actions",
    label: "Actions",
    element: <RouteRedirect to="/workflow/actions" />,
    isBackgroundTransparent: true,
  },
];

const allRoutes: RouteItem[] = [...navRoutes, ...hiddenRoutes];

function MainApp() {
  const uriQuery = useQuery({
    queryKey: ["dashboard-uri-resolved"],
    queryFn: resolveDashboardUri,
  });
  const dashQuery = useQuery({
    queryKey: ["dashboard-config", uriQuery.data?.uri],
    queryFn: () => fetchDashboardConfig(uriQuery.data!.uri),
    enabled: Boolean(uriQuery.data?.uri),
  });

  const headerTitle = dashQuery.data?.title?.trim() || "Lambda MX";

  return (
    <>
      <div className="grid grid-cols-[6rem_1fr] grid-rows-[auto_1fr] h-screen w-screen">
        <FinchSidebar routes={navRoutes} />
        <FinchHeader title={headerTitle} />
        <FinchMainContent
          routes={allRoutes}
          className="h-[calc(100vh-4rem)]"
          classNameScrollContainer="p-4 md:p-6"
        />
      </div>
      <NotesWindowLauncher />
    </>
  );
}

export default function App() {
  if (isNotesPopupWindow()) {
    if (typeof document !== "undefined") {
      document.documentElement.classList.add("notes-popup");
      document.body?.classList.add("notes-popup");
    }
    return <NotesPage />;
  }
  if (isDensityPopupWindow()) {
    if (typeof document !== "undefined") {
      document.documentElement.classList.add("density-popup");
      document.body?.classList.add("density-popup");
    }
    return <DensityPage />;
  }
  return <MainApp />;
}
