## MetricQ Data Source For Grafana

based on [TypeScript Template Data Source for Grafana](https://github.com/grafana/typescript-template-datasource) and [SimpleJson Datasource](https://github.com/grafana/simple-json-datasource), react update based on [Grafana Data Source Plugin Template](https://github.com/grafana/grafana-starter-datasource)

## What is Grafana Data Source Plugin?

Grafana supports a wide range of data sources, including Prometheus, MySQL, and even Datadog. There’s a good chance you can already visualize metrics from the systems you have set up. In some cases, though, you already have an in-house metrics solution that you’d like to add to your Grafana dashboards. Grafana Data Source Plugins enables integrating such solutions with Grafana.

## Getting started

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

### CHANGELOG

#### v0.0.1

- First version.
