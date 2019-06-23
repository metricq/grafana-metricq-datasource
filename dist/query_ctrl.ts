///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import _ from 'lodash';
import {QueryCtrl} from 'app/plugins/sdk';
import './css/query_editor.css!';

export class MetricQQueryCtrl extends QueryCtrl {
  static templateUrl = 'partials/query.editor.html';

  available_aggregates : string[] = ['min', 'max', 'avg', 'sma', 'count'];
  available_alias_types:string[] = ['', 'by value', 'by metric', 'by description', 'by metric and description'];

  dummydashboard = {
    on: (str, fn, val) => {}
  };

  selected_aggregates = {};

  defaults = {
  };

  /** @ngInject **/
  constructor($scope, $injector, private templateSrv) {
    super($scope, $injector);

    _.defaultsDeep(this.target, this.defaults);

    this.target.aliasType = this.target.aliasType || '';
    this.target.aliasValue = this.target.aliasValue || '';
    this.target.targetMetric = this.target.targetMetric || 'select metric';
    this.target.aggregates = this.target.aggregates || [];
    this.target.smaWindow = this.target.smaWindow || 0;

    let options = [];

    for (let aggregate of this.available_aggregates) {
      console.log(aggregate)
      options.push({ text: aggregate, value: aggregate, selected: this.target.aggregates.includes(aggregate) })
    }

    this.selected_aggregates = {
      multi: true,
      current: {},
      useTags: false,
      options: options
    };
  }

  getAvailableAliasTypes() {
    return this.available_alias_types;
  }

  getOptions(query) {
    return this.datasource.metricFindQuery(query || '');
  }

  onChangeInternal() {
    this.panelCtrl.refresh(); // Asks the panel to refresh data.
  }

  aggregatesUpdated(variable) {
    console.log(variable);
  }
}
