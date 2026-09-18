import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LinkSimple } from "@phosphor-icons/react";
import { Paper } from "@blueskyproject/finch";
import ZoomableTiledImage from "../components/ZoomableTiledImage";
import CompactMetricsTable from "../components/CompactMetricsTable";
import CrateMarkerControls from "../components/CrateMarkerControls";
import CrateActionsPanel from "../components/CrateActionsPanel";
import PushToNotesButton from "../components/PushToNotesButton";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import { fetchCrateSidecar } from "../lib/cratePlotData";
import {
  fetchCrateMetadata,
  fetchSeriesMembers,
  shortId,
  str,
  tissueClassRows,
  type CrateMetadata,
} from "../lib/tiledCrates";
import {
  fetchDashboardConfig,
  fetchLinkmlSchema,
  formatSlotValue,
  isTissueFractionsSlot,
  primaryClassMaskBinding,
  slotLabel,
  type DashboardConfig,
  type ParsedSchema,
} from "../lib/schema";
import CratePlotsColumn from "../viz/CrateVegaPlot";

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-slate-700/50 last:border-0">
      <dt className="text-slate-200 text-base shrink-0 max-w-[45%]">{label}</dt>
      <dd className="text-slate-50 text-base text-right break-all">{value}</dd>
    </div>
  );
}

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Paper className={`p-4 bg-slate-900/70 ${className}`}>
      <h2 className="text-base font-semibold uppercase tracking-wide text-sky-200 mb-3">
        {title}
      </h2>
      {children}
    </Paper>
  );
}

function KpiChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2 min-w-[7rem]">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="text-base text-slate-100 mt-0.5 font-medium truncate max-w-[14rem]">
        {value}
      </div>
    </div>
  );
}

function ClassFractionsSection({
  schema,
  meta,
  legendSlot,
  binding,
}: {
  schema: ParsedSchema;
  meta: CrateMetadata;
  legendSlot: string;
  binding: ReturnType<typeof primaryClassMaskBinding>;
}) {
  const rows = tissueClassRows(meta, {
    legendSlot,
    idSlot: binding?.label_id_slot,
    keySlot: binding?.label_key_slot,
    nameSlot: binding?.label_name_slot,
  });
  const nameSlot = binding?.label_name_slot ?? "label_name";
  const keySlot = binding?.label_key_slot ?? "label_key";

  if (rows.length === 0) {
    return <p className="text-slate-400 text-base">No class-fraction data</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="flex justify-between gap-2 text-base mb-1">
            <div>
              <span className="text-slate-100 font-medium">{row.name}</span>
              {row.tissueClassId != null && (
                <span className="ml-2 text-sm text-slate-400 font-mono">
                  id {row.tissueClassId}
                </span>
              )}
              {row.description && (
                <p className="text-sm text-slate-400 mt-0.5">{row.description}</p>
              )}
            </div>
            <div className="text-right shrink-0 tabular-nums text-slate-200 text-base">
              {row.percent.toFixed(1)}%
              <div className="text-sm text-slate-400">
                {row.pixelCount.toLocaleString()} px
              </div>
            </div>
          </div>
          <div className="h-2 rounded bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded bg-sky-500/80"
              style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }}
            />
          </div>
          <div className="sr-only">
            {slotLabel(schema, keySlot)}={row.key}{" "}
            {slotLabel(schema, nameSlot)}={row.name}{" "}
            fraction={row.fraction} percent={row.percent} px={row.pixelCount}
          </div>
        </div>
      ))}
    </div>
  );
}

function SchemaSection({
  schema,
  dash,
  meta,
  title,
  slots,
  wide,
  binding,
}: {
  schema: ParsedSchema;
  dash: DashboardConfig;
  meta: CrateMetadata;
  title: string;
  slots: string[];
  wide?: boolean;
  binding: ReturnType<typeof primaryClassMaskBinding>;
}) {
  const tissueSlots = slots.filter((s) =>
    isTissueFractionsSlot(schema, s, dash.tissue_class),
  );
  const plainSlots = slots.filter(
    (s) => !isTissueFractionsSlot(schema, s, dash.tissue_class),
  );

  return (
    <Section title={title} className={wide ? "md:col-span-2" : ""}>
      {plainSlots.length > 0 && (
        <dl>
          {plainSlots.map((slotName) => {
            const raw = meta[slotName];
            const slot = schema.slots[slotName];
            const isUri =
              slot?.range === "uri" ||
              (typeof raw === "string" && /^https?:\/\//.test(raw));
            const display = formatSlotValue(schema, slotName, raw);
            return (
              <div key={slotName}>
                {isUri && typeof raw === "string" ? (
                  <div className="flex justify-between gap-4 py-2 border-b border-slate-700/50">
                    <dt className="text-slate-200 text-base shrink-0">
                      {slotLabel(schema, slotName)}
                    </dt>
                    <dd className="text-right">
                      <a
                        href={raw}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-start gap-1 text-sky-300 hover:text-sky-200 text-base break-all"
                      >
                        <LinkSimple size={16} className="shrink-0 mt-0.5" />
                        {display}
                      </a>
                    </dd>
                  </div>
                ) : (
                  <MetaRow
                    label={slotLabel(schema, slotName)}
                    value={display}
                  />
                )}
              </div>
            );
          })}
        </dl>
      )}
      {tissueSlots.map((slotName) => (
        <div key={slotName} className={plainSlots.length ? "mt-4" : ""}>
          <ClassFractionsSection
            schema={schema}
            meta={meta}
            legendSlot={slotName}
            binding={binding}
          />
        </div>
      ))}
    </Section>
  );
}

export default function CrateDetailPage() {
  const { uuid = "" } = useParams();
  const location = useLocation();
  const returnState =
    location.state &&
    typeof location.state === "object" &&
    !Array.isArray(location.state)
      ? (location.state as { backTo?: unknown; backLabel?: unknown })
      : null;
  const backTo = typeof returnState?.backTo === "string" ? returnState.backTo : "/";
  const backLabel =
    typeof returnState?.backLabel === "string"
      ? returnState.backLabel
      : "Data & Projects";

  const crateQuery = useQuery({
    queryKey: ["crate", uuid],
    queryFn: () => fetchCrateMetadata(uuid),
    enabled: Boolean(uuid),
  });

  const dashUriQuery = useQuery({
    queryKey: ["dashboard-uri-resolved"],
    queryFn: resolveDashboardUri,
  });

  const dashQuery = useQuery({
    queryKey: ["dashboard-config", dashUriQuery.data?.uri],
    queryFn: () => fetchDashboardConfig(dashUriQuery.data!.uri),
    enabled: Boolean(dashUriQuery.data?.uri),
  });

  const schemaUri = dashQuery.data?.schema_uri ?? "";
  const crateSchemaUri =
    (crateQuery.data?.metadata.schema_uri as string | undefined) ?? "";

  const schemaQuery = useQuery({
    queryKey: ["schema", schemaUri],
    queryFn: () => fetchLinkmlSchema(schemaUri),
    enabled: Boolean(schemaUri),
  });

  const groupKey = dashQuery.data?.preview?.series_group_key;
  const indexKey = dashQuery.data?.preview?.series_index_key;

  const seriesQuery = useQuery({
    queryKey: ["series", uuid, groupKey, indexKey],
    queryFn: () =>
      fetchSeriesMembers(crateQuery.data!, groupKey!, indexKey!),
    enabled: Boolean(crateQuery.data && groupKey && indexKey),
  });

  const needsSidecar = Boolean(
    dashQuery.data?.crate?.plots?.panels.some((p) => p.data.from === "sidecar"),
  );
  const sidecarFile =
    typeof crateQuery.data?.metadata.sidecar_file === "string"
      ? crateQuery.data.metadata.sidecar_file
      : null;
  const sidecarQuery = useQuery({
    queryKey: ["crate-sidecar", uuid, sidecarFile],
    queryFn: () => fetchCrateSidecar(uuid, sidecarFile),
    enabled: Boolean(uuid && needsSidecar),
  });

  const navigate = useNavigate();
  const [detailTab, setDetailTab] = useState<"overview" | "actions">("overview");

  const series = seriesQuery.data ?? [];
  const seriesIndex = useMemo(() => {
    const i = series.findIndex((m) => m.id === uuid);
    return i >= 0 ? i : 0;
  }, [series, uuid]);

  if (crateQuery.isLoading) {
    return <p className="p-6 text-slate-400">Loading crate…</p>;
  }
  if (crateQuery.error || !crateQuery.data) {
    return (
      <div className="p-6 space-y-3">
        <Link
          to={backTo}
          className="text-sky-400 text-sm inline-flex items-center gap-1"
        >
          <ArrowLeft size={14} /> {backLabel}
        </Link>
        <Paper className="p-4 text-rose-300 text-sm">
          Could not load crate <code>{uuid}</code>
          {crateQuery.error ? `: ${String(crateQuery.error)}` : ""}
        </Paper>
      </div>
    );
  }

  const meta = crateQuery.data.metadata;
  const schema = schemaQuery.data;
  const dash = dashQuery.data;
  const crateCfg = dash?.crate;
  const actionsEnabled = Boolean(
    crateCfg?.actions && crateCfg.actions.enabled !== false,
  );
  const actionsCfg = actionsEnabled ? crateCfg!.actions! : null;
  const hasCratePlots = Boolean(crateCfg?.plots?.panels.length);
  const stride = dash?.preview?.stride ?? 8;
  const widthFraction =
    crateCfg?.plots?.defaults?.width_fraction ??
    dash?.preview?.width_fraction ??
    (hasCratePlots ? 0.45 : 0.25);
  const classMask = schema ? primaryClassMaskBinding(schema) : null;
  const imageChild =
    dash?.preview?.image_child ?? classMask?.primary_child ?? null;
  const maskChild =
    dash?.preview?.mask_child ?? classMask?.mask_child ?? null;
  const previewConfig = {
    stride,
    oversample: dash?.preview?.oversample ?? 4,
    mask_overlay: dash?.preview?.mask_overlay !== false,
    mask_opacity: dash?.preview?.mask_opacity ?? 0.45,
    mask_legend_enum:
      dash?.preview?.mask_legend_enum ?? classMask?.legend_enum,
    mask_colors: dash?.preview?.mask_colors,
  };

  const titleSlot = dash?.hero.title;
  const subtitleSlot = dash?.hero.subtitle;
  const title = titleSlot ? str(meta, titleSlot) : shortId(crateQuery.data.id);
  const subtitle = subtitleSlot ? str(meta, subtitleSlot) : "";
  const showSeriesSlider = Boolean(groupKey && indexKey && series.length > 1);

  return (
    <div className="flex flex-col gap-4 p-4 w-full h-full min-h-0 overflow-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={backTo}
            className="text-sky-400 text-sm inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft size={14} /> {backLabel}
          </Link>
          <h1 className="text-3xl font-semibold text-slate-100">{title}</h1>
          <p className="text-base text-slate-300 mt-1">{subtitle}</p>
          <p className="text-sm font-mono text-slate-500 mt-1">
            {crateQuery.data.id}
          </p>
          <div className="crate-detail-markers mt-3 max-w-lg">
            <CrateMarkerControls crateId={crateQuery.data.id} size="cozy" />
          </div>
          {dash && (
            <p className="text-sm text-slate-400 mt-2 max-w-2xl">
              Layout from{" "}
              <a
                href={dashUriQuery.data?.uri}
                className="text-sky-400 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {dash.title ?? "dashboard"}
              </a>
              {schemaUri ? (
                <>
                  {" "}
                  · data schema{" "}
                  <a
                    href={crateSchemaUri || schemaUri}
                    className="text-sky-400 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    LinkML
                  </a>
                </>
              ) : null}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <PushToNotesButton
            crates={[
              {
                id: crateQuery.data.id,
                label: title !== "—" ? title : shortId(crateQuery.data.id),
              },
            ]}
          />
          {(dash?.hero.badges ?? []).map((slot) => (
            <span
              key={slot}
              className="text-sm uppercase tracking-wide px-3 py-1 rounded-full bg-sky-900/70 text-sky-100"
              title={schema ? slotLabel(schema, slot) : slot}
            >
              {schema
                ? formatSlotValue(schema, slot, meta[slot])
                : str(meta, slot)}
            </span>
          ))}
        </div>
      </div>

      {dash?.hero.facts && schema && (
        <div className="flex flex-wrap gap-2">
          {dash.hero.facts.map((slot) => (
            <KpiChip
              key={slot}
              label={slotLabel(schema, slot)}
              value={formatSlotValue(schema, slot, meta[slot])}
            />
          ))}
        </div>
      )}

      {(dashQuery.isLoading || schemaQuery.isLoading) && (
        <p className="text-slate-300 text-base">Loading dashboard / LinkML…</p>
      )}
      {dashQuery.error && (
        <Paper className="p-4 text-amber-300 text-sm">
          Dashboard layout unavailable: {String(dashQuery.error)}. Configure
          under Setup. Showing previews only.
        </Paper>
      )}
      {schemaQuery.error && (
        <Paper className="p-4 text-amber-300 text-sm">
          LinkML schema unavailable: {String(schemaQuery.error)}.
        </Paper>
      )}

      {actionsEnabled ? (
        <div className="flex gap-1 border-b border-slate-700/80">
          {(
            [
              { id: "overview" as const, label: "Overview" },
              {
                id: "actions" as const,
                label: actionsCfg?.title ?? "Actions",
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDetailTab(tab.id)}
              className={`px-3 py-2 text-base border-b-2 -mb-px transition-colors ${
                detailTab === tab.id
                  ? "border-sky-400 text-sky-100"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {actionsEnabled && detailTab === "actions" && actionsCfg ? (
        <Paper className="p-4 bg-slate-900/70">
          <CrateActionsPanel crateUuid={uuid} config={actionsCfg} />
        </Paper>
      ) : (
      <div className="flex flex-col xl:flex-row gap-4 items-start">
        <div
          className="shrink-0"
          style={{ width: `min(100%, ${widthFraction * 100}vw)` }}
        >
          <Paper className="p-4 bg-slate-900/70">
            <h2 className="text-base font-semibold uppercase tracking-wide text-sky-200 mb-3">
              {hasCratePlots ? "Crate plots" : "Viewer"}
            </h2>

            {showSeriesSlider && (
              <div className="mb-4 space-y-2">
                <div className="flex justify-between text-sm text-slate-300">
                  <span>
                    Series · {String(meta[groupKey!] ?? groupKey)} (
                    {series.length} frames)
                  </span>
                  <span className="tabular-nums">
                    {indexKey} {series[seriesIndex]?.label}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={series.length - 1}
                  step={1}
                  value={seriesIndex}
                  onChange={(e) => {
                    const next = series[Number(e.target.value)];
                    if (next && next.id !== uuid) {
                      navigate(`/crates/${next.id}`, { state: location.state });
                    }
                  }}
                  className="w-full accent-sky-500"
                />
                <div className="flex justify-between text-xs text-slate-500 font-mono">
                  <span>{series[0]?.label}</span>
                  <span>{series[series.length - 1]?.label}</span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4">
              {dashQuery.isLoading ? (
                <p className="text-slate-400 text-base">Loading dashboard layout…</p>
              ) : hasCratePlots && crateCfg?.plots ? (
                <>
                  {sidecarQuery.isLoading ? (
                    <p className="text-slate-400 text-base">Loading sidecar…</p>
                  ) : sidecarQuery.error ? (
                    <p className="text-amber-200 text-base">
                      Sidecar unavailable: {String(sidecarQuery.error)}
                    </p>
                  ) : (
                    <CratePlotsColumn
                      plots={crateCfg.plots}
                      sidecar={sidecarQuery.data}
                      metadata={meta}
                    />
                  )}
                  {crateCfg.metrics ? (
                    <div className="pt-2 border-t border-slate-700/60">
                      <CompactMetricsTable
                        metrics={crateCfg.metrics}
                        schema={schema}
                        meta={meta}
                      />
                    </div>
                  ) : null}
                </>
              ) : imageChild ? (
                <ZoomableTiledImage
                  uuid={uuid}
                  imageChild={imageChild}
                  maskChild={maskChild}
                  config={previewConfig}
                  schema={schema}
                  crateMeta={meta}
                  label={
                    maskChild
                      ? `${imageChild} + ${maskChild} overlay`
                      : imageChild
                  }
                />
              ) : (
                <>
                  {crateCfg?.metrics ? (
                    <CompactMetricsTable
                      metrics={crateCfg.metrics}
                      schema={schema}
                      meta={meta}
                    />
                  ) : dashQuery.error ? (
                    <p className="text-amber-200 text-base">
                      Dashboard YAML unavailable — plots/metrics cannot load.
                      Check Setup / client_store schemas.
                    </p>
                  ) : (
                    <p className="text-slate-400 text-base">
                      No primary image child declared (set preview.image_child or
                      a schema ClassMaskBinding), and no crate.plots in the
                      dashboard YAML.
                    </p>
                  )}
                </>
              )}
            </div>
          </Paper>
        </div>

        <div className="flex-1 min-w-0 grid gap-4 md:grid-cols-1 2xl:grid-cols-2 w-full">
          {schema && dash ? (
            dash.sections.map((section) => (
              <SchemaSection
                key={section.id}
                schema={schema}
                dash={dash}
                meta={meta}
                title={section.title}
                slots={section.slots}
                wide={section.wide}
                binding={classMask}
              />
            ))
          ) : (
            <p className="text-slate-400 text-base">Loading metadata sections…</p>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
