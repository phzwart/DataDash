import { useQuery } from "@tanstack/react-query";
import {
  HubAppLayout,
  type RouteItem,
} from "@blueskyproject/finch";
import {
  ChartBar,
  FlowArrow,
  Gear,
  SquaresFour,
} from "@phosphor-icons/react";
import CratesPage from "./pages/CratesPage";
import CrateDetailPage from "./pages/CrateDetailPage";
import PlotsPage from "./pages/PlotsPage";
import SetupPage from "./pages/SetupPage";
import CartPage from "./pages/CartPage";
import SelectionPage from "./pages/SelectionPage";
import ExportPage from "./pages/ExportPage";
import NotesPage from "./pages/NotesPage";
import NotesWindowLauncher from "./components/NotesWindowLauncher";
import RouteRedirect from "./components/RouteRedirect";
import { resolveDashboardUri } from "./lib/dashboardConfig";
import { isNotesPopupWindow } from "./lib/notesLog";
import { fetchDashboardConfig } from "./lib/schema";

const routes: RouteItem[] = [
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
        label: "Cart",
        element: <CartPage />,
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
    label: "Cart",
    element: <RouteRedirect to="/workflow/cart" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/export",
    label: "Export",
    element: <RouteRedirect to="/workflow/export" />,
    isBackgroundTransparent: true,
  },
];

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
      <HubAppLayout
        routes={routes}
        headerTitle={headerTitle}
        showPageTitle={false}
        classNameMainContentScrollContainer="p-4 md:p-6"
      />
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
  return <MainApp />;
}
