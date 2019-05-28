///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import _ from 'lodash';
import {QueryCtrl} from 'app/plugins/sdk';
import './css/query_editor.css!';

export class MetricQQueryCtrl extends QueryCtrl {
  static templateUrl = 'partials/query.editor.html';

  available_functions: { [id: string] : string[]; } = {};

  defaults = {
  };

  /** @ngInject **/
  constructor($scope, $injector, private templateSrv) {
    super($scope, $injector);

    _.defaultsDeep(this.target, this.defaults);

    this.available_functions[''] = [];
    this.available_functions['alias'] = ['alias'];
    this.available_functions['aliasByMetric'] = [];
    this.available_functions['aliasByDescription'] = [];
    this.available_functions['aliasByMetricAndDescription'] = [];
    this.available_functions['movingAverageWithAlias'] = ['alias', 'sma window in ms'];
    this.target.target = this.target.target || '';
    this.target.targetMetric = this.target.targetMetric || 'select metric';
    this.target.function = this.target.function || '';
    this.target.functionArguments = this.target.functionArguments || [];
  }

  getAvailableFunctions() {
    let avail_funcs : string[] = [];
    for (let key in this.available_functions) {
      avail_funcs.push(key);
    }
    return avail_funcs;
  }

  getArgumentsForActiveFunction() {
    return this.available_functions[this.target.function] || [];
  }

  getOptions(query) {
    return this.datasource.metricFindQuery(query || '');
  }

  onChangeInternal() {
    if (!this.target.rawQuery) {
      this.target.target = this.buildTargetString();
    }
    this.panelCtrl.refresh(); // Asks the panel to refresh data.
  }

  buildTargetString() {
    let numArgs = this.getArgumentsForActiveFunction().length;
    let targetString: string = this.target.function;
    if (targetString !== '') {
      targetString = targetString.concat('(');
    }
    targetString = targetString.concat(this.target.targetMetric);
    for (let _i = 0; _i < numArgs; _i++) {
      targetString = targetString.concat(",", this.target.functionArguments[_i] as string);
    }
    if (this.target.function !== '') {
      targetString = targetString.concat(')');
    }
    return targetString;
  }
}
