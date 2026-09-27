package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	metricq "github.com/metricq/metricq-go"
)

// ── config ────────────────────────────────────────────────────────────────────

type pluginConfig struct {
	// intentionally empty — all config comes from secureJsonData
}

// ── query model ───────────────────────────────────────────────────────────────

type queryModel struct {
	Metric        string                 `json:"metric"`
	Metrics       []string               `json:"metrics"`
	Filter        map[string]interface{} `json:"filter"` // values: string or []interface{} (from Grafana multi-value)
	Search        string                 `json:"search"`
	Infix         string                 `json:"infix"`
	Selector      string                 `json:"selector"` // regex on metric name
	GroupBy       string                 `json:"groupBy"`  // legacy field, interpreted as collapseBy
	CollapseBy    string                 `json:"collapseBy"`
	AggregateOver string                 `json:"aggregateOver"`
	Aggregate     string                 `json:"aggregate"`
	Statistics    []string               `json:"statistics"`
}

// ── datasource instance ───────────────────────────────────────────────────────

type datasourceInstance struct {
	token         string
	agent         *metricq.Agent
	historyClient *metricq.HistoryClient
	rpcCancel     context.CancelFunc
}

const interactiveMetricLimit = 200
const fromAlertHeader = "FromAlert"
const alertingSchedulerUser = "grafana_scheduler"

var _ instancemgmt.Instance = (*datasourceInstance)(nil)
var _ backend.QueryDataHandler = (*datasourceInstance)(nil)
var _ backend.CheckHealthHandler = (*datasourceInstance)(nil)
var _ backend.CallResourceHandler = (*datasourceInstance)(nil)

func newDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	amqpURL := settings.DecryptedSecureJSONData["server"]
	if amqpURL == "" {
		amqpURL = "amqp://localhost:5672/"
	}

	token := fmt.Sprintf("grafana-metricq-%d", settings.ID)

	log.DefaultLogger.Info("Connecting to MetricQ", "url", sanitizeURL(amqpURL), "token", token)

	agent, err := metricq.NewAgent(token, amqpURL)
	if err != nil {
		return nil, fmt.Errorf("create agent: %w", err)
	}

	rpcCtx, rpcCancel := context.WithCancel(context.Background())
	if err := agent.Connect(rpcCtx); err != nil {
		rpcCancel()
		return nil, fmt.Errorf("connect to MetricQ: %w", err)
	}

	connectCtx, connectCancel := context.WithTimeout(ctx, 15*time.Second)
	defer connectCancel()

	historyClient, err := metricq.NewHistoryClient(connectCtx, agent)
	if err != nil {
		rpcCancel()
		agent.Close()
		return nil, fmt.Errorf("create history client: %w", err)
	}

	go agent.ServeDiscover(rpcCtx, "1.0.0")

	log.DefaultLogger.Info("MetricQ datasource connected", "token", token)

	return &datasourceInstance{
		token:         token,
		agent:         agent,
		historyClient: historyClient,
		rpcCancel:     rpcCancel,
	}, nil
}

func (d *datasourceInstance) Dispose() {
	if d.historyClient != nil {
		_ = d.historyClient.Close()
	}
	d.rpcCancel()
	if d.agent != nil {
		d.agent.Close()
	}
}

// ── metric resolution ─────────────────────────────────────────────────────────

type metricsResolveReq struct {
	Function string                 `json:"function"`
	Filter   map[string]interface{} `json:"filter"`
	Limit    *int                   `json:"limit"` // null → no limit
}

type getMetricsReq struct {
	Function string `json:"function"`
	Format   string `json:"format"`
	Infix    string `json:"infix,omitempty"`
	Selector string `json:"selector,omitempty"` // regex on metric name (_id)
	Historic bool   `json:"historic"`
	Limit    *int   `json:"limit"`
}

type metricsSearchReq struct {
	Function string                 `json:"function"`
	Query    string                 `json:"query"`
	Fields   []string               `json:"fields"`
	Mode     string                 `json:"mode"`
	Filter   map[string]interface{} `json:"filter"`
	Limit    *int                   `json:"limit"` // null → no limit
}

type resolvedMetric struct {
	Name     string         `json:"name"`
	Metadata map[string]any `json:"metadata"`
}

type metricsResolveResp struct {
	Metrics []resolvedMetric `json:"metrics"`
}

func hasQueryFilter(filter map[string]interface{}) bool {
	for _, raw := range filter {
		switch value := raw.(type) {
		case string:
			if strings.TrimSpace(value) != "" {
				return true
			}
		case []string:
			for _, item := range value {
				if strings.TrimSpace(item) != "" {
					return true
				}
			}
		case []interface{}:
			for _, item := range value {
				if strings.TrimSpace(fmt.Sprintf("%v", item)) != "" {
					return true
				}
			}
		default:
			if strings.TrimSpace(fmt.Sprintf("%v", value)) != "" {
				return true
			}
		}
	}
	return false
}

func explicitMetrics(metrics []string, legacyMetric string) []string {
	selected := make([]string, 0, len(metrics)+1)
	seen := make(map[string]struct{}, len(metrics)+1)

	appendMetric := func(metric string) {
		trimmed := strings.TrimSpace(metric)
		if trimmed == "" {
			return
		}
		if _, exists := seen[trimmed]; exists {
			return
		}
		seen[trimmed] = struct{}{}
		selected = append(selected, trimmed)
	}

	appendMetric(legacyMetric)
	for _, metric := range metrics {
		appendMetric(metric)
	}
	return selected
}

func mapResolvedMetrics(raw map[string]map[string]any) map[string]map[string]string {
	result := make(map[string]map[string]string, len(raw))
	for name, meta := range raw {
		flat := make(map[string]string, len(meta))
		for k, v := range meta {
			flat[k] = fmt.Sprintf("%v", v)
		}
		result[name] = flat
	}
	return result
}

func resolvedMetricsFromResponse(body []byte, rpcFunc string) (map[string]map[string]string, error) {
	var resp metricsResolveResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("parse %s response: %w", rpcFunc, err)
	}
	result := make(map[string]map[string]string, len(resp.Metrics))
	for _, m := range resp.Metrics {
		flat := make(map[string]string, len(m.Metadata))
		for k, v := range m.Metadata {
			flat[k] = fmt.Sprintf("%v", v)
		}
		result[m.Name] = flat
	}
	return result, nil
}

func resolveExplicitMetricSelection(explicit []string) map[string]map[string]string {
	result := make(map[string]map[string]string, len(explicit))
	for _, metric := range explicit {
		trimmed := strings.TrimSpace(metric)
		if trimmed == "" {
			continue
		}
		result[trimmed] = map[string]string{}
	}
	return result
}

func extractTimelinePoints(from, to time.Time, result metricq.TimelineResult) map[time.Time]float64 {
	return extractTimelineStatistics(from, to, result, []string{"mean"})["mean"]
}

var historyStatisticNames = []string{"mean", "min", "max", "count"}

func selectedHistoryStatistics(requested []string) []string {
	valid := make(map[string]bool, len(historyStatisticNames))
	for _, name := range historyStatisticNames {
		valid[name] = true
	}

	selected := make([]string, 0, len(requested))
	seen := make(map[string]bool, len(requested))
	for _, raw := range requested {
		name := strings.ToLower(strings.TrimSpace(raw))
		if valid[name] && !seen[name] {
			selected = append(selected, name)
			seen[name] = true
		}
	}
	if len(selected) == 0 {
		return []string{"mean"}
	}
	return selected
}

func extractTimelineStatistics(from, to time.Time, result metricq.TimelineResult, requested []string) map[string]map[time.Time]float64 {
	statistics := selectedHistoryStatistics(requested)
	points := make(map[string]map[time.Time]float64, len(statistics))
	for _, statistic := range statistics {
		points[statistic] = make(map[time.Time]float64)
	}

	inRange := func(t time.Time) bool {
		if from.IsZero() && to.IsZero() {
			return true
		}
		return (from.IsZero() || !t.Before(from)) && (to.IsZero() || !t.After(to))
	}

	switch r := result.(type) {
	case *metricq.TimelineAggregates:
		for t, agg := range r.All() {
			if !inRange(t) {
				continue
			}
			for _, statistic := range statistics {
				switch statistic {
				case "mean":
					value := 0.0
					if mean, err := agg.Mean(); err == nil {
						value = mean
					}
					points[statistic][t] = value
				case "min":
					points[statistic][t] = agg.GetMinimum()
				case "max":
					points[statistic][t] = agg.GetMaximum()
				case "count":
					points[statistic][t] = float64(agg.GetCount())
				}
			}
		}
	case *metricq.TimelineValues:
		for t, v := range r.All() {
			if inRange(t) {
				for _, statistic := range statistics {
					if statistic == "count" {
						points[statistic][t] = 1
					} else {
						points[statistic][t] = v
					}
				}
			}
		}
	}

	return points
}

func aggregateValues(values []float64, mode string) (float64, bool) {
	if len(values) == 0 {
		return 0, false
	}

	switch mode {
	case "min":
		value := values[0]
		for _, candidate := range values[1:] {
			if candidate < value {
				value = candidate
			}
		}
		return value, true
	case "max":
		value := values[0]
		for _, candidate := range values[1:] {
			if candidate > value {
				value = candidate
			}
		}
		return value, true
	case "sum":
		var total float64
		for _, value := range values {
			total += value
		}
		return total, true
	case "mean":
		var total float64
		for _, value := range values {
			total += value
		}
		return total / float64(len(values)), true
	default:
		return 0, false
	}
}

type timelineSample struct {
	time  time.Time
	value float64
}

func sortedSamples(points map[time.Time]float64) []timelineSample {
	samples := make([]timelineSample, 0, len(points))
	for t, value := range points {
		samples = append(samples, timelineSample{time: t, value: value})
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i].time.Before(samples[j].time) })
	return samples
}

func aggregateIntervalPoints(series []metricSeries, mode string) map[time.Time]float64 {
	if len(series) == 0 {
		return nil
	}

	allEdges := make(map[time.Time]struct{})
	sortedByMetric := make([][]timelineSample, 0, len(series))
	for _, item := range series {
		samples := sortedSamples(item.points)
		if len(samples) == 0 {
			continue
		}
		sortedByMetric = append(sortedByMetric, samples)
		for _, sample := range samples {
			allEdges[sample.time] = struct{}{}
		}
	}
	if len(allEdges) < 2 {
		return nil
	}

	edges := make([]time.Time, 0, len(allEdges))
	for edge := range allEdges {
		edges = append(edges, edge)
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].Before(edges[j]) })

	aggregated := make(map[time.Time]float64, len(edges)-1)
	for i := 0; i < len(edges)-1; i++ {
		intervalStart := edges[i]
		intervalEnd := edges[i+1]
		values := make([]float64, 0, len(sortedByMetric))

		for _, samples := range sortedByMetric {
			idx := sort.Search(len(samples), func(j int) bool {
				return samples[j].time.After(intervalStart)
			})
			if idx < len(samples) {
				values = append(values, samples[idx].value)
			}
		}

		if value, ok := aggregateValues(values, mode); ok {
			aggregated[intervalEnd] = value
		}
	}

	return aggregated
}

func buildFrameFromPoints(name string, labels data.Labels, metadata map[string]string, points map[time.Time]float64) backend.DataResponse {
	return buildFrameFromStatistics(name, labels, metadata, map[string]map[time.Time]float64{"mean": points}, []string{"mean"})
}

var statisticColorFamilies = [][]string{
	{"#5794F2", "#8AB8FF", "#3274D9", "#B4D2FF"},
	{"#73BF69", "#A5D99D", "#37872D", "#C9E8C5"},
	{"#FF9830", "#FFC078", "#E0752D", "#FFD7A8"},
	{"#B877D9", "#D6A7EE", "#8F3BB8", "#E8CCF5"},
	{"#F2495C", "#FF8A98", "#C4162A", "#FFBAC2"},
	{"#2D9D9A", "#70C9C6", "#1F7875", "#A8E1DF"},
}

func statisticColor(metric, statistic string) string {
	hash := uint32(2166136261)
	for _, char := range []byte(metric) {
		hash ^= uint32(char)
		hash *= 16777619
	}
	family := statisticColorFamilies[int(hash%uint32(len(statisticColorFamilies)))]
	for index, name := range historyStatisticNames {
		if name == statistic {
			return family[index]
		}
	}
	return family[0]
}

func buildFrameFromStatistics(name string, labels data.Labels, metadata map[string]string, points map[string]map[time.Time]float64, requested []string) backend.DataResponse {
	frame := data.NewFrame(name)
	statistics := selectedHistoryStatistics(requested)

	allTimes := make(map[time.Time]struct{})
	for _, statistic := range statistics {
		for t := range points[statistic] {
			allTimes[t] = struct{}{}
		}
	}
	times := make([]time.Time, 0, len(allTimes))
	for t := range allTimes {
		times = append(times, t)
	}
	sort.Slice(times, func(i, j int) bool { return times[i].Before(times[j]) })

	timeField := data.NewField("time", nil, times)
	frame.Fields = append(frame.Fields, timeField)
	for _, statistic := range statistics {
		values := make([]float64, 0, len(times))
		for _, t := range times {
			values = append(values, points[statistic][t])
		}

		displayName := name
		if len(statistics) > 1 || statistic != "mean" {
			displayName = fmt.Sprintf("%s %s", name, statistic)
		}
		unit := metricqUnitToGrafana(metadata["unit"])
		if statistic == "count" {
			unit = "short"
		}
		fieldName := statistic
		if len(statistics) == 1 && statistic == "mean" {
			fieldName = "value"
		}
		fieldLabels := labels.Copy()
		if len(statistics) > 1 {
			fieldLabels["statistic"] = statistic
		}
		field := data.NewField(fieldName, fieldLabels, values)
		fieldConfig := &data.FieldConfig{
			DisplayNameFromDS: displayName,
			Description:       metadata["description"],
			Unit:              unit,
		}
		if len(statistics) > 1 {
			fieldConfig.Color = map[string]interface{}{
				"mode":       "fixed",
				"fixedColor": statisticColor(name, statistic),
			}
		}
		field.Config = fieldConfig
		frame.Fields = append(frame.Fields, field)
	}

	return backend.DataResponse{Frames: data.Frames{frame}}
}

func summarizeLabels(labels data.Labels) string {
	if len(labels) == 0 {
		return ""
	}

	keys := make([]string, 0, len(labels))
	for key := range labels {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", key, labels[key]))
	}
	return strings.Join(parts, ", ")
}

func buildCollapsedDataResponse(collapseBy, aggregate string, grouped map[string][]metricSeries) backend.DataResponse {
	groupNames := make([]string, 0, len(grouped))
	for groupName := range grouped {
		groupNames = append(groupNames, groupName)
	}
	sort.Strings(groupNames)

	var frames data.Frames
	for _, groupName := range groupNames {
		series := grouped[groupName]
		if len(series) == 0 {
			continue
		}

		unit := ""
		sameUnit := true
		for _, item := range series {
			if currentUnit := item.metadata["unit"]; currentUnit != "" {
				if unit == "" {
					unit = currentUnit
				} else if unit != currentUnit {
					sameUnit = false
				}
			}
		}

		aggregated := aggregateIntervalPoints(series, aggregate)
		if len(aggregated) == 0 {
			continue
		}

		metadata := map[string]string{
			"description": fmt.Sprintf("%s across %d metrics collapsed by %s=%s", aggregate, len(series), collapseBy, groupName),
		}
		if sameUnit {
			metadata["unit"] = unit
		}
		labels := data.Labels{
			collapseBy:  groupName,
			"aggregate": aggregate,
		}
		frames = append(frames, buildFrameFromPoints(fmt.Sprintf("%s=%s", collapseBy, groupName), labels, metadata, aggregated).Frames...)
	}

	return backend.DataResponse{Frames: frames}
}

type aggregateOverGroup struct {
	labels data.Labels
	series []metricSeries
}

func labelsWithoutField(metric string, metadata map[string]string, filter map[string]interface{}, field string) data.Labels {
	labels := buildLabels(metric, metadata, filter, false)
	delete(labels, field)
	return labels
}

func groupSeriesByAggregateOver(series []metricSeries, aggregateOver string, filter map[string]interface{}) (map[string]aggregateOverGroup, int) {
	grouped := make(map[string]aggregateOverGroup)
	skippedWithoutField := 0
	for _, result := range series {
		if result.metric == "" || len(result.points) == 0 {
			continue
		}
		if strings.TrimSpace(result.metadata[aggregateOver]) == "" {
			skippedWithoutField++
			continue
		}

		labels := labelsWithoutField(result.metric, result.metadata, filter, aggregateOver)
		key := summarizeLabels(labels)
		group := grouped[key]
		if group.labels == nil {
			group.labels = labels
		}
		group.series = append(group.series, result)
		grouped[key] = group
	}
	return grouped, skippedWithoutField
}

func buildAggregateOverDataResponse(aggregateOver, aggregate string, grouped map[string]aggregateOverGroup) backend.DataResponse {
	groupKeys := make([]string, 0, len(grouped))
	for key := range grouped {
		groupKeys = append(groupKeys, key)
	}
	sort.Strings(groupKeys)

	var frames data.Frames
	for _, key := range groupKeys {
		group := grouped[key]
		if len(group.series) == 0 {
			continue
		}

		unit := ""
		sameUnit := true
		for _, item := range group.series {
			if currentUnit := item.metadata["unit"]; currentUnit != "" {
				if unit == "" {
					unit = currentUnit
				} else if unit != currentUnit {
					sameUnit = false
				}
			}
		}

		aggregated := aggregateIntervalPoints(group.series, aggregate)
		if len(aggregated) == 0 {
			continue
		}

		frameName := summarizeLabels(group.labels)
		if frameName == "" {
			frameName = fmt.Sprintf("%s over %s", aggregate, aggregateOver)
		}

		metadata := map[string]string{
			"description": fmt.Sprintf("%s across %d metrics aggregated over %s", aggregate, len(group.series), aggregateOver),
		}
		if sameUnit {
			metadata["unit"] = unit
		}

		frames = append(frames, buildFrameFromPoints(frameName, group.labels, metadata, aggregated).Frames...)
	}

	return backend.DataResponse{Frames: frames}
}

func orderedActiveMetricNames(metrics map[string]map[string]string, explicit []string) []string {
	if len(metrics) == 0 {
		return nil
	}

	if len(explicit) > 0 {
		names := make([]string, 0, len(explicit))
		seen := make(map[string]struct{}, len(explicit))
		for _, metric := range explicit {
			trimmed := strings.TrimSpace(metric)
			if trimmed == "" {
				continue
			}
			if _, alreadySeen := seen[trimmed]; alreadySeen {
				continue
			}
			metadata, ok := metrics[trimmed]
			if !ok {
				continue
			}
			if _, archived := metadata["archived"]; archived {
				continue
			}
			seen[trimmed] = struct{}{}
			names = append(names, trimmed)
		}
		return names
	}

	names := make([]string, 0, len(metrics))
	for metric, metadata := range metrics {
		if _, archived := metadata["archived"]; archived {
			continue
		}
		names = append(names, metric)
	}
	sort.Strings(names)
	return names
}

func limitInteractivePreview(metricNames []string, interactive bool, explicit bool) ([]string, *data.Notice) {
	if !interactive || explicit || len(metricNames) <= interactiveMetricLimit {
		return metricNames, nil
	}

	limited := metricNames[:interactiveMetricLimit]
	notice := &data.Notice{
		Severity: data.NoticeSeverityWarning,
		Text:     fmt.Sprintf("User-initiated previews are limited to the first %d of %d matching metrics. Backend alert evaluations are not limited.", interactiveMetricLimit, len(metricNames)),
		Inspect:  data.InspectTypeMeta,
	}
	return limited, notice
}

func shouldLimitInteractivePreview(req *backend.QueryDataRequest) bool {
	if req == nil || req.PluginContext.User == nil {
		return false
	}
	if strings.EqualFold(req.PluginContext.User.Login, alertingSchedulerUser) {
		return false
	}
	return req.GetHTTPHeader(fromAlertHeader) == ""
}

func aggregateOverSkipNotice(field string, skipped int) *data.Notice {
	if skipped <= 0 {
		return nil
	}

	return &data.Notice{
		Severity: data.NoticeSeverityWarning,
		Text:     fmt.Sprintf("%d matching metrics without %s were skipped by aggregate-over.", skipped, field),
		Inspect:  data.InspectTypeMeta,
	}
}

func collapseByUnknownNotice(field string, unknown int) *data.Notice {
	if unknown <= 0 {
		return nil
	}

	return &data.Notice{
		Severity: data.NoticeSeverityWarning,
		Text:     fmt.Sprintf("%d matching metrics without %s were grouped into <unknown> by collapse-by.", unknown, field),
		Inspect:  data.InspectTypeMeta,
	}
}

func appendNoticeToFrames(frames data.Frames, notice *data.Notice) {
	if notice == nil {
		return
	}
	for _, frame := range frames {
		frame.AppendNotices(*notice)
	}
}

type metricSeries struct {
	metric     string
	metadata   map[string]string
	labels     data.Labels
	points     map[time.Time]float64
	statistics map[string]map[time.Time]float64
}

func (d *datasourceInstance) resolveMetricsByNamePattern(ctx context.Context, infix, selector string) (map[string]map[string]string, error) {
	body, err := d.agent.Rpc(ctx, "metricq.management", "get_metrics", getMetricsReq{
		Function: "get_metrics",
		Format:   "object",
		Infix:    infix,
		Selector: selector,
		Historic: true,
		Limit:    nil,
	})
	if err != nil {
		return nil, fmt.Errorf("get_metrics RPC: %w", err)
	}

	var raw struct {
		Metrics map[string]map[string]any `json:"metrics"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse get_metrics response: %w", err)
	}

	return mapResolvedMetrics(raw.Metrics), nil
}

func (d *datasourceInstance) searchMetricsByText(ctx context.Context, filter map[string]interface{}, search string) (map[string]map[string]string, error) {
	body, err := d.agent.Rpc(ctx, "metricq.management", "metrics.search", metricsSearchReq{
		Function: "metrics.search",
		Query:    search,
		Fields:   []string{"description", "display_name"},
		Mode:     "words",
		Filter:   filter,
		Limit:    nil,
	})
	if err != nil {
		return nil, fmt.Errorf("metrics.search RPC: %w", err)
	}

	return resolvedMetricsFromResponse(body, "metrics.search")
}

func (d *datasourceInstance) resolveMetricsByFilter(ctx context.Context, filter map[string]interface{}) (map[string]map[string]string, error) {
	body, err := d.agent.Rpc(ctx, "metricq.management", "metrics.resolve", metricsResolveReq{
		Function: "metrics.resolve",
		Filter:   filter,
		Limit:    nil,
	})
	if err != nil {
		return nil, fmt.Errorf("metrics.resolve RPC: %w", err)
	}

	return resolvedMetricsFromResponse(body, "metrics.resolve")
}

// resolveMetrics returns a map of metric name → metadata fields.
func (d *datasourceInstance) resolveMetrics(
	ctx context.Context, explicit []string, filter map[string]interface{}, search, infix, selector string) (map[string]map[string]string, error) {
	search = strings.TrimSpace(search)
	infix = strings.TrimSpace(infix)
	selector = strings.TrimSpace(selector)

	switch {
	case len(explicit) > 0:
		return resolveExplicitMetricSelection(explicit), nil
	case infix != "" || selector != "":
		return d.resolveMetricsByNamePattern(ctx, infix, selector)
	case search != "":
		return d.searchMetricsByText(ctx, filter, search)
	case hasQueryFilter(filter):
		return d.resolveMetricsByFilter(ctx, filter)
	default:
		return nil, fmt.Errorf("refusing to query all metrics without an explicit metric, filter, search, infix, or selector")
	}
}

// ── QueryData ─────────────────────────────────────────────────────────────────

func (d *datasourceInstance) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	resp := backend.NewQueryDataResponse()
	interactive := shouldLimitInteractivePreview(req)
	for _, q := range req.Queries {
		resp.Responses[q.RefID] = d.runQuery(ctx, q, interactive)
	}
	return resp, nil
}

func (d *datasourceInstance) runQuery(ctx context.Context, q backend.DataQuery, interactive bool) backend.DataResponse {
	var model queryModel
	if err := json.Unmarshal(q.JSON, &model); err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("parse query: %v", err))
	}

	if model.Filter == nil {
		model.Filter = map[string]interface{}{}
	}
	if model.Aggregate == "" {
		model.Aggregate = "none"
	}
	model.GroupBy = strings.TrimSpace(model.GroupBy)
	model.CollapseBy = strings.TrimSpace(model.CollapseBy)
	model.AggregateOver = strings.TrimSpace(model.AggregateOver)
	if model.CollapseBy == "" {
		model.CollapseBy = model.GroupBy
	}
	if model.CollapseBy != "" && model.AggregateOver != "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "collapseBy and aggregateOver are mutually exclusive")
	}
	explicit := explicitMetrics(model.Metrics, model.Metric)

	metrics, err := d.resolveMetrics(ctx, explicit, model.Filter, model.Search, model.Infix, model.Selector)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("resolve metrics: %v", err))
	}
	metricNames := orderedActiveMetricNames(metrics, explicit)
	if len(metricNames) == 0 {
		return backend.DataResponse{Frames: data.Frames{}}
	}
	metricNames, previewNotice := limitInteractivePreview(metricNames, interactive, len(explicit) > 0)

	// Compute labels for each metric before issuing history requests.
	// Filter fields are excluded from labels so that queries with different
	// filter values (e.g. phase=L1 vs phase=L2) can be joined by Grafana's
	// alert expression engine.
	// The "metric" label is added only when the remaining labels are not
	// unique across all results (fallback to prevent duplicate-label errors).
	type metricInfo struct {
		metric   string
		metadata map[string]string
		labels   data.Labels
	}
	infos := make([]metricInfo, 0, len(metricNames))
	seen := make(map[string]bool, len(metricNames))
	needMetricLabel := false
	for _, metric := range metricNames {
		metadata := metrics[metric]
		key := buildLabels(metric, metadata, model.Filter, false).String()
		if seen[key] {
			needMetricLabel = true
			break
		}
		seen[key] = true
	}
	for _, metric := range metricNames {
		metadata := metrics[metric]
		infos = append(infos, metricInfo{
			metric:   metric,
			metadata: metadata,
			labels:   buildLabels(metric, metadata, model.Filter, needMetricLabel),
		})
	}

	requestedStatistics := selectedHistoryStatistics(model.Statistics)
	results := make([]metricSeries, len(infos))
	var wg sync.WaitGroup
	for i, info := range infos {
		wg.Add(1)
		go func(idx int, info metricInfo) {
			defer wg.Done()
			timelineResp, histErr := d.historyClient.RequestTimeline(ctx, info.metric,
				q.TimeRange.From, q.TimeRange.To,
				q.Interval*2,
			)
			if histErr != nil {
				log.DefaultLogger.Warn("MetricQ query failed", "metric", info.metric, "err", histErr)
				return
			}
			statistics := extractTimelineStatistics(q.TimeRange.From, q.TimeRange.To, timelineResp, requestedStatistics)
			results[idx] = metricSeries{
				metric:     info.metric,
				metadata:   info.metadata,
				labels:     info.labels,
				points:     extractTimelinePoints(q.TimeRange.From, q.TimeRange.To, timelineResp),
				statistics: statistics,
			}
		}(i, info)
	}
	wg.Wait()

	if model.CollapseBy != "" && model.Aggregate != "none" {
		grouped := make(map[string][]metricSeries)
		unknownCount := 0
		for _, result := range results {
			if result.metric == "" || len(result.points) == 0 {
				continue
			}
			groupValue := strings.TrimSpace(result.metadata[model.CollapseBy])
			if groupValue == "" {
				groupValue = "<unknown>"
				unknownCount++
			}
			grouped[groupValue] = append(grouped[groupValue], result)
		}
		response := buildCollapsedDataResponse(model.CollapseBy, model.Aggregate, grouped)
		appendNoticeToFrames(response.Frames, previewNotice)
		appendNoticeToFrames(response.Frames, collapseByUnknownNotice(model.CollapseBy, unknownCount))
		return response
	}

	if model.AggregateOver != "" && model.Aggregate != "none" {
		grouped, skippedWithoutField := groupSeriesByAggregateOver(results, model.AggregateOver, model.Filter)
		response := buildAggregateOverDataResponse(model.AggregateOver, model.Aggregate, grouped)
		appendNoticeToFrames(response.Frames, previewNotice)
		appendNoticeToFrames(response.Frames, aggregateOverSkipNotice(model.AggregateOver, skippedWithoutField))
		return response
	}

	var frames data.Frames
	for _, result := range results {
		if result.metric == "" {
			continue
		}
		frames = append(frames, buildFrameFromStatistics(result.metric, result.labels, result.metadata, result.statistics, requestedStatistics).Frames...)
	}
	appendNoticeToFrames(frames, previewNotice)

	return backend.DataResponse{Frames: frames}
}

var metadataFields = []string{
	"site", "room", "rack", "feed",
	"asset_type", "asset_id", "location_code",
	"scope", "metric_type", "circuit", "position", "power_type", "phase",
	"service", "team", "criticality",
	"source", "system", "cluster",
}

// buildLabels computes Grafana labels for a metric.
// Fields present in filter are excluded — they are constant for the query and
// would prevent Grafana from joining corresponding series across queries
// (e.g. phase=L1 vs phase=L2 belonging to the same PDU).
// The "metric" label is included only when includeMetric is true.
func buildLabels(metric string, metadata map[string]string, filter map[string]interface{}, includeMetric bool) data.Labels {
	labels := make(data.Labels)
	for _, field := range metadataFields {
		if _, isFilter := filter[field]; isFilter {
			continue
		}
		if v := metadata[field]; v != "" {
			labels[field] = v
		}
	}
	if includeMetric {
		labels["metric"] = metric
	}
	return labels
}

func buildDataResponse(metric string, labels data.Labels, metadata map[string]string, from, to time.Time, result metricq.TimelineResult) backend.DataResponse {
	return buildFrameFromPoints(metric, labels, metadata, extractTimelinePoints(from, to, result))
}

// ── CheckHealth ───────────────────────────────────────────────────────────────

func (d *datasourceInstance) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := d.agent.Rpc(checkCtx, "metricq.management", "history.register",
		metricq.RpcMessage{Function: "history.register"})
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("MetricQ unreachable: %v", err),
		}, nil
	}
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: fmt.Sprintf("Connected to MetricQ (token: %s)", d.token),
	}, nil
}

// ── CallResource ──────────────────────────────────────────────────────────────

type metricsSuggestReq struct {
	Function string                 `json:"function"`
	Field    string                 `json:"field"`
	Filter   map[string]interface{} `json:"filter"`
	Limit    int                    `json:"limit"`
}

type metricsSuggestResp struct {
	Field  string `json:"field"`
	Values []struct {
		Value string `json:"value"`
		Count int    `json:"count"`
	} `json:"values"`
}

type metricCountResp struct {
	Count            int `json:"count"`
	InteractiveLimit int `json:"interactive_limit"`
}

func (d *datasourceInstance) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	// Route: suggest/{field}
	if strings.HasPrefix(req.Path, "suggest/") {
		field := strings.TrimPrefix(req.Path, "suggest/")
		return d.handleSuggest(ctx, field, req.Body, sender)
	}
	// Route: metric-names?infix=...
	if req.Path == "metric-names" {
		return d.handleMetricNames(ctx, req, sender)
	}
	if req.Path == "metric-explorer" {
		return d.handleMetricExplorer(ctx, req, sender)
	}
	if req.Path == "metric-count" {
		return d.handleMetricCount(ctx, req, sender)
	}
	return sender.Send(&backend.CallResourceResponse{Status: http.StatusNotFound})
}

func (d *datasourceInstance) handleMetricNames(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	u, err := url.Parse("?" + string(req.Body))
	if err != nil {
		u = &url.URL{}
	}
	infix := u.Query().Get("infix")

	limit := 100
	respBytes, err := d.agent.Rpc(ctx, "metricq.management", "get_metrics", getMetricsReq{
		Function: "get_metrics",
		Format:   "array",
		Infix:    strings.TrimSpace(infix),
		Historic: true,
		Limit:    &limit,
	})
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte(fmt.Sprintf("get_metrics: %v", err)),
		})
	}

	var parsed struct {
		Metrics []string `json:"metrics"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte(fmt.Sprintf("parse: %v", err)),
		})
	}

	out, _ := json.Marshal(parsed.Metrics)
	return sender.Send(&backend.CallResourceResponse{
		Status:  http.StatusOK,
		Headers: map[string][]string{"Content-Type": {"application/json"}},
		Body:    out,
	})
}

func (d *datasourceInstance) handleMetricExplorer(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	var body struct {
		Infix    string `json:"infix"`
		Selector string `json:"selector"`
		Search   string `json:"search"`
	}
	if err := json.Unmarshal(req.Body, &body); err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadRequest,
			Body:   []byte(fmt.Sprintf("parse body: %v", err)),
		})
	}

	metrics, err := d.resolveMetrics(
		ctx,
		nil,
		map[string]interface{}{},
		strings.TrimSpace(body.Search),
		strings.TrimSpace(body.Infix),
		strings.TrimSpace(body.Selector),
	)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte(fmt.Sprintf("metric explorer: %v", err)),
		})
	}

	type result struct {
		Name        string `json:"name"`
		Description string `json:"description,omitempty"`
		DisplayName string `json:"display_name,omitempty"`
	}
	names := make([]string, 0, len(metrics))
	for name := range metrics {
		names = append(names, name)
	}
	sort.Strings(names)

	out := make([]result, 0, len(names))
	for _, name := range names {
		metadata := metrics[name]
		out = append(out, result{
			Name:        name,
			Description: metadata["description"],
			DisplayName: metadata["display_name"],
		})
	}

	encoded, _ := json.Marshal(out)
	return sender.Send(&backend.CallResourceResponse{
		Status:  http.StatusOK,
		Headers: map[string][]string{"Content-Type": {"application/json"}},
		Body:    encoded,
	})
}

func (d *datasourceInstance) handleMetricCount(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	var body queryModel
	if len(req.Body) > 0 {
		if err := json.Unmarshal(req.Body, &body); err != nil {
			return sender.Send(&backend.CallResourceResponse{
				Status: http.StatusBadRequest,
				Body:   []byte(fmt.Sprintf("parse body: %v", err)),
			})
		}
	}

	if body.Filter == nil {
		body.Filter = map[string]interface{}{}
	}

	explicit := explicitMetrics(body.Metrics, body.Metric)
	if len(explicit) == 0 &&
		!hasQueryFilter(body.Filter) &&
		strings.TrimSpace(body.Search) == "" &&
		strings.TrimSpace(body.Infix) == "" &&
		strings.TrimSpace(body.Selector) == "" {
		encoded, _ := json.Marshal(metricCountResp{Count: 0, InteractiveLimit: interactiveMetricLimit})
		return sender.Send(&backend.CallResourceResponse{
			Status:  http.StatusOK,
			Headers: map[string][]string{"Content-Type": {"application/json"}},
			Body:    encoded,
		})
	}

	metrics, err := d.resolveMetrics(ctx, explicit, body.Filter, strings.TrimSpace(body.Search), strings.TrimSpace(body.Infix), strings.TrimSpace(body.Selector))
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte(fmt.Sprintf("metric count: %v", err)),
		})
	}

	encoded, _ := json.Marshal(metricCountResp{
		Count:            len(orderedActiveMetricNames(metrics, explicit)),
		InteractiveLimit: interactiveMetricLimit,
	})
	return sender.Send(&backend.CallResourceResponse{
		Status:  http.StatusOK,
		Headers: map[string][]string{"Content-Type": {"application/json"}},
		Body:    encoded,
	})
}

func (d *datasourceInstance) handleSuggest(ctx context.Context, field string, body []byte, sender backend.CallResourceResponseSender) error {
	// Parse optional filter context from request body.
	var reqBody struct {
		Filter map[string]interface{} `json:"filter"`
	}
	if len(body) > 0 {
		_ = json.Unmarshal(body, &reqBody)
	}
	if reqBody.Filter == nil {
		reqBody.Filter = map[string]interface{}{}
	}

	rpcCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	respBytes, err := d.agent.Rpc(rpcCtx, "metricq.management", "metrics.suggest",
		metricsSuggestReq{
			Function: "metrics.suggest",
			Field:    field,
			Filter:   reqBody.Filter,
			Limit:    200,
		})
	if err != nil {
		log.DefaultLogger.Warn("metrics.suggest failed", "field", field, "err", err)
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte(fmt.Sprintf("metrics.suggest: %v", err)),
		})
	}

	var parsed metricsSuggestResp
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte(fmt.Sprintf("parse response: %v", err)),
		})
	}

	out, _ := json.Marshal(parsed)
	return sender.Send(&backend.CallResourceResponse{
		Status:  http.StatusOK,
		Headers: map[string][]string{"Content-Type": {"application/json"}},
		Body:    out,
	})
}

// ── unit mapping ──────────────────────────────────────────────────────────────

// normalizeSIUnit converts MetricQ/BACnet unit strings to canonical SI notation
// (e.g. "kilowatts" → "kW", "degreesCelsius" → "°C", "kW" → "kW").
func normalizeSIUnit(unit string) string {
	compact := strings.ReplaceAll(strings.TrimSpace(unit), " ", "")
	if compact == "" {
		return ""
	}

	// Named BACnet / English unit strings (case-sensitive, longest first).
	switch compact {
	case "watts", "Watts":
		return "W"
	case "kilowatts", "kiloWatts":
		return "kW"
	case "megawatts":
		return "MW"
	case "wattHours":
		return "Wh"
	case "kilowattHours":
		return "kWh"
	case "megawattHours":
		return "MWh"
	case "degC", "degreesCelsius":
		return "°C"
	case "degreesFahrenheit":
		return "°F"
	case "degreesKelvin":
		return "K"
	case "cubicMeters":
		return "m³"
	case "cubicMetersPerHour":
		return "m³/h"
	case "hertz":
		return "Hz"
	case "kilohertz":
		return "kHz"
	case "megahertz":
		return "MHz"
	case "kilovoltAmperes", "kilovoltAmperesReactive":
		return "kVA"
	case "voltAmperes":
		return "VA"
	case "bytes":
		return "B"
	case "kilobytes":
		return "kB"
	case "megabytes":
		return "MB"
	case "gigabytes":
		return "GB"
	case "bar", "bars":
		return "bar"
	case "mbar", "millibar", "millibars":
		return "mbar"
	case "pascals":
		return "Pa"
	case "kilopascals":
		return "kPa"
	case "amperes":
		return "A"
	case "milliamperes":
		return "mA"
	case "volts":
		return "V"
	case "millivolts":
		return "mV"
	case "kilovolts":
		return "kV"
	case "litersPerHour":
		return "l/h"
	case "litersPerMinute", "LMin":
		return "l/min"
	case "litersPerSecond":
		return "l/s"
	case "cubicMetersPerMinute":
		return "m³/min"
	case "cubicMetersPerSecond":
		return "m³/s"
	case "metersPerSecond":
		return "m/s"
	case "kilometersPerHour":
		return "km/h"
	case "None", "nan", "noUnits":
		return "1"
	case "partsPerMillion":
		return "ppm"
	case "partsPerBillion":
		return "ppb"
	case "percent", "percentRelativeHumidity":
		return "%"
	case "RPM":
		return "rpm"
	case "millimeters":
		return "mm"
	case "meters":
		return "m"
	case "kilometers":
		return "km"
	case "minutes":
		return "min"
	case "seconds":
		return "s"
	case "hours":
		return "h"
	case "ohms":
		return "Ω"
	case "milliohms":
		return "mΩ"
	case "kilohms":
		return "kΩ"
	case "megohms":
		return "MΩ"
	case "lux":
		return "lx"
	case "candela":
		return "cd"
	case "lumen":
		return "lm"
	case "decibelMilliwatts":
		return "dBm"
	case "decibels":
		return "dB"
	}

	// Case-insensitive fallbacks for plain English names.
	lower := strings.ToLower(compact)
	switch lower {
	case "volt", "volts":
		return "V"
	case "kilovolt", "kilovolts":
		return "kV"
	case "watt", "watts":
		return "W"
	case "kilowatt", "kilowatts":
		return "kW"
	case "ampere", "amperes":
		return "A"
	}

	// SI prefix + base unit pattern.
	// Bases ordered longest-first to avoid partial match (e.g. "wh" before "w").
	type siBase struct {
		suffix string
		canon  string
	}
	bases := []siBase{
		{"wh", "Wh"}, {"va", "VA"}, {"pa", "Pa"}, {"hz", "Hz"},
		{"w", "W"}, {"v", "V"}, {"a", "A"}, {"b", "B"},
	}
	// Strip optional _rms / -rms / _eff / -eff suffix.
	stripped := compact
	for _, sfx := range []string{"_rms", "-rms", "_eff", "-eff"} {
		if strings.HasSuffix(strings.ToLower(stripped), sfx) {
			stripped = stripped[:len(stripped)-len(sfx)]
			break
		}
	}
	strippedLower := strings.ToLower(stripped)
	for _, b := range bases {
		if strings.HasSuffix(strippedLower, b.suffix) {
			prefixRaw := stripped[:len(stripped)-len(b.suffix)]
			var prefix string
			switch prefixRaw {
			case "", " ":
				prefix = ""
			case "n", "N":
				prefix = "n"
			case "u", "U", "μ", "µ":
				prefix = "u"
			case "m":
				prefix = "m" // lowercase = milli
			case "k", "K":
				prefix = "k"
			case "M":
				prefix = "M" // uppercase = Mega
			case "g", "G":
				prefix = "G"
			default:
				continue // unknown prefix, try next base
			}
			return prefix + b.canon
		}
	}

	return compact // unknown – pass through as-is
}

// metricqUnitToGrafana maps a MetricQ/BACnet unit string to a Grafana unit ID.
// Unknown units fall back to the "suffix:" notation so Grafana shows them verbatim.
func metricqUnitToGrafana(unit string) string {
	si := normalizeSIUnit(unit)
	switch si {
	case "", "1":
		return "short"
	// Power
	case "nW":
		return "suffix:nW"
	case "uW":
		return "suffix:µW"
	case "mW":
		return "mwatt"
	case "W":
		return "watt"
	case "kW":
		return "kwatt"
	case "MW":
		return "megwatt"
	case "GW":
		return "gwatt"
	// Energy
	case "Wh":
		return "watth"
	case "mWh":
		return "mwatth"
	case "kWh":
		return "kwatth"
	case "MWh":
		return "Mwatth"
	case "GWh":
		return "gwatth"
	// Apparent power – no native Grafana unit
	case "VA":
		return "suffix:VA"
	case "kVA":
		return "suffix:kVA"
	// Voltage
	case "mV":
		return "suffix:mV"
	case "V":
		return "volt"
	case "kV":
		return "suffix:kV"
	// Current
	case "mA":
		return "suffix:mA"
	case "A":
		return "amp"
	// Frequency
	case "Hz":
		return "hertz"
	case "kHz":
		return "khertz"
	case "MHz":
		return "mhertz"
	case "GHz":
		return "ghertz"
	// Pressure
	case "Pa":
		return "presspa"
	case "kPa":
		return "suffix:kPa"
	case "mbar":
		return "suffix:mbar"
	case "bar":
		return "suffix:bar"
	// Temperature
	case "°C":
		return "celsius"
	case "°F":
		return "fahrenheit"
	case "K":
		return "kelvin"
	// Percentage / humidity
	case "%":
		return "percent"
	// Concentration
	case "ppm":
		return "conc_ppm"
	case "ppb":
		return "conc_ppb"
	// Angular velocity
	case "rpm":
		return "rotrpm"
	// Velocity
	case "m/s":
		return "velocityms"
	case "km/h":
		return "velocitykmh"
	// Length
	case "mm":
		return "lengthmm"
	case "m":
		return "lengthm"
	case "km":
		return "lengthkm"
	// Data
	case "B":
		return "bytes"
	case "kB":
		return "kbytes"
	case "MB":
		return "mbytes"
	case "GB":
		return "gbytes"
	// Time
	case "s":
		return "s"
	case "min":
		return "m"
	case "h":
		return "h"
	// Volume + flow – no native Grafana unit
	case "m³":
		return "suffix:m³"
	case "m³/h":
		return "suffix:m³/h"
	case "m³/min":
		return "suffix:m³/min"
	case "m³/s":
		return "suffix:m³/s"
	case "l/h":
		return "suffix:l/h"
	case "l/min":
		return "suffix:l/min"
	case "l/s":
		return "suffix:l/s"
	// Resistance
	case "mΩ":
		return "suffix:mΩ"
	case "Ω":
		return "suffix:Ω"
	case "kΩ":
		return "suffix:kΩ"
	case "MΩ":
		return "suffix:MΩ"
	// Light
	case "lx":
		return "suffix:lx"
	case "cd":
		return "suffix:cd"
	case "lm":
		return "suffix:lm"
	// RF
	case "dBm":
		return "dBm"
	case "dB":
		return "dB"
	default:
		return "suffix:" + si
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

func sanitizeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	u.User = nil
	return u.String()
}
