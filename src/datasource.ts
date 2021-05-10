import _ from 'lodash';

import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  FieldType,
  MutableDataFrame,
} from '@grafana/data';

import { getBackendSrv, getTemplateSrv } from '@grafana/runtime';

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

    const data = await this.doRequest(this.url + '/query', 'POST', query).then((response: { data: any[] }) => {
      return response.data.map((result: any) => {
        const frame = new MutableDataFrame({
          refId: result.refId,
          name: result.target,
          fields: [
            { name: 'Time', type: FieldType.time },
            { name: 'Value', type: FieldType.number },
          ],
        });
        result.datapoints.forEach((point: any) => {
          frame.appendRow([point[1], point[0]]);
        });

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
      .datasourceRequest({
        url: this.url + '/',
        method: 'GET',
      })
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
    return await getBackendSrv().datasourceRequest({
      method: method,
      url: url,
      data: options,
      withCredentials: this.withCredentials,
      headers: this.headers,
    });
  }

  buildQueryParameters(options: DataQueryRequest<MetricQQuery>) {
    //remove placeholder targets
    options.targets = _.filter(options.targets, (target: MetricQQuery) => {
      return target.metric !== 'select metric';
    });

    options.targets = _.map(options.targets, (target: MetricQQuery) => {
      target.name = getTemplateSrv().replace(target.name, options.scopedVars, 'regex');
      target.metric = getTemplateSrv().replace(target.metric, options.scopedVars, 'regex');
      return target;
    });

    return options;
  }
}
