#!/bin/sh
set -eu
mkdir -p /data/materials /data/media /data/models
chown node:node /data /data/materials /data/media /data/models
exec gosu node "$@"
