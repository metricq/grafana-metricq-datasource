import { MetricQDatasource } from './datasource';
import { MetricQQueryEditor } from './QueryEditor';
import { MetricQConfigEditor } from './ConfigEditor';

import { DataSourcePlugin } from '@grafana/data';
import { MetricQDataSourceOptions, MetricQQuery } from './types';

export const plugin = new DataSourcePlugin<MetricQDatasource, MetricQQuery, MetricQDataSourceOptions>(MetricQDatasource)
  .setConfigEditor(MetricQConfigEditor)
  .setQueryEditor(MetricQQueryEditor);
