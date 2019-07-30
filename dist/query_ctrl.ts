///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import _ from 'lodash';
import {QueryCtrl} from 'app/plugins/sdk';
import './css/query_editor.css!';

export class MetricQQueryCtrl extends QueryCtrl {
  static templateUrl = 'partials/query.editor.html';

  available_aggregates : string[] = ['min', 'max', 'avg', 'sma', 'count'];
  available_alias_types = {'': 'use metric name', 'custom': 'use custom text', 'description': 'use description from metadata'};

  dummydashboard = {
    on: (str, fn, val) => {}
  };

  selected_aggregates = {};
  //hasTextEditMode = true;

  defaults = {
  };

  /** @ngInject **/
  constructor($scope, $injector, private templateSrv) {
    super($scope, $injector);

    _.defaultsDeep(this.target, this.defaults);
    //this.hasRawMode = true;

    this.target.aliasType = this.target.aliasType || '';
    this.target.aliasValue = this.target.aliasValue || '';
    this.target.targetMetric = this.target.targetMetric || 'select metric';
    this.target.aggregates = this.target.aggregates || ['avg'];
    this.target.smaWindow = this.target.smaWindow || '';

    let options = [];

    for (let aggregate of this.available_aggregates) {
      options.push({ text: aggregate, value: aggregate, selected: this.target.aggregates.includes(aggregate) })
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

  isSmaSelected() {
    return this.target.aggregates.includes("sma");
  }

  isCustomAliasSelected() {
    return this.target.aliasType == "custom";
  }

}
