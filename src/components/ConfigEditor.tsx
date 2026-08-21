import React, { ChangeEvent } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { InlineField, InlineFieldRow, SecretInput } from '@grafana/ui';
import { MetricQDataSourceOptions, MetricQSecureJsonData } from '../types';

type Props = DataSourcePluginOptionsEditorProps<MetricQDataSourceOptions, MetricQSecureJsonData>;

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { secureJsonFields, secureJsonData } = options;

  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    onOptionsChange({
      ...options,
      secureJsonData: { ...secureJsonData, server: e.target.value },
    });

  const onReset = () =>
    onOptionsChange({
      ...options,
      secureJsonFields: { ...secureJsonFields, server: false },
      secureJsonData: { ...secureJsonData, server: '' },
    });

  return (
    <InlineFieldRow>
      <InlineField
        label="Server URL"
        labelWidth={14}
        tooltip="AMQP-URL mit Zugangsdaten, z.B. amqp://user:pass@rabbitmq.example.com:5672/"
      >
        <SecretInput
          value={secureJsonData?.server ?? ''}
          isConfigured={Boolean(secureJsonFields?.server)}
          onChange={onChange}
          onReset={onReset}
          placeholder="amqp://user:pass@host:5672/"
          width={50}
        />
      </InlineField>
    </InlineFieldRow>
  );
}
