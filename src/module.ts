import { DataSourcePlugin } from '@grafana/data';
import { MetricQDataSource } from './datasource';
import { QueryEditor } from './components/QueryEditor';
import { ConfigEditor } from './components/ConfigEditor';
import { MetricQQuery, MetricQDataSourceOptions } from './types';

export const plugin = new DataSourcePlugin<MetricQDataSource, MetricQQuery, MetricQDataSourceOptions>(
  MetricQDataSource
)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
