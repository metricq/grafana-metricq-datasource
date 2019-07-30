/// <reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />
import { QueryCtrl } from 'app/plugins/sdk';
export declare class MetricQQueryCtrl extends QueryCtrl {
    private templateSrv;
    static templateUrl: string;
    available_aggregates: string[];
    available_alias_types: {
        '': string;
        'custom': string;
        'description': string;
    };
    dummydashboard: {
        on: (str: any, fn: any, val: any) => void;
    };
    selected_aggregates: {};
    defaults: {};
    /** @ngInject **/
    constructor($scope: any, $injector: any, templateSrv: any);
    getAvailableAliasTypes(): {
        '': string;
        'custom': string;
        'description': string;
    };
    getOptions(query: any): any;
    onChangeInternal(): void;
    aggregatesUpdated(): void;
    isSmaSelected(): any;
    isCustomAliasSelected(): boolean;
}
