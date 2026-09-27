package main

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	metricq "github.com/metricq/metricq-go"
)

// ── buildDataResponse ─────────────────────────────────────────────────────────

func TestBuildDataResponse_RawValues(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)
	result := &metricq.TimelineValues{
		Times:  []time.Time{t0, t0.Add(time.Second)},
		Values: []float64{0.5, 0.7},
	}

	dr := buildDataResponse("host.cpu.load", nil, nil, time.Time{}, time.Time{}, result)

	if dr.Error != nil {
		t.Fatalf("unexpected error: %v", dr.Error)
	}
	if len(dr.Frames) != 1 {
		t.Fatalf("expected 1 frame, got %d", len(dr.Frames))
	}
	frame := dr.Frames[0]
	if frame.Name != "host.cpu.load" {
		t.Errorf("frame name: want %q, got %q", "host.cpu.load", frame.Name)
	}
	if len(frame.Fields) != 2 {
		t.Fatalf("expected 2 fields (time, value), got %d", len(frame.Fields))
	}
	if frame.Fields[0].Name != "time" {
		t.Errorf("field[0]: want %q, got %q", "time", frame.Fields[0].Name)
	}
	if frame.Fields[0].Len() != 2 {
		t.Errorf("time field length: want 2, got %d", frame.Fields[0].Len())
	}
}

func TestBuildDataResponse_Aggregates(t *testing.T) {
	// Mean = Integral / ActiveTime = 120 / 60 = 2.0
	result := &metricq.TimelineAggregates{
		Times: []time.Time{time.Unix(1_700_000_000, 0)},
		Agg:   []*metricq.HistoryResponse_Aggregate{{Integral: 120, ActiveTime: 60}},
	}

	dr := buildDataResponse("host.cpu.load", nil, nil, time.Time{}, time.Time{}, result)

	if dr.Error != nil {
		t.Fatalf("unexpected error: %v", dr.Error)
	}
	frame := dr.Frames[0]
	if len(frame.Fields) != 2 {
		t.Fatalf("expected 2 fields (time, value), got %d", len(frame.Fields))
	}
	for i, want := range []string{"time", "value"} {
		if got := frame.Fields[i].Name; got != want {
			t.Errorf("field[%d]: want %q, got %q", i, want, got)
		}
	}
	if got := frame.Fields[1].At(0).(float64); got != 2.0 {
		t.Errorf("mean: want 2.0, got %v", got)
	}
}

func TestExtractTimelineStatistics_Aggregates(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)
	result := &metricq.TimelineAggregates{
		Times: []time.Time{t0},
		Agg: []*metricq.HistoryResponse_Aggregate{{
			Minimum:    1,
			Maximum:    5,
			Sum:        9,
			Count:      3,
			Integral:   180,
			ActiveTime: 60,
		}},
	}

	got := extractTimelineStatistics(time.Time{}, time.Time{}, result, []string{"mean", "min", "max", "count"})
	want := map[string]float64{"mean": 3, "min": 1, "max": 5, "count": 3}
	for statistic, wantValue := range want {
		if gotValue := got[statistic][t0]; gotValue != wantValue {
			t.Errorf("%s: want %v, got %v", statistic, wantValue, gotValue)
		}
	}
}

func TestExtractTimelineStatistics_RawValues(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)
	result := &metricq.TimelineValues{Times: []time.Time{t0}, Values: []float64{4.5}}

	got := extractTimelineStatistics(time.Time{}, time.Time{}, result, []string{"mean", "min", "max", "count"})
	want := map[string]float64{"mean": 4.5, "min": 4.5, "max": 4.5, "count": 1}
	for statistic, wantValue := range want {
		if gotValue := got[statistic][t0]; gotValue != wantValue {
			t.Errorf("%s: want %v, got %v", statistic, wantValue, gotValue)
		}
	}
}

func TestBuildFrameFromStatistics_CouplesFields(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)
	statistics := []string{"mean", "min", "max", "count"}
	points := map[string]map[time.Time]float64{
		"mean":  {t0: 3},
		"min":   {t0: 1},
		"max":   {t0: 5},
		"count": {t0: 7},
	}

	response := buildFrameFromStatistics("power", data.Labels{"phase": "L1"}, map[string]string{"unit": "W"}, points, statistics)
	frame := response.Frames[0]
	if len(frame.Fields) != 5 {
		t.Fatalf("expected time plus four statistic fields, got %d fields", len(frame.Fields))
	}
	for index, statistic := range statistics {
		field := frame.Fields[index+1]
		if field.Name != statistic {
			t.Errorf("field %d: want name %q, got %q", index+1, statistic, field.Name)
		}
		if field.Labels["phase"] != "L1" {
			t.Errorf("field %s lost shared labels", statistic)
		}
		if field.Labels["statistic"] != statistic {
			t.Errorf("field %s has statistic label %q", statistic, field.Labels["statistic"])
		}
		if field.Config.Color["mode"] != "fixed" || field.Config.Color["fixedColor"] == "" {
			t.Errorf("field %s has no fixed family color", statistic)
		}
	}
	if frame.Fields[1].Config.Unit != "watt" {
		t.Errorf("mean unit: want watt, got %q", frame.Fields[1].Config.Unit)
	}
	if frame.Fields[4].Config.Unit != "short" {
		t.Errorf("count unit: want short, got %q", frame.Fields[4].Config.Unit)
	}
}

func TestBuildDataResponse_AggregateZeroActiveTime(t *testing.T) {
	// ActiveTime=0 → Mean() returns error → value stays 0
	result := &metricq.TimelineAggregates{
		Times: []time.Time{time.Unix(1_700_000_000, 0)},
		Agg:   []*metricq.HistoryResponse_Aggregate{{ActiveTime: 0}},
	}

	dr := buildDataResponse("m", nil, nil, time.Time{}, time.Time{}, result)

	if dr.Error != nil {
		t.Fatalf("unexpected error: %v", dr.Error)
	}
	if v := dr.Frames[0].Fields[1].At(0).(float64); v != 0 {
		t.Errorf("want 0 for zero active time, got %v", v)
	}
}

func TestBuildDataResponse_Empty(t *testing.T) {
	dr := buildDataResponse("m", nil, nil, time.Time{}, time.Time{}, &metricq.TimelineValues{})

	if dr.Error != nil {
		t.Fatalf("unexpected error: %v", dr.Error)
	}
	if len(dr.Frames[0].Fields) != 2 {
		t.Fatalf("expected 2 fields for empty response, got %d", len(dr.Frames[0].Fields))
	}
	if dr.Frames[0].Fields[0].Len() != 0 {
		t.Errorf("expected empty time field, got len %d", dr.Frames[0].Fields[0].Len())
	}
}

// ── sanitizeURL ───────────────────────────────────────────────────────────────

func TestSanitizeURL(t *testing.T) {
	tests := []struct{ input, want string }{
		{"amqp://user:secret@rabbitmq.example.com:5672/", "amqp://rabbitmq.example.com:5672/"},
		{"amqp://user@rabbitmq.example.com/", "amqp://rabbitmq.example.com/"},
		{"amqp://localhost:5672/", "amqp://localhost:5672/"},
		{"nicht-eine-url", "nicht-eine-url"},
	}
	for _, tc := range tests {
		if got := sanitizeURL(tc.input); got != tc.want {
			t.Errorf("sanitizeURL(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestResolveMetricsExplicitSelectionDeduplicatesEmptyNames(t *testing.T) {
	ds := &datasourceInstance{}

	got, err := ds.resolveMetrics(context.Background(), []string{" metric.a ", "", "metric.b", "metric.a"}, nil, "", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("expected 2 metrics, got %d", len(got))
	}
	if _, ok := got["metric.a"]; !ok {
		t.Fatalf("expected metric.a to be present")
	}
	if _, ok := got["metric.b"]; !ok {
		t.Fatalf("expected metric.b to be present")
	}
}

func TestExplicitMetricsIncludesLegacyMetric(t *testing.T) {
	got := explicitMetrics([]string{"metric.b", "metric.a"}, "metric.a")
	want := []string{"metric.a", "metric.b"}

	if len(got) != len(want) {
		t.Fatalf("len(explicitMetrics()) = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("explicitMetrics()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestHasQueryFilter(t *testing.T) {
	tests := []struct {
		name   string
		filter map[string]interface{}
		want   bool
	}{
		{name: "nil", filter: nil, want: false},
		{name: "empty string", filter: map[string]interface{}{"site": ""}, want: false},
		{name: "spaces", filter: map[string]interface{}{"site": "   "}, want: false},
		{name: "scalar", filter: map[string]interface{}{"site": "LZR"}, want: true},
		{name: "string slice", filter: map[string]interface{}{"site": []string{"", "TRE"}}, want: true},
		{name: "interface slice empty", filter: map[string]interface{}{"site": []interface{}{"", "  "}}, want: false},
		{name: "interface slice value", filter: map[string]interface{}{"site": []interface{}{"", "TRE"}}, want: true},
	}

	for _, tc := range tests {
		if got := hasQueryFilter(tc.filter); got != tc.want {
			t.Fatalf("%s: hasQueryFilter() = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestResolveMetricsRejectsUnboundedQuery(t *testing.T) {
	ds := &datasourceInstance{}

	_, err := ds.resolveMetrics(context.Background(), nil, nil, "", "", "")
	if err == nil {
		t.Fatal("expected error for unbounded query")
	}
}

func TestAggregateValues(t *testing.T) {
	values := []float64{1, 2, 3}
	tests := []struct {
		mode string
		want float64
		ok   bool
	}{
		{mode: "min", want: 1, ok: true},
		{mode: "max", want: 3, ok: true},
		{mode: "mean", want: 2, ok: true},
		{mode: "sum", want: 6, ok: true},
		{mode: "none", want: 0, ok: false},
	}

	for _, tc := range tests {
		got, ok := aggregateValues(values, tc.mode)
		if ok != tc.ok {
			t.Fatalf("%s: ok = %v, want %v", tc.mode, ok, tc.ok)
		}
		if ok && got != tc.want {
			t.Fatalf("%s: got %v, want %v", tc.mode, got, tc.want)
		}
	}
}

func TestExtractTimelinePoints(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)
	result := &metricq.TimelineValues{
		Times:  []time.Time{t0, t0.Add(time.Second), t0.Add(2 * time.Second)},
		Values: []float64{1, 2, 3},
	}

	points := extractTimelinePoints(t0.Add(time.Second), t0.Add(2*time.Second), result)
	if len(points) != 2 {
		t.Fatalf("expected 2 points, got %d", len(points))
	}
	if points[t0.Add(time.Second)] != 2 {
		t.Fatalf("unexpected point at +1s: %v", points[t0.Add(time.Second)])
	}
	if points[t0.Add(2*time.Second)] != 3 {
		t.Fatalf("unexpected point at +2s: %v", points[t0.Add(2*time.Second)])
	}
}

func TestAggregateIntervalPointsUsesNextSampleToTheRight(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)

	series := []metricSeries{
		{
			metric: "metric.a",
			points: map[time.Time]float64{
				t0.Add(5 * time.Minute):  0.9,
				t0.Add(10 * time.Minute): 0.7,
			},
		},
		{
			metric: "metric.b",
			points: map[time.Time]float64{
				t0.Add(7 * time.Minute):  0.5,
				t0.Add(11 * time.Minute): 0.4,
			},
		},
	}

	got := aggregateIntervalPoints(series, "min")
	want := map[time.Time]float64{
		t0.Add(7 * time.Minute):  0.5,
		t0.Add(10 * time.Minute): 0.4,
		t0.Add(11 * time.Minute): 0.4,
	}

	if len(got) != len(want) {
		t.Fatalf("len(aggregateIntervalPoints()) = %d, want %d", len(got), len(want))
	}
	for ts, wantValue := range want {
		gotValue, ok := got[ts]
		if !ok {
			t.Fatalf("missing aggregated point at %s", ts)
		}
		if gotValue != wantValue {
			t.Fatalf("point at %s = %v, want %v", ts, gotValue, wantValue)
		}
	}
}

func TestOrderedActiveMetricNamesSortsAndSkipsArchived(t *testing.T) {
	metrics := map[string]map[string]string{
		"metric.b": {},
		"metric.a": {},
		"metric.c": {"archived": "true"},
	}

	got := orderedActiveMetricNames(metrics, nil)
	want := []string{"metric.a", "metric.b"}

	if len(got) != len(want) {
		t.Fatalf("len(orderedActiveMetricNames()) = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("orderedActiveMetricNames()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestLimitInteractivePreviewTruncatesOnlyUserDrivenNonExplicitQueries(t *testing.T) {
	metricNames := make([]string, interactiveMetricLimit+5)
	for i := range metricNames {
		metricNames[i] = "metric"
	}

	limited, notice := limitInteractivePreview(metricNames, true, false)
	if len(limited) != interactiveMetricLimit {
		t.Fatalf("len(limitInteractivePreview()) = %d, want %d", len(limited), interactiveMetricLimit)
	}
	if notice == nil {
		t.Fatal("expected truncation notice")
	}

	unchanged, explicitNotice := limitInteractivePreview(metricNames, true, true)
	if len(unchanged) != len(metricNames) {
		t.Fatalf("explicit query was truncated unexpectedly: got %d, want %d", len(unchanged), len(metricNames))
	}
	if explicitNotice != nil {
		t.Fatal("did not expect notice for explicit selection")
	}

	alerting, alertingNotice := limitInteractivePreview(metricNames, false, false)
	if len(alerting) != len(metricNames) {
		t.Fatalf("alerting query was truncated unexpectedly: got %d, want %d", len(alerting), len(metricNames))
	}
	if alertingNotice != nil {
		t.Fatal("did not expect notice for alerting query")
	}
}

func TestShouldLimitInteractivePreview(t *testing.T) {
	req := &backend.QueryDataRequest{}
	if shouldLimitInteractivePreview(req) {
		t.Fatal("request without user must not be limited")
	}

	req.PluginContext.User = &backend.User{Login: "mario"}
	if !shouldLimitInteractivePreview(req) {
		t.Fatal("user-initiated request should be limited")
	}

	req.PluginContext.User = &backend.User{Login: "grafana_scheduler"}
	if shouldLimitInteractivePreview(req) {
		t.Fatal("grafana scheduler request must not be limited")
	}

	req.PluginContext.User = &backend.User{Login: "mario"}
	req.SetHTTPHeader("fromalert", "true")
	if shouldLimitInteractivePreview(req) {
		t.Fatal("alert header request must not be limited")
	}
}

func TestSummarizeLabelsSortsKeys(t *testing.T) {
	labels := data.Labels{
		"phase":    "1",
		"asset_id": "pdu-01",
	}

	got := summarizeLabels(labels)
	want := "asset_id=pdu-01, phase=1"
	if got != want {
		t.Fatalf("summarizeLabels() = %q, want %q", got, want)
	}
}

func TestGroupSeriesByAggregateOverKeepsRemainingDimensions(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)
	series := []metricSeries{
		{
			metric: "m1",
			metadata: map[string]string{
				"asset_id": "pdu-01",
				"phase":    "1",
			},
			points: map[time.Time]float64{t0: 1},
		},
		{
			metric: "m2",
			metadata: map[string]string{
				"asset_id": "pdu-01",
				"phase":    "2",
			},
			points: map[time.Time]float64{t0: 2},
		},
		{
			metric: "m3",
			metadata: map[string]string{
				"asset_id": "pdu-02",
				"phase":    "1",
			},
			points: map[time.Time]float64{t0: 3},
		},
	}

	grouped, skipped := groupSeriesByAggregateOver(series, "phase", map[string]interface{}{})
	if len(grouped) != 2 {
		t.Fatalf("len(groupSeriesByAggregateOver()) = %d, want 2", len(grouped))
	}
	if skipped != 0 {
		t.Fatalf("skipped = %d, want 0", skipped)
	}

	pdu01, ok := grouped["asset_id=pdu-01"]
	if !ok {
		t.Fatal("expected group for asset_id=pdu-01")
	}
	if len(pdu01.series) != 2 {
		t.Fatalf("len(grouped[pdu-01].series) = %d, want 2", len(pdu01.series))
	}
	if _, hasPhase := pdu01.labels["phase"]; hasPhase {
		t.Fatal("phase label should have been removed from aggregate-over grouping")
	}

	pdu02, ok := grouped["asset_id=pdu-02"]
	if !ok {
		t.Fatal("expected group for asset_id=pdu-02")
	}
	if len(pdu02.series) != 1 {
		t.Fatalf("len(grouped[pdu-02].series) = %d, want 1", len(pdu02.series))
	}
}

func TestGroupSeriesByAggregateOverSkipsMetricsWithoutTargetField(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)
	series := []metricSeries{
		{
			metric: "phase-1",
			metadata: map[string]string{
				"asset_id": "pdu-01",
				"phase":    "1",
			},
			points: map[time.Time]float64{t0: 1},
		},
		{
			metric: "phase-2",
			metadata: map[string]string{
				"asset_id": "pdu-01",
				"phase":    "2",
			},
			points: map[time.Time]float64{t0: 2},
		},
		{
			metric: "circuit-a",
			metadata: map[string]string{
				"asset_id": "pdu-01",
				"circuit":  "A",
			},
			points: map[time.Time]float64{t0: 3},
		},
	}

	grouped, skipped := groupSeriesByAggregateOver(series, "phase", map[string]interface{}{})
	if len(grouped) != 1 {
		t.Fatalf("len(groupSeriesByAggregateOver()) = %d, want 1", len(grouped))
	}
	if skipped != 1 {
		t.Fatalf("skipped = %d, want 1", skipped)
	}

	group, ok := grouped["asset_id=pdu-01"]
	if !ok {
		t.Fatal("expected group for asset_id=pdu-01")
	}
	if len(group.series) != 2 {
		t.Fatalf("len(grouped[pdu-01].series) = %d, want 2", len(group.series))
	}
	for _, item := range group.series {
		if item.metric == "circuit-a" {
			t.Fatal("metric without phase should have been skipped")
		}
	}
}

func TestAggregateOverSkipNotice(t *testing.T) {
	notice := aggregateOverSkipNotice("phase", 6)
	if notice == nil {
		t.Fatal("expected notice")
	}
	if notice.Severity != data.NoticeSeverityWarning {
		t.Fatalf("severity = %v, want warning", notice.Severity)
	}
	wantText := "6 matching metrics without phase were skipped by aggregate-over."
	if notice.Text != wantText {
		t.Fatalf("notice text = %q, want %q", notice.Text, wantText)
	}
	if aggregateOverSkipNotice("phase", 0) != nil {
		t.Fatal("did not expect notice for zero skipped metrics")
	}
}

func TestCollapseByUnknownNotice(t *testing.T) {
	notice := collapseByUnknownNotice("phase", 6)
	if notice == nil {
		t.Fatal("expected notice")
	}
	if notice.Severity != data.NoticeSeverityWarning {
		t.Fatalf("severity = %v, want warning", notice.Severity)
	}
	wantText := "6 matching metrics without phase were grouped into <unknown> by collapse-by."
	if notice.Text != wantText {
		t.Fatalf("notice text = %q, want %q", notice.Text, wantText)
	}
	if collapseByUnknownNotice("phase", 0) != nil {
		t.Fatal("did not expect notice for zero unknown metrics")
	}
}
