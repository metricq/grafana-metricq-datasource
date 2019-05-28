/// <reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />
export default class MetricQDatasource {
    private backendSrv;
    private templateSrv;
    private $q;
    id: number;
    name: string;
    url: string;
    withCredentials: boolean;
    headers: any;
    /** @ngInject */
    constructor(instanceSettings: any, backendSrv: any, templateSrv: any, $q: any);
    query(options: any): any;
    annotationQuery(options: any): void;
    metricFindQuery(query: string): any;
    testDatasource(): any;
    mapToTextValue(result: any): any;
    doRequest(options: any): any;
    buildQueryParameters(options: any): any;
}
