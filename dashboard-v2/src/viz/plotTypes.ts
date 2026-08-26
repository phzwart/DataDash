/** Config-driven viz panel types for Finch Plots. */

import type {
  CategoricalPlotSpec,
  HistogramPlotSpec,
  PlotLayoutSpec,
  ScatterPlotSpec,
  TablePlotSpec,
} from "../lib/schema";

export type VegaSelectionBinding = {
  /** Vega signal name emitting selected rows / ids (default: brush). */
  signal?: string;
  /** Field on each data row that is the crate id (default: id). */
  id_field?: string;
};

export type VegaPlotSpec = PlotLayoutSpec & {
  title?: string;
  /** Inline Vega-Lite spec (data.values filled at runtime). */
  spec?: Record<string, unknown>;
  /** Optional URI to a .vl.json / YAML VL document. */
  spec_uri?: string;
  selection?: VegaSelectionBinding;
};

export type ThreeUnitCellFields = {
  a?: string;
  b?: string;
  c?: string;
  alpha?: string;
  beta?: string;
  gamma?: string;
  label?: string;
  color?: string;
};

export type ThreePlotSpec = PlotLayoutSpec & {
  title?: string;
  /** Registered Three.js tool id. */
  tool: "unit_cell_lattice";
  fields?: ThreeUnitCellFields;
};

export type PlotRowPanel =
  | ({ type: "table" } & TablePlotSpec)
  | ({ type: "vega" } & VegaPlotSpec)
  | ({ type: "three" } & ThreePlotSpec)
  | ({ type: "scatter" } & ScatterPlotSpec)
  | ({ type: "histogram" } & HistogramPlotSpec)
  | ({ type: "categorical" } & CategoricalPlotSpec);

/** Flat row fed to Vega-Lite (crate id + searchable metadata). */
export type CrateDataRow = Record<string, unknown> & { id: string };
