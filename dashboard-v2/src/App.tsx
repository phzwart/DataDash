import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router";
import {
  FinchHeader,
  FinchMainContent,
  FinchSidebar,
  type RouteItem,
} from "@blueskyproject/finch";
import {
  ChartBar,
  FileText,
  FlowArrow,
  Gear,
  MagnifyingGlass,
  SquaresFour,
} from "@phosphor-icons/react";
import CratesPage from "./pages/CratesPage";
import CrateDetailPage from "./pages/CrateDetailPage";
import PlotsPage from "./pages/PlotsPage";
import ReportPage from "./pages/ReportPage";
import SetupPage from "./pages/SetupPage";
import SearchPage from "./pages/SearchPage";
import CartPage from "./pages/CartPage";
import SelectionPage from "./pages/SelectionPage";
import ExportPage from "./pages/ExportPage";
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
    label: "Data & Projects",
    element: <CratesPage />,
    icon: <SquaresFour size={28} />,
    isBackgroundTransparent: true,
    showPageTitle: false,
  },
  {
    path: "/organize",
    label: "Organize",
    element: <PlotsPage />,
    icon: <ChartBar size={28} />,
    isBackgroundTransparent: true,
  },
  {
    path: "/report",
    label: "Report",
    element: <ReportPage />,
    icon: <FileText size={28} />,
    isBackgroundTransparent: true,
  },
  {
    path: "/work",
    label: "Work",
    icon: <FlowArrow size={28} />,
    isBackgroundTransparent: true,
    tabs: [
      {
        path: "run",
        label: "Run",
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
];

function ProjectBookRedirect() {
  const { projectId, subId } = useParams();
  const q = new URLSearchParams();
  if (projectId) q.set("project", projectId);
  if (subId) q.set("sub", subId);
  return <Navigate to={q.toString() ? `/?${q}` : "/"} replace />;
}

/** Reachable pages kept out of the sidebar (deep links, popups, legacy URLs). */
const hiddenRoutes: RouteItem[] = [
  {
    path: "/projects/:projectId/sub/:subId",
    label: "Subproject",
    element: <ProjectBookRedirect />,
    isBackgroundTransparent: true,
    showPageTitle: false,
  },
  {
    path: "/projects/:projectId",
    label: "Project",
    element: <ProjectBookRedirect />,
    isBackgroundTransparent: true,
    showPageTitle: false,
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
    path: "/plots",
    label: "Organize",
    element: <RouteRedirect to="/organize" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/work/selection",
    label: "Selection",
    element: <SelectionPage />,
    isBackgroundTransparent: true,
  },
  {
    path: "/selection",
    label: "Selection",
    element: <RouteRedirect to="/work/selection" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/cart",
    label: "Work",
    element: <RouteRedirect to="/work/run" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/export",
    label: "Export",
    element: <RouteRedirect to="/work/export" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/actions",
    label: "Work",
    element: <RouteRedirect to="/work/run" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/workflow",
    label: "Work",
    element: <RouteRedirect to="/work/run" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/workflow/cart",
    label: "Work",
    element: <RouteRedirect to="/work/run" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/workflow/selection",
    label: "Selection",
    element: <RouteRedirect to="/work/selection" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/workflow/export",
    label: "Export",
    element: <RouteRedirect to="/work/export" />,
    isBackgroundTransparent: true,
  },
  {
    path: "/workflow/actions",
    label: "Work",
    element: <RouteRedirect to="/work/run" />,
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
