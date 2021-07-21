import { DataQuery, DataSourceJsonData } from '@grafana/data';

export interface MetricQQuery extends DataQuery {
  name?: string;
  metric: string;
  functions: string[];
  smaWindow: string;
  scalingFactor: number;
}

export const defaultQuery: Partial<MetricQQuery> = {
  metric: undefined,
  functions: ['avg'],
  smaWindow: '',
  scalingFactor: 1,
};

/**
 * These are options configured for each DataSource instance
 */
export interface MetricQDataSourceOptions extends DataSourceJsonData {}

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface MetricQSecureJsonData {}
