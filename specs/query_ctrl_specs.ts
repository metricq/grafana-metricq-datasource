import {describe, beforeEach, it, sinon, expect} from './lib/common';
import {MetricQQueryCtrl} from '../src/query_ctrl';
import TemplateSrvStub from './lib/template_srv_stub';
import Q from 'q';
import moment from 'moment';

describe('MetricQQueryCtrl', function() {
  let queryCtrl;

  beforeEach(function() {
    queryCtrl = new MetricQQueryCtrl({}, {}, new TemplateSrvStub());
    queryCtrl.datasource = {$q: Q};
  });

  describe('init query_ctrl variables', function() {
    it('defaults should be initialized', function() {
      // Replace with test for defaults that should be set in the query ctrl.
      expect(queryCtrl.target.target).to.be('');
    });
  });
});
