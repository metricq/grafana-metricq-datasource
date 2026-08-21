const path = require('path');
const fs = require('fs');
const webpack = require('webpack');

// Minimal asset copy — avoids copy-webpack-plugin's broken ESM deps.
class CopyPluginAssets {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('CopyPluginAssets', () => {
      const dist = path.resolve(__dirname, 'dist');
      const img = path.resolve(dist, 'img');

      fs.mkdirSync(img, { recursive: true });
      fs.copyFileSync(
        path.resolve(__dirname, 'src', 'plugin.json'),
        path.resolve(dist, 'plugin.json')
      );
      fs.copyFileSync(
        path.resolve(__dirname, 'src', 'img', 'metricq.svg'),
        path.resolve(img, 'metricq.svg')
      );
    });
  }
}

// Pakete die Grafana zur Laufzeit bereitstellt — nicht bundlen.
// Quelle: https://grafana.com/developers/plugin-tools/create-a-plugin/develop-a-plugin/build-a-plugin
const externals = [
  'lodash', 'jquery', 'moment', 'emotion',
  '@emotion/react', '@emotion/css',
  'react', 'react-dom', 'react-redux', 'redux',
  'rxjs', 'react-router', 'react-router-dom',
  'd3', 'angular',
  '@grafana/ui', '@grafana/runtime', '@grafana/data', '@grafana/schema',
];

module.exports = {
  context: path.resolve(__dirname, 'src'),
  target: 'web',
  entry: { module: './module.ts' },

  output: {
    clean: true,
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    library: { type: 'amd' },
  },

  externals,

  module: {
    rules: [
      {
        test: /\.[tj]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'swc-loader',
          options: {
            jsc: {
              target: 'es2015',
              parser: { syntax: 'typescript', tsx: true },
              // classic = React.createElement, kein react/jsx-runtime nötig
              transform: { react: { runtime: 'classic' } },
            },
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },

  resolve: { extensions: ['.ts', '.tsx', '.js'] },

  plugins: [
    // React global bereitstellen damit JSX (React.createElement) funktioniert
    new webpack.ProvidePlugin({ React: 'react' }),
    new CopyPluginAssets(),
  ],
};
