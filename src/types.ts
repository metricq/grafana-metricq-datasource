import { DataQuery, DataSourceJsonData } from '@grafana/data';

/** Fields supported by metrics.resolve and metrics.suggest. */
export const FILTERABLE_FIELDS = [
  'site', 'room', 'rack', 'feed',
  'asset_type', 'asset_id', 'location_code',
  'scope', 'circuit', 'position', 'power_type', 'phase',
  'service', 'team', 'criticality',
  'system', 'cluster', 'metric_type',
  'description', 'display_name', 'source'
] as const;

export type FilterableField = typeof FILTERABLE_FIELDS[number];

/** Fields that support value suggestions (metrics.suggest). */
export const SUGGESTABLE_FIELDS = FILTERABLE_FIELDS.filter(
  (f) => f !== 'description' && f !== 'display_name'
);

export const GROUPABLE_FIELDS = FILTERABLE_FIELDS.filter(
  (f) => f !== 'description' && f !== 'display_name'
);

export const AGGREGATION_OPTIONS = ['none', 'min', 'max', 'mean', 'sum'] as const;

export type AggregationMode = typeof AGGREGATION_OPTIONS[number];

export const HISTORY_STATISTIC_OPTIONS = ['mean', 'min', 'max', 'count'] as const;

export type HistoryStatistic = typeof HISTORY_STATISTIC_OPTIONS[number];

export interface MetricQQuery extends DataQuery {
  metric?: string; // legacy single-metric field for loading existing saved queries
  metrics: string[];
  filter: Record<string, string | string[]>;
  search: string;
  infix: string;
  selector: string; // regex on metric name (mutually exclusive with infix)
  groupBy?: string; // legacy field, interpreted as collapseBy when loading saved queries
  collapseBy: string;
  aggregateOver: string;
  aggregate: AggregationMode;
  statistics: HistoryStatistic[];
}

export const defaultQuery: Partial<MetricQQuery> = {
  metrics: [],
  filter: {},
  search: '',
  infix: '',
  selector: '',
  collapseBy: '',
  aggregateOver: '',
  aggregate: 'none',
  statistics: ['mean'],
};

export interface MetricQDataSourceOptions extends DataSourceJsonData {}

export interface MetricQSecureJsonData {
  /** Full AMQP URL including credentials, e.g. amqp://user:pass@host:5672/ */
  server?: string;
}
