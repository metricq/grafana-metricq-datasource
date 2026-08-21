import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';
import { DataSourceInstanceSettings, MetricFindValue, ScopedVars } from '@grafana/data';
import { MetricQQuery, MetricQDataSourceOptions, defaultQuery } from './types';

export interface SuggestValue {
  value: string;
  count: number;
}

export interface MetricExplorerResult {
  name: string;
  description?: string;
  display_name?: string;
}

export interface MetricCountResult {
  count: number;
  interactive_limit: number;
}

/** Parses a Grafana-interpolated string value into a scalar or array.
 *  "{v1,v2,v3}" → ["v1","v2","v3"],  "v1" → "v1",  sentinels → undefined
 */
function parseFilterValue(v: string): string | string[] | undefined {
  if (v === '' || v === '*' || v === '$__all') {
    return undefined;
  }
  if (v.startsWith('{') && v.endsWith('}')) {
    const parts = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length === 1 ? parts[0] : parts;
  }
  return v;
}

function asFilterValues(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function explicitMetrics(query: MetricQQuery): string[] {
  const seen = new Set<string>();
  const metrics: string[] = [];

  const addMetric = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    metrics.push(trimmed);
  };

  addMetric(query.metric);
  for (const metric of Array.isArray(query.metrics) ? query.metrics : []) {
    addMetric(metric);
  }

  return metrics;
}

export class MetricQDataSource extends DataSourceWithBackend<MetricQQuery, MetricQDataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<MetricQDataSourceOptions>) {
    super(instanceSettings);
  }

  /**
   * Interpolate dashboard variables before a request leaves the browser.
   *
   * The backend does not receive Grafana's dashboard-variable state, so doing
   * this there would leave values such as "$system" literal.
   */
  private interpolateQuery(query: Partial<MetricQQuery>, scopedVars?: ScopedVars): MetricQQuery {
    const srv = getTemplateSrv();
    const interpolatedFilter: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(query.filter ?? {})) {
      const values = asFilterValues(v);
      const interpolatedValues = values.flatMap((value) => {
        const parsed = parseFilterValue(srv.replace(value, scopedVars));
        return parsed === undefined ? [] : asFilterValues(parsed);
      });
      if (interpolatedValues.length === 1) {
        interpolatedFilter[k] = interpolatedValues[0];
      } else if (interpolatedValues.length > 1) {
        interpolatedFilter[k] = interpolatedValues;
      }
    }
    return {
      ...defaultQuery,
      ...query,
      metrics: explicitMetrics({
        ...query,
        metric: srv.replace(query.metric ?? '', scopedVars),
        metrics: Array.isArray(query.metrics) ? query.metrics.map((metric) => srv.replace(metric ?? '', scopedVars)) : [],
      }),
      filter: interpolatedFilter,
      search: srv.replace(query.search ?? '', scopedVars),
      infix: srv.replace(query.infix ?? '', scopedVars),
      selector: srv.replace(query.selector ?? '', scopedVars),
    };
  }

  applyTemplateVariables(query: MetricQQuery, scopedVars: ScopedVars): MetricQQuery {
    return this.interpolateQuery(query, scopedVars);
  }

  filterQuery(query: MetricQQuery): boolean {
    const metrics = explicitMetrics(query);
    return (
      metrics.length > 0 ||
      Object.keys(query.filter ?? {}).length > 0 ||
      Boolean(query.search?.trim()) ||
      Boolean(query.infix?.trim()) ||
      Boolean(query.selector?.trim())
    );
  }

  /**
   * Supports variable queries of the form:
   *   suggest:<field>
   *   suggest:<field>:<json-filter>
   *
   * Examples:
   *   suggest:asset_id
   *   suggest:asset_id:{"metric_type":"power_factor"}
   */
  async metricFindQuery(query: string): Promise<MetricFindValue[]> {
    const trimmed = getTemplateSrv().replace(query).trim();
    if (!trimmed.startsWith('suggest:')) {
      return [];
    }
    const rest = trimmed.slice('suggest:'.length);
    const colonIdx = rest.indexOf(':');
    const field = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
    let filter: Record<string, string | string[]> = {};
    if (colonIdx !== -1) {
      try {
        const raw: Record<string, string> = JSON.parse(rest.slice(colonIdx + 1));
        for (const [k, v] of Object.entries(raw)) {
          const parsed = parseFilterValue(v);
          if (parsed !== undefined) {
            filter[k] = parsed;
          }
        }
      } catch {
        // ignore malformed filter
      }
    }
    const values = await this.suggestValues(field, filter);
    return values.map((v) => ({ text: v.value, value: v.value }));
  }

  /**
   * Calls metrics.suggest for a field, optionally scoped by the current filter context.
   * Returns values sorted by frequency (most common first).
   */
  async suggestValues(field: string, filter: Record<string, string | string[]> = {}): Promise<SuggestValue[]> {
    try {
      const result = await this.postResource(`suggest/${encodeURIComponent(field)}`, {
        filter: this.interpolateQuery({ filter }).filter,
      });
      return Array.isArray(result?.values) ? result.values : [];
    } catch {
      return [];
    }
  }

  /** Returns up to 100 metric names matching the given infix substring. */
  async suggestMetricNames(infix: string): Promise<string[]> {
    try {
      const result = await this.postResource('metric-names', {
        infix: getTemplateSrv().replace(infix),
      });
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  async searchMetrics(params: { infix?: string; selector?: string; search?: string }): Promise<MetricExplorerResult[]> {
    try {
      const result = await this.postResource('metric-explorer', {
        infix: getTemplateSrv().replace(params.infix ?? ''),
        selector: getTemplateSrv().replace(params.selector ?? ''),
        search: getTemplateSrv().replace(params.search ?? ''),
      });
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  async countMatchingMetrics(query: Partial<MetricQQuery>): Promise<MetricCountResult> {
    try {
      const result = await this.postResource('metric-count', this.interpolateQuery(query));
      return {
        count: Number(result?.count ?? 0),
        interactive_limit: Number(result?.interactive_limit ?? 0),
      };
    } catch {
      return { count: 0, interactive_limit: 0 };
    }
  }
}
