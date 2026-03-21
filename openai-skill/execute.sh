#!/bin/bash
# Get execution plan for a capability
# Usage: bash execute.sh <domain> <capability> [params_json]
node /mnt/skills/air-sdk/air.js execute "$@"
