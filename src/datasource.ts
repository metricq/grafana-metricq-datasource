import _ from 'lodash';

import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  FieldType,
  MutableDataFrame,
  TIME_SERIES_TIME_FIELD_NAME,
} from '@grafana/data';

import { FetchResponse, getBackendSrv, getTemplateSrv } from '@grafana/runtime';

import { MetricQDataSourceOptions, MetricQQuery } from './types';
import { MetricFindValue } from '@grafana/data/types/datasource';

export class MetricQDatasource extends DataSourceApi<MetricQQuery, MetricQDataSourceOptions> {
  id: number;
  name: string;
  url?: string;
  withCredentials?: boolean;
  headers: any;

  constructor(instanceSettings: DataSourceInstanceSettings<MetricQDataSourceOptions>) {
    super(instanceSettings);
    this.name = instanceSettings.name;
    this.id = instanceSettings.id;
    this.url = instanceSettings.url;
    this.withCredentials = instanceSettings.withCredentials;
    this.headers = { 'Content-Type': 'application/json' };
    if (typeof instanceSettings.basicAuth === 'string' && instanceSettings.basicAuth.length > 0) {
      this.headers['Authorization'] = instanceSettings.basicAuth;
    }
  }

  async query(options: DataQueryRequest<MetricQQuery>): Promise<DataQueryResponse> {
    let query = this.buildQueryParameters(options);

    query.targets = query.targets.filter((t: MetricQQuery) => !t.hide);

    const data = await this.doRequest(this.url + '/query_hta', 'POST', query).then((response: FetchResponse) => {
      return response.data.map((result: any) => {
        let fields = [{ name: TIME_SERIES_TIME_FIELD_NAME, type: FieldType.time }];
        if (result.mode === 'raw') {
          fields.push({ name: 'raw', type: FieldType.number });
        } else {
          fields.push({ name: 'min', type: FieldType.number });
          fields.push({ name: 'avg', type: FieldType.number });
          fields.push({ name: 'max', type: FieldType.number });
        }
        const frame = new MutableDataFrame({
          refId: result.refId,
          name: result.metric,
          fields: fields,
          meta: {
            stats: [
              {
                displayName: 'time-measurements-db',
                value: result.time_measurements.db,
              },
              {
                displayName: 'time-measurements-http',
                value: result.time_measurements.http,
              },
            ],
          },
        });
        if (result.mode === 'raw') {
          result.raw.forEach((point: any) => {
            frame.appendRow([point.time, point.value]);
          });
        } else {
          result.aggregates.forEach((point: any) => {
            frame.appendRow([point.time, point.min, point.avg, point.max]);
          });
        }

        return frame;
      });
    });

    return { data };
  }

  async metricFindQuery(query: string): Promise<MetricFindValue[]> {
    const interpolated = {
      target: getTemplateSrv().replace(query, undefined, 'regex'),
    };

    return this.doRequest(this.url + '/search', 'POST', interpolated).then(this.mapToTextValue);
  }

  async testDatasource() {
    return getBackendSrv()
      .get(this.url + '/')
      .then((response) => {
        if (response.status === 200) {
          return { status: 'success', message: 'Data source is working' };
        } else {
          return {
            status: 'failed',
            message: response.status,
          };
        }
      });
  }

  mapToTextValue(result: any): MetricFindValue[] {
    return _.map(result.data, (d, i) => {
      if (d && d.text && d.value) {
        return { text: d.text, value: d.value };
      } else if (_.isObject(d)) {
        return { text: d, value: i };
      }
      return { text: d, value: d };
    });
  }

  async doRequest(url: string, method: string, options: any) {
    return await getBackendSrv()
      .fetch({
        method: method,
        url: url,
        data: options,
        withCredentials: this.withCredentials,
        headers: this.headers,
      })
      .toPromise();
  }

  buildQueryParameters(options: DataQueryRequest<MetricQQuery>) {
    //remove placeholder targets
    options.targets = _.filter(options.targets, (target: MetricQQuery) => {
      return target.metric !== undefined;
    });

    options.targets = _.map(options.targets, (target: MetricQQuery) => {
      target.name = getTemplateSrv().replace(target.name, options.scopedVars, 'regex');
      target.metric = getTemplateSrv().replace(target.metric, options.scopedVars, 'regex');
      return target;
    });

    return options;
  }
}
