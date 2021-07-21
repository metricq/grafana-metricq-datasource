import React, { PureComponent } from 'react';
import { DataSourceHttpSettings } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps, DataSourceSettings } from '@grafana/data';
import { MetricQDataSourceOptions } from './types';

interface Props extends DataSourcePluginOptionsEditorProps<MetricQDataSourceOptions> {}

interface State {}

export class MetricQConfigEditor extends PureComponent<Props, State> {
  onConfigChange = (config: DataSourceSettings) => {
    const { onOptionsChange, options } = this.props;
    onOptionsChange({
      ...options,
      ...config,
    });
  };

  render() {
    const { options } = this.props;

    return (
      <DataSourceHttpSettings
        defaultUrl={'http://localhost:4000'}
        dataSourceConfig={options}
        onChange={this.onConfigChange}
      />
    );
  }
}
