///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />
System.register(['lodash', 'app/plugins/sdk', './css/query_editor.css!'], function(exports_1) {
    var __extends = (this && this.__extends) || function (d, b) {
        for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
    var lodash_1, sdk_1;
    var MetricQQueryCtrl;
    return {
        setters:[
            function (lodash_1_1) {
                lodash_1 = lodash_1_1;
            },
            function (sdk_1_1) {
                sdk_1 = sdk_1_1;
            },
            function (_1) {}],
        execute: function() {
            MetricQQueryCtrl = (function (_super) {
                __extends(MetricQQueryCtrl, _super);
                /** @ngInject **/
                function MetricQQueryCtrl($scope, $injector, templateSrv) {
                    _super.call(this, $scope, $injector);
                    this.templateSrv = templateSrv;
                    this.available_aggregates = ['min', 'max', 'avg', 'sma', 'count'];
                    this.available_alias_types = ['', 'custom', 'description'];
                    this.dummydashboard = {
                        on: function (str, fn, val) { }
                    };
                    this.selected_aggregates = {};
                    this.defaults = {};
                    lodash_1.default.defaultsDeep(this.target, this.defaults);
                    this.target.aliasType = this.target.aliasType || '';
                    this.target.aliasValue = this.target.aliasValue || '';
                    this.target.targetMetric = this.target.targetMetric || 'select metric';
                    this.target.aggregates = this.target.aggregates || ['avg'];
                    this.target.smaWindow = this.target.smaWindow || '';
                    var options = [];
                    for (var _i = 0, _a = this.available_aggregates; _i < _a.length; _i++) {
                        var aggregate = _a[_i];
                        options.push({ text: aggregate, value: aggregate });
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
                MetricQQueryCtrl.prototype.getAvailableAliasTypes = function () {
                    return this.available_alias_types;
                };
                MetricQQueryCtrl.prototype.getOptions = function (query) {
                    return this.datasource.metricFindQuery(query || '');
                };
                MetricQQueryCtrl.prototype.onChangeInternal = function () {
                    this.panelCtrl.refresh(); // Asks the panel to refresh data.
                };
                MetricQQueryCtrl.prototype.aggregatesUpdated = function () {
                    this.target.aggregates = this.selected_aggregates["current"].value;
                    this.onChangeInternal();
                };
                MetricQQueryCtrl.templateUrl = 'partials/query.editor.html';
                return MetricQQueryCtrl;
            })(sdk_1.QueryCtrl);
            exports_1("MetricQQueryCtrl", MetricQQueryCtrl);
        }
    }
});
//# sourceMappingURL=query_ctrl.js.map