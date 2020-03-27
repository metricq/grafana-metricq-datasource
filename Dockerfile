FROM grafana/grafana:latest-ubuntu
LABEL maintainer="mario.bielert@tu-dresden.de"

USER grafana
COPY --chown=grafana:grafana . /var/lib/grafana/plugins/grafana-metricq-datasource

COPY --chown=grafana:grafana provisioning/datasources/metricq.yaml /etc/grafana/provisioning/datasources
