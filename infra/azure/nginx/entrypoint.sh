#!/bin/sh
set -eu
envsubst '${GATEWAY_PORT} ${WORKER_PORT} ${THINK_PATH} ${VOICE_WS_PATH} ${NGINX_CLIENT_MAX_BODY}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
