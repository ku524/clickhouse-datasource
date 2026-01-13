#!/bin/sh
set -e

echo "Copying custom ClickHouse datasource plugin..."
mkdir -p /var/lib/grafana/plugins/grafana-clickhouse-datasource
cp -r /etc/grafana-clickhouse-datasource/* /var/lib/grafana/plugins/grafana-clickhouse-datasource/
echo "Plugin copied successfully"

exec /run.sh "$@"
