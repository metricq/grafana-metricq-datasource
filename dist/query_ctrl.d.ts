/// <reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />
import { QueryCtrl } from 'app/plugins/sdk';
export declare class MetricQQueryCtrl extends QueryCtrl {
    private templateSrv;
    static templateUrl: string;
    available_functions: {
        [id: string]: string[];
    };
    defaults: {};
    /** @ngInject **/
    constructor($scope: any, $injector: any, templateSrv: any);
    getAvailableFunctions(): string[];
    getArgumentsForActiveFunction(): string[];
    getOptions(query: any): any;
    onChangeInternal(): void;
    buildTargetString(): string;
}
