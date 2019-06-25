///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import _ from 'lodash';
import {QueryCtrl} from 'app/plugins/sdk';
import './css/query_editor.css!';

export class MetricQQueryCtrl extends QueryCtrl {
  static templateUrl = 'partials/query.editor.html';

  available_aggregates : string[] = ['min', 'max', 'avg', 'sma', 'count'];
  available_alias_types:string[] = ['', 'custom', 'description'];

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
    this.target.aggregates = this.target.aggregates || ['avg'];
    this.target.smaWindow = this.target.smaWindow || 0;

    let options = [];

    for (let aggregate of this.available_aggregates) {
      options.push({ text: aggregate, value: aggregate })
    }

    this.selected_aggregates = {
      multi: true,
      current: {
        text: this.target.aggregates.join(" + "),
        value: this.target.aggregates
      },
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

  aggregatesUpdated() {
    this.target.aggregates = this.selected_aggregates["current"].value;
    this.onChangeInternal();
  }
}
