FROM grafana/grafana:latest-ubuntu
LABEL maintainer="mario.bielert@tu-dresden.de"

USER grafana
COPY --chown=grafana:root . /var/lib/grafana/plugins/grafana-metricq-datasource

COPY --chown=grafana:root provisioning/datasources/metricq.yaml /etc/grafana/provisioning/datasources

ENV GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=metricq-metricq-datasource
