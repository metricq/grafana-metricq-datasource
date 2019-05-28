import MetricQDatasource from './datasource';
import {MetricQQueryCtrl} from './query_ctrl';
import {MetricQConfigCtrl} from './config_ctrl';

class MetricQAnnotationsQueryCtrl {
  static templateUrl = 'partials/annotations.editor.html';
}

export {
  MetricQDatasource as Datasource,
  MetricQQueryCtrl as QueryCtrl,
  MetricQConfigCtrl as ConfigCtrl,
  MetricQAnnotationsQueryCtrl as AnnotationsQueryCtrl,
};
