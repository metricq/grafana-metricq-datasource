///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import _ from 'lodash';
import {QueryCtrl} from 'app/plugins/sdk';
import './css/query_editor.css!';

export class MetricQQueryCtrl extends QueryCtrl {
  static templateUrl = 'partials/query.editor.html';

  available_aggregates : string[] = ['min', 'max', 'avg', 'sma', 'count'];

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

    this.target.name = this.target.name || this.target.aliasValue || (this.target.aliasType == 'description' && '$description') || '';
    this.target.metric = this.target.metric || this.target.targetMetric || 'select metric';
    this.target.functions = this.target.functions || this.target.aggregates || ['avg'];
    this.target.smaWindow = this.target.smaWindow || '';
    this.target.scalingFactor = this.target.scalingFactor || '1';

    let options = [];

    for (let aggregate of this.available_aggregates) {
      options.push({ text: aggregate, value: aggregate, selected: this.target.functions.includes(aggregate) })
    }

    this.selected_aggregates = {
      multi: true,
      current: {
        text: this.target.functions.join(" + "),
        value: this.target.functions
      },
      useTags: false,
      options: options
    };
  }

  getOptions(query) {
    return this.datasource.metricFindQuery(query || '');
  }

  onChangeInternal() {
    this.panelCtrl.refresh(); // Asks the panel to refresh data.
  }

  aggregatesUpdated() {
    this.target.functions = this.selected_aggregates["current"].value;
    this.onChangeInternal();
  }

  isSmaSelected() {
    return this.target.functions.includes("sma");
  }

}
