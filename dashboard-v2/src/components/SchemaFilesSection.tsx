import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import YamlInspector from "./YamlInspector";
import { resolveCollectionUri } from "../lib/collectionConfig";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import { fetchDashboardConfig } from "../lib/schema";
import { getTiledOrigin } from "../lib/tiledServer";

type Props = {
  collectionDraft?: string;
  dashboardDraft?: string;
};

/** YAML inspectors for active collection, dashboard, and LinkML schema files. */
export default function SchemaFilesSection({
  collectionDraft,
  dashboardDraft,
}: Props) {
  const dashUriQuery = useQuery({
    queryKey: ["dashboard-uri-resolved"],
    queryFn: resolveDashboardUri,
  });

  const coll = useMemo(() => resolveCollectionUri(), []);

  const dashConfigQuery = useQuery({
    queryKey: ["dashboard-config", dashUriQuery.data?.uri],
    queryFn: () => fetchDashboardConfig(dashUriQuery.data!.uri),
    enabled: Boolean(dashUriQuery.data?.uri),
  });

  const dashboardUri = dashboardDraft?.trim() || dashUriQuery.data?.uri;
  const schemaUri = dashConfigQuery.data?.schema_uri;
  const collectionUri = collectionDraft?.trim() || coll.uri;
  const seriesSchemaUri = `${getTiledOrigin()}/schemas/lambda_mx_series.yaml`;
  const bookSchemaUri = `${getTiledOrigin()}/schemas/lambda_project_book.yaml`;
  const bookDashUri = `${getTiledOrigin()}/schemas/lambda_project_book_dashboard.yaml`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Expand a file to load contents; use Open for a raw browser tab.
      </p>
      <YamlInspector uri={dashboardUri} title="Dashboard YAML" />
      <YamlInspector uri={schemaUri} title="LinkML schema (schema_uri)" />
      <YamlInspector
        uri={collectionUri}
        title={`Collection YAML${!collectionUri ? " (none active)" : ""}`}
      />
      <YamlInspector uri={seriesSchemaUri} title="Lambda MX series (LinkML)" />
      <YamlInspector
        uri={bookSchemaUri}
        title="Project Book LinkML (developer)"
      />
      <YamlInspector
        uri={bookDashUri}
        title="Project Book dashboard YAML (developer)"
      />
      {collectionDraft?.trim() ? (
        <YamlInspector
          uri={collectionDraft.trim()}
          title="Collection YAML (draft URL)"
        />
      ) : null}
      {dashboardDraft?.trim() &&
      dashboardDraft.trim() !== dashboardUri ? (
        <YamlInspector
          uri={dashboardDraft.trim()}
          title="Dashboard YAML (draft URL)"
        />
      ) : null}
    </div>
  );
}
