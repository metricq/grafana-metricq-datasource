import defaults from 'lodash/defaults';

import React, { ChangeEvent, PureComponent } from 'react';
import { AsyncSelect, InlineField, InlineFieldRow, InlineSwitch, Input, MultiSelect } from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { MetricQDatasource } from './datasource';
import { defaultQuery, MetricQDataSourceOptions, MetricQQuery } from './types';

type Props = QueryEditorProps<MetricQDatasource, MetricQQuery, MetricQDataSourceOptions>;
interface State {
  autocomplete: boolean;
}

const labelWidth = 16;

export class MetricQQueryEditor extends PureComponent<Props, State> {
  constructor(props: Readonly<Props>) {
    super(props);
    this.state = {
      autocomplete: true,
    };
  }

  onMetricChange = (value: string) => {
    const { onChange, query, onRunQuery } = this.props;
    onChange({ ...query, metric: value || '' });
    onRunQuery();
  };

  onFunctionsChange = (selectedFunctions: Array<SelectableValue<string>>) => {
    const { onChange, query, onRunQuery } = this.props;
    onChange({ ...query, functions: selectedFunctions.map((val: SelectableValue<string>) => val.value || '') });
    onRunQuery();
  };

  onSmaWindowChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { onChange, query, onRunQuery } = this.props;
    onChange({ ...query, smaWindow: event.target.value });
    onRunQuery();
  };

  onScalingFactorChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { onChange, query, onRunQuery } = this.props;
    onChange({ ...query, scalingFactor: parseFloat(event.target.value) });
    onRunQuery();
  };

  onNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { onChange, query, onRunQuery } = this.props;
    onChange({ ...query, name: event.target.value });
    onRunQuery();
  };

  onAutocompleteChange = (event: ChangeEvent<HTMLInputElement>) => {
    this.setState({
      autocomplete: event.target.checked,
    });
  };

  loadMetricOptions = (query: string) => {
    const { datasource } = this.props;
    return datasource.metricFindQuery(query || '').then((result) => {
      return result.map((val) => {
        return {
          label: val.value,
          value: val.value,
        };
      });
    });
  };

  render() {
    const query = defaults(this.props.query, defaultQuery);
    const { name, metric, functions, smaWindow, scalingFactor } = query;

    const metricVal =
      metric === undefined
        ? null
        : {
            label: metric,
            value: metric,
          };

    return (
      <>
        <InlineFieldRow>
          <InlineField
            label="Metric"
            grow={true}
            labelWidth={labelWidth}
            tooltip={'Start typing to search for available metrics (dropdown shows first 100 results)'}
          >
            <>
              {this.state.autocomplete && (
                <AsyncSelect
                  isMulti={false}
                  isClearable={true}
                  allowCustomValue={true}
                  backspaceRemovesValue={false}
                  onChange={(selectableValue) =>
                    this.onMetricChange((selectableValue && selectableValue.value) || defaultQuery.metric)
                  }
                  loadOptions={this.loadMetricOptions}
                  defaultOptions={[metricVal]}
                  isSearchable={true}
                  maxMenuHeight={500}
                  placeholder={'select metric'}
                  noOptionsMessage={'No metrics found'}
                  value={metricVal}
                />
              )}
              {!this.state.autocomplete && (
                <Input
                  value={metric}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => this.onMetricChange(event.target.value)}
                  placeholder={'$metric/$function'}
                />
              )}
            </>
          </InlineField>
          <InlineField label="Autocomplete">
            <InlineSwitch value={this.state.autocomplete} onChange={this.onAutocompleteChange} />
          </InlineField>
        </InlineFieldRow>
        <InlineFieldRow>
          <InlineField label="Name" grow={true} labelWidth={labelWidth}>
            <Input value={name} onChange={this.onNameChange} placeholder={'$metric/$function'} />
          </InlineField>
        </InlineFieldRow>
        <InlineFieldRow>
          <InlineField label="Functions" grow={true} labelWidth={labelWidth}>
            <MultiSelect
              options={[
                { label: 'min', value: 'min' },
                { label: 'max', value: 'max' },
                { label: 'avg', value: 'avg' },
                {
                  label: 'count',
                  value: 'count',
                },
                { label: 'sma', value: 'sma' },
              ]}
              onChange={this.onFunctionsChange}
              value={functions}
            />
          </InlineField>
          {functions.includes('sma') && (
            <InlineField label="SMA Window" labelWidth={labelWidth} tooltip={'Use a duration string, like "10s"'}>
              <Input value={smaWindow} onChange={this.onSmaWindowChange} />
            </InlineField>
          )}
        </InlineFieldRow>
        <InlineFieldRow>
          <InlineField label="Scaling factor" grow={true} labelWidth={labelWidth}>
            <Input value={scalingFactor} onChange={this.onScalingFactorChange} />
          </InlineField>
        </InlineFieldRow>
      </>
    );
  }
}
