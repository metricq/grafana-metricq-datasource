import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { AsyncSelect, Button, Checkbox, getTagColorsFromName, Input, Modal, RadioButtonGroup, Select } from '@grafana/ui';
import { MetricExplorerResult, MetricQDataSource } from '../datasource';
import {
  MetricQDataSourceOptions,
  MetricQQuery,
  FILTERABLE_FIELDS,
  SUGGESTABLE_FIELDS,
  GROUPABLE_FIELDS,
  AGGREGATION_OPTIONS,
  HISTORY_STATISTIC_OPTIONS,
  HistoryStatistic,
  defaultQuery,
} from '../types';

type Props = QueryEditorProps<MetricQDataSource, MetricQQuery, MetricQDataSourceOptions>;

const FIELD_OPTIONS: Array<SelectableValue<string>> = FILTERABLE_FIELDS
  .filter((f) => f !== 'description' && f !== 'display_name')
  .map((f) => ({ label: f, value: f }));

const GROUP_BY_OPTIONS: Array<SelectableValue<string>> = GROUPABLE_FIELDS.map((f) => ({ label: f, value: f }));

const AGGREGATE_OPTIONS: Array<SelectableValue<string>> = AGGREGATION_OPTIONS.map((mode) => ({
  label: mode,
  value: mode,
}));

const EXPLORER_MODE_OPTIONS = [
  { label: 'Infix', value: 'infix' as const },
  { label: 'Regex', value: 'regex' as const },
  { label: 'Description search', value: 'search' as const },
];

type DashboardVariable = {
  name?: string;
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  opacity: 0.75,
};

function formatQueryValue(value: string | string[]) {
  return Array.isArray(value) ? value.join(', ') : value;
}

function truncate(text: string, maxLength = 48) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

/**
 * Suggestions are useful for literal metadata, but cannot help with a Grafana
 * template expression.  More importantly, sending the unresolved expression
 * to MetricQ can turn a simple "$system" entry into a slow, broad request.
 */
function containsTemplateVariable(value: string) {
  return /\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[^}]+\})|\[\[[^\]]+\]\]/.test(value);
}

function SelectionToken({ field, value, onRemove }: { field: string; value: string; onRemove: () => void }) {
  const { color, borderColor } = getTagColorsFromName(field);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: color,
        border: `1px solid ${borderColor}`,
        borderRadius: 999,
        fontSize: 12,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        color: '#ffffff',
        overflow: 'hidden',
      }}
    >
      <span style={{ padding: '5px 10px', background: borderColor, fontWeight: 500 }}>{field}</span>
      <span style={{ padding: '5px 10px', background: color, fontWeight: 500 }}>{value}</span>
      <button
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 10px 0 0',
          color: 'inherit',
          opacity: 0.8,
          lineHeight: 1,
          fontSize: 12,
        }}
        title="Remove selection"
      >
        x
      </button>
    </div>
  );
}

function ExplorerResultRow({ item, onSelect }: { item: MetricExplorerResult; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%',
        textAlign: 'left',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 6,
        padding: 10,
        cursor: 'pointer',
        color: 'inherit',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
      {item.description && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{item.description}</div>}
    </button>
  );
}

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const q: MetricQQuery = { ...(defaultQuery as MetricQQuery), ...query };
  const metrics = useMemo(() => {
    const values = [q.metric, ...(Array.isArray(q.metrics) ? q.metrics : [])];
    return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
  }, [q.metric, q.metrics]);
  const filter = q.filter ?? {};
  const search = q.search ?? '';
  const infix = q.infix ?? '';
  const selector = q.selector ?? '';
  const collapseBy = q.collapseBy ?? q.groupBy ?? '';
  const aggregateOver = q.aggregateOver ?? '';
  const aggregate = q.aggregate ?? 'none';
  const statistics = useMemo<HistoryStatistic[]>(() => {
    const selected = Array.isArray(q.statistics)
      ? q.statistics.filter((value): value is HistoryStatistic =>
          (HISTORY_STATISTIC_OPTIONS as readonly string[]).includes(value)
        )
      : [];
    return selected.length > 0 ? Array.from(new Set(selected)) : ['mean'];
  }, [q.statistics]);

  const [isAdding, setIsAdding] = useState(false);
  const [addField, setAddField] = useState('');
  const [addValue, setAddValue] = useState('');

  const [showDescriptionSearch, setShowDescriptionSearch] = useState(Boolean(search.trim()));
  const [searchDraft, setSearchDraft] = useState(search);

  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [explorerMode, setExplorerMode] = useState<'infix' | 'regex' | 'search'>('infix');
  const [explorerQuery, setExplorerQuery] = useState('');
  const [explorerResults, setExplorerResults] = useState<MetricExplorerResult[]>([]);
  const [isExplorerLoading, setIsExplorerLoading] = useState(false);

  useEffect(() => {
    setSearchDraft(search);
    if (!search.trim()) {
      setShowDescriptionSearch(false);
    }
  }, [search]);

  const hasMetricSelection = metrics.length > 0;
  const hasDescriptionSearch = Boolean(search.trim());
  const hasFilterSelection = Object.keys(filter).length > 0;
  const hasNameQuery = Boolean(infix.trim()) || Boolean(selector.trim());
  const hasActiveResolverQuery = hasMetricSelection || hasFilterSelection || hasDescriptionSearch || hasNameQuery;
  const hasActiveQuery = hasActiveResolverQuery || Boolean(collapseBy) || Boolean(aggregateOver);
  const hasPendingSearchChange = searchDraft !== search;
  const filterKey = useMemo(() => JSON.stringify(filter), [filter]);
  const isSuggestable = (SUGGESTABLE_FIELDS as readonly string[]).includes(addField);
  const availableFieldOptions = useMemo(
    () => FIELD_OPTIONS.filter((option) => option.value === addField || !(option.value && option.value in filter)),
    [addField, filter]
  );
  const templateVariableOptions = useMemo<Array<SelectableValue<string>>>(() => {
    const templateSrv = getTemplateSrv() as unknown as { getVariables?: () => DashboardVariable[] };
    const names = templateSrv.getVariables?.()
      .map((variable) => variable.name?.trim())
      .filter((name): name is string => Boolean(name)) ?? [];

    return Array.from(new Set(names))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({ label: `$${name} (variable)`, value: `$${name}` }));
  }, []);

  const querySummary = useMemo(() => {
    let reductionSuffix = '';
    if (collapseBy) {
      reductionSuffix = ` collapsed by ${collapseBy}${aggregate !== 'none' ? ` (${aggregate})` : ''}`;
    } else if (aggregateOver) {
      reductionSuffix = ` aggregated over ${aggregateOver}${aggregate !== 'none' ? ` (${aggregate})` : ''}`;
    }

    if (metrics.length === 1) {
      return `Explicit metric: ${metrics[0]}${reductionSuffix ? `;${reductionSuffix}` : ''}`;
    }

    if (metrics.length > 1) {
      return `${metrics.length} explicit metrics selected${reductionSuffix ? `;${reductionSuffix}` : ''}`;
    }

    const parts: string[] = [];
    const filterEntries = Object.entries(filter);

    if (filterEntries.length > 0) {
      const preview = filterEntries
        .slice(0, 2)
        .map(([field, value]) => `${field}=${truncate(formatQueryValue(value))}`)
        .join(', ');
      parts.push(filterEntries.length > 2 ? `${preview}, +${filterEntries.length - 2} more filters` : preview);
    }

    if (hasDescriptionSearch) {
      parts.push(`description contains "${truncate(search.trim(), 32)}"`);
    }

    if (infix.trim()) {
      parts.push(`name contains "${truncate(infix.trim(), 32)}"`);
    }

    if (selector.trim()) {
      parts.push(`name matches ${truncate(selector.trim(), 32)}`);
    }

    if (collapseBy) {
      parts.push(`collapsed by ${collapseBy}${aggregate !== 'none' ? ` (${aggregate})` : ''}`);
    } else if (aggregateOver) {
      parts.push(`aggregated over ${aggregateOver}${aggregate !== 'none' ? ` (${aggregate})` : ''}`);
    }

    return parts.length > 0 ? parts.join('; ') : 'No explicit metrics or filters selected';
  }, [aggregate, aggregateOver, collapseBy, filter, hasDescriptionSearch, infix, metrics, search, selector]);

  useEffect(() => {
    if (hasMetricSelection) {
      setIsAdding(false);
      setShowDescriptionSearch(false);
      setAddField('');
      setAddValue('');
    }
  }, [hasMetricSelection]);

  useEffect(() => {
    if (!isExplorerOpen || explorerQuery.trim().length < 2) {
      setExplorerResults([]);
      setIsExplorerLoading(false);
      return;
    }

    let cancelled = false;
    setIsExplorerLoading(true);
    const timer = setTimeout(async () => {
      const results = await datasource.searchMetrics(
        explorerMode === 'regex'
          ? { selector: explorerQuery }
          : explorerMode === 'search'
            ? { search: explorerQuery }
            : { infix: explorerQuery }
      );
      if (!cancelled) {
        setExplorerResults(results);
        setIsExplorerLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [datasource, explorerMode, explorerQuery, isExplorerOpen]);

  const applyQuery = useCallback(
    (next: MetricQQuery) => {
      onChange(next);
      onRunQuery();
    },
    [onChange, onRunQuery]
  );

  const loadValueOptions = useCallback(
    async (inputValue: string): Promise<Array<SelectableValue<string>>> => {
      if (!addField) {
        return [];
      }

      const value = inputValue.trim();
      const lower = value.toLowerCase();
      const matchingVariables = templateVariableOptions.filter((option) =>
        !lower || option.value?.toLowerCase().includes(lower)
      );
      if (containsTemplateVariable(value)) {
        return matchingVariables.length > 0 ? matchingVariables : [{ label: value, value }];
      }

      const suggestions = await datasource.suggestValues(addField, filter);
      const matchingSuggestions = suggestions
        .filter((entry) => !lower || entry.value.toLowerCase().includes(lower))
        .slice(0, 16)
        .map((entry) => ({ label: `${entry.value} (${entry.count})`, value: entry.value }));
      return [...matchingVariables, ...matchingSuggestions];
    },
    [addField, datasource, filter, templateVariableOptions]
  );

  const commitFilter = useCallback(
    (field: string, value: string) => {
      if (!field || !value) {
        return;
      }

      applyQuery({
        ...q,
        metric: undefined,
        metrics: [],
        filter: { ...filter, [field]: value },
      });
      setIsAdding(false);
      setAddField('');
      setAddValue('');
    },
    [applyQuery, filter, q]
  );

  const removeFilter = useCallback(
    (field: string) => {
      const next = { ...filter };
      delete next[field];
      applyQuery({ ...q, filter: next });
    },
    [applyQuery, filter, q]
  );

  const clearQuery = useCallback(() => {
    applyQuery({
      ...q,
      metric: undefined,
      metrics: [],
      filter: {},
      search: '',
      infix: '',
      selector: '',
      groupBy: undefined,
      collapseBy: '',
      aggregateOver: '',
      aggregate: 'none',
      statistics: ['mean'],
    });
    setIsAdding(false);
    setAddField('');
    setAddValue('');
    setSearchDraft('');
    setShowDescriptionSearch(false);
  }, [applyQuery, q]);

  const removeMetric = useCallback(
    (name: string) => {
      applyQuery({ ...q, metric: undefined, metrics: metrics.filter((metric) => metric !== name) });
    },
    [applyQuery, metrics, q]
  );

  const selectMetric = useCallback(
    (name: string) => {
      if (!name.trim() || metrics.includes(name)) {
        return;
      }

      applyQuery({
        ...q,
        metric: undefined,
        metrics: [...metrics, name],
        filter: {},
        search: '',
        infix: '',
        selector: '',
      });
      setShowDescriptionSearch(false);
      setSearchDraft('');
      setIsAdding(false);
      setAddField('');
      setAddValue('');
    },
    [applyQuery, metrics, q]
  );

  const commitSearch = useCallback(
    (nextSearch: string) => {
      applyQuery({
        ...q,
        metric: undefined,
        metrics: [],
        search: nextSearch,
      });
      setShowDescriptionSearch(false);
    },
    [applyQuery, q]
  );

  const clearSearch = useCallback(() => {
    applyQuery({
      ...q,
      metric: undefined,
      metrics: [],
      search: '',
    });
    setSearchDraft('');
    setShowDescriptionSearch(false);
  }, [applyQuery, q]);

  const activeTokens = useMemo(() => {
    const tokens: React.ReactNode[] = [];

    for (const metric of metrics) {
      tokens.push(<SelectionToken key={`metric-${metric}`} field="metric" value={metric} onRemove={() => removeMetric(metric)} />);
    }

    for (const [field, value] of Object.entries(filter)) {
      tokens.push(
        <SelectionToken
          key={field}
          field={field}
          value={formatQueryValue(value)}
          onRemove={() => removeFilter(field)}
        />
      );
    }

    if (hasDescriptionSearch) {
      tokens.push(
        <SelectionToken
          key="description-search"
          field="description"
          value={`contains "${truncate(search.trim(), 32)}"`}
          onRemove={clearSearch}
        />
      );
    }

    return tokens;
  }, [clearSearch, filter, hasDescriptionSearch, metrics, removeFilter, removeMetric, search]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4 }}>
        <div style={{ flex: 1, display: 'grid', gap: 4 }}>
          <Input value={querySummary} readOnly />
        </div>
        <Button variant="secondary" onClick={() => setIsExplorerOpen(true)}>
          Browse metrics
        </Button>
        {hasActiveQuery && (
          <Button variant="secondary" onClick={clearQuery}>
            Clear query
          </Button>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minHeight: 28 }}>
        {activeTokens.length > 0 ? activeTokens : <div style={{ fontSize: 12, opacity: 0.55 }}>No active filters or explicit metrics.</div>}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={sectionLabelStyle}>History values</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {HISTORY_STATISTIC_OPTIONS.map((statistic) => (
            <Checkbox
              key={statistic}
              label={statistic}
              value={statistics.includes(statistic)}
              disabled={Boolean(collapseBy || aggregateOver)}
              onChange={(event) => {
                const next = event.currentTarget.checked
                  ? [...statistics, statistic]
                  : statistics.filter((value) => value !== statistic);
                if (next.length > 0) {
                  applyQuery({ ...q, statistics: next });
                }
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {collapseBy || aggregateOver
            ? 'History values apply to individual metrics and are unavailable while metrics are collapsed or aggregated.'
            : 'Values from the same MetricQ history interval share labels and use related colors. Count is displayed without the metric unit.'}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={sectionLabelStyle}>Filter query by</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            variant={isAdding ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setIsAdding((value) => !value)}
            disabled={hasMetricSelection}
            title={hasMetricSelection ? 'Clear explicit metrics before adding filters' : 'Add a metadata filter'}
          >
            Add Tag Filter
          </Button>
          <Button
            variant={showDescriptionSearch ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowDescriptionSearch((value) => !value)}
            disabled={hasMetricSelection}
            title={hasMetricSelection ? 'Clear explicit metrics before searching descriptions' : 'Search description and display_name'}
          >
            Add Description Filter
          </Button>
        </div>
      </div>

      {isAdding && !hasMetricSelection && (
        <div style={{ display: 'grid', gap: 8, padding: '4px 0' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ width: 180 }}>
              <Select
                options={availableFieldOptions}
                value={addField ? { label: addField, value: addField } : null}
                onChange={(value) => {
                  setAddField(value?.value ?? '');
                  setAddValue('');
                }}
                placeholder="Field"
                width={22}
                isClearable={false}
              />
            </div>
            <div style={{ width: 240 }}>
              {isSuggestable ? (
                <AsyncSelect
                  key={`value-${addField}-${filterKey}`}
                  loadOptions={loadValueOptions}
                  value={addValue ? { label: addValue, value: addValue } : null}
                  onChange={(value) => setAddValue(value?.value ?? '')}
                  isClearable
                  allowCustomValue
                  placeholder="Value"
                  defaultOptions
                  cacheOptions={false}
                  loadingMessage="Searching values..."
                  noOptionsMessage="No values"
                />
              ) : (
                <Input
                  value={addValue}
                  onChange={(e) => setAddValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitFilter(addField, addValue);
                    }
                  }}
                  placeholder="Value"
                />
              )}
            </div>
            <Button size="sm" onClick={() => commitFilter(addField, addValue)} disabled={!addField || !addValue}>
              Add filter
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setIsAdding(false);
                setAddField('');
                setAddValue('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showDescriptionSearch && !hasMetricSelection && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.currentTarget.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                name="metricq-description-search"
                type="search"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchDraft.trim() && hasPendingSearchChange) {
                    commitSearch(searchDraft);
                  }
                  if (e.key === 'Escape') {
                    setSearchDraft(search);
                    setShowDescriptionSearch(false);
                  }
                }}
                placeholder="Search description or display_name"
              />
            </div>
            <Button
              size="sm"
              onClick={() => commitSearch(searchDraft)}
              disabled={!searchDraft.trim() || !hasPendingSearchChange}
            >
              Add filter
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchDraft(search);
                setShowDescriptionSearch(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 180, display: 'grid', gap: 4 }}>
            <div style={sectionLabelStyle}>Collapse by</div>
            <Select
              options={[{ label: 'None', value: '' }, ...GROUP_BY_OPTIONS]}
              value={collapseBy ? { label: collapseBy, value: collapseBy } : { label: 'None', value: '' }}
              onChange={(value) => {
                const nextCollapseBy = value?.value ?? '';
                applyQuery({
                  ...q,
                  groupBy: undefined,
                  collapseBy: nextCollapseBy,
                  aggregateOver: '',
                  aggregate: nextCollapseBy ? (aggregate === 'none' ? 'mean' : aggregate) : 'none',
                });
              }}
              placeholder="Collapse by"
              width={22}
              isClearable={false}
            />
          </div>

          <div style={{ width: 180, display: 'grid', gap: 4 }}>
            <div style={sectionLabelStyle}>Aggregate over</div>
            <Select
              options={[{ label: 'None', value: '' }, ...GROUP_BY_OPTIONS]}
              value={aggregateOver ? { label: aggregateOver, value: aggregateOver } : { label: 'None', value: '' }}
              onChange={(value) => {
                const nextAggregateOver = value?.value ?? '';
                applyQuery({
                  ...q,
                  groupBy: undefined,
                  collapseBy: '',
                  aggregateOver: nextAggregateOver,
                  aggregate: nextAggregateOver ? (aggregate === 'none' ? 'mean' : aggregate) : 'none',
                });
              }}
              placeholder="Aggregate over"
              width={22}
              isClearable={false}
            />
          </div>

          <div style={{ width: 160, display: 'grid', gap: 4 }}>
            <div style={sectionLabelStyle}>Aggregate using</div>
            <Select
              options={AGGREGATE_OPTIONS}
              value={{ label: aggregate, value: aggregate }}
              onChange={(value) => {
                const nextAggregate = (value?.value ?? 'none') as MetricQQuery['aggregate'];
                applyQuery({
                  ...q,
                  aggregate: collapseBy || aggregateOver ? nextAggregate : 'none',
                });
              }}
              placeholder="Aggregation"
              width={20}
              isClearable={false}
              disabled={!collapseBy && !aggregateOver}
            />
          </div>

          <div style={{ display: 'grid', gap: 4 }}>
            <div style={sectionLabelStyle}>Reset</div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                applyQuery({
                  ...q,
                  groupBy: undefined,
                  collapseBy: '',
                  aggregateOver: '',
                  aggregate: 'none',
                })
              }
              disabled={!collapseBy && !aggregateOver && aggregate === 'none'}
            >
              Reset
            </Button>
          </div>
        </div>
      </div>

      {isExplorerOpen && (
        <Modal title="Select metrics" isOpen={isExplorerOpen} onDismiss={() => setIsExplorerOpen(false)} closeOnBackdropClick>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <RadioButtonGroup
                options={EXPLORER_MODE_OPTIONS}
                value={explorerMode}
                onChange={(value) => {
                  setExplorerMode(value as 'infix' | 'regex' | 'search');
                  setExplorerResults([]);
                }}
              />
              <div style={{ flex: 1 }}>
                <Input
                  value={explorerQuery}
                  onChange={(e) => setExplorerQuery(e.currentTarget.value)}
                  placeholder={
                    explorerMode === 'regex'
                      ? '^LZR\\.CC.*\\.power$'
                      : explorerMode === 'search'
                        ? 'Search descriptions'
                        : 'Search metric names'
                  }
                  autoFocus
                />
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
              {explorerQuery.trim().length < 2 && <div style={{ fontSize: 12, opacity: 0.6 }}>Type at least 2 characters.</div>}
              {isExplorerLoading && <div style={{ fontSize: 12, opacity: 0.6 }}>Loading matches...</div>}
              {!isExplorerLoading && explorerQuery.trim().length >= 2 && explorerResults.length === 0 && (
                <div style={{ fontSize: 12, opacity: 0.6 }}>No matching metrics.</div>
              )}
              {!isExplorerLoading &&
                explorerResults.map((item) => (
                  <ExplorerResultRow key={item.name} item={item} onSelect={() => selectMetric(item.name)} />
                ))}
            </div>

            <Modal.ButtonRow>
              <Button variant="secondary" onClick={() => setIsExplorerOpen(false)}>
                Close
              </Button>
            </Modal.ButtonRow>
          </div>
        </Modal>
      )}
    </div>
  );
}
