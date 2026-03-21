#!/bin/bash
# Report outcome after executing a capability
# Usage: bash report.sh <domain> <capability> <true|false> [steps_json]
node /mnt/skills/air-sdk/air.js report "$@"
