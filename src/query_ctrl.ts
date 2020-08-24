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
  min_selected = false;
  max_selected = false;
  avg_selected = false;
  sma_selected = false;
  count_selected = false;


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

    this.min_selected = this.target.functions.includes("min");
    this.max_selected = this.target.functions.includes("max");
    this.avg_selected = this.target.functions.includes("avg");
    this.sma_selected = this.target.functions.includes("sma");
    this.count_selected = this.target.functions.includes("count");
  }

  getOptions(query) {
    return this.datasource.metricFindQuery(query || '');
  }

  onChangeInternal() {
    let functions = [];

    if (this.min_selected) {
      functions = [...functions, "min"];
    }

    if (this.max_selected) {
      functions = [...functions, "max"];
    }

    if (this.avg_selected) {
      functions = [...functions, "avg"];
    }

    if (this.sma_selected) {
      functions = [...functions, "sma"];
    }

    if (this.count_selected) {
      functions = [...functions, "count"];
    }

    this.target.functions = functions;
    this.panelCtrl.refresh(); // Asks the panel to refresh data.
  }

  isSmaSelected() {
    return this.target.functions.includes("sma");
  }

}
