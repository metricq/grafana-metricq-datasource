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
                    this.available_functions = {};
                    this.defaults = {};
                    lodash_1.default.defaultsDeep(this.target, this.defaults);
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
                MetricQQueryCtrl.prototype.getAvailableFunctions = function () {
                    var avail_funcs = [];
                    for (var key in this.available_functions) {
                        avail_funcs.push(key);
                    }
                    return avail_funcs;
                };
                MetricQQueryCtrl.prototype.getArgumentsForActiveFunction = function () {
                    return this.available_functions[this.target.function] || [];
                };
                MetricQQueryCtrl.prototype.getOptions = function (query) {
                    return this.datasource.metricFindQuery(query || '');
                };
                MetricQQueryCtrl.prototype.onChangeInternal = function () {
                    if (!this.target.rawQuery) {
                        this.target.target = this.buildTargetString();
                    }
                    this.panelCtrl.refresh(); // Asks the panel to refresh data.
                };
                MetricQQueryCtrl.prototype.buildTargetString = function () {
                    var numArgs = this.getArgumentsForActiveFunction().length;
                    var targetString = this.target.function;
                    if (targetString !== '') {
                        targetString = targetString.concat('(');
                    }
                    targetString = targetString.concat(this.target.targetMetric);
                    for (var _i = 0; _i < numArgs; _i++) {
                        targetString = targetString.concat(",", this.target.functionArguments[_i]);
                    }
                    if (this.target.function !== '') {
                        targetString = targetString.concat(')');
                    }
                    return targetString;
                };
                MetricQQueryCtrl.templateUrl = 'partials/query.editor.html';
                return MetricQQueryCtrl;
            })(sdk_1.QueryCtrl);
            exports_1("MetricQQueryCtrl", MetricQQueryCtrl);
        }
    }
});
//# sourceMappingURL=query_ctrl.js.map