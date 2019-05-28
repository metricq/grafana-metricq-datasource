System.register(['./datasource', './query_ctrl', './config_ctrl'], function(exports_1) {
    var datasource_1, query_ctrl_1, config_ctrl_1;
    var MetricQAnnotationsQueryCtrl;
    return {
        setters:[
            function (datasource_1_1) {
                datasource_1 = datasource_1_1;
            },
            function (query_ctrl_1_1) {
                query_ctrl_1 = query_ctrl_1_1;
            },
            function (config_ctrl_1_1) {
                config_ctrl_1 = config_ctrl_1_1;
            }],
        execute: function() {
            MetricQAnnotationsQueryCtrl = (function () {
                function MetricQAnnotationsQueryCtrl() {
                }
                MetricQAnnotationsQueryCtrl.templateUrl = 'partials/annotations.editor.html';
                return MetricQAnnotationsQueryCtrl;
            })();
            exports_1("Datasource", datasource_1.default);
            exports_1("QueryCtrl", query_ctrl_1.MetricQQueryCtrl);
            exports_1("ConfigCtrl", config_ctrl_1.MetricQConfigCtrl);
            exports_1("AnnotationsQueryCtrl", MetricQAnnotationsQueryCtrl);
        }
    }
});
//# sourceMappingURL=module.js.map