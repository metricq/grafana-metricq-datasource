## MetricQ Data Source For Grafana

based on [SimpleJson Datasource](https://github.com/grafana/simple-json-datasource), react update based on [Grafana Data Source Plugin Template](https://github.com/grafana/grafana-starter-datasource)

## What is MetricQ Data Source Plugin?

MetricQ Data Source Plugins enables integrating MetricQ with Grafana via [`metricq-grafana`](https://github.com/metricq/metricq-grafana).

## Getting started

This plugins comes with a production build in the `dist/` folder. Just clone it into your Grafana plugins directory.

## Development setup

1. Install dependencies

   ```bash
   yarn install
   ```

2. Build plugin in development mode or run in watch mode

   ```bash
   yarn dev
   ```

   or

   ```bash
   yarn watch
   ```

3. Build plugin in production mode

   ```bash
   yarn build
   ```
