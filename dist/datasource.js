///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />
System.register(['lodash'], function(exports_1) {
    var lodash_1;
    var MetricQDatasource;
    return {
        setters:[
            function (lodash_1_1) {
                lodash_1 = lodash_1_1;
            }],
        execute: function() {
            MetricQDatasource = (function () {
                /** @ngInject */
                function MetricQDatasource(instanceSettings, backendSrv, templateSrv, $q) {
                    this.backendSrv = backendSrv;
                    this.templateSrv = templateSrv;
                    this.$q = $q;
                    this.name = instanceSettings.name;
                    this.id = instanceSettings.id;
                    this.url = instanceSettings.url;
                    this.withCredentials = instanceSettings.withCredentials;
                    this.headers = { 'Content-Type': 'application/json' };
                    if (typeof instanceSettings.basicAuth === 'string' && instanceSettings.basicAuth.length > 0) {
                        this.headers['Authorization'] = instanceSettings.basicAuth;
                    }
                }
                MetricQDatasource.prototype.query = function (options) {
                    var query = this.buildQueryParameters(options);
                    query.targets = query.targets.filter(function (t) { return !t.hide; });
                    if (query.targets.length <= 0) {
                        return this.$q.when({ data: [] });
                    }
                    if (this.templateSrv.getAdhocFilters) {
                        query.adhocFilters = this.templateSrv.getAdhocFilters(this.name);
                    }
                    else {
                        query.adhocFilters = [];
                    }
                    return this.doRequest({
                        url: this.url + '/query',
                        data: query,
                        method: 'POST'
                    });
                };
                MetricQDatasource.prototype.annotationQuery = function (options) {
                    throw new Error("Annotation Support not implemented yet.");
                };
                MetricQDatasource.prototype.metricFindQuery = function (query) {
                    var interpolated = {
                        target: this.templateSrv.replace(query, null, 'regex')
                    };
                    return this.doRequest({
                        url: this.url + '/search',
                        data: interpolated,
                        method: 'POST',
                    }).then(this.mapToTextValue);
                };
                MetricQDatasource.prototype.testDatasource = function () {
                    return this.doRequest({
                        url: this.url + '/',
                        method: 'GET',
                    }).then(function (response) {
                        if (response.status === 200) {
                            return { status: "success", message: "Data source is working", title: "Success" };
                        }
                    });
                };
                MetricQDatasource.prototype.mapToTextValue = function (result) {
                    return lodash_1.default.map(result.data, function (d, i) {
                        if (d && d.text && d.value) {
                            return { text: d.text, value: d.value };
                        }
                        else if (lodash_1.default.isObject(d)) {
                            return { text: d, value: i };
                        }
                        return { text: d, value: d };
                    });
                };
                MetricQDatasource.prototype.doRequest = function (options) {
                    options.withCredentials = this.withCredentials;
                    options.headers = this.headers;
                    return this.backendSrv.datasourceRequest(options);
                };
                MetricQDatasource.prototype.buildQueryParameters = function (options) {
                    var _this = this;
                    //remove placeholder targets
                    options.targets = lodash_1.default.filter(options.targets, function (target) {
                        return target.target !== 'select metric';
                    });
                    var targets = lodash_1.default.map(options.targets, function (target) {
                        return {
                            target: _this.templateSrv.replace(target.target, options.scopedVars, 'regex'),
                            refId: target.refId,
                            hide: target.hide,
                            type: 'timeserie'
                        };
                    });
                    options.targets = targets;
                    return options;
                };
                return MetricQDatasource;
            })();
            exports_1("default", MetricQDatasource);
        }
    }
});
//# sourceMappingURL=datasource.js.map